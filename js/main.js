/* Yakuza Garage NYC — prévia, 2ª versão. Base: prompt "Mossline" (docs/refs/mossline-base.md).
   Um rAF só. Cada história presa no scroll tem um progresso suavizado (sp, ep); tudo na tela é função dele.
   Filme: 480 quadros (24 por segundo) em img/film/d (1920x1080) e img/film/m (recorte central 1190x1080). */

const FILM_SRC = "";                 // vídeo do Carlinhos: caminho do .mp4 (9:16). Vazio = cartaz "premiering soon".
const PHONE = "+13478132779";
const COUNT = 480;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SNAP = location.search.includes("snap");   // verificação: progresso sem suavização (janela em segundo plano roda a 1 quadro/s)
const isMobile = () => innerWidth <= 820;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function at(keys, p) {
  for (let i = 1; i < keys.length; i++) if (p <= keys[i][0]) {
    const [p0, v0] = keys[i - 1], [p1, v1] = keys[i];
    return v0 + (v1 - v0) * clamp((p - p0) / (p1 - p0 || 1));
  }
  return keys[keys.length - 1][1];
}
/** só escreve no DOM quando o valor muda */
function put(el, prop, val) { const c = el._c || (el._c = {}); if (c[prop] !== val) { c[prop] = val; el.style[prop] = val; } }
function show(el, on) { put(el, "visibility", on ? "visible" : "hidden"); }
function words(el) {
  const out = [];
  const walk = (node) => [...node.childNodes].forEach((n) => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach((t) => { if (!t) return; if (/^\s+$/.test(t)) return frag.appendChild(document.createTextNode(" ")); const s = document.createElement("span"); s.textContent = t; out.push(s); frag.appendChild(s); });
      node.replaceChild(frag, n);
    } else if (n.nodeType === 1 && n.tagName !== "BR") walk(n);
  });
  el.setAttribute("aria-label", el.textContent.trim()); walk(el);
  return out;
}

/* ---------------- linha do tempo do filme ---------------- */
const KF = [[0.40, 176], [0.60, 176], [0.67, 202], [0.705, 220], [0.825, 282], [0.855, 324], [0.97, 364], [1, 364]];     // história 1: [progresso, quadro]
const AF = [[0, 1], [0.645, 1], [0.668, 0], [0.705, 0], [0.735, 1], [1, 1]];                                // alfa: corte no preto entre a roda e as peças
const KE = [[0, 368], [0.05, 372], [0.55, 461], [1, 461]];                                                // história 2
const AE = [[0, 0], [0.05, 1], [1, 1]];
const USED = (i) => (i >= 0 && i <= 202) || (i >= 220 && i <= 364) || (i >= 368 && i <= 461);

/* ---------------- quadros: imagens comprimidas + janela pequena de bitmaps decodificados ---------------- */
let set = "", imgs = [], gen = 0, coarseDone = 0, coarseTotal = 1, dirty = true;
const bmps = new Map(), pending = new Set();
function loadSet(which) {
  const my = ++gen, list = new Array(COUNT).fill(null);
  bmps.forEach((b) => b.close?.()); bmps.clear(); pending.clear();
  const coarse = []; for (let i = 0; i <= 202; i += 8) coarse.push(i);
  const seen = new Set(coarse), order = [...coarse];
  const push = (a, b, step) => { for (let i = a; i <= b; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); } };
  push(0, 60, 2); push(0, 202, 4); push(0, 202, 2); push(0, 202, 1);
  push(220, 364, 4); push(220, 364, 2); push(220, 364, 1); push(368, 461, 2); push(368, 461, 1);
  coarseDone = 0; coarseTotal = coarse.length;
  let next = 0;
  const pump = () => {
    if (my !== gen || next >= order.length) return;
    const i = order[next++], img = new Image(), isCoarse = i % 8 === 0 && i <= 202;
    img.decoding = "async";
    img.onload = () => { if (my === gen) { list[i] = img; dirty = true; if (isCoarse) coarseDone++; } pump(); };
    img.onerror = () => { if (isCoarse) coarseDone++; pump(); };
    img.src = `img/film/${which}/${String(i).padStart(3, "0")}.webp`;
  };
  for (let k = 0; k < 6; k++) pump();
  return list;
}
function warm(center) {
  if (!window.createImageBitmap) return;
  const my = gen;
  for (let i = center - 6; i <= center + 10; i++) {
    if (!USED(i) || !imgs[i] || bmps.has(i) || pending.has(i) || pending.size > 5) continue;
    pending.add(i);
    createImageBitmap(imgs[i]).then((b) => {
      pending.delete(i);
      if (my !== gen || Math.abs(i - curFrame) > 28) return b.close();
      bmps.set(i, b); dirty = true;
    }).catch(() => pending.delete(i));
  }
  for (const [k, b] of bmps) if (Math.abs(k - center) > 28) { b.close(); bmps.delete(k); }
}
function pick(i) {
  if (bmps.has(i)) return bmps.get(i);
  for (let d = 1; d <= 3; d++) { if (bmps.has(i - d)) return bmps.get(i - d); if (bmps.has(i + d)) return bmps.get(i + d); }
  if (imgs[i]) return imgs[i];
  for (let d = 1; d < 90; d++) { if (USED(i - d) && imgs[i - d]) return imgs[i - d]; if (USED(i + d) && imgs[i + d]) return imgs[i + d]; }
  return null;
}

/* ---------------- dois palcos, cada um com seu canvas ---------------- */
const films = ["#film", "#film2"].map((id) => { const cv = $(id); return { cv, ctx: cv.getContext("2d", { alpha: false }), cam: cv.parentElement, cw: 0, ch: 0, W: 0, H: 0, i: -1, a: -1, src: null }; });
let curFrame = 0, SW = innerWidth, SH = innerHeight;
/** retângulo do quadro dentro do canvas (px de CSS): celular encaixa pela largura, desktop cobre */
function frameRect(cw, ch) {
  const iw = isMobile() ? 1190 : 1920, ih = 1080, s = isMobile() ? cw / iw : Math.max(cw / iw, ch / ih);
  return { x: (cw - iw * s) / 2, y: (ch - ih * s) * (isMobile() ? 0.44 : 0.5), w: iw * s, h: ih * s };
}
/** fração do quadro desktop -> ponto no palco (px) */
function stagePoint(fx, fy) {
  const r = frameRect(SW * 1.06, SH * 1.06);
  return [-0.03 * SW + r.x + r.w * (isMobile() ? (fx - 0.19) / 0.62 : fx), -0.03 * SH + r.y + r.h * fy];
}
function resize() {
  SW = innerWidth; SH = $(".stage").clientHeight || innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, isMobile() ? 2.5 : 2);
  for (const f of films) {
    f.cw = f.cv.clientWidth; f.ch = f.cv.clientHeight;
    f.W = f.cv.width = Math.round(f.cw * dpr); f.H = f.cv.height = Math.round(f.ch * dpr);
    f.ctx.imageSmoothingQuality = "high"; f.i = -1;
  }
  const s = isMobile() ? "m" : "d";
  if (s !== set) { set = s; imgs = loadSet(s); }
  place(); dirty = true;
}
function draw(f, i, alpha) {
  const src = alpha > 0.003 ? pick(i) : null;
  if (!dirty && f.i === i && Math.abs(f.a - alpha) < 0.004 && f.src === src) return;
  f.i = i; f.a = alpha; f.src = src;
  const { ctx, W, H } = f;
  ctx.globalAlpha = 1; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (!src) return;
  const k = W / f.cw, r = frameRect(f.cw, f.ch);
  ctx.globalAlpha = alpha; ctx.drawImage(src, r.x * k, r.y * k, r.w * k, r.h * k);
  if (isMobile()) {                                               // funde a faixa do filme no preto, em cima e embaixo
    ctx.globalAlpha = 1;
    const y = r.y * k, h = r.h * k, fh = h * 0.12;
    let g = ctx.createLinearGradient(0, y, 0, y + fh); g.addColorStop(0, "#000"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, y - 1, W, fh + 1);
    g = ctx.createLinearGradient(0, y + h - fh, 0, y + h); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "#000");
    ctx.fillStyle = g; ctx.fillRect(0, y + h - fh, W, fh + 1);
  }
}

/* ---------------- peças ---------------- */
const story = $("#story"), end = $("#end"), log = $("#log"), nav = $(".nav");
const word = $("#word"), word2 = $("#word2"), bank = $("#bank"), prog = $("#prog");
const L1 = $("#L1"), L2 = $("#L2"), L3 = $("#L3"), L4 = $("#L4"), E1 = $("#E1"), E2 = $("#E2");
const hud = $("#hud"), cap = $("#cap"), hint = $("#hint");
const vision = $("#vision"), vWords = words($("#visionH")), vP = $("p", vision);
const aWords = words($("#acct")), hots = $$(".hot");
const cred = $("#cred"), card = $("#card"), feats = $("#feats"), rate = $("#rate"), meter = $("#meter"), rows = $$("#feats li");
const cred2 = $("#cred2"), ring = $("#ring"), visit = $("#visit");
let hudPt = [0, 0];
function place() {
  const m = isMobile();
  const a = stagePoint(m ? 0.40 : 0.655, m ? 0.268 : 0.272);                    // mira encosta no teto do carro; o bloco fica acima dele
  hudPt = [a[0] + (m ? 23 : 33), a[1] - (m ? 122 : 70)];
  $(".hud__x").style.top = (m ? 113 : 59) + "px";
  for (const h of hots) {
    const [x, y] = stagePoint(+h.dataset.x, +h.dataset.y), left = x > SW * 0.56;
    h.classList.toggle("hot--l", left);
    h._x = left ? x + 11 : x - 11; h._y = y - 11; h._l = left;      // etiqueta a esquerda: prende pela borda direita
  }
}

/* ---------------- controlador ---------------- */
let sp = 0, ep = 0, mx = 0, my = 0, sx = 0, sy = 0, intro = 0, last = performance.now(), state = {};
addEventListener("pointermove", (e) => { if (e.pointerType === "touch") return; mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
const raw = (el) => { const r = el.getBoundingClientRect(), span = el.offsetHeight - innerHeight; return [span > 0 ? clamp(-r.top / span) : 0, r]; };

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(64, now - last); last = now;
  const k = reduce || SNAP ? 1 : 1 - Math.pow(0.86, dt / 16.7);
  const [p1, r1] = raw(story), [p2, r2] = raw(end);
  sp += (p1 - sp) * k; if (Math.abs(p1 - sp) < 0.0002) sp = p1;
  ep += (p2 - ep) * k; if (Math.abs(p2 - ep) < 0.0002) ep = p2;
  sx += (mx - sx) * 0.06; sy += (my - sy) * 0.06;
  const live = intro > 0.6;
  const onStory = r1.bottom > 0, onEnd = r2.top < innerHeight && r2.bottom > 0;

  if (onStory) {
    /* filme */
    const fr = sp < 0.40 ? 176 * ease(seg(sp, 0.06, 0.40)) : at(KF, sp);
    curFrame = Math.round(fr); warm(curFrame);
    draw(films[0], curFrame, at(AF, sp) * intro);
    const cs = 1 - 0.13 * ease(seg(sp, 0.825, 0.86));                 // o coilover e alto: recua um pouco para caber entre a nav e a barra
    put(films[0].cam, "transform", `translate3d(${(-sx * 18).toFixed(1)}px,${(-sy * 12).toFixed(1)}px,0) scale(${cs.toFixed(4)})`);

    /* herói: título de contorno andando de lado, HUD preso no carro, legenda, dica */
    const wo = (1 - seg(sp, 0.09, 0.17)) * intro;
    put(word, "opacity", wo.toFixed(3));
    if (wo > 0) put(word, "transform", `translate3d(${(6 - sp * 110).toFixed(2)}vw,0,0)`);
    const h = seg(sp, 0.02, 0.10);
    show(L1, live && h < 1);
    if (h < 1) {
      put(hud, "transform", `translate3d(${(hudPt[0] + sx * 26).toFixed(1)}px,${(hudPt[1] + sy * 18 - h * 40).toFixed(1)}px,0)`);
      put(hud, "opacity", (1 - seg(sp, 0.02, 0.08)).toFixed(3));
      const o = (1 - seg(sp, 0.01, 0.05)).toFixed(3); put(cap, "opacity", o); put(hint, "opacity", o);
    }

    /* a frase deles: sai do desfoque palavra por palavra no preto do corte, entre a roda e as pecas */
    const vIn = seg(sp, 0.635, 0.685), vOut = seg(sp, 0.70, 0.74);
    show(L2, vIn > 0 && vOut < 1);
    if (vIn > 0 && vOut < 1) {
      vWords.forEach((w, i) => {
        const q = clamp(vIn * 1.6 - i * 0.08);
        put(w, "transform", `translate3d(0,${((1 - q) * 30 - vOut * 60).toFixed(1)}px,0)`);
        put(w, "filter", `blur(${((1 - q) * 12 + vOut * 14).toFixed(1)}px)`);
        put(w, "opacity", (q * (1 - vOut)).toFixed(3));
      });
      const o = (clamp(vIn * 2 - 0.6) * (1 - vOut)).toFixed(3), y = `translate3d(0,${(-vOut * 50).toFixed(1)}px,0)`;
      put(vP, "opacity", o); put(vP, "transform", y);
    }

    /* a roda parada: parágrafo se escreve, quatro pontos presos na imagem, banco de sombra atrás do texto */
    const aIn = seg(sp, 0.42, 0.50), aOut = seg(sp, 0.575, 0.61);
    const fg = ease(seg(sp, 0.40, 0.46)) * (1 - aOut);
    put(bank, "opacity", fg.toFixed(3));
    if (fg > 0) put(bank, "transform", `translate3d(${((fg - 1) * 18 + sx * -10).toFixed(2)}vw,${(sy * -6).toFixed(1)}px,0)`);
    show(L3, sp > 0.42 && aOut < 1);
    if (sp > 0.42 && aOut < 1) {
      aWords.forEach((w, i) => {
        const q = clamp(aIn * 2.2 - (i / aWords.length) * 1.2);
        put(w, "opacity", ((0.15 + 0.85 * q) * (1 - aOut)).toFixed(3));
        put(w, "filter", `blur(${((1 - q) * 6 + aOut * 10).toFixed(1)}px)`);
      });
      hots.forEach((el, i) => {
        const q = seg(sp, 0.45 + i * 0.02, 0.49 + i * 0.02) * (1 - aOut);
        put(el, "transform", `translate3d(${(el._x + sx * -30).toFixed(1)}px,${(el._y + sy * -20).toFixed(1)}px,0)${el._l ? " translateX(-100%)" : ""} scale(${q.toFixed(3)})`);
      });
    }

    /* as peças: título, um cartão com dado de verdade (nota no Google), lista */
    const sIn = seg(sp, 0.745, 0.82), cIn = ease(seg(sp, 0.76, 0.86));
    const sOut = seg(sp, 0.935, 0.975);                                // sai antes do painel claro subir
    show(L4, sIn > 0 && sOut < 1);
    if (sIn > 0 && sOut < 1) {
      put(L4, "opacity", (1 - sOut).toFixed(3));
      put(cred, "opacity", sIn.toFixed(3));
      put(cred, "transform", `translate3d(0,${((1 - sIn) * 30).toFixed(1)}px,0)`);
      put(cred, "filter", `blur(${((1 - sIn) * 8).toFixed(1)}px)`);
      put(card, "opacity", cIn.toFixed(3));
      put(card, "transform", `perspective(900px) translate3d(${(sx * -14).toFixed(1)}px,${((1 - cIn) * 60 + sy * -10).toFixed(1)}px,0) rotateY(${(sx * 8).toFixed(2)}deg) rotateX(${(-sy * 8).toFixed(2)}deg)`);
      const n = (4 + 0.9 * seg(sp, 0.78, 0.90)).toFixed(1);                // conta de 4.0 a 4.9: parado no meio nunca mostra nota baixa
      if (rate.textContent !== n) rate.textContent = n;
      put(meter, "strokeDashoffset", (220 * (1 - (0.8 + 0.18 * seg(sp, 0.78, 0.90)))).toFixed(1));
      put(feats, "opacity", ease(seg(sp, 0.75, 0.79)).toFixed(3));
      rows.forEach((li, i) => {
        const q = ease(seg(sp, 0.76 + i * 0.02, 0.81 + i * 0.02));
        put(li, "opacity", q.toFixed(3)); put(li, "transform", `translate3d(${((1 - q) * 40).toFixed(1)}px,0,0)`);
      });
    }
    put(prog, "transform", `scaleX(${sp.toFixed(4)})`);
  }

  if (onEnd) {
    curFrame = Math.round(at(KE, ep)); warm(curFrame);
    draw(films[1], curFrame, at(AE, ep) * intro);
    put(films[1].cam, "transform", `translate3d(${(-sx * 18).toFixed(1)}px,${(-sy * 12).toFixed(1)}px,0)`);
    const wo = seg(ep, 0.03, 0.09) * (1 - seg(ep, 0.36, 0.46));
    put(word2, "opacity", wo.toFixed(3));
    if (wo > 0) put(word2, "transform", `translate3d(${((ep - 0.22) * 70).toFixed(2)}vw,0,0)`);
    const cI = seg(ep, 0.06, 0.14), cO = seg(ep, 0.34, 0.42);
    show(E1, cI > 0 && cO < 1);
    put(cred2, "opacity", (cI * (1 - cO)).toFixed(3));
    put(cred2, "transform", `translate3d(0,${((1 - cI) * 30 - cO * 40).toFixed(1)}px,0)`);
    put(cred2, "filter", `blur(${((1 - cI) * 8 + cO * 10).toFixed(1)}px)`);
    const rI = ease(seg(ep, 0.56, 0.78)), vI = seg(ep, 0.68, 0.84);
    show(E2, rI > 0);
    ring.style.setProperty("--p", (rI * 100).toFixed(1) + "%");
    put(visit, "opacity", vI.toFixed(3));
    put(visit, "marginTop", ((1 - vI) * 30).toFixed(1) + "px");
  }
  dirty = false;

  const lr = log.getBoundingClientRect();
  nav.classList.toggle("on-paper", lr.top < 44 && lr.bottom > 44);
  state = { sp, ep, frame: curFrame };
}

/* ---------------- loader: anel conta o carregamento, abre como íris, olhos viram faróis ---------------- */
const HEAD = [[0.300, 0.458], [0.468, 0.455]];                    // faróis no quadro 0 (fração do quadro desktop)
const EYES = [[0.375, 0.497], [0.634, 0.499]];                    // olhos no img/oni.webp
const ready = new Promise((resolve) => {
  const loader = $("#loader"), lring = $(".loader__ring"), oni = $(".loader__oni"), count = $("#loaderCount"), eyes = $$(".loader__eyes i");
  const t0 = performance.now(), FILL = 1700, LIMIT = 9000;
  if (reduce) { intro = 1; loader.remove(); document.body.classList.remove("is-loading"); return resolve(); }
  (function step(now) {
    const k = clamp((now - t0) / FILL), frac = now - t0 > LIMIT ? 1 : coarseDone / coarseTotal;
    const v = Math.min(1 - Math.pow(1 - k, 3), frac);
    count.textContent = String(Math.round(v * 100)).padStart(3, "0");
    lring.style.setProperty("--p", (v * 100).toFixed(1) + "%");
    if (v < 1) return requestAnimationFrame(step);
    const o = oni.getBoundingClientRect();
    eyes.forEach((e, i) => (e.style.transform = `translate3d(${o.left + o.width * EYES[i][0]}px,${o.top + o.height * EYES[i][1]}px,0)`));
    requestAnimationFrame(() => {
      loader.classList.add("open");
      requestAnimationFrame(() => eyes.forEach((e, i) => {
        const [x, y] = stagePoint(HEAD[i][0], HEAD[i][1]);
        e.style.transform = `translate3d(${x}px,${y}px,0) scale(${isMobile() ? 0.7 : 1})`;
      }));
      const s = performance.now() + 650;
      (function fade(n) {
        intro = clamp((n - s) / 900); dirty = true;
        if (intro < 1) return requestAnimationFrame(fade);
        loader.classList.add("done"); document.body.classList.remove("is-loading"); resolve();
        setTimeout(() => loader.remove(), 1400);
      })(performance.now());
    });
  })(t0);
});

/* ---------------- o registro: três trabalhos reais (fotos e legendas públicas do @_yakuzagaragenyc) ---------------- */
const JOBS = [
  ["charger-coilovers", "Suspension", "Dodge Charger", "Coilover install. That big gap, gone.", "30% 60%"],
  ["s2000-brakes", "Brakes", "Honda S2000 widebody", "Full brake upgrade: pads and rotors all around, fresh calipers, full flush.", "42% 62%"],
  ["x7-air-struts", "Air suspension", "BMW X7", "Front air struts replaced and recalibrated.", "40% 62%"],
];
$("#cards").innerHTML = JOBS.map(([f, tag, car, job, pos]) => `
  <article class="job">
    <div class="job__bg" style="background-image:url(img/ig/${f}.webp);background-position:${pos}"></div>
    <div class="job__top"><span class="mono">[${tag}]</span><i aria-hidden="true">→</i></div>
    <div class="job__bot"><h3>${car}</h3><p>${job}</p></div>
  </article>`).join("");
$$(".job").forEach((el) => {
  el.addEventListener("pointermove", (e) => { if (e.pointerType === "touch") return; const r = el.getBoundingClientRect(); el.style.transform = `perspective(1000px) rotateY(${(((e.clientX - r.left) / r.width - 0.5) * 6).toFixed(2)}deg) rotateX(${(-((e.clientY - r.top) / r.height - 0.5) * 6).toFixed(2)}deg)`; });
  el.addEventListener("pointerleave", () => (el.style.transform = ""));
});
/* ---------------- vaga do filme ---------------- */
if (FILM_SRC) $("#slotFrame").replaceChildren(Object.assign(document.createElement("video"), { src: FILM_SRC, controls: true, playsInline: true, preload: "metadata" }));

/* ---------------- pontos, lista, menu ---------------- */
hots.forEach((h) => h.addEventListener("click", () => { const on = h.classList.contains("on"); hots.forEach((o) => o.classList.remove("on")); h.classList.toggle("on", !on); }));
$$(".nav__menu a").forEach((a) => a.addEventListener("click", (e) => {
  const el = $(a.getAttribute("href")); if (!el) return;
  e.preventDefault();
  const go = +(a.dataset.go || 0), top = el.getBoundingClientRect().top + scrollY;
  scrollTo({ top: top + go * Math.max(0, el.offsetHeight - innerHeight), behavior: reduce ? "auto" : "smooth" });
}));

/* ---------------- modal: monta o SMS ---------------- */
const modal = $("#textModal"), chips = $("#tmChips"), car = $("#tmCar"), note = $("#tmNote"), prev = $("#tmPrev"), send = $("#tmSend");
const SERVICES = ["Suspension", "Brakes", "Auto body", "Repair", "Something else"];
chips.insertAdjacentHTML("beforeend", SERVICES.map((s, i) => `<label><input type="radio" name="svc" value="${s}" ${i ? "" : "checked"}><span>${s}</span></label>`).join(""));
function compose() {
  const svc = chips.querySelector("input:checked").value, c = car.value.trim(), n = note.value.trim();
  const what = svc === "Something else" ? "some work" : svc === "Repair" ? "a repair" : svc.toLowerCase() + " work";
  const msg = `Hi Yakuza Garage, I need ${what}${c ? ` on my ${c}` : ""}.${n ? " " + n : ""} When can I bring it in?`;
  prev.textContent = msg;
  send.href = `sms:${PHONE}?&body=${encodeURIComponent(msg)}`;
}
[chips, car, note].forEach((el) => el.addEventListener("input", compose));
compose();
function openText(svc) {
  if (svc) { const r = chips.querySelector(`input[value="${svc}"]`); if (r) r.checked = true; compose(); }
  modal.showModal();
}
$$("[data-open-text]").forEach((b) => b.addEventListener("click", () => openText()));
$$("#feats button").forEach((b) => b.addEventListener("click", () => openText(b.dataset.svc)));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

/* ---------------- boot ---------------- */
scrollTo(0, 0);
addEventListener("resize", resize);
document.fonts?.ready.then(() => { place(); dirty = true; });
resize();
requestAnimationFrame(tick);
window.__yk = { ready, get state() { return state; }, get loaded() { return imgs.filter(Boolean).length; }, get decoded() { return bmps.size; } };
