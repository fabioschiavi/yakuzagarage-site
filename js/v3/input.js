// input.js — gestos do canvas (seção 7 do SPEC-3D).
// Sem import de "three": o classificador é puro e roda no node; createInput só toca o DOM.
// Coordenadas sempre em px CSS locais ao canvas (offsetX/offsetY); tempo em ms.

// Números da seção 7. doubleTap e rampMs não estão na spec: escolha nossa, ajustável.
export const GESTURE = Object.freeze({
  holdMs: 180,      // hold = pelo menos 180 ms parado
  holdPx: 8,        // ... e menos de 8 px de movimento
  scrubPx: 10,      // scrub = |dx| > |dy| e mais de 10 px
  scrollPx: 4,      // página rolou mais que isso durante os 180 ms: não é hold
  doubleTapMs: 300, // do primeiro up ao segundo down
  doubleTapPx: 24,
  rampMs: 1200,     // amount 0..1 do hold; 1.2 s casa com a rampa de F_load
  vxSmooth: 0.5,    // EMA da velocidade do scrub, tira o serrilhado dos eventos
  scrubIdleMs: 50,  // dedo parado no scrub sem pointermove: velocidade real é 0 (3 quadros a 60 Hz)
});

const IDLE = 0, PENDING = 1, HOLD = 2, SCRUB = 3, DEAD = 4;
export const GESTURE_STATE = Object.freeze({ IDLE, PENDING, HOLD, SCRUB, DEAD });

// Máquina de estados pura. emit(type, payload) recebe sempre os MESMOS objetos de payload
// (zero lixo por frame): quem precisar guardar valores copia.
export class GestureClassifier {
  constructor(emit, opts) {
    this.o = Object.assign({}, GESTURE, opts || null);
    this.emit = emit;
    this.state = IDLE;
    this.id = -1;
    this.nDown = 0;      // ponteiros pressionados; 2+ = pinça, aborta o gesto
    this.x0 = 0; this.y0 = 0; this.t0 = 0; this.s0 = 0;
    this.x = 0; this.y = 0;
    this.moved = false;  // passou de holdPx: já não pode ser hold nem tap
    this.lastX = 0; this.lastT = 0; this.vx = 0;
    this.lastTapT = -1e9; this.lastTapX = 0; this.lastTapY = 0;
    this.dblCand = false;
    this.holdEv = { x: 0, y: 0, amount: 0 };
    this.releaseEv = { x: 0, y: 0, heldMs: 0 };
    // active=false no último evento: o spin troca de "dedo manda" para decaimento de 0.6 s
    this.scrubEv = { vx: 0, active: false };
    this.tapEv = { x: 0, y: 0, hit: null };
    this.dblEv = { x: 0, y: 0 };
  }

  // SCRUB também precisa de tick: dedo parado não gera pointermove e o vx ficaria preso
  get needsTick() { return this.state === PENDING || this.state === HOLD || this.state === SCRUB; }

  down(id, x, y, t, scrollY) {
    this.nDown++;
    if (this.nDown > 1) { this._abort(t); this.state = DEAD; return; }
    const o = this.o;
    this.state = PENDING;
    this.id = id;
    this.x0 = this.x = x; this.y0 = this.y = y;
    this.t0 = t; this.s0 = scrollY || 0;
    this.moved = false;
    this.vx = 0;
    this.lastX = x; this.lastT = t;
    const dx = x - this.lastTapX, dy = y - this.lastTapY;
    this.dblCand = t - this.lastTapT <= o.doubleTapMs && dx * dx + dy * dy <= o.doubleTapPx * o.doubleTapPx;
    // o tap anterior só vale para ESTE toque; se este virar hold/scrub, o próximo não casa com ele
    this.lastTapT = -1e9;
  }

  move(id, x, y, t, scrollY) {
    if (id !== this.id) return;
    this.x = x; this.y = y;
    const o = this.o, st = this.state;
    if (st === PENDING) {
      if (this._scrolled(scrollY)) { this.state = DEAD; return; }
      const dx = x - this.x0, dy = y - this.y0;
      const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
      if (adx > ady && adx > o.scrubPx) {
        this.state = SCRUB;
        // velocidade do último trecho, não desde o down: dedo que descansou e depois
        // varreu não pode começar com vx subestimado
        let ddt = t - this.lastT, ddx = x - this.lastX;
        if (ddt <= 1) { ddt = t - this.t0; ddx = dx; }
        this.vx = ddx / (ddt > 1 ? ddt : 1) * 1000;
        this.lastX = x; this.lastT = t;
        this.scrubEv.vx = this.vx; this.scrubEv.active = true;
        this.emit('scrub', this.scrubEv);
        return;
      }
      this.lastX = x; this.lastT = t;
      if (dx * dx + dy * dy >= o.holdPx * o.holdPx) {
        this.moved = true;
        // vertical: é rolagem da página (pan-y), sai do caminho para sempre
        if (ady >= adx) this.state = DEAD;
      }
    } else if (st === HOLD) {
      const dx = x - this.x0, dy = y - this.y0;
      if (dx * dx + dy * dy >= o.holdPx * o.holdPx) { this._release(t); this.state = DEAD; }
    } else if (st === SCRUB) {
      const dt = t - this.lastT;
      if (dt <= 0) return; // eventos coalescidos com o mesmo timestamp: espera o próximo
      const inst = (x - this.lastX) / dt * 1000;
      this.vx += (inst - this.vx) * o.vxSmooth;
      this.lastX = x; this.lastT = t;
      this.scrubEv.vx = this.vx; this.scrubEv.active = true;
      this.emit('scrub', this.scrubEv);
    }
  }

  up(id, x, y, t, scrollY) {
    if (this.nDown > 0) this.nDown--;
    if (id === this.id && this.state !== DEAD) {
      if (x !== this.x || y !== this.y) this.move(id, x, y, t, scrollY);
      const st = this.state;
      if (st === PENDING && !this.moved && !this._scrolled(scrollY)) {
        // tick atrasado (rAF lento): passou de 180 ms, então era hold
        if (t - this.t0 >= this.o.holdMs) { this.state = HOLD; this._emitHold(t); this._release(t); }
        else this._tap(t);
      } else if (st === HOLD) this._release(t);
      else if (st === SCRUB) this._endScrub();
    }
    if (id === this.id) { this.id = -1; this.state = this.nDown > 0 ? DEAD : IDLE; }
    else if (this.nDown === 0) this.state = IDLE;
  }

  // pointercancel: o navegador assumiu (rolagem pan-y) ou o toque sumiu
  cancel(id, t) {
    if (this.nDown > 0) this.nDown--;
    if (id === this.id) {
      this._abort(t || this.t0);
      this.id = -1;
      this.state = this.nDown > 0 ? DEAD : IDLE;
    } else if (this.nDown === 0) this.state = IDLE;
  }

  // chamado por frame enquanto needsTick; o hold nasce por tempo, não por evento
  tick(t, scrollY) {
    const st = this.state;
    if (st === PENDING) {
      if (this._scrolled(scrollY)) { this.state = DEAD; return; }
      if (!this.moved && t - this.t0 >= this.o.holdMs) { this.state = HOLD; this._emitHold(t); }
    } else if (st === HOLD) this._emitHold(t);
    else if (st === SCRUB && this.vx !== 0 && t - this.lastT > this.o.scrubIdleMs) {
      // dedo parou mas continua na tela: velocidade 0, dedo ainda manda (active)
      this.vx = 0;
      this.scrubEv.vx = 0; this.scrubEv.active = true;
      this.emit('scrub', this.scrubEv);
    }
  }

  // novo toque primário: zera contagem presa por um up perdido
  reset(t) {
    this._abort(t || this.t0);
    this.state = IDLE; this.id = -1; this.nDown = 0;
  }

  _scrolled(scrollY) {
    const d = (scrollY || 0) - this.s0;
    return (d < 0 ? -d : d) > this.o.scrollPx;
  }

  _abort(t) {
    if (this.state === HOLD) this._release(t);
    else if (this.state === SCRUB) this._endScrub();
  }

  // fim do scrub: sem este evento quem trava o último vx gira a roda para sempre
  _endScrub() {
    const ev = this.scrubEv;
    ev.vx = 0; ev.active = false;
    this.vx = 0;
    this.emit('scrub', ev);
  }

  _emitHold(t) {
    const o = this.o, ev = this.holdEv;
    let a = (t - this.t0 - o.holdMs) / o.rampMs;
    ev.amount = a < 0 ? 0 : a > 1 ? 1 : a;
    ev.x = this.x; ev.y = this.y;
    this.emit('hold', ev);
  }

  _release(t) {
    const ev = this.releaseEv;
    ev.x = this.x; ev.y = this.y; ev.heldMs = t - this.t0;
    this.emit('release', ev);
  }

  _tap(t) {
    if (this.dblCand) {
      this.lastTapT = -1e9; // triplo toque não vira dois doubletaps
      this.dblEv.x = this.x; this.dblEv.y = this.y;
      this.emit('doubletap', this.dblEv);
      return;
    }
    this.lastTapT = t; this.lastTapX = this.x; this.lastTapY = this.y;
    const ev = this.tapEv;
    ev.x = this.x; ev.y = this.y; ev.hit = null;
    this.emit('tap', ev);
  }
}

export function createGestureClassifier(emit, opts) { return new GestureClassifier(emit, opts); }

// Hit test só por círculos projetados (seção 7). proxies: array de {x, y, r, enabled?, name?}
// em px do canvas, mutado pelo dono a cada frame, ou função que devolve esse array.
export function hitTestCircles(proxies, x, y) {
  const list = typeof proxies === 'function' ? proxies() : proxies;
  if (!list) return null;
  let best = null, bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || p.enabled === false) continue;
    const dx = x - p.x, dy = y - p.y, d = dx * dx + dy * dy;
    if (d <= p.r * p.r && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

const TYPES = ['hold', 'release', 'scrub', 'doubletap', 'tap', 'pointer'];

// Emissor de 'hold' {x,y,amount}, 'release' {x,y,heldMs}, 'scrub' {vx px/s},
// 'doubletap' {x,y}, 'tap' {x,y,hit}, 'pointer' {x,y,ndcX,ndcY,vx,vy,inside,down,ray}.
// ray só com opts.THREE + opts.camera (input não importa three); sem eles fica null e a
// coreografia monta o raio com os NDC. 'scrub' {vx, active}: active=false marca o fim.
export function createInput(canvas, opts) {
  opts = opts || {};
  const win = canvas.ownerDocument.defaultView;
  const doc = canvas.ownerDocument;
  let proxies = opts.hitProxies || null;
  // copy-on-write: on/off dentro de um handler não quebra o laço do emit
  const handlers = {};
  for (let i = 0; i < TYPES.length; i++) handlers[TYPES[i]] = [];

  function emit(type, ev) {
    const list = handlers[type];
    for (let i = 0; i < list.length; i++) list[i](ev);
  }
  function sink(type, ev) {
    if (type === 'tap') ev.hit = hitTestCircles(proxies, ev.x, ev.y);
    emit(type, ev);
  }
  const cls = new GestureClassifier(sink, opts.gesture);

  // pan-y: rolagem vertical sempre é do navegador; nada de preventDefault em pointer
  const cs = canvas.style;
  cs.touchAction = 'pan-y';
  cs.userSelect = 'none';
  cs.webkitUserSelect = 'none';
  cs.webkitTouchCallout = 'none';

  // 'pointer' {ray} da seção 7: só existe se o boot passar THREE e camera (input não importa three).
  // Raio montado no evento; quem precisa dele por quadro com câmera andando chama api.updateRay().
  const THREE = opts.THREE || null;
  let camera = opts.camera || null;
  const rc = THREE ? new THREE.Raycaster() : null;
  const ndc = THREE ? new THREE.Vector2() : null;
  const pev = { x: 0, y: 0, ndcX: 0, ndcY: 0, vx: 0, vy: 0, inside: false, down: false, ray: rc ? rc.ray : null };
  function updateRay() {
    if (!rc || !camera) return null;
    ndc.set(pev.ndcX, pev.ndcY);
    rc.setFromCamera(ndc, camera);
    return pev.inside ? rc.ray : null;
  }
  let lastPT = 0;
  function pointerOut(e, inside) {
    const x = e.offsetX, y = e.offsetY;
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const dt = e.timeStamp - lastPT;
    if (dt > 0 && pev.inside) { pev.vx = (x - pev.x) / dt * 1000; pev.vy = (y - pev.y) / dt * 1000; }
    else { pev.vx = 0; pev.vy = 0; }
    lastPT = e.timeStamp;
    pev.x = x; pev.y = y;
    pev.ndcX = x / w * 2 - 1;
    pev.ndcY = 1 - y / h * 2;
    pev.inside = inside;
    pev.down = cls.state !== IDLE;
    updateRay();
    emit('pointer', pev);
  }

  let raf = 0;
  function frame() {
    raf = 0;
    cls.tick(win.performance.now(), win.scrollY);
    if (cls.needsTick) raf = win.requestAnimationFrame(frame);
  }
  function startTicking() { if (!raf && cls.needsTick) raf = win.requestAnimationFrame(frame); }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary) cls.reset(e.timeStamp);
    cls.down(e.pointerId, e.offsetX, e.offsetY, e.timeStamp, win.scrollY);
    pointerOut(e, true);
    // toque já tem captura implícita; o mouse precisa para arrastar fora do canvas
    if (e.pointerType === 'mouse') { try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ } }
    startTicking();
  }
  function onMove(e) {
    cls.move(e.pointerId, e.offsetX, e.offsetY, e.timeStamp, win.scrollY);
    pointerOut(e, true);
  }
  function onUp(e) {
    cls.up(e.pointerId, e.offsetX, e.offsetY, e.timeStamp, win.scrollY);
    pointerOut(e, e.pointerType === 'mouse'); // dedo saiu da tela: sem repulsão nos destroços
  }
  function onCancel(e) {
    cls.cancel(e.pointerId, e.timeStamp);
    pev.inside = false; pev.down = false; pev.vx = 0; pev.vy = 0;
    emit('pointer', pev);
  }
  function onLeave(e) {
    if (e.pointerType !== 'mouse') return;
    pev.inside = false; pev.vx = 0; pev.vy = 0;
    emit('pointer', pev);
  }
  // long-press do Android/clique direito não abre menu no meio de um hold
  function onContext(e) { if (cls.state === PENDING || cls.state === HOLD) e.preventDefault(); }
  // troca de app no meio do hold: solta o freio
  function onVis() { if (doc.visibilityState === 'hidden') cls.reset(win.performance.now()); }

  const P = { passive: true };
  canvas.addEventListener('pointerdown', onDown, P);
  canvas.addEventListener('pointermove', onMove, P);
  canvas.addEventListener('pointerup', onUp, P);
  canvas.addEventListener('pointercancel', onCancel, P);
  canvas.addEventListener('pointerleave', onLeave, P);
  canvas.addEventListener('contextmenu', onContext);
  doc.addEventListener('visibilitychange', onVis, P);

  const api = {
    classifier: cls,
    get holding() { return cls.state === HOLD; },
    on(type, fn) {
      const list = handlers[type];
      if (!list) throw new Error('input: evento desconhecido ' + type);
      if (list.indexOf(fn) < 0) handlers[type] = list.concat(fn);
      return api;
    },
    off(type, fn) {
      const list = handlers[type];
      if (list) handlers[type] = list.filter((f) => f !== fn);
      return api;
    },
    setHitProxies(p) { proxies = p; },
    setCamera(c) { camera = c; },
    // raio do último ponteiro com a câmera DESTE quadro; null fora do canvas ou sem THREE
    updateRay,
    destroy() {
      if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
      cls.reset(win.performance.now()); // hold ativo recebe o 'release' antes de calar
      canvas.removeEventListener('pointerdown', onDown, P);
      canvas.removeEventListener('pointermove', onMove, P);
      canvas.removeEventListener('pointerup', onUp, P);
      canvas.removeEventListener('pointercancel', onCancel, P);
      canvas.removeEventListener('pointerleave', onLeave, P);
      canvas.removeEventListener('contextmenu', onContext);
      doc.removeEventListener('visibilitychange', onVis, P);
      for (let i = 0; i < TYPES.length; i++) handlers[TYPES[i]] = [];
    },
  };
  return api;
}
