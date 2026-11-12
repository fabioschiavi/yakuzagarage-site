/* v3: identidade. Loader (oni + anel de pincel + íris), medidor do dedo, vigia do Carlinhos e a marca persistente.
   Sobe ANTES da three: nada de import "three" aqui, senão o loader espera o CDN. O porthole recebe THREE pelo ctx.
   Visual do loader herdado do v2 (index.html / css/style.css / js/main.js), o que o dono aprovou:
   img/ring.webp revelado por máscara cônica a partir de 215 graus, img/oni.webp no centro a 62% do palco,
   anel a 144% do palco, palco min(64vw, 300px). Sem contador, sem olhos-farol (cortados pela spec). */
import { LAYOUT, LOADER, BEATS, CAMERA } from "./spec.js";

const IMG_RING = new URL("../../img/ring.webp", import.meta.url).href;
const IMG_ONI = new URL("../../img/oni.webp", import.meta.url).href;
export const MARK_URL = new URL("../../img/mark.svg", import.meta.url).href;

// medido em img/ring.webp (900 px, centro no meio): raios do traço em fração da largura da imagem
const RING = { inner: 0.276, mean: 0.362, outer: 0.45, drawFrom: 215 };
// oni no palco do v2: 62% da largura; o anel tem 144% -> oni = 0.62 / 1.44 da imagem do anel
const ONI = { ofRing: 0.62 / 1.44, aspect: 1000 / 870 };

/* ---------------- marca persistente ----------------
   Vetorizada de img/logo.webp por capturas/trace_logo.py (máscara + katanas, sem as letras). Mesmo path de img/mark.svg.
   currentColor: a UI pinta com osso a 90%. Decorativa (aria-hidden). */
const MARK_PATH = "M166 310l3 7 4 3 6 3 4-2v-5l3-7 3-2h1l-2 7 1 4 1 2 5 1h9l5-2 1-3-1-7v-2l2 1 3 7 1 6 3 2h2l8-5 2-2 2-5v-2l-3 3h-4l-1-2 5-1-6-1-3-2 1-2 3 2 5-1 2-2-1-1-2 1h-5l-3-2-4 1h-3l5 5 1 2h-2l-8-5-6-2-1-1 1-1h5l-6-3h-6l-5 2-1 1h5h1l-1 2-8 3-7 5-1-2 2-2 4-4h-2l-5-1-4 2h-4l-2-1v2l2 1 5 1 1-2h1l1 1-3 3-6 1h4l1 2-1 1h-4zM169 281l-2 8v6l1 3 4 1v-2l-2-7v-1h2v-1l-2-4zM229 281v3l-3 5v2l2-1-3 8 1 1 4-1 1-2v-8zM151 280l-1-1h-2l-39 34h-1l-1-2 38-33-2-1-6 6-6 3-15 15-7 4-6 7-3 1-9 7-14 7v-1l59-51 2-2h-1l-70 60v1l19 2h5l61-53zM248 279l-1 4 62 53h2l22-2v-1l-71-61h-1v1l64 55-1 1-28-17-3-4-16-12-10-10-12-9h-2v1l24 21 3 3-1 1-28-24h-1zM180 261l1 4 2 5 15 4 8-2 9-2 3-7-1-3h-2l-11 6-6 1h-4l-9-6-4-1zM226 265v2l6 5 11 4h6l4-1 4-2-8-1-6-2-7-5-4-8-4 3zM172 264l-3-6-3-1v2l-4 6-5 5-7 2-8 1 8 3h5l8-3 7-4 2-2zM133 234l-2 3 2 6 8 8 7 15-5-15 2-3-9-8zM266 234l-4 6-9 8 1 6-5 15 1-1 9-19 6-7 2-5zM253 225h-1l-5 7-5 5-9 4 1 2-1 5 4-1 7 3 4-3 2-4 3-10zM145 225v7l2 10 3 5 4 3 7-3h4l-1-2 1-4-8-4-5-5-6-7zM215 228l1 1 2-2h6h6l4 5v5h2l8-4 6-9-8 1h-5l-20-4zM183 228l-2-7-8 2-12 2h-9l-3-1 6 9 8 4h1v-5l5-5h11l2 2zM125 209v1l4 5 4 10 6 12 7 7-4-12v-8l-5-4-9-10zM273 209l-3 1-8 10-5 3-2 10-2 11 6-7 6-12 4-10 4-5zM273 204l-1-1-9 1-13 12-6 4 3-1 4 2 6-1 13-13 3-2zM126 204v1l2 1 13 14 6 1 3-2h4l-9-6-9-9-6-1zM190 199l2 4v6l2 3-3 2v3l-6 5v1l2 3v7l4 11h-1l-7-11-2-2-10-1h-1l2 5h-2l-2-2-1 1 1 6 2 4 2 3 1-1 1-2h3l17 18 7 1 3-1 17-18 2-1 1 1 1 3 2-1 2-3 2-9-1-1-3 2h-1l2-4-1-1-10 1-2 2-5 8-2 3-1-2 4-9v-7l2-3v-1l-5-5-2-4-2-1 3-4-1-4 2-5-5 3h-6zM279 188l-1 2 1 5-2 4v4l4 6 1 6-1 3-4 4h-1l-2-2h-1v4l2 3 6-2 2-2 1-5v-6l-4-12zM119 187l-1 14-4 11v6l1 4 2 3 7 2 2-5v-2h-2l-2 2h-2l-3-4-1-3 1-7 5-5v-3l-3-4 1-7zM103 144l-24 20 3 1 11-10h1v-2l1-1h3l3 4v2l2 1v-8l-2-2zM295 143v2l3 4-3 3v8l3-1 2 1 7-5 11 9h2zM304 152l1 3-4 3h-1l-2-1 1-2 4-3zM336 124l-10 8-12 11 7-6zM252 95l-2 2-2 5h-1v-3h-1l-3 15-1 6 1 1 1-1 6 6v2l3 2 7 2 8-1-5-2-7-4-4-5-2 3h-2l1-6-1-2v-6l5-9 4-3-2-2zM147 95h-4l-2 1v1l3 2 6 10v14l-2 1-2-4-1 2-4 4-7 4h-3v1l6 1 8-2 3-2v-2l6-6 2 1v-1l-1-9-3-11h-1v2h-1l-1-1v-4zM34 83l-5 2-2 3 4-1 2-2zM106 135l3 5v12l-1 2-2-1v13l2 4 7 7 3 7v-8l-1-4-3-4 1-2 2 2-7-8v-2l2-1 7 7 5 7 4 17 4 8v1l-3-1-3-3-1-4h-1v3l1 4v3l1 1 4-1 7 1-1-3-1-3-1-6v-5l1-2 17 18 5 3h6l1 2h1h11l11-2v-3l3-3 8 3 10-2 3 2v3l12 2h10l3-2h5l5-3 16-17h2v6l-2 9-1 3 6-1 6 1 2-8-1-3-1 1-1 4-2 2-3 1-1-2 4-6 4-19 12-12 2 1v1l-7 8 2-1v2l-3 7v9l2-5 8-10 2-4v-12l-1-2-1 1v-3v-10l3-5-1-1-6 6-2 8-5 9-14 16h-1l1-8-1-3 4-5 2-5-1-12-4-3-4-1h-8l-8-4-5-7-2-6-2-14-2-5-5-7-2-2 1-2-7-5-8-2h-28l-6 1-8 5v2l-5 6-4 9-3 17-5 9-5 4-6 1h-7l-4 2-2 2-2 12 2 4 4 6-1 2 2 4-1 5-2-1-14-16-4-8-1-6-2-4-3-3zM259 173l-1 2-7 5-3 4-3 5-3 4-8 4-6 2-10 1-5-3 2-2 8 3 11-5 7-4 3-7 5-4 9-6zM139 173l2-1 11 8 5 9 9 5 8 3h4l5-2 2 1-1 1-3 2-4 1-13-3-7-4-3-3-4-7-10-8zM23 70l-11 9v2l78 66v2l-14 12 1 1 6-6 18-15 2-3-11 9h-1l-7-7-17-14-2-3h-2l-3-4h-2l-16-14-1-3h-3l-2-4-7-4-3-4h-1l-4-4h-1l-6-5v-2l3-3h2l-1 4 4-1 3-4-2-1-3 2-1-2 4-3h2l30 25 6 6 3 2 1 2 19 15 10 10 3 2v-1l-72-62zM376 69l-6 5-74 63 1 2 24 21 1 2 1-1v-1l-13-10-1-3h-2l-9-8v-3l17-13 12-12 3-1 25-23 3-1 6-6 11-9h1l4 3v2l-4-2-1 1 2 4 5 1-2-3 1-1 5 4-21 18-1 1-22 19 24-19 22-19-3-3zM286 64h-1l-1 6-4 9-11 15-1 3-8 10-4 13 2 4 4 2 2-2 10-15v-1l-6 6-1-1 13-18 6-14h1v1l-2 9-4 7-5 8 1 1-5 9v1l9-12 7-17 1-9v-7l-2-3zM281 84l1 1-2 4-4 5-3 7-6 8-3 1v-1l7-10 8-14zM112 63l-1 7-2 3 1 12 2 9 5 12 8 9-4-8 1-2-4-5-5-9-1-9h2l5 15 12 16v2l-6-6 1 1 5 8 2 5 3 3 4-2 2-3v-4l-3-8-2-4-7-8v-3l-12-17-4-7-1-6zM116 83l3 3 5 7 3 5 7 10v2h-1l-8-10-2-5-5-6-2-5z";
export const MARK_SVG = `<svg class="yk-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="${MARK_PATH}"/></svg>`;

/* ---------------- utilidades ---------------- */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const prefersReduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** cubic-bezier do CSS em JS: a íris anda por rAF (clip-path path() não interpola de forma confiável). */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { // Newton; se escapar de 0..1 cai na bisseção
      const e = X(t) - x, d = dX(t);
      if (Math.abs(e) < 1e-6) return Y(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
      if (t < 0 || t > 1) break;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 40; i++) { const v = X(t); if (Math.abs(v - x) < 1e-6) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return Y(t);
  };
}
const parseBezier = (s) => { const m = String(s).match(/-?\d*\.?\d+/g); return m && m.length === 4 ? bezier(...m.map(Number)) : bezier(0.7, 0, 0.2, 1); };
const IRIS_EASE = parseBezier(LOADER.irisEase);

/** k de 0 a 1 em ms, por rAF. Aba em segundo plano pausa junto com o render, de propósito. */
function tween(ms, fn) {
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (now) => { const k = ms > 0 ? Math.min(1, (now - t0) / ms) : 1; fn(k, now - t0); if (k < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });
}
const until = (cond, maxMs) => new Promise((res) => {
  const t0 = performance.now();
  const f = (now) => (cond() || now - t0 > maxMs ? res() : requestAnimationFrame(f));
  requestAnimationFrame(f);
});

/* ---------------- estilo: um bloco só, prefixo yk- ---------------- */
const STYLE = `
.yk-loader{position:fixed;inset:0;z-index:60;overflow:hidden;pointer-events:auto;-webkit-tap-highlight-color:transparent}
.yk-loader.yk-is-open{pointer-events:none}
.yk-loader__poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;visibility:hidden}
.yk-loader__poster.yk-on{visibility:visible}
.yk-loader__curtain{position:absolute;inset:0;background:#000}
.yk-loader__stage{position:absolute;left:50%;top:50%;width:min(64vw,300px);height:min(64vw,300px);transform:translate(-50%,-50%)}
.yk-loader__ring,.yk-loader__arc{position:absolute;left:-22%;top:-22%;width:144%;height:144%;max-width:none;display:block;transform-origin:50% 50%;will-change:transform,opacity;-webkit-user-drag:none;user-select:none}
.yk-loader__ring{--p:0%;-webkit-mask-image:conic-gradient(from ${RING.drawFrom}deg,#000 var(--p),transparent 0);mask-image:conic-gradient(from ${RING.drawFrom}deg,#000 var(--p),transparent 0)}
.yk-loader__arc{opacity:0}
.yk-loader__oni{position:absolute;left:19%;width:62%;top:${((100 - 62 * ONI.aspect) / 2).toFixed(2)}%;height:${(62 * ONI.aspect).toFixed(2)}%;display:block;opacity:0;transition:opacity .6s ease;will-change:transform,opacity}
.yk-loader__oni.yk-on{opacity:1}
.yk-gauge{position:fixed;left:0;top:0;width:64px;height:64px;margin:-32px 0 0 -32px;pointer-events:none;z-index:40;opacity:0;transition:opacity .18s ease;will-change:transform,opacity}
.yk-gauge.yk-on{opacity:1}
.yk-gauge svg{display:block;width:100%;height:100%;overflow:visible}
.yk-mark{display:block;width:100%;height:100%}
`;
function injectStyle() {
  if (document.getElementById("yk-emblem-css")) return;
  const s = document.createElement("style");
  s.id = "yk-emblem-css"; s.textContent = STYLE;
  document.head.appendChild(s);
}

/** oni.webp é RGB opaco com fundo preto. Vira traço com alfa (luz = alfa) para a íris abrir por trás dele:
    dentro do contexto de empilhamento do loader o screen do v2 não enxerga o canvas. */
function drawOniAlpha(canvas, img) {
  const g = canvas.getContext("2d");
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    const d = g.getImageData(0, 0, canvas.width, canvas.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const a = Math.max(p[i], p[i + 1], p[i + 2]);
      if (a > 0) { const k = 255 / a; p[i] = p[i] * k; p[i + 1] = p[i + 1] * k; p[i + 2] = p[i + 2] * k; }
      p[i + 3] = a;
    }
    g.putImageData(d, 0, 0);
    return true;
  } catch { return false; } // canvas sujo (file://): fica opaco; o fade da íris ainda esconde
}

/* ================= LOADER =================
   setProgress(v) só avança (nunca volta). openIris(arcTarget, {onArcLand}) fecha o anel, abre a íris e devolve
   a Promise do fim. arcTarget() devolve {x, y} em px de viewport (clientX/Y); é chamado a cada quadro do voo. */
export function createLoader(rootEl = document.body, { reducedMotion } = {}) {
  injectStyle();
  const reduce = reducedMotion == null ? prefersReduced() : !!reducedMotion;
  const el = document.createElement("div");
  el.className = "yk-loader";
  el.setAttribute("role", "status");
  el.setAttribute("aria-label", "Loading");
  el.innerHTML =
    `<img class="yk-loader__poster" alt="" decoding="async">` +
    `<div class="yk-loader__curtain"></div>` +
    `<div class="yk-loader__stage" aria-hidden="true">` +
    `<img class="yk-loader__ring" alt="" src="${IMG_RING}" width="900" height="900" draggable="false">` +
    `<img class="yk-loader__arc" alt="" src="${IMG_RING}" width="900" height="900" draggable="false">` +
    `<canvas class="yk-loader__oni" width="870" height="1000"></canvas>` +
    `</div>`;
  rootEl.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const poster = $(".yk-loader__poster"), curtain = $(".yk-loader__curtain"), stage = $(".yk-loader__stage");
  const ring = $(".yk-loader__ring"), arc = $(".yk-loader__arc"), oni = $(".yk-loader__oni");

  const oniImg = new Image();
  oniImg.decoding = "async";
  oniImg.onload = () => { drawOniAlpha(oni, oniImg); oni.classList.add("yk-on"); };
  oniImg.src = IMG_ONI;

  /* progresso: o anel persegue a prontidão real com um leve amortecimento (sem saltos), nunca à frente dela */
  let target = 0, shown = 0, raf = 0, last = 0, rate = 7;
  let opening = null, irisDone = false, posterOn = false, destroyed = false;
  const paint = () => ring.style.setProperty("--p", (shown * 100).toFixed(2) + "%");
  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    shown += (target - shown) * (1 - Math.exp(-dt * rate));
    if (target - shown < 0.0015) shown = target;
    paint();
    if (shown !== target && !destroyed) raf = requestAnimationFrame(tick); else last = 0;
  };
  const kick = () => { if (!raf && !destroyed) raf = requestAnimationFrame(tick); };

  const setMask = (node, v) => { node.style.webkitMaskImage = v; node.style.maskImage = v; };
  const pathClip = typeof CSS !== "undefined" && CSS.supports && CSS.supports("clip-path", 'path(evenodd, "M0 0H1V1Z")');

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    el.remove();
  }

  /** íris: furo circular na cortina preta, de 22vw a 150vmax. Mesmo efeito do clip-path circle, só que invertido. */
  function iris(arcTarget, onArcLand) {
    const er = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const W = er.width, H = er.height;
    const cx = sr.left - er.left + sr.width / 2, cy = sr.top - er.top + sr.height / 2;
    const ringW = sr.width * 1.44, inner = RING.inner * ringW, mean = RING.mean * ringW;
    // 22vw no celular cai por baixo do oni, dentro do anel; no desktop o palco trava em 300 px, então limita
    const r0 = Math.min((LOADER.irisFromVw / 100) * W, inner * 0.9), r1 = (LOADER.irisToVmax / 100) * Math.max(W, H);
    const hole = (r) => {
      if (pathClip) {
        const v = `path(evenodd, "M0 0H${W}V${H}H0Z M${(cx - r).toFixed(1)} ${cy.toFixed(1)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(2 * r).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-2 * r).toFixed(1)} 0Z")`;
        curtain.style.webkitClipPath = v; curtain.style.clipPath = v;
      } else {
        setMask(curtain, `radial-gradient(circle at ${cx.toFixed(1)}px ${cy.toFixed(1)}px, transparent ${r.toFixed(1)}px, #000 ${(r + 1).toFixed(1)}px)`);
      }
    };

    // o arco de 92 graus que não abre: o que aponta para a pinça (ângulo CSS: horário a partir do topo)
    const readTarget = () => {
      try { const p = typeof arcTarget === "function" ? arcTarget() : arcTarget; return p && isFinite(p.x) && isFinite(p.y) ? p : null; } catch { return null; }
    };
    const t0p = readTarget();
    const aDeg = t0p ? (Math.atan2(t0p.x - er.left - cx, -(t0p.y - er.top - cy)) * 180) / Math.PI : 45;
    const A = LOADER.arcDeg, from = aDeg - A / 2, aRad = (aDeg * Math.PI) / 180;
    setMask(ring, `conic-gradient(from ${(from + A).toFixed(2)}deg, #000 0deg ${360 - A}deg, transparent ${360 - A}deg)`);
    setMask(arc, `conic-gradient(from ${from.toFixed(2)}deg, #000 0deg ${A}deg, transparent ${A}deg)`);
    const midX = cx + Math.sin(aRad) * mean, midY = cy - Math.cos(aRad) * mean;
    arc.style.transformOrigin = `${(ringW / 2 + Math.sin(aRad) * mean).toFixed(1)}px ${(ringW / 2 - Math.cos(aRad) * mean).toFixed(1)}px`;
    arc.style.opacity = "1";
    oni.style.transition = "none";
    let landed = false;
    hole(r0);

    return tween(LOADER.irisMs, (k, ms) => {
      const e = IRIS_EASE(k), r = r0 + (r1 - r0) * e;
      hole(r);
      // o anel abre junto: a borda interna monta na borda da íris
      ring.style.transform = `scale(${Math.max(1, r / inner).toFixed(4)}) rotate(${(40 * e).toFixed(2)}deg)`;
      ring.style.opacity = (1 - smooth(0.45, 0.95, k)).toFixed(3);
      oni.style.opacity = (1 - smooth(0, 0.45, k)).toFixed(3);
      oni.style.transform = `scale(${(1 + 0.12 * e).toFixed(4)})`;
      // voo do arco: 300 ms até o alvo vivo, encolhe e derrete no fim
      const ka = Math.min(1, ms / LOADER.arcFlyMs), ea = IRIS_EASE(ka), p = readTarget();
      const dx = p ? p.x - er.left - midX : 0, dy = p ? p.y - er.top - midY : 0;
      arc.style.transform = `translate(${(dx * ea).toFixed(1)}px, ${(dy * ea).toFixed(1)}px) scale(${(1 - 0.75 * ea).toFixed(4)})`;
      arc.style.opacity = (1 - smooth(0.5, 1, ka)).toFixed(3);
      if (ka >= 1 && !landed) { landed = true; if (onArcLand) try { onArcLand(); } catch (err) { console.error(err); } }
    }).then(() => { if (!landed && onArcLand) try { onArcLand(); } catch (err) { console.error(err); } });
  }

  /** movimento reduzido: só um fade de 300 ms, sem voo do arco */
  function fadeOut() {
    return tween(300, (k) => { const o = (1 - k).toFixed(3); curtain.style.opacity = o; stage.style.opacity = o; });
  }

  return {
    el,
    setProgress(v) {
      v = clamp01(+v || 0);
      if (v > target && !opening) { target = v; kick(); }
    },
    openIris(arcTarget, { onArcLand } = {}) {
      if (opening) return opening;
      opening = (async () => {
        // fecha o anel antes de abrir (no corte de 3 s ele ainda pode estar no meio)
        target = 1; rate = 22; kick();
        await until(() => shown >= 1, 260);
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        shown = 1; paint();
        el.classList.add("yk-is-open");
        if (reduce) { await fadeOut(); if (onArcLand) try { onArcLand(); } catch (err) { console.error(err); } } else await iris(arcTarget, onArcLand);
        curtain.remove(); stage.remove();
        irisDone = true;
        if (!posterOn) destroy();
      })();
      return opening;
    },
    /** cartaz por baixo da cortina: a íris abre nele quando o vivo não ficou pronto em 3 s */
    setPoster(url) {
      if (destroyed || !url) return;
      poster.src = url; poster.style.opacity = "1"; poster.classList.add("yk-on"); posterOn = true;
    },
    /** cruza o cartaz para o vivo; quando a íris já abriu, o loader sai do DOM no fim */
    fadePoster(ms = reduce ? 300 : 450) {
      if (!posterOn || destroyed) return Promise.resolve();
      return tween(ms, (k) => { poster.style.opacity = (1 - k).toFixed(3); }).then(() => {
        posterOn = false; poster.remove();
        if (irisDone) destroy();
      });
    },
    get progress() { return shown; },
    destroy,
  };
}

/* ================= MEDIDOR DO DEDO =================
   64 px, o mesmo pincel do loader (ring.webp), desenhado por stroke-dashoffset numa máscara. Único professor de gesto. */
let gaugeN = 0;
export function createGauge(rootEl = document.body) {
  injectStyle();
  const id = "yk-gauge-m" + ++gaugeN;
  const R = RING.mean * 100, C = 2 * Math.PI * R, a0 = (RING.drawFrom * Math.PI) / 180;
  // começa onde o loader começa (215 graus, horário), duas meias-voltas no sentido horário
  const sx = 50 + R * Math.sin(a0), sy = 50 - R * Math.cos(a0), ex = 100 - sx, ey = 100 - sy;
  const d = `M${sx.toFixed(2)} ${sy.toFixed(2)}A${R} ${R} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}A${R} ${R} 0 1 1 ${sx.toFixed(2)} ${sy.toFixed(2)}`;
  const band = (RING.outer - RING.inner) * 100 + 5; // cobre a borda irregular do pincel
  const el = document.createElement("div");
  el.className = "yk-gauge";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    `<svg viewBox="0 0 100 100" focusable="false"><defs><mask id="${id}" maskUnits="userSpaceOnUse" x="-5" y="-5" width="110" height="110">` +
    `<path d="${d}" fill="none" stroke="#fff" stroke-width="${band.toFixed(1)}" stroke-linecap="round" visibility="hidden" stroke-dasharray="${C.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/>` +
    `</mask></defs><image href="${IMG_RING}" xlink:href="${IMG_RING}" x="0" y="0" width="100" height="100" mask="url(#${id})"/></svg>`;
  rootEl.appendChild(el);
  const stroke = el.querySelector("mask path");
  let shown = false, value = -1, lx = NaN, ly = NaN;
  return {
    el,
    show(x, y) {
      // chamado todo quadro durante a pressão: só escreve o estilo quando o dedo andou
      x = +x || 0; y = +y || 0;
      if (Math.abs(x - lx) >= 0.5 || Math.abs(y - ly) >= 0.5 || lx !== lx) {
        lx = x; ly = y;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
      if (!shown) { shown = true; el.classList.add("yk-on"); }
    },
    set(v) {
      v = clamp01(+v || 0);
      if (Math.abs(v - value) < 0.002) return;
      value = v;
      // ponta redonda parece pincel; em zero esconde, senão a ponta vira um ponto solto
      stroke.setAttribute("visibility", v > 0.002 ? "visible" : "hidden");
      stroke.setAttribute("stroke-dashoffset", (C * (1 - v)).toFixed(2));
    },
    hide() { if (shown) { shown = false; el.classList.remove("yk-on"); } },
    dispose() { el.remove(); },
  };
}

/* ================= VIGIA DO CARLINHOS =================
   Plano de 1.6 m com ring.webp, de frente para a câmera do B6. Vazio = oni em traço respirando a 0.25 Hz.
   Sem render target (ruling). O <video> do DOM é recortado pela UI com screenCircle(). */
function haloCanvas(img) {
  // desfoque barato que funciona no Safari (sem ctx.filter): reduz em dois passos e amplia suavizado
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const mid = mk(174, 200), small = mk(36, 41), out = mk(192, 221);
  mid.getContext("2d").drawImage(img, 0, 0, mid.width, mid.height);
  small.getContext("2d").drawImage(mid, 0, 0, small.width, small.height);
  const g = out.getContext("2d");
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

export function buildPorthole(ctx) {
  const { THREE } = ctx;
  const P = LAYOUT.porthole, D = P.diameter;
  const root = new THREE.Group();
  root.name = "porthole";
  root.position.set(P.center[0], P.center[1], P.center[2]);
  const b6 = BEATS.find((b) => b.key === "carlinhos");
  if (b6) root.lookAt(new THREE.Vector3(b6.cam.pos[0], b6.cam.pos[1], b6.cam.pos[2]));

  // MeshBasic sem tone mapping: o #810015 e o osso do traço saem exatos, como no DOM
  const base = { transparent: true, depthWrite: false, toneMapped: false };
  const ringMat = new THREE.MeshBasicMaterial({ ...base });
  const oniMat = new THREE.MeshBasicMaterial({ ...base, blending: THREE.AdditiveBlending }); // fundo preto do webp some no aditivo
  const haloMat = new THREE.MeshBasicMaterial({ ...base, blending: THREE.AdditiveBlending, opacity: 0 });
  const oniW = ONI.ofRing * D, oniH = oniW * ONI.aspect;
  const ringMesh = new THREE.Mesh(new THREE.PlaneGeometry(D, D), ringMat);
  const haloMesh = new THREE.Mesh(new THREE.PlaneGeometry(oniW * 1.12, oniH * 1.12), haloMat);
  const oniMesh = new THREE.Mesh(new THREE.PlaneGeometry(oniW, oniH), oniMat);
  ringMesh.name = "porthole.ring"; haloMesh.name = "porthole.halo"; oniMesh.name = "porthole.oni";
  // milímetros à frente: a ordenação de transparentes por profundidade resolve sem renderOrder global
  haloMesh.position.z = 0.002; oniMesh.position.z = 0.004;
  for (const m of [ringMesh, haloMesh, oniMesh]) { m.visible = false; m.frustumCulled = true; root.add(m); }

  const textures = [];
  const loader = new THREE.TextureLoader();
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  const ready = Promise.all([load(IMG_RING), load(IMG_ONI)]).then(([rt, ot]) => {
    for (const t of [rt, ot]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; textures.push(t); }
    ringMat.map = rt; oniMat.map = ot;
    const ht = new THREE.CanvasTexture(haloCanvas(ot.image));
    ht.colorSpace = THREE.SRGBColorSpace; ht.generateMipmaps = false; ht.minFilter = THREE.LinearFilter;
    textures.push(ht);
    haloMat.map = ht;
    for (const m of [ringMat, oniMat, haloMat]) m.needsUpdate = true;
    for (const m of [ringMesh, haloMesh, oniMesh]) m.visible = true;
    return true;
  }).catch((err) => { console.error("porthole: imagens não carregaram", err); return false; });

  const hz = P.breatheHz, holeR = RING.inner * D * 0.97; // furo um pouco por dentro da borda irregular do pincel
  const _c = new THREE.Vector3(), _e = new THREE.Vector3(), _s = new THREE.Vector3();
  const out = { x: 0, y: 0, r: 0, visible: false };
  // tamanho CSS do canvas no último quadro: o canvas tem 100lvh, innerHeight do celular não é isso com a barra aberta
  const _vp = new THREE.Vector2();
  ringMesh.onBeforeRender = (renderer) => renderer.getSize(_vp);

  const part = {
    root,
    anchors: { center: new THREE.Vector3(0, 0, 0), world: new THREE.Vector3(P.center[0], P.center[1], P.center[2]) },
    explodeAxis: new THREE.Vector3(0, 0, 1),
    explodeDist: 0,
    ready,
    /** respiração do brilho: t em segundos (relógio da página). Halo de 25% a 100%, traço de 82% a 100%. */
    breathe(t) {
      const b = 0.5 - 0.5 * Math.cos(2 * Math.PI * hz * t);
      haloMat.opacity = 0.25 + 0.75 * b;
      oniMat.opacity = 0.82 + 0.18 * b;
    },
    /** opcional: encara a câmera atual (o build já encara a pose do B6). Supõe root sem pai girado. */
    faceCamera(camera) { root.quaternion.copy(camera.quaternion); },
    /** centro e raio do furo em px CSS. viewport = {width, height, left?, top?} do canvas. Objeto reutilizado. */
    screenCircle(camera, viewport) {
      const vw = viewport ? viewport.width : 0, vh = viewport ? viewport.height : 0;
      const w = vw || _vp.x || globalThis.innerWidth || 1, h = vh || _vp.y || globalThis.innerHeight || 1;
      const l = (viewport && viewport.left) || 0, t = (viewport && viewport.top) || 0;
      camera.updateMatrixWorld();
      root.updateWorldMatrix(true, false);
      root.getWorldPosition(_c);
      const s = root.getWorldScale(_s).x;
      _e.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(holeR * s).add(_c); // borda: lateral da câmera
      _c.project(camera); _e.project(camera);
      out.x = l + (_c.x * 0.5 + 0.5) * w;
      out.y = t + (0.5 - _c.y * 0.5) * h;
      out.r = Math.hypot((_e.x - _c.x) * 0.5 * w, (_e.y - _c.y) * 0.5 * h);
      out.visible = _c.z > -1 && _c.z < 1;
      return out;
    },
    dispose() {
      for (const m of [ringMesh, haloMesh, oniMesh]) m.geometry.dispose();
      for (const m of [ringMat, oniMat, haloMat]) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
  part.breathe(0);
  return part;
}

/** Bancada (lab/v3.html?p=emblem): vigia na origem, de frente para a vista "34", respirando. */
export async function labPreview(ctx) {
  const part = buildPorthole(ctx);
  const h = CAMERA.hero;
  part.root.position.set(0, 0, 0);
  part.root.lookAt(new ctx.THREE.Vector3(h.pos[0] - h.target[0], h.pos[1] - h.target[1], h.pos[2] - h.target[2]));
  await part.ready;
  part.update = (dt, t) => part.breathe(t);
  return part;
}
