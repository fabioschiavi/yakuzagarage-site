// quality.js — tier, governor, pausa e altura estável (seção 3 do SPEC-3D).
// Sem import de "three": tudo aqui é número e DOM opcional, testável no node.

// Limites do probe de 40 quadros: < 11 ms high, 11..18 base, > 18 low.
export const TIER_MS = Object.freeze({ high: 11, low: 18 });

// Botões que o governor pode girar sem recompilar shader: DPR, teto de faíscas, destroços.
export const TIER_KNOBS = Object.freeze({
  high: Object.freeze({ dprCap: 1.5, sparks: 192, debris: 36 }),
  base: Object.freeze({ dprCap: 1.5, sparks: 192, debris: 36 }),
  low: Object.freeze({ dprCap: 1.0, sparks: 96, debris: 18 }),
});
// Degrau a partir de um tier que já é low: a spec não dá números; escolha nossa.
export const STEP_FLOOR = Object.freeze({ dprCap: 0.75, sparks: 64, debris: 12 });

// Janela do governor: média dos quadros 30 a 120 (contagem a partir de 1), corte > 19 ms.
export const GOVERNOR = Object.freeze({ first: 30, last: 120, limitMs: 19, maxFrameMs: 250 });

export function pickTier(ms) {
  if (!(ms >= 0)) return 'base'; // probe falhou (NaN): fica no meio, sem apostar
  if (ms < TIER_MS.high) return 'high';
  if (ms <= TIER_MS.low) return 'base';
  return 'low';
}

// createGovernor({studio, onStepDown, tier?, dpr?, unit?}) -> { tier, sample(dt), ... }
// sample(dt) recebe dt em SEGUNDOS (mesma unidade do loop); unit: 'ms' se preferir.
// Desce no máximo uma vez, e só via DPR, faíscas e destroços. tier não muda depois do
// degrau: os shaders compilados continuam os do tier escolhido no loader.
export function createGovernor(opts) {
  opts = opts || {};
  const studio = opts.studio || null;
  const onStepDown = opts.onStepDown || null;
  const scale = opts.unit === 'ms' ? 1 : 1000;
  const tier = opts.tier || (studio && studio.tier) || 'base';
  const deviceDpr = opts.dpr != null ? opts.dpr
    : studio && studio.dpr != null ? studio.dpr
    : globalThis.devicePixelRatio || 1;
  const k0 = TIER_KNOBS[tier] || TIER_KNOBS.base;

  let sum = 0, n = 0;
  const gov = {
    tier,
    stepped: false,
    done: false,   // janela 30..120 já avaliada
    frame: 0,      // quadros válidos vistos
    meanMs: 0,
    knobs: { dpr: Math.min(deviceDpr, k0.dprCap), sparks: k0.sparks, debris: k0.debris },

    // devolve true só no quadro em que desceu
    sample(dt) {
      if (gov.done) return false;
      const ms = dt * scale;
      // engasgo de aba/retomada não é desempenho: não conta como quadro
      if (!(ms > 0) || ms > GOVERNOR.maxFrameMs) return false;
      const f = ++gov.frame;
      if (f >= GOVERNOR.first) { sum += ms; n++; }
      if (f < GOVERNOR.last) return false;
      gov.done = true;
      gov.meanMs = sum / n;
      if (gov.meanMs <= GOVERNOR.limitMs) return false;
      stepDown();
      return true;
    },

    // rearma a janela (ex.: após voltar de pausa) se ainda não desceu
    reset() {
      if (gov.stepped) return;
      gov.done = false; gov.frame = 0; gov.meanMs = 0; sum = 0; n = 0;
    },
  };

  function stepDown() {
    gov.stepped = true;
    const next = tier === 'low' ? STEP_FLOOR : TIER_KNOBS.low;
    const k = gov.knobs;
    k.dpr = Math.min(k.dpr, deviceDpr, next.dprCap);
    k.sparks = Math.min(k.sparks, next.sparks);
    k.debris = Math.min(k.debris, next.debris);
    if (studio && typeof studio.setDPR === 'function') studio.setDPR(k.dpr);
    if (onStepDown) onStepDown(k, gov.meanMs);
  }

  return gov;
}

// Pausa o render com a aba escondida ou com o canvas fora da tela.
// doc e IO injetáveis para teste no node.
export function createPauser(canvas, opts) {
  opts = opts || {};
  const doc = opts.doc || (canvas && canvas.ownerDocument) || globalThis.document || null;
  const IO = opts.IntersectionObserver || globalThis.IntersectionObserver || null;
  const onPause = opts.onPause || null, onResume = opts.onResume || null;

  let hidden = !!(doc && doc.visibilityState === 'hidden');
  let offscreen = false;
  let paused = hidden;

  function apply() {
    const p = hidden || offscreen;
    if (p === paused) return;
    paused = p;
    if (p) { if (onPause) onPause(); } else if (onResume) onResume();
  }
  function onVis() { hidden = doc.visibilityState === 'hidden'; apply(); }
  function onIO(entries) {
    // só o último registro vale: vários podem chegar no mesmo lote
    offscreen = !entries[entries.length - 1].isIntersecting;
    apply();
  }

  if (doc) doc.addEventListener('visibilitychange', onVis);
  let io = null;
  if (IO && canvas) { io = new IO(onIO, { threshold: 0 }); io.observe(canvas); }

  return {
    get paused() { return paused; },
    destroy() {
      if (doc) doc.removeEventListener('visibilitychange', onVis);
      if (io) { io.disconnect(); io = null; }
    },
  };
}

// Altura estável: ignora mudanças < 120 px (barra do Instagram/Safari aparecendo).
// Mudança de largura (rotação) aceita na hora.
export const STABLE_HEIGHT_PX = 120;

export function createStableHeight(opts) {
  const threshold = opts && opts.threshold != null ? opts.threshold : STABLE_HEIGHT_PX;
  let w = -1, h = 0;
  return {
    update(width, height) {
      const d = height - h;
      if (width !== w || (d < 0 ? -d : d) >= threshold) { w = width; h = height; }
      return h;
    },
    get value() { return h; },
  };
}

let stable = null;
export function stableViewportHeight(win) {
  win = win || globalThis.window;
  if (!win) return 0;
  if (!stable) stable = createStableHeight();
  return stable.update(win.innerWidth, win.innerHeight);
}
