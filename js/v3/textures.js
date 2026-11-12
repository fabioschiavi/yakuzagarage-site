/* v3: todas as texturas geradas em canvas. Nada de arquivo, exceto as imagens locais de img/.
   Convenções:
   - mapas normais em espaço tangente (OpenGL, +Y verde), derivados de um campo de altura por Sobel;
     o canvas tem flipY (linha 0 = v 1), por isso o sinal de y é invertido no Sobel.
   - mapas de dados (normal, rugosidade, anisotropia) ficam em NoColorSpace; cor e texto em sRGB.
   - quem precisa de outro repeat faz .clone(): o clone divide a mesma imagem na GPU (Source compartilhado).
   - textos (Anton, Instrument Serif) são desenhados já com fallback e redesenhados quando a fonte chega. */
import * as THREE from "three";
import { LAYOUT, PALETTE, FACTS, COPY, STUDIO } from "./spec.js";

const FONT_TITLE = '"Anton", "Impact", "Arial Narrow", sans-serif';
const FONT_SERIF = '"Instrument Serif", "Times New Roman", serif';
const TAU = Math.PI * 2;

/* ---------------- utilidades ---------------- */
export function rng(seed = 1) {
  // mulberry32: determinístico, para o mesmo desenho em todo carregamento
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => t * t * (3 - 2 * t);

function makeCanvas(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}
function canvasTex(c, { srgb = false, wrapS = THREE.RepeatWrapping, wrapT = THREE.RepeatWrapping, repeat = null, anisotropy = 8, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = wrapS; t.wrapT = wrapT; t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

/** Ruído de valor periódico (emenda perfeita nas bordas): px x py células no quadro inteiro. */
function tileNoise(w, h, px, py, seed) {
  const R = rng(seed), lat = new Float32Array(px * py);
  for (let i = 0; i < lat.length; i++) lat[i] = R();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * py, y0 = Math.floor(fy), ty = smooth(fy - y0), r0 = (y0 % py) * px, r1 = ((y0 + 1) % py) * px;
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * px, x0 = Math.floor(fx), tx = smooth(fx - x0), c0 = x0 % px, c1 = (x0 + 1) % px;
      const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
      const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
      out[y * w + x] = a + (b - a) * ty;
    }
  }
  return out;
}
/** fBm periódico normalizado em 0..1. */
export function fbmField(w, h, { octaves = 5, px = 4, py = 4, gain = 0.5, seed = 1 } = {}) {
  const out = new Float32Array(w * h); let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = tileNoise(w, h, px << o, py << o, seed * 131 + o * 17);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp; amp *= gain;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < out.length; i++) { const v = out[i] / norm; out[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * k;
  return out;
}
/** Desfoque de caixa separável em campo float (2 passes ~ gaussiano). wrap por eixo. */
function blurField(f, w, h, r, { wrapX = true, wrapY = true, passes = 2 } = {}) {
  if (r <= 0) return f;
  const tmp = new Float32Array(f.length), R = Math.max(1, Math.round(r)), n = 2 * R + 1;
  const run = (src, dst, len, count, stride, step, wrap) => {
    for (let c = 0; c < count; c++) {
      const base = c * stride;
      const at = (i) => src[base + (wrap ? ((i % len) + len) % len : clamp(i, 0, len - 1)) * step];
      let s = 0; for (let i = -R; i <= R; i++) s += at(i);
      for (let i = 0; i < len; i++) { dst[base + i * step] = s / n; s += at(i + R + 1) - at(i - R); }
    }
  };
  for (let p = 0; p < passes; p++) { run(f, tmp, w, h, w, 1, wrapX); run(tmp, f, h, w, 1, w, wrapY); }
  return f;
}
/** Altura a partir do canal R de um canvas (0..1). */
function heightFromCanvas(c) {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, f = new Float32Array(c.width * c.height);
  for (let i = 0; i < f.length; i++) f[i] = d[i * 4] / 255;
  return f;
}
/** Sobel: altura -> normal em espaço tangente. sx/sy convertem "1 de altura por pixel" em inclinação. */
export function normalFromHeight(hf, w, h, { sx = 1, sy = 1, wrapX = true, wrapY = true } = {}) {
  const out = new Uint8ClampedArray(w * h * 4);
  const ix = (x) => (wrapX ? (x + w) % w : clamp(x, 0, w - 1)), iy = (y) => (wrapY ? (y + h) % h : clamp(y, 0, h - 1));
  for (let y = 0; y < h; y++) {
    const ra = iy(y - 1) * w, rb = y * w, rc = iy(y + 1) * w;
    for (let x = 0; x < w; x++) {
      const xl = ix(x - 1), xr = ix(x + 1);
      const a = hf[ra + xl], b = hf[ra + x], c = hf[ra + xr], d = hf[rb + xl], f = hf[rb + xr], g = hf[rc + xl], i = hf[rc + x], j = hf[rc + xr];
      const gx = (c + 2 * f + j - a - 2 * d - g) / 8;
      const gy = (g + 2 * i + j - a - 2 * b - c) / 8; // +y do canvas = -v
      const nx = -gx * sx, ny = gy * sy, l = 1 / Math.sqrt(nx * nx + ny * ny + 1), k = (rb + x) * 4;
      out[k] = (nx * l * 0.5 + 0.5) * 255; out[k + 1] = (ny * l * 0.5 + 0.5) * 255; out[k + 2] = (l * 0.5 + 0.5) * 255; out[k + 3] = 255;
    }
  }
  return out;
}
function normalCanvas(hf, w, h, opts) {
  const c = makeCanvas(w, h);
  c.getContext("2d").putImageData(new ImageData(normalFromHeight(hf, w, h, opts), w, h), 0, 0);
  return c;
}
function grayCanvas(f, w, h, map = (v) => v) {
  const c = makeCanvas(w, h), g = c.getContext("2d"), img = g.createImageData(w, h);
  for (let i = 0; i < f.length; i++) { const v = clamp(map(f[i]), 0, 1) * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

/* ---------------- fontes ---------------- */
let _fonts = null;
/** Promessa que resolve quando Anton e Instrument Serif carregaram (ou após 2.5 s). Precisa do @font-face na página. */
export function fontsReady() {
  if (_fonts) return _fonts;
  const want = ['400 100px "Anton"', '400 100px "Instrument Serif"', 'italic 400 100px "Instrument Serif"'];
  const load = typeof document !== "undefined" && document.fonts ? Promise.all(want.map((f) => document.fonts.load(f).catch(() => null))) : Promise.resolve();
  _fonts = Promise.race([load, new Promise((r) => setTimeout(r, 2500))]).then(() => true);
  return _fonts;
}
/** Desenha agora e de novo quando a fonte chegar: a textura nunca fica vazia nem presa no fallback. */
function drawWithFonts(t, draw) {
  draw();
  fontsReady().then(() => { draw(); t.needsUpdate = true; });
}

/* ---------------- 1. banda de rodagem ----------------
   Canvas 256 (u, em volta) x 1024 (v, de ombro a ombro da coroa). Um ladrilho = 1/32 da volta (64.9 mm).
   A spec diz 1024x256; aqui está de pé para casar com o UV do torno (u em volta). Mesmos pixels, px quase quadrado.
   v = 0..1 ao longo da coroa; sulcos de geometria em v = 0.2, 0.4, 0.6, 0.8 (o mapa deixa liso ali). */
export function treadNormal({ strength = 0.28 } = {}) {
  const W = 256, H = 1024, T = LAYOUT.tyre;
  const tileMM = (Math.PI * T.od * 1000) / T.tread.repeatAround, crownMM = (T.section - 0.03) * 1000;
  const pu = W / tileMM, pv = H / crownMM;
  const c = makeCanvas(W, H), g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.setTransform(pu, 0, 0, pv, 0, 0); // desenho em mm
  g.lineCap = "round"; g.lineJoin = "round";
  const V = (v) => v * crownMM;
  const each = (fn) => { for (const off of [-tileMM, 0, tileMM]) fn(off); };
  // blocos de ombro: 2 fendas laterais por passo, levemente curvas, abertas para fora
  for (const [v0, v1, dir] of [[-0.02, 0.165, 1], [1.02, 0.835, -1]]) {
    for (const u of [0.22, 0.72]) each((off) => {
      g.strokeStyle = "#000"; g.lineWidth = 4.6;
      g.beginPath(); g.moveTo(off + u * tileMM, V(v0));
      g.quadraticCurveTo(off + (u + 0.05) * tileMM, V((v0 + v1) / 2), off + (u + 0.085) * tileMM, V(v1)); g.stroke();
      // lamela rasa no meio do bloco
      g.strokeStyle = "#7a7a7a"; g.lineWidth = 0.9;
      const um = u + 0.25;
      g.beginPath(); g.moveTo(off + um * tileMM, V(v0 + 0.02 * dir)); g.lineTo(off + (um + 0.06) * tileMM, V(v1 - 0.015 * dir)); g.stroke();
    });
  }
  // nervuras centrais: lamelas inclinadas 25 graus, alternando por nervura, fechadas a 1.5 mm das bordas
  const ribs = [[0.222, 0.378], [0.422, 0.578], [0.622, 0.778]];
  ribs.forEach(([a, b], k) => {
    const len = V(b) - V(a) - 3, du = Math.tan((25 * Math.PI) / 180) * len * (k % 2 ? -1 : 1);
    for (let s = 0; s < 3; s++) each((off) => {
      const u0 = off + ((s + 0.5) / 3) * tileMM - du / 2;
      g.strokeStyle = "#6a6a6a"; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(u0, V(a) + 1.5); g.lineTo(u0 + du, V(b) - 1.5); g.stroke();
    });
  });
  g.setTransform(1, 0, 0, 1, 0, 0);
  const hf = blurField(heightFromCanvas(c), W, H, 1.2, { wrapX: true, wrapY: false });
  const depthMM = LAYOUT.tyre.grooves.depth * 1000;
  const n = normalCanvas(hf, W, H, { sx: depthMM * pu * strength, sy: depthMM * pv * strength, wrapX: true, wrapY: false });
  const t = canvasTex(n, { wrapT: THREE.ClampToEdgeWrapping, repeat: [T.tread.repeatAround, 1] });
  t.name = "treadNormal"; t.userData = { grooveV: [0.2, 0.4, 0.6, 0.8], tileMM, crownMM, axis: "u around, v across crown" };
  return t;
}

/* ---------------- 2. costado com endereço moldado ----------------
   Faixa 4096 (u em volta) x 256 (v radial). v = (r - beadR) / (r0 - beadR): 0 no talão, 1 no raio externo.
   Um arco só, centrado em centerU. Com o torno em Y girado por rotateZ(-PI/2) para o eixo +X, o topo do mundo
   fica em u = 0.75 e u cresce para +Z; vista de +X a leitura corre para -Z, daí flipU = true (espelha). */
export function sidewallNormal(lines = [FACTS.addressMolded], { centerU = 0.75, flipU = true, flipV = false, rText = 0.289, strength = 1, gapLines = 1.55 } = {}) {
  const W = LAYOUT.tyre.sidewallMap.size[0], H = LAYOUT.tyre.sidewallMap.size[1], T = LAYOUT.tyre, S = T.sidewallMap;
  const spanMM = (T.r0 - T.beadR) * 1000, pv = H / spanMM;
  const capMM = S.capHeight * 1000, raisedMM = S.raised * 1000;
  const c = makeCanvas(W, H), g = c.getContext("2d");
  const draw = () => {
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "alphabetic";
    // tamanho da fonte para a altura de maiúscula pedida (mede o "H" de verdade)
    g.font = `400 100px ${FONT_TITLE}`;
    const m = g.measureText("H"), capRatio = (m.actualBoundingBoxAscent || 73) / 100;
    const capPx = capMM * pv, fontPx = capPx / capRatio;
    lines.forEach((text, i) => {
      const r = rText - i * gapLines * S.capHeight;               // linhas seguintes descem para o talão
      const pu = W / (TAU * r * 1000), sx = pu / pv;            // px por mm em volta / px por mm radial
      const vBase = (r - S.capHeight / 2 - T.beadR) / (T.r0 - T.beadR);
      const yBase = (flipV ? vBase : 1 - vBase) * H;
      g.font = `400 ${fontPx}px ${FONT_TITLE}`;
      for (const off of [-W, 0, W]) {
        g.save(); g.translate(centerU * W + off, yBase); g.scale(sx * (flipU ? -1 : 1), flipV ? -1 : 1);
        g.fillText(text, 0, 0); g.restore();
      }
    });
  };
  draw();
  const t = canvasTex(c, { wrapT: THREE.ClampToEdgeWrapping }); // provisório até virar normal
  const bake = () => {
    const hf = blurField(heightFromCanvas(c), W, H, 1.3, { wrapX: true, wrapY: false });
    const pu = W / (TAU * rText * 1000);
    const n = normalFromHeight(hf, W, H, { sx: raisedMM * pu * strength, sy: raisedMM * pv * strength, wrapX: true, wrapY: false });
    c.getContext("2d").putImageData(new ImageData(n, W, H), 0, 0);
    t.needsUpdate = true;
  };
  bake();
  fontsReady().then(() => { draw(); bake(); });
  t.name = "sidewallNormal";
  t.userData = { centerU, flipU, flipV, rText, v: "(r - beadR) / (r0 - beadR)", lines };
  return t;
}

/* ---------------- 3. rosca ----------------
   Um passo por ladrilho em v, hélice de um passo por volta em u (avanço = passo). Perfil 60 graus com crista arredondada.
   repeat.y = comprimento / pitchM (faça um clone por peça). */
export function threadNormal(pitchM = LAYOUT.coilover.body.threadPitch, { strength = 1 } = {}) {
  const W = 64, H = 64, hf = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ph = ((1 - (y + 0.5) / H) - (x + 0.5) / W + 2) % 1;    // v - u: hélice
    const tri = 1 - 2 * Math.abs(ph - 0.5);
    hf[y * W + x] = smooth(clamp(tri * 1.15 - 0.075, 0, 1));    // crista e raiz levemente planas
  }
  const pitchMM = pitchM * 1000, depthMM = 0.6 * pitchMM, pv = H / pitchMM;
  const n = normalCanvas(hf, W, H, { sx: depthMM * pv * strength * 0.02, sy: depthMM * pv * strength, wrapX: true, wrapY: true });
  const t = canvasTex(n); t.name = "threadNormal"; t.userData = { pitchM, note: "repeat.y = length / pitch" };
  return t;
}

/* ---------------- 4. rugosidade torneada ----------------
   UV planar: 0..1 atravessa o diâmetro 2R (kit.planarUV(g, R)). Anéis finos com rugosidade variando; o canal G multiplica a roughness. */
export function turningRoughness({ size = 1024, seed = 5 } = {}) {
  const R = rng(seed), N = size * 2, prof = new Float32Array(N);
  // perfil radial: passo de ferramenta (0.6 a 2.2 px) + bandas largas de vibração
  let i = 0;
  while (i < N) {
    const w = 1.2 + R() * 3.2, v = 0.78 + (R() - 0.5) * 0.36;
    for (let k = 0; k < w && i < N; k++, i++) prof[i] = v;
  }
  for (let k = 0; k < N; k++) prof[k] += 0.05 * Math.sin(k * 0.021 + 1.3) + 0.04 * Math.sin(k * 0.0057);
  const c = makeCanvas(size, size), g = c.getContext("2d"), img = g.createImageData(size, size), h = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x + 0.5 - h, y + 0.5 - h) * 4, r0 = Math.floor(r), f = r - r0;
    const v = r0 + 1 < N ? prof[r0] * (1 - f) + prof[r0 + 1] * f : prof[N - 1];
    const k = (y * size + x) * 4, b = clamp(v, 0, 1) * 255;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = canvasTex(c, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, anisotropy: 16 });
  t.name = "turningRoughness"; t.userData = { uv: "planar, 0..1 across 2R" };
  return t;
}

/* ---------------- 5. anisotropia circunferencial ----------------
   RG = direção em espaço tangente (-1..1 -> 0..1), B = força. Mesmo UV planar do torneado. */
export function anisoCircular({ size = 256 } = {}) {
  const c = makeCanvas(size, size), g = c.getContext("2d"), img = g.createImageData(size, size), h = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5 - h) / h, py = (h - (y + 0.5)) / h, r = Math.hypot(px, py) || 1e-6;
    const dx = -py / r, dy = px / r, k = (y * size + x) * 4;
    img.data[k] = (dx * 0.5 + 0.5) * 255; img.data[k + 1] = (dy * 0.5 + 0.5) * 255;
    img.data[k + 2] = clamp((r - 0.04) / 0.1, 0, 1) * 255; img.data[k + 3] = 255; // some no centro (direção indefinida)
  }
  g.putImageData(img, 0, 0);
  const t = canvasTex(c, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  t.name = "anisoCircular";
  return t;
}

/* ---------------- 6. marcas de swirl ----------------
   UV planar sobre a face (r 0.215). Fundo = névoa fina, riscos em arco = lavagem errada. G em 0..1 entra no clearcoat via uSwirl. */
export function swirlMap({ size = LAYOUT.wheel.material.face.swirlMapSize, seed = 9 } = {}) {
  const R = rng(seed), c = makeCanvas(size, size), g = c.getContext("2d");
  g.fillStyle = "rgb(46,46,46)"; g.fillRect(0, 0, size, size);
  g.lineCap = "round";
  for (let i = 0; i < 2600; i++) {
    // swirl de verdade: arcos quase concêntricos em torno de centros aleatórios, tamanhos variados
    const cx = R() * size, cy = R() * size, r = 20 + Math.pow(R(), 1.6) * size * 0.55, a0 = R() * TAU, span = 0.15 + R() * 1.1;
    const v = 120 + R() * 135, a = 0.08 + R() * 0.3;
    g.strokeStyle = `rgba(${v},${v},${v},${a})`; g.lineWidth = 0.5 + R() * 1.1;
    g.beginPath(); g.arc(cx, cy, r, a0, a0 + span); g.stroke();
  }
  // poucos riscos retos (pano sujo)
  for (let i = 0; i < 60; i++) {
    const x = R() * size, y = R() * size, l = 30 + R() * 160, a = R() * TAU;
    g.strokeStyle = `rgba(255,255,255,${0.1 + R() * 0.25})`; g.lineWidth = 0.6 + R() * 0.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = canvasTex(c, { anisotropy: 16 }); t.name = "swirlMap";
  return t;
}

/* ---------------- 7. cor de revenimento (palha -> azul) ----------------
   x = calor acumulado (0 metal nu, 1 cinza-azulado depois do azul), y = manchas. sRGB. Rampa e cordão de solda. */
export function heatTintMap({ w = 512, h = 64, seed = 13 } = {}) {
  const stops = [[0.0, [150, 152, 156]], [0.14, [205, 190, 140]], [0.28, [200, 158, 78]], [0.42, [158, 96, 50]], [0.54, [112, 52, 92]], [0.66, [52, 64, 146]], [0.8, [74, 118, 176]], [1.0, [118, 128, 140]]];
  const ramp = (x) => {
    x = clamp(x, 0, 1);
    for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = smooth((x - a) / (b - a));
      return ca.map((v, k) => v + (cb[k] - v) * f);
    }
    return stops[stops.length - 1][1];
  };
  const n = fbmField(w, h, { px: 8, py: 2, octaves: 4, seed });
  const c = makeCanvas(w, h), g = c.getContext("2d"), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, col = ramp(x / (w - 1) + (n[i] - 0.5) * 0.07), k = i * 4;
    img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = canvasTex(c, { srgb: true, wrapS: THREE.ClampToEdgeWrapping });
  t.name = "heatTintMap"; t.userData = { stops };
  return t;
}

/* ---------------- 8. normal a partir de imagem ----------------
   Luminância x alfa vira altura. strength = inclinação para altura 1 por pixel. */
export function sobelFromImage(img, strength = 1, { maxSize = 1024, blur = 1, invert = false, wrap = false } = {}) {
  const iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
  const k = Math.min(1, maxSize / Math.max(iw, ih)), W = Math.max(4, Math.round(iw * k)), H = Math.max(4, Math.round(ih * k));
  const c = makeCanvas(W, H), g = c.getContext("2d");
  g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data, hf = new Float32Array(W * H);
  for (let i = 0; i < hf.length; i++) {
    const l = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255 * (d[i * 4 + 3] / 255);
    hf[i] = invert ? 1 - l : l;
  }
  blurField(hf, W, H, blur, { wrapX: wrap, wrapY: wrap });
  const t = canvasTex(normalCanvas(hf, W, H, { sx: strength, sy: strength, wrapX: wrap, wrapY: wrap }), {
    wrapS: wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping, wrapT: wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
  });
  t.name = "sobelFromImage";
  return t;
}

/* ---------------- 9. título gigante vazado ----------------
   4096x512, Anton em strokeText, osso a 30%, sem preenchimento. Plano de 6 m: 1 px do canvas = 1.5 mm. */
export function titleTexture(word = COPY.titles.hero, { lineWidth = 3, alpha = LAYOUT.title.alpha } = {}) {
  const [W, H] = LAYOUT.title.canvas, c = makeCanvas(W, H), g = c.getContext("2d");
  const t = canvasTex(c, { srgb: true, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, anisotropy: 8 });
  drawWithFonts(t, () => {
    g.clearRect(0, 0, W, H);
    g.font = `400 400px ${FONT_TITLE}`;
    const m = g.measureText(word), asc = m.actualBoundingBoxAscent || 300, desc = m.actualBoundingBoxDescent || 0;
    const k = Math.min((W * 0.97) / m.width, (H * 0.86) / (asc + desc)), px = 400 * k;
    g.font = `400 ${px}px ${FONT_TITLE}`;
    g.textAlign = "center"; g.textBaseline = "alphabetic"; g.lineJoin = "round"; g.miterLimit = 2;
    g.strokeStyle = `rgba(242,238,230,${alpha})`; g.lineWidth = lineWidth;
    g.strokeText(word, W / 2, H / 2 + ((asc - desc) * k) / 2);
  });
  t.name = "title:" + word; t.userData = { word };
  return t;
}

/* ---------------- 10. fita de legendas da órbita ----------------
   4096x128, u ao longo da elipse. labels: strings (espaçadas por igual) ou {text, u}. Instrument Serif, osso. */
export function labelRibbonTexture(labels = COPY.orbitLabels.map((l) => l.text), { italic = true } = {}) {
  const [W, H] = LAYOUT.orbit.ribbonCanvas, c = makeCanvas(W, H), g = c.getContext("2d");
  const items = labels.map((l, i) => (typeof l === "string" ? { text: l, u: (i + 0.5) / labels.length } : l));
  const t = canvasTex(c, { srgb: true, wrapT: THREE.ClampToEdgeWrapping, anisotropy: 16 });
  drawWithFonts(t, () => {
    g.clearRect(0, 0, W, H);
    g.font = `${italic ? "italic " : ""}400 ${Math.round(H * 0.6)}px ${FONT_SERIF}`;
    g.fillStyle = PALETTE.bone; g.textAlign = "center"; g.textBaseline = "middle";
    for (const { text, u } of items) for (const off of [-W, 0, W]) g.fillText(text, u * W + off, H * 0.54);
  });
  t.name = "labelRibbon"; t.userData = { items };
  return t;
}

/* ---------------- 11. anel de legenda do disco ----------------
   Faixa polar 4096 (u = ângulo) x 128 (v = raio, 0 dentro, 1 fora). O RingGeometry precisa de UV polar:
   u = atan2(y, x) / 2pi, v = (r - inner) / (outer - inner). Texto repetido até fechar a volta sem emenda. */
export function ringLabelTexture(text = COPY.ringLabel, { inner = LAYOUT.labelRing.inner, outer = LAYOUT.labelRing.outer, flipU = false } = {}) {
  const [W, H] = LAYOUT.labelRing.canvas, c = makeCanvas(W, H), g = c.getContext("2d");
  const pu = W / (TAU * ((inner + outer) / 2) * 1000), pv = H / ((outer - inner) * 1000), sx = pu / pv;
  const t = canvasTex(c, { srgb: true, wrapT: THREE.ClampToEdgeWrapping, anisotropy: 16 });
  drawWithFonts(t, () => {
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    const fpx = Math.round(H * 0.62);
    g.font = `400 ${fpx}px ${FONT_SERIF}`;
    const unit = text.trim() + "   ", wpx = g.measureText(unit).width * sx;
    const n = Math.max(1, Math.floor(W / wpx)), step = W / n;          // estica o espaço para emendar certo
    g.fillStyle = PALETTE.bone; g.textBaseline = "middle"; g.textAlign = "center";
    for (let i = 0; i < n; i++) {
      g.save(); g.translate((i + 0.5) * step, H * 0.52); g.scale(sx * (flipU ? -1 : 1), 1);
      g.fillText(unit, 0, 0); g.restore();
    }
  });
  t.name = "ringLabel"; t.userData = { inner, outer, uv: "polar" };
  return t;
}

/* ---------------- render de um objeto para pixels (bokeh e disco borrado) ----------------
   O alvo é linear sem tone mapping; convertemos aqui (ACES aproximado + sRGB) para o sprite casar com a cena. */
const acesSRGB = (x, exposure = STUDIO.exposure) => {
  x *= exposure;
  const y = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1);
  return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
};
function renderObject(renderer, object, { size, dir = [0.55, 0.45, 1], up = [0, 1, 0], ortho = false, fill = 0.62, env = null }) {
  const scene = new THREE.Scene();
  scene.environment = env;
  const key = new THREE.DirectionalLight(0xffffff, STUDIO.key.intensity); key.position.set(...STUDIO.key.position); scene.add(key);
  object.updateWorldMatrix(true, true);
  const clone = object.clone(true);
  object.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
  scene.add(clone); clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone), center = box.getCenter(new THREE.Vector3());
  let radius, half = 0;
  const d = new THREE.Vector3(...dir).normalize(), u = new THREE.Vector3(...up);
  let cam;
  if (ortho) {
    // raio no plano perpendicular à vista; a quina da caixa de um disco fica a r*sqrt2, daí a divisão
    const corners = []; for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    radius = Math.max(...corners.map((p) => { const q = p.clone().sub(center); return q.sub(d.clone().multiplyScalar(q.dot(d))).length(); })) / Math.SQRT2;
    const h = (half = radius / fill);
    cam = new THREE.OrthographicCamera(-h, h, h, -h, 0.001, 100);
    cam.position.copy(center).addScaledVector(d, 10);
  } else {
    radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    cam = new THREE.PerspectiveCamera(20, 1, 0.001, 100);
    const dist = radius / Math.sin((10 * Math.PI) / 180) / fill;
    cam.position.copy(center).addScaledVector(d, dist);
  }
  cam.up.copy(u); cam.lookAt(center); cam.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, depthBuffer: true });
  const prevRT = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  const buf = new Uint8Array(size * size * 4);
  try {
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, true);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
  } finally {
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevColor, prevAlpha); rt.dispose();
  }
  return { buf, radius, half, center };
}
/** buf linear (linhas de baixo para cima) -> RGBA float pré-multiplicado, de cima para baixo, já em sRGB. */
function toPremulSRGB(buf, size, down = 1) {
  const s = size / down, out = new Float32Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < down; j++) for (let i = 0; i < down; i++) {
      const k = ((size - 1 - (y * down + j)) * size + (x * down + i)) * 4, al = buf[k + 3] / 255;
      r += acesSRGB(buf[k] / 255) * al; g += acesSRGB(buf[k + 1] / 255) * al; b += acesSRGB(buf[k + 2] / 255) * al; a += al;
    }
    const n = down * down, o = (y * s + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
  }
  return out;
}
function premulToCanvas(f, s, gain = 1) {
  const c = makeCanvas(s, s), g = c.getContext("2d"), img = g.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const a = f[i * 4 + 3], k = i * 4;
    if (a > 1e-4) { img.data[k] = clamp((f[k] / a) * gain, 0, 1) * 255; img.data[k + 1] = clamp((f[k + 1] / a) * gain, 0, 1) * 255; img.data[k + 2] = clamp((f[k + 2] / a) * gain, 0, 1) * 255; }
    img.data[k + 3] = clamp(a, 0, 1) * 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ---------------- 12. bokeh ----------------
   Impostor de 128 px renderizado da malha real (2x e reduzido), desfocado em JS (o ctx.filter não existe no Safari). */
export function bokehSprite(mesh, renderer, { size = 128, blur = 0.075, env = null, dir } = {}) {
  const { buf } = renderObject(renderer, mesh, { size: size * 2, fill: 0.5, env, dir });
  const f = toPremulSRGB(buf, size * 2, 2), r = Math.max(1, blur * size);
  for (let ch = 0; ch < 4; ch++) {
    const plane = new Float32Array(size * size);
    for (let i = 0; i < plane.length; i++) plane[i] = f[i * 4 + ch];
    blurField(plane, size, size, r, { wrapX: false, wrapY: false, passes: 3 });
    for (let i = 0; i < plane.length; i++) f[i * 4 + ch] = plane[i];
  }
  const t = canvasTex(premulToCanvas(f, size, 1.12), { srgb: true, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, mips: false });
  t.name = "bokeh"; return t;
}

/* ---------------- 13. disco borrado (face girando) ----------------
   Vista ortográfica de +X, borrão angular em JS. O plano do impostor: PlaneGeometry(2r, 2r).rotateY(PI/2)
   (canvas direita = -Z, canvas cima = +Y). userData.radius = raio coberto pelo quadro. */
export function blurredDisc(mesh, renderer, { size = 384, span = 1.2, samples = 32, env = null } = {}) {
  const fill = 0.98;
  const { buf, half } = renderObject(renderer, mesh, { size, dir: [1, 0, 0], up: [0, 1, 0], ortho: true, fill, env });
  const src = toPremulSRGB(buf, size, 1), out = new Float32Array(src.length), h = size / 2;
  const angs = Array.from({ length: samples }, (_, i) => span * (i / (samples - 1) - 0.5));
  const cs = angs.map(Math.cos), sn = angs.map(Math.sin);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x + 0.5 - h, dy = y + 0.5 - h, o = (y * size + x) * 4;
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < samples; k++) {
      const sx = Math.round(h + dx * cs[k] - dy * sn[k] - 0.5), sy = Math.round(h + dx * sn[k] + dy * cs[k] - 0.5);
      if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
      const q = (sy * size + sx) * 4; r += src[q]; g += src[q + 1]; b += src[q + 2]; a += src[q + 3];
    }
    out[o] = r / samples; out[o + 1] = g / samples; out[o + 2] = b / samples; out[o + 3] = a / samples;
  }
  const t = canvasTex(premulToCanvas(out, size), { srgb: true, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  t.name = "blurredDisc"; t.userData = { radius: half, span };
  return t;
}

/* ---------------- 14. sombra de contato ----------------
   Gaussiana preta com alfa, borda zerada antes da quina do plano. */
export function blobShadow({ size = 256 } = {}) {
  const c = makeCanvas(size, size), g = c.getContext("2d"), img = g.createImageData(size, size), h = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h, a = Math.exp(-r * r * 4.2) * (1 - smooth(clamp((r - 0.8) / 0.2, 0, 1)));
    img.data[(y * size + x) * 4 + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = canvasTex(c, { srgb: true, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  t.name = "blobShadow"; return t;
}

/* ---------------- extras que as peças vão pedir ---------------- */
/** fBm 512 para rugosidade (basalto, fundido, jateado). G em ~0.7..1.3 x roughness. */
export function fbmRoughness({ size = LAYOUT.slab.fbmSize, seed = 21 } = {}) {
  const f = fbmField(size, size, { px: 6, py: 6, octaves: 6, gain: 0.55, seed });
  const t = canvasTex(grayCanvas(f, size, size, (v) => 0.55 + 0.45 * v)); t.name = "fbmRoughness"; return t;
}
/** Normal de grão fino (casca de laranja da pintura, jato de areia, pedra). Use com repeat alto. */
export function grainNormal({ size = 512, seed = 33, strength = 2.2 } = {}) {
  const f = fbmField(size, size, { px: 32, py: 32, octaves: 3, gain: 0.5, seed });
  const t = canvasTex(normalCanvas(f, size, size, { sx: strength * 8, sy: strength * 8 })); t.name = "grainNormal"; return t;
}
/** Disco: 6 rasgos curvos por face (só normal) + ondulação leve do torno. UV planar igual ao torneado. */
export function rotorSlotsNormal({ size = 1024, slots = LAYOUT.rotor.slotsPerFace, strength = 0.5 } = {}) {
  const Rr = LAYOUT.rotor.R, c = makeCanvas(size, size), g = c.getContext("2d"), pmm = size / (2 * Rr * 1000), h = size / 2;
  g.fillStyle = "#fff"; g.fillRect(0, 0, size, size);
  g.strokeStyle = "#000"; g.lineCap = "round"; g.lineWidth = 2 * pmm;
  const r0 = 0.128, r1 = 0.182, sweep = 0.42;
  for (let s = 0; s < slots; s++) {
    const a0 = (s / slots) * TAU + 0.26; g.beginPath();
    for (let k = 0; k <= 24; k++) {
      const t = k / 24, r = (r0 + (r1 - r0) * t) * 1000 * pmm, a = a0 + sweep * t * t;
      const x = h + Math.cos(a) * r, y = h - Math.sin(a) * r; k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  const hf = heightFromCanvas(c), R = rng(41), N = size * 2, prof = new Float32Array(N);
  for (let i = 0; i < N; i++) prof[i] = Math.sin(i * 1.9 + R() * 0.6) * 0.004;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const r = Math.hypot(x + 0.5 - h, y + 0.5 - h) * 2; hf[y * size + x] += prof[Math.min(N - 1, r | 0)]; }
  blurField(hf, size, size, 1, { wrapX: false, wrapY: false });
  const depthMM = 1.2;
  const t = canvasTex(normalCanvas(hf, size, size, { sx: depthMM * pmm * strength, sy: depthMM * pmm * strength, wrapX: false, wrapY: false }), { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, anisotropy: 16 });
  t.name = "rotorSlotsNormal"; return t;
}
export function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.decoding = "async"; im.onload = () => res(im); im.onerror = () => rej(new Error("imagem não carregou: " + url)); im.src = url; });
}
/** Oni em traço osso com alfa (inlay da calota). Devolve já; desenha quando a imagem chega. */
export function oniDecal({ size = 512, url = new URL("../../img/oni.webp", import.meta.url).href } = {}) {
  const c = makeCanvas(size, size), g = c.getContext("2d");
  const t = canvasTex(c, { srgb: true, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  t.name = "oniDecal";
  t.userData.ready = loadImage(url).then((im) => {
    const k = Math.min(size / im.naturalWidth, size / im.naturalHeight) * 0.92, w = im.naturalWidth * k, hh = im.naturalHeight * k;
    g.drawImage(im, (size - w) / 2, (size - hh) / 2, w, hh);
    const d = g.getImageData(0, 0, size, size);
    for (let i = 0; i < d.data.length; i += 4) {
      const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 765, a = smooth(clamp((l - 0.35) / 0.4, 0, 1)); // só o traço, sem o halo
      d.data[i] = 242; d.data[i + 1] = 238; d.data[i + 2] = 230; d.data[i + 3] = a * 255;
    }
    g.putImageData(d, 0, 0); t.needsUpdate = true; return t;
  }).catch(() => t);
  return t;
}

/* ---------------- cache preguiçoso ----------------
   tex.treadNormal() cria na primeira chamada e devolve a mesma textura depois. Com argumentos, a chave inclui os argumentos. */
export function createTextures(renderer, { envTex = null } = {}) {
  const cache = new Map();
  const memo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  const k = (...a) => JSON.stringify(a);
  const tex = {
    renderer,
    env: envTex,
    setEnv(t) { tex.env = t; },
    fontsReady,
    treadNormal: (o) => memo("tread" + k(o), () => treadNormal(o)),
    sidewallNormal: (lines, o) => memo("side" + k(lines, o), () => sidewallNormal(lines, o)),
    threadNormal: (pitchM, o) => memo("thread" + k(pitchM, o), () => threadNormal(pitchM, o)),
    turningRoughness: (o) => memo("turn" + k(o), () => turningRoughness(o)),
    anisoCircular: (o) => memo("aniso" + k(o), () => anisoCircular(o)),
    swirlMap: (o) => memo("swirl" + k(o), () => swirlMap(o)),
    heatTintMap: (o) => memo("tint" + k(o), () => heatTintMap(o)),
    sobelFromImage: (img, strength, o) => memo("sobel" + k(img.src || img.id || img.width, strength, o), () => sobelFromImage(img, strength, o)),
    titleTexture: (word, o) => memo("title" + k(word, o), () => titleTexture(word, o)),
    labelRibbonTexture: (labels, o) => memo("ribbon" + k(labels, o), () => labelRibbonTexture(labels, o)),
    ringLabelTexture: (text, o) => memo("ring" + k(text, o), () => ringLabelTexture(text, o)),
    bokehSprite: (mesh, r = renderer, o = {}) => memo("bokeh" + mesh.uuid + k(o), () => bokehSprite(mesh, r || renderer, { env: tex.env, ...o })),
    blurredDisc: (mesh, r = renderer, o = {}) => memo("disc" + mesh.uuid + k(o), () => blurredDisc(mesh, r || renderer, { env: tex.env, ...o })),
    blobShadow: (o) => memo("blob" + k(o), () => blobShadow(o)),
    fbmRoughness: (o) => memo("fbm" + k(o), () => fbmRoughness(o)),
    grainNormal: (o) => memo("grainN" + k(o), () => grainNormal(o)),
    rotorSlotsNormal: (o) => memo("slots" + k(o), () => rotorSlotsNormal(o)),
    oniDecal: (o) => memo("oni" + k(o), () => oniDecal(o)),
    /** quantas texturas e quanto de GPU (aprox., com mipmaps) */
    stats() {
      let bytes = 0;
      for (const t of cache.values()) { const im = t.image; if (im && im.width) bytes += im.width * im.height * 4 * (t.generateMipmaps === false ? 1 : 1.333); }
      return { count: cache.size, mb: +(bytes / 1048576).toFixed(1), names: [...cache.values()].map((t) => t.name) };
    },
    dispose() { for (const t of cache.values()) t.dispose(); cache.clear(); },
  };
  return tex;
}
