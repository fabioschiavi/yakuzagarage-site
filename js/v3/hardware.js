/* v3: ferragens compartilhadas (porca de roda, bobbin do disco flutuante, parafuso flangeado) e os destroços.
   Convenção de toda ferragem: eixo em +X (o lado de fora), metros, origem na face de contato.
   - porca: origem no plano da sede (boca do cone de 60 graus); o corpo cresce para +X. Comprimento 35 mm.
   - parafuso: origem sob a cabeça; cabeça para +X, haste para -X.
   - bobbin: origem no plano de junção chapéu/pista; flange com o botão do parafuso para +X.
   Ângulo em volta do eixo = theta da spec: y = r sin(theta), z = -r cos(theta) (theta 90 graus = topo).
   Sextavado de verdade: raio = min(sextavado com canto arredondado, perfil). O cone do chanfro corta só os cantos
   e deixa os arcos nas faces, como numa porca real, e as faces ficam planas (normais por área, não "redondas"). */
import * as THREE from "three";
import { LAYOUT, SIM, BEATS, CAMERA } from "./spec.js";
import { bokehSprite, rng } from "./textures.js";

const TAU = Math.PI * 2, D2R = Math.PI / 180, T30 = Math.tan(Math.PI / 6), C30 = Math.cos(Math.PI / 6);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------------- furação da roda (compartilhada com hub.js e com quem montar as porcas) ---------------- */
// Não está na spec: prisioneiro 0 no topo (theta 90 graus) e os outros a cada 72 graus no sentido de theta crescente.
// A roda precisa furar nos mesmos ângulos (wheel.js). Ordem de aperto em estrela 1-3-5-2-4 = índices 0,2,4,1,3.
export const STUDS = {
  count: LAYOUT.hub.studs.count,
  r: LAYOUT.hub.studs.pcd / 2,                                      // 0.060 (PCD 120)
  thetas: Array.from({ length: LAYOUT.hub.studs.count }, (_, k) => (90 + 72 * k) * D2R),
  star: [0, 2, 4, 1, 3],
};
// Palpite: face de montagem da roda + 24 mm de almofada forjada até a sede cônica. Quem manda é a roda.
export const LUG_SEAT_X = 0.024;

/* ---------------- amostragem angular ---------------- */
/** Raio do sextavado de apótema 1 com canto arredondado (rho = raio do canto / apótema) na direção th. */
function unitHexR(th, phase, rho) {
  const s = Math.PI / 3;
  let f = (th - phase) % s; if (f < 0) f += s; if (f > s / 2) f -= s;     // -30..30 graus da normal da face
  const af = Math.abs(f), tf = Math.atan((1 - rho) * T30);
  if (af <= tf + 1e-12) return 1 / Math.cos(f);                           // na face plana
  const c = (1 - rho) / C30, dc = c * Math.cos(af - Math.PI / 6);         // centro do arco do canto
  return dc + Math.sqrt(Math.max(0, dc * dc - c * c + rho * rho));
}
/** n ângulos iguais (peça redonda). Linhas com hex ainda funcionam, mas grosseiras. */
export function roundAngles(n, { phase = 0, rho = 0.06 } = {}) {
  const theta = new Float64Array(n), unit = new Float64Array(n);
  for (let j = 0; j < n; j++) { theta[j] = phase + (j / n) * TAU; unit[j] = unitHexR(theta[j], phase, rho); }
  return { theta, unit };
}
/** Amostras que caem nas quinas: nFlat por face (inclui as pontas da face) + nCorner dentro de cada canto. */
export function hexAngles({ nFlat = 2, nCorner = 1, rho = 0.06, phase = 0 } = {}) {
  const tf = Math.atan((1 - rho) * T30), list = [];
  for (let k = 0; k < 6; k++) {
    const c = phase + (k * Math.PI) / 3;
    for (let i = 0; i < nFlat; i++) list.push(c - tf + 2 * tf * (nFlat === 1 ? 0.5 : i / (nFlat - 1)));
    for (let i = 1; i <= nCorner; i++) list.push(c + tf + ((Math.PI / 3 - 2 * tf) * i) / (nCorner + 1));
  }
  const theta = Float64Array.from(list), unit = theta.map((t) => unitHexR(t, phase, rho));
  return { theta, unit };
}

/* ---------------- perfil com cantos arredondados ----------------
   Ponto: {x, r, f (raio do canto), hex (apótema; 0 = redondo), ao (0..1), brk (vinco: normal não suaviza ali)}. */
export const P = (x, r, f = 0, o = {}) => ({ x, r, f, ...o });

function filletProfile(pts, segQ) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], f = p.f || 0;
    if (!f || i === 0 || i === pts.length - 1) { out.push(p); continue; }
    const a = pts[i - 1], b = pts[i + 1];
    let ax = a.x - p.x, ar = a.r - p.r, bx = b.x - p.x, br = b.r - p.r;
    const la = Math.hypot(ax, ar), lb = Math.hypot(bx, br);
    if (la < 1e-9 || lb < 1e-9) { out.push(p); continue; }
    ax /= la; ar /= la; bx /= lb; br /= lb;
    const alpha = Math.acos(clamp(ax * bx + ar * br, -1, 1));             // ângulo interno do canto
    if (alpha > Math.PI - 2e-3 || alpha < 1e-3) { out.push(p); continue; }
    let rad = f, t = rad / Math.tan(alpha / 2);
    const tMax = 0.48 * Math.min(la, lb);                                  // dois arcos no mesmo trecho não se cruzam
    if (t > tMax) { t = tMax; rad = t * Math.tan(alpha / 2); }
    let wx = ax + bx, wr = ar + br; const lw = Math.hypot(wx, wr); wx /= lw; wr /= lw;
    const dc = rad / Math.sin(alpha / 2), ox = p.x + wx * dc, or = p.r + wr * dc;
    const a1 = Math.atan2(p.r + ar * t - or, p.x + ax * t - ox);
    let da = Math.atan2(p.r + br * t - or, p.x + bx * t - ox) - a1;
    while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    const n = Math.max(1, Math.ceil((Math.abs(da) / (Math.PI / 2)) * segQ));
    for (let k = 0; k <= n; k++) {
      const an = a1 + (da * k) / n;
      out.push({ ...p, f: 0, brk: false, x: ox + rad * Math.cos(an), r: Math.max(0, or + rad * Math.sin(an)) });
    }
  }
  return out;
}

/* ---------------- sólido de revolução em torno de +X ----------------
   O perfil anda em sentido HORÁRIO no plano (x para a direita, r para cima): da ponta de dentro (-x) pelo lado de
   fora até a ponta de fora (+x) e de volta pelo eixo. Assim as normais saem para fora (furos internos andam em -x).
   UV: u = ângulo (0..uLen numa volta), v = comprimento de arco do perfil / vScale (rosca em mats.steel: vScale 0.045
   dá passo 1.5 mm). Normais por área com emenda angular soldada; nos polos (r = 0) a normal vira a média do anel. */
export function revolveGeometry(profile, { angles = 48, closed = false, segQ = 3, uLen = 1, vScale = 0.045, ao = false } = {}) {
  const A = typeof angles === "number" ? roundAngles(angles) : angles;
  const nA = A.theta.length, sinT = A.theta.map(Math.sin), cosT = A.theta.map(Math.cos);
  const rows = filletProfile(profile, segQ);

  // comprimento de arco contínuo (v)
  const arc = new Float64Array(rows.length + 1);
  for (let i = 1; i < rows.length; i++) arc[i] = arc[i - 1] + Math.hypot(rows[i].x - rows[i - 1].x, rows[i].r - rows[i - 1].r);
  arc[rows.length] = arc[rows.length - 1] + (closed ? Math.hypot(rows[0].x - rows[rows.length - 1].x, rows[0].r - rows[rows.length - 1].r) : 0);

  // tiras: um brk fecha a tira atual nesta linha e abre outra começando nela (vinco)
  const strips = [[]];
  rows.forEach((row, i) => {
    const cur = strips[strips.length - 1];
    cur.push(i);
    if (row.brk && i > 0 && i < rows.length - 1) strips.push([i]);
  });
  if (closed && strips.length > 1) throw new Error("revolveGeometry: perfil fechado não aceita brk");

  const pos = [], nor = [], uv = [], col = [], idx = [];
  const radius = (row, j) => (row.hex ? Math.min(row.r, row.hex * A.unit[j]) : row.r);
  const u0 = A.theta[0];

  for (const strip of strips) {
    const L = strip.length, outRows = closed ? L + 1 : L, cols = nA + 1, base = pos.length / 3;
    // posições na grade lógica (L x nA)
    const g = new Float64Array(L * nA * 3), acc = new Float64Array(L * nA * 3);
    for (let i = 0; i < L; i++) {
      const row = rows[strip[i]];
      for (let j = 0; j < nA; j++) {
        const R = radius(row, j), k = (i * nA + j) * 3;
        g[k] = row.x; g[k + 1] = R * sinT[j]; g[k + 2] = -R * cosT[j];
      }
    }
    const tri = (a, b, c) => {
      const ax = g[a], ay = g[a + 1], az = g[a + 2];
      const ux = g[b] - ax, uy = g[b + 1] - ay, uz = g[b + 2] - az, vx = g[c] - ax, vy = g[c + 1] - ay, vz = g[c + 2] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { acc[q] += nx; acc[q + 1] += ny; acc[q + 2] += nz; }
    };
    const quads = closed ? L : L - 1;
    for (let i = 0; i < quads; i++) {
      const i2 = (i + 1) % L;
      for (let j = 0; j < nA; j++) {
        const j2 = (j + 1) % nA;
        const a = (i * nA + j) * 3, b = (i * nA + j2) * 3, c = (i2 * nA + j) * 3, d = (i2 * nA + j2) * 3;
        tri(a, b, c); tri(b, d, c);
      }
    }
    // polos: todos os vértices do anel no mesmo ponto; normal = média do anel (eixo)
    for (let i = 0; i < L; i++) {
      if (rows[strip[i]].r > 1e-9) continue;
      let sx = 0, sy = 0, sz = 0;
      for (let j = 0; j < nA; j++) { const k = (i * nA + j) * 3; sx += acc[k]; sy += acc[k + 1]; sz += acc[k + 2]; }
      for (let j = 0; j < nA; j++) { const k = (i * nA + j) * 3; acc[k] = sx; acc[k + 1] = sy; acc[k + 2] = sz; }
    }
    for (let i = 0; i < outRows; i++) {
      const li = i % L, row = rows[strip[li]], v = (closed && i === L ? arc[rows.length] : arc[strip[li]]) / vScale, a = row.ao == null ? 1 : row.ao;
      for (let j = 0; j < cols; j++) {
        const lj = j % nA, k = (li * nA + lj) * 3;
        pos.push(g[k], g[k + 1], g[k + 2]);
        const l = Math.hypot(acc[k], acc[k + 1], acc[k + 2]) || 1;
        nor.push(acc[k] / l, acc[k + 1] / l, acc[k + 2] / l);
        uv.push(j === nA ? uLen : ((A.theta[j] - u0) / TAU) * uLen, v);
        if (ao) col.push(a, a, a);
      }
    }
    for (let i = 0; i < outRows - 1; i++) for (let j = 0; j < nA; j++) {
      const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (ao) geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/** Junta geometrias indexadas (position, normal, uv; color vira 1 onde faltar). Sem addons. */
export function mergeGeometries(list) {
  const anyColor = list.some((g) => g.attributes.color);
  const pos = [], nor = [], uv = [], col = [], idx = [];
  let base = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
      if (anyColor) col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
    }
    const ix = g.index ? g.index.array : Array.from({ length: p.count }, (_, i) => i);
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
    base += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (anyColor) geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  for (const g of list) g.dispose();
  return geo;
}

/* ---------------- chapa extrudada com bordas arredondadas ----------------
   Faz o papel do ExtrudeGeometry com bevel, mas com normais analíticas: o ExtrudeGeometry da three sai facetado
   (normal por face) e o arredondado vira degraus. Contornos = polilinhas [x, y] no plano da forma; a forma é
   extrudada de x = 0 a x = depth no mundo, com (forma x, forma y) -> (mundo -z, mundo y), logo o ângulo da forma
   é o theta da spec. bevel = raio do arredondado (perfil em quarto de círculo nas duas faces). UV em metros. */
export function roundedSlab({ outer, holes = [], depth, bevel, segs = 3 }) {
  const area = (c) => { let s = 0; for (let i = 0; i < c.length; i++) { const a = c[i], b = c[(i + 1) % c.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const o = area(outer) > 0 ? outer : outer.slice().reverse();               // fora anti-horário
  const hs = holes.map((h) => (area(h) < 0 ? h : h.slice().reverse()));     // furos horários
  const b = bevel;
  // normal 2D "para fora do material" + miolo recuado b (com fator de mitra)
  const prep = (c) => {
    const m = c.length, n = new Float64Array(m * 2), q = new Float64Array(m * 2);
    for (let i = 0; i < m; i++) {
      const a = c[(i - 1 + m) % m], p = c[i], d = c[(i + 1) % m];
      let e1x = p[1] - a[1], e1y = -(p[0] - a[0]), e2x = d[1] - p[1], e2y = -(d[0] - p[0]);
      const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1; e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
      let nx = e1x + e2x, ny = e1y + e2y; const ln = Math.hypot(nx, ny) || 1; nx /= ln; ny /= ln;
      const miter = 1 / Math.max(0.5, nx * e1x + ny * e1y);
      n[i * 2] = nx; n[i * 2 + 1] = ny; q[i * 2] = p[0] - nx * b * miter; q[i * 2 + 1] = p[1] - ny * b * miter;
    }
    return { c, m, n, q };
  };
  const C = [prep(o), ...hs.map(prep)];
  const pos = [], nor = [], uv = [], idx = [];
  // forma (sx, sy, sz) -> mundo (sz, sy, -sx): rotação própria, o enrolamento se mantém
  const put = (sx, sy, sz, nx, ny, nz, u, v) => { pos.push(sz, sy, -sx); nor.push(nz, ny, -nx); uv.push(u, v); };

  // tampas: miolo triangulado, face da frente (x = depth) e de trás (x = 0)
  const v2 = (q, m) => Array.from({ length: m }, (_, i) => new THREE.Vector2(q[i * 2], q[i * 2 + 1]));
  const capPts = C.map(({ q, m }) => v2(q, m)), flat = capPts.flat();
  const faces = THREE.ShapeUtils.triangulateShape(capPts[0], capPts.slice(1));
  for (const [z, nz] of [[depth, 1], [0, -1]]) {
    const base = pos.length / 3;
    for (const p of flat) put(p.x, p.y, z, 0, 0, nz, p.x, p.y);
    for (const [a, bb, c] of faces) {
      const A = flat[a], B = flat[bb], Cc = flat[c], cr = (B.x - A.x) * (Cc.y - A.y) - (B.y - A.y) * (Cc.x - A.x);
      const ccw = cr > 0;                                                    // anti-horário visto de +z
      if ((nz > 0) === ccw) idx.push(base + a, base + bb, base + c); else idx.push(base + a, base + c, base + bb);
    }
  }
  // anéis: quarto de círculo na frente, parede, quarto de círculo atrás
  const phis = [];
  for (let k = 0; k <= segs; k++) phis.push([(k / segs) * Math.PI / 2, true]);
  for (let k = 0; k <= segs; k++) phis.push([Math.PI / 2 + (k / segs) * Math.PI / 2, false]);
  for (const { c, m, n, q } of C) {
    const base = pos.length / 3, cols = m + 1;
    let len = 0;
    const lens = new Float64Array(cols);
    for (let i = 1; i <= m; i++) { const a = c[i - 1], p = c[i % m]; len += Math.hypot(p[0] - a[0], p[1] - a[1]); lens[i] = len; }
    let vacc = 0, prevZ = null;
    for (const [phi, front] of phis) {
      const s = Math.sin(phi), co = Math.cos(phi), z = front ? depth - b + b * co : b + b * co;
      if (prevZ !== null) vacc += front || phi === Math.PI / 2 ? b * (Math.PI / 2 / segs) : b * (Math.PI / 2 / segs);
      if (prevZ !== null && phi === Math.PI / 2 && !front) vacc += Math.abs(prevZ - z) - b * (Math.PI / 2 / segs); // parede reta
      prevZ = z;
      for (let i = 0; i < cols; i++) {
        const ii = i % m, nx = n[ii * 2], ny = n[ii * 2 + 1];
        put(q[ii * 2] + nx * b * s, q[ii * 2 + 1] + ny * b * s, z, nx * s, ny * s, co, lens[i], vacc);
      }
    }
    const rowsN = phis.length;
    // enrolamento decidido pela normal analítica do primeiro quad da parede
    const r0 = segs, at = (r, i) => base + r * cols + i;
    const P0 = at(r0, 0) * 3, P1 = at(r0, 1) * 3, P2 = at(r0 + 1, 0) * 3;
    const ux = pos[P1] - pos[P0], uy = pos[P1 + 1] - pos[P0 + 1], uz = pos[P1 + 2] - pos[P0 + 2];
    const wx = pos[P2] - pos[P0], wy = pos[P2 + 1] - pos[P0 + 1], wz = pos[P2 + 2] - pos[P0 + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const flip = fx * nor[P0] + fy * nor[P0 + 1] + fz * nor[P0 + 2] < 0;
    for (let r = 0; r < rowsN - 1; r++) for (let i = 0; i < m; i++) {
      const a = at(r, i), bb = at(r, i + 1), cc = at(r + 1, i), d = at(r + 1, i + 1);
      if (flip) idx.push(a, cc, bb, bb, cc, d); else idx.push(a, bb, cc, bb, d, cc);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}
/** Círculo como polilinha [x, y] no plano da forma (ângulo da forma = theta). */
export function circlePts(cx, cy, r, n, start = 0) {
  return Array.from({ length: n }, (_, i) => { const a = start + (i / n) * TAU; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
}

/* ---------------- porca de roda ----------------
   Porca "17HEX" fechada de tuner, M14x1.5, sede cônica de 60 graus (meio ângulo 30 do eixo), 35 mm.
   Sextavado 17 mm entre faces (apótema 8.5 mm), canto arredondado 0.5 mm, chanfro de 30 graus em cima e embaixo.
   detail: high (montadas, ~36 amostras), mid (destroços), low (tier baixo). */
const NUT = { A: LAYOUT.hub.lugNut.hexAF / 2, rho: 0.06, len: 0.035 };
export function lugNutGeometry({ detail = "high" } = {}) {
  const A = NUT.A, rho = NUT.rho, corner = A * ((1 - rho) / C30 + rho);   // 9.74 mm
  const tSeat = Math.tan((LAYOUT.hub.lugNut.seatDeg / 2) * D2R);           // cone de 60 graus: dr/dx = tan 30
  const tCh = Math.tan(LAYOUT.hub.lugNut.chamferDeg * D2R);                // chanfro 30 graus com a face: dx/dr
  const big = 0.03, xTop = 0.0272, rFace = 0.0081, xBase = 0.0078, rBase = 0.0091;
  const chTop = (r) => P(xTop - (r - rFace) * tCh, r, 0, { hex: A });
  const chBot = (r) => P(xBase + (r - rBase) * tCh, r, 0, { hex: A });
  const seatX = 0.0060;
  const prof = [
    // furo da rosca (fechado no fundo, broca de 118 graus)
    P(0.0260, 0, 0, { ao: 0.25 }),
    P(0.0260, 0.0050, 0, { ao: 0.25 }),
    P(0.0248, 0.0062, 0.0004, { ao: 0.3 }),
    P(0.0008, 0.0062, 0.0004, { ao: 0.5 }),                               // parede do furo, voltando para a boca
    P(0.0000, 0.0070, 0.0003, { ao: 0.7 }),                               // escareado da boca
    P(0.0000, 0.0074, 0.0003),
    P(seatX, 0.0074 + seatX * tSeat, 0.0006),                              // cone da sede, 60 graus
    P(xBase, 0.0074 + seatX * tSeat, 0.0004),                              // arruela integrada (gira solta? não: maciça)
    P(xBase, rBase, 0, { hex: A, brk: true }),                             // face de cima da arruela até o chanfro de baixo
    chBot(0.0094), chBot(0.0097), chBot(corner),
    P(xBase + (corner - rBase) * tCh + 0.0006, big, 0, { hex: A }),        // faces do sextavado
    P(xTop - (corner - rFace) * tCh - 0.0004, big, 0, { hex: A }),
    chTop(corner), chTop(0.0094), chTop(0.0089), chTop(0.0084),
    P(xTop, rFace, 0, { hex: A, brk: true }),                              // círculo do chanfro: vinco com a face de cima
    P(xTop, 0.0075, 0.0005),                                               // degrau para a cauda fechada
    P(0.0318, 0.0071, 0.0024),                                             // cauda levemente cônica
    P(0.0347, 0.0034, 0.003),                                              // cúpula
    P(NUT.len, 0),
  ];
  const opt = { high: [4, 2, 3], mid: [2, 1, 2], low: [2, 0, 1] }[detail] || [4, 2, 3];
  return revolveGeometry(prof, { angles: hexAngles({ nFlat: opt[0], nCorner: opt[1], rho, phase: 0 }), segQ: opt[2], ao: false });
}

/* ---------------- bobbin do disco flutuante ----------------
   Carretel de aço: cintura Ø12 mm que corre nos rasgos do chapéu/pista, flanges Ø17/Ø18 mm, botão de parafuso
   com sextavado interno de 4 mm (o "6 segmentos" da spec virou o soquete sextavado; o corpo é redondo). 15 mm. */
export function bobbinGeometry({ detail = "high" } = {}) {
  const S = 0.002, big = 0.01;                                            // apótema do soquete (4 mm entre faces)
  const dome = [0, 22.5, 45, 67.5].map((a) => P(0.0062 + 0.0028 * Math.sin(a * D2R), 0.0068 * Math.cos(a * D2R), a === 0 ? 0.0004 : 0));
  dome[dome.length - 1].r = 0.0026;
  const prof = [
    P(-0.0020, 0, 0, { ao: 0.35 }),                                        // fundo do furo do parafuso (lado de dentro)
    P(-0.0020, 0.0034, 0.0004, { ao: 0.35 }),
    P(-0.0060, 0.0034, 0.0004, { ao: 0.6 }),
    P(-0.0060, 0.0085, 0.0006),                                            // flange de dentro Ø17
    P(-0.0040, 0.0085, 0.0005),
    P(-0.0040, 0.0060, 0.0006, { ao: 0.7 }),                               // cintura Ø12
    P(0.0040, 0.0060, 0.0006, { ao: 0.7 }),
    P(0.0040, 0.0090, 0.0005),                                             // flange de fora Ø18
    P(0.0062, 0.0090, 0.0006),
    ...dome,                                                               // botão do parafuso
    P(0.00879, big, 0, { hex: S, brk: true, ao: 0.6 }),                    // boca do soquete
    P(0.0072, big, 0, { hex: S, ao: 0.3 }),
    P(0.0070, 0.0014, 0, { brk: true, ao: 0.25 }),
    P(0.0066, 0, 0, { ao: 0.25 }),
  ];
  const opt = detail === "low" ? [2, 1, 2] : [3, 2, 3];
  return revolveGeometry(prof, { angles: hexAngles({ nFlat: opt[0], nCorner: opt[1], rho: 0.15, phase: 0 }), segQ: opt[2], ao: false });
}

/* ---------------- parafuso flangeado sextavado ----------------
   Padrão M8 x 30, sextavado 13, flange serrilhada lisa. Para os parafusos da ponte da pinça (M10: d 0.010, af 0.014)
   e do chapéu. Cabeça em +X, haste em -X, origem sob a flange. Rosca = normal map do material (mats.steel). */
export function boltGeometry({ d = 0.008, length = 0.030, af = 0.013, head = 0.0065, flange = true, detail = "high" } = {}) {
  const rs = d / 2, A = af / 2, rho = 0.06, corner = A * ((1 - rho) / C30 + rho), ch = Math.min(0.001, d * 0.1);
  const rf = flange ? corner * 1.14 : 0, ft = flange ? 0.0015 : 0, rFace = 0.95 * A, tCh = T30;
  const xHex = ft + (flange ? 0.0009 : 0);                                // base do sextavado
  const chTop = (r) => P(head - (r - rFace) * tCh, r, 0, { hex: A });
  const prof = [
    P(-length, 0),
    P(-length, rs - ch, 0.0002),
    P(-length + ch, rs, 0.0002),
    ...(flange
      ? [P(0, rs, 0.0006, { ao: 0.6 }), P(0, rf, 0.0004), P(ft, rf, 0.0004), P(xHex, corner * 1.03)]
      : [P(0, rs, 0.0005, { ao: 0.6 }), P(0, corner * 1.0)]),
    P(xHex, corner * 0.96, 0, { hex: A, brk: true }),
    P(xHex + 0.0006, 0.05, 0, { hex: A }),
    P(head - (corner - rFace) * tCh - 0.0003, 0.05, 0, { hex: A }),
    chTop(corner), chTop((corner + rFace) / 2),
    P(head, rFace, 0, { hex: A, brk: true }),
    P(head + 0.0002, rFace * 0.5),                                         // topo levemente abaulado (estampado)
    P(head + 0.0003, 0),
  ];
  const opt = detail === "low" ? [2, 1, 2] : [3, 2, 3];
  return revolveGeometry(prof, { angles: hexAngles({ nFlat: opt[0], nCorner: opt[1], rho, phase: 0 }), segQ: opt[2] });
}

/* ---------------- 5 porcas montadas (opcional para wheel.js / assembly.js) ----------------
   setLug(i, voltas, saídaM): +voltas = desaperta (anti-horário visto de fora = rotação + em X), sai para +X.
   As porcas são da roda pela spec; isto só poupa refazer a matemática. Porcas com fase diferente: aperto real. */
export function createLugNutSet({ mats, seatX = LUG_SEAT_X, detail = "high", material = null } = {}) {
  const geo = lugNutGeometry({ detail });
  const mesh = new THREE.InstancedMesh(geo, material || mats.chromeBlack, STUDS.count);
  mesh.name = "lugNuts"; mesh.frustumCulled = false;                      // saem 70 mm: a esfera de culling ficaria velha
  const phase = [0.13, 0.41, 0.77, 0.29, 0.58], turns = new Float32Array(STUDS.count), out = new Float32Array(STUDS.count);
  const ys = STUDS.thetas.map((t) => STUDS.r * Math.sin(t)), zs = STUDS.thetas.map((t) => -STUDS.r * Math.cos(t));
  const m = new THREE.Matrix4();
  let seat = seatX;
  const write = (i) => { m.makeRotationX(phase[i] + turns[i] * TAU); m.setPosition(seat + out[i], ys[i], zs[i]); mesh.setMatrixAt(i, m); };
  for (let i = 0; i < STUDS.count; i++) write(i);
  mesh.instanceMatrix.needsUpdate = true;
  return {
    mesh,
    setLug(i, t = 0, o = 0) { if (i < 0 || i >= STUDS.count) return; turns[i] = t; out[i] = o; write(i); mesh.instanceMatrix.needsUpdate = true; },
    setSeat(x) { seat = x; for (let i = 0; i < STUDS.count; i++) write(i); mesh.instanceMatrix.needsUpdate = true; },
    dispose() { geo.dispose(); mesh.dispose(); },
  };
}

/* ---------------- destroços (seção 4e) ----------------
   24 porcas + 12 bobbins em 2 InstancedMesh, flutuando a 0.15..4 m do caminho da câmera. Os 4 mais perto da câmera
   (dentro de 0.9 m) viram sprites de bokeh pré-borrados (1 malha de 4 quads, 1 draw). Mola de casa k 4, c 2.4,
   deriva curl-noise a 0.02 m/s, giro 0.1..0.4 rad/s, repulsão 1.8/d² do raio do ponteiro até 0.25 m e esteira.
   borrow(i) empresta a instância i (porcas 0..4 = as 5 da roda) como um Object3D filho de root: mexa position/
   quaternion/visible dele (espaço de root, que fica na origem do mundo). release(i) devolve com a velocidade que
   o proxy tinha, e a mola leva a peça para casa. Nada aloca por quadro. */
const BOKEH = { far: 0.9, near: 0.55, slots: 4 };
const CORNER_BOX = { min: [-1.0, -0.46, -0.95], max: [0.9, 1.0, 0.95] };   // canto + elipse da órbita + laje: sem destroço
const inBox = (x, y, z) => x > CORNER_BOX.min[0] && x < CORNER_BOX.max[0] && y > CORNER_BOX.min[1] && y < CORNER_BOX.max[1] && z > CORNER_BOX.min[2] && z < CORNER_BOX.max[2];

function cameraPoses() {
  const list = [[CAMERA.hero.pos, CAMERA.hero.target]];
  for (const b of BEATS) { const c = b.cam; if (!c) continue; if (c.posFrom) list.push([c.posFrom, c.target]); list.push([c.pos, c.target]); }
  // poses macro (dentro do canto) não recebem destroço: ele atravessaria peças
  return list.filter(([p]) => !inBox(p[0], p[1], p[2]));
}

export function createDebris({ mats, tex = null, count = SIM.debris.nuts + SIM.debris.bobbins, tier = "base", region = null, seed = 7, leash = null } = {}) {
  const S = SIM.debris, R = rng(seed);
  count = Math.max(1, Math.round(count));
  const ratio = S.nuts / (S.nuts + S.bobbins);
  const nNut = Math.min(count, Math.max(Math.min(5, count), Math.round(count * ratio))), nBob = count - nNut, N = count;

  const root = new THREE.Group(); root.name = "debris";
  const nutGeo = lugNutGeometry({ detail: tier === "low" ? "low" : "mid" });
  const bobGeo = bobbinGeometry({ detail: "low" });
  const nuts = new THREE.InstancedMesh(nutGeo, mats.chromeBlack, nNut);
  nuts.name = "debris.nuts"; nuts.frustumCulled = false; root.add(nuts);
  const bobs = nBob > 0 ? new THREE.InstancedMesh(bobGeo, mats.padSteel || mats.steel, nBob) : null;
  if (bobs) { bobs.name = "debris.bobbins"; bobs.frustumCulled = false; root.add(bobs); }

  // estado (Float32 contínuo: sem objetos por instância)
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), home = new Float32Array(N * 3), anchor = new Float32Array(N * 3);
  const quat = new Float32Array(N * 4), axis = new Float32Array(N * 3), w = new Float32Array(N);
  const borrowed = new Uint8Array(N), hidden = new Uint8Array(N), proxies = new Array(N).fill(null);
  const leashK = leash != null ? leash : region ? 0.6 : 0.08;               // deriva máx ~ 0.02 / leash

  /* casas */
  const v = new THREE.Vector3(), f = new THREE.Vector3(), up = new THREE.Vector3(), rt = new THREE.Vector3(), tmp = new THREE.Vector3();
  const offAxis = (C, T, aMin, aMax, dist) => {
    f.set(T[0] - C[0], T[1] - C[1], T[2] - C[2]).normalize();
    tmp.set(0, 1, 0); if (Math.abs(f.y) > 0.95) tmp.set(1, 0, 0);
    rt.crossVectors(f, tmp).normalize(); up.crossVectors(rt, f);
    const a = (aMin + (aMax - aMin) * R()) * D2R, b = R() * TAU;
    v.copy(f).multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a) * Math.cos(b)).addScaledVector(rt, Math.sin(a) * Math.sin(b));
    return v.multiplyScalar(dist).add(tmp.set(C[0], C[1], C[2]));
  };
  const poses = cameraPoses();
  const fit = BEATS.find((b) => b.key === "fitment" && b.cam && b.cam.path === "arc") || { cam: { pos: [0, 0.1, 3.3], target: [0, 0.02, 0] } };
  const lerp3 = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  for (let i = 0; i < N; i++) {
    let H;
    if (region) {
      // modo bancada: casca esférica em volta de um centro
      const c = region.center || [0, 0, 0], r0 = region.inner != null ? region.inner : region.radius * 0.6, r1 = region.radius;
      tmp.set(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1); if (tmp.lengthSq() < 1e-4) tmp.set(0, 1, 0);
      H = tmp.normalize().multiplyScalar(r0 + (r1 - r0) * R()).add(v.set(c[0], c[1], c[2])).clone();
    } else if (i < Math.min(5, nNut)) {
      // as 5 porcas da roda moram perto da câmera do fitment: "juntam-se aos destroços perto da câmera"
      H = offAxis(fit.cam.pos, fit.cam.target, 3, 9, 0.55 + 0.75 * R()).clone();
    } else {
      for (let tries = 0; tries < 14; tries++) {
        const k = Math.floor(R() * Math.max(1, poses.length - 1)), s = R();
        const a = poses[k], b = poses[Math.min(poses.length - 1, k + 1)];
        const C = lerp3(a[0], b[0], s), T = lerp3(a[1], b[1], s);
        const d = 0.15 * Math.pow(4 / 0.15, Math.pow(R(), 0.8));             // log-uniforme puxado para longe
        H = offAxis(C, T, 6, 28, tries > 9 ? Math.min(d, 0.6) : d).clone();
        if (!inBox(H.x, H.y, H.z)) break;
      }
    }
    for (let k = 0; k < 3; k++) home[i * 3 + k] = anchor[i * 3 + k] = pos[i * 3 + k] = H.getComponent(k);
    // orientação uniforme (Shoemake) e eixo de giro aleatório
    const u1 = R(), u2 = R() * TAU, u3 = R() * TAU, s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    quat[i * 4] = s1 * Math.sin(u2); quat[i * 4 + 1] = s1 * Math.cos(u2); quat[i * 4 + 2] = s2 * Math.sin(u3); quat[i * 4 + 3] = s2 * Math.cos(u3);
    tmp.set(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize();
    axis[i * 3] = tmp.x; axis[i * 3 + 1] = tmp.y; axis[i * 3 + 2] = tmp.z;
    w[i] = (S.spin[0] + (S.spin[1] - S.spin[0]) * R()) * (R() < 0.5 ? -1 : 1);
  }

  /* bokeh: atlas 256x128 (porca | bobbin) renderizado da malha real, 4 quads billboard */
  let bokeh = null;
  const nutBox = nutGeo.boundingBox, bobBox = bobGeo.boundingBox;
  const halfOf = (bb) => 2.03 * Math.hypot((bb.max.x - bb.min.x) / 2, (bb.max.y - bb.min.y) / 2, (bb.max.z - bb.min.z) / 2); // ver textures.renderObject (fill 0.5, fov 20)
  const half = [halfOf(nutBox), halfOf(bobBox)];
  if (tex && tex.renderer && typeof document !== "undefined") {
    try {
      const gN = lugNutGeometry({ detail: "high" }), gB = bobbinGeometry({ detail: "high" });
      const tN = bokehSprite(new THREE.Mesh(gN, mats.chromeBlack), tex.renderer, { env: tex.env, size: S.bokehPx });
      const tB = bokehSprite(new THREE.Mesh(gB, mats.padSteel || mats.steel), tex.renderer, { env: tex.env, size: S.bokehPx });
      const cv = document.createElement("canvas"); cv.width = S.bokehPx * 2; cv.height = S.bokehPx;
      const g2 = cv.getContext("2d"); g2.drawImage(tN.image, 0, 0); g2.drawImage(tB.image, S.bokehPx, 0);
      tN.dispose(); tB.dispose(); gN.dispose(); gB.dispose();
      const atlas = new THREE.CanvasTexture(cv);
      atlas.colorSpace = THREE.SRGBColorSpace; atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping; atlas.name = "debrisBokehAtlas";
      const n = BOKEH.slots, geo = new THREE.BufferGeometry();
      const bp = new Float32Array(n * 12), buv = new Float32Array(n * 8), bc = new Float32Array(n * 16).fill(1), bi = [];
      for (let s = 0; s < n; s++) { const o = s * 4; bi.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }   // TL BL TR / TR BL BR
      geo.setAttribute("position", new THREE.BufferAttribute(bp, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute("uv", new THREE.BufferAttribute(buv, 2).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute("color", new THREE.BufferAttribute(bc, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setIndex(bi);
      // o sprite já vem com ACES + sRGB aplicados em JS: sem tone mapping de novo
      const mat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = "debris.bokeh"; mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.visible = false;
      root.add(mesh);
      bokeh = { mesh, geo, mat, atlas, bp, buv, bc, slot: new Int32Array(n), dist: new Float32Array(n) };
    } catch (e) {
      console.warn("debris: bokeh desligado", e);
      bokeh = null;
    }
  }

  /* quadro */
  let time = 0, nNutOn = nNut, nBobOn = nBob, rayPrev = false;
  const ro = new THREE.Vector3(), rd = new THREE.Vector3(), pro = new THREE.Vector3(), prd = new THREE.Vector3();
  const q = new THREE.Quaternion(), dq = new THREE.Quaternion(), ax = new THREE.Vector3(), p3 = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0), m4 = new THREE.Matrix4();
  const cv3 = new Float64Array(3), KC = 2.2, KB = 1.3 * KC;
  const active = (i) => (i < nNut ? i < nNutOn : i - nNut < nBobOn);

  function curl(x, y, z, t) {
    // rotacional de um potencial senoidal: sem divergência, os vizinhos giram juntos
    const s = t * 0.07;
    cv3[0] = KB * Math.cos(KB * y + 1.7 + s) - KC * Math.cos(KC * z + 0.4 - s);
    cv3[1] = KB * Math.cos(KB * z + 2.9 - s) - KC * Math.cos(KC * x + 5.1 + s);
    cv3[2] = KB * Math.cos(KB * x + 0.8 + s) - KC * Math.cos(KC * y + 3.3 - s);
  }

  function update(dt, camera = null, ray = null) {
    dt = clamp(dt || 0, 0, 0.05);
    time += dt;
    const hasRay = !!(ray && ray.direction);
    if (hasRay) { ro.copy(ray.origin); rd.copy(ray.direction).normalize(); }
    const wake = hasRay && rayPrev && dt > 0;
    const Rr = S.repelR;

    for (let i = 0; i < N; i++) {
      if (!active(i)) continue;
      const i3 = i * 3, i4 = i * 4;
      if (borrowed[i]) {
        const px = proxies[i];
        px.updateMatrix();
        if (dt > 0) for (let k = 0; k < 3; k++) { const c = px.position.getComponent(k); vel[i3 + k] = vel[i3 + k] * 0.5 + 0.5 * ((c - pos[i3 + k]) / dt); }
        pos[i3] = px.position.x; pos[i3 + 1] = px.position.y; pos[i3 + 2] = px.position.z;
        quat[i4] = px.quaternion.x; quat[i4 + 1] = px.quaternion.y; quat[i4 + 2] = px.quaternion.z; quat[i4 + 3] = px.quaternion.w;
        continue;
      }
      if (dt <= 0) continue;
      // a casa deriva no campo curl, presa na âncora
      curl(home[i3], home[i3 + 1], home[i3 + 2], time);
      const cl = Math.hypot(cv3[0], cv3[1], cv3[2]) || 1, ks = (S.drift / cl) * dt;
      for (let k = 0; k < 3; k++) home[i3 + k] += cv3[k] * ks + (anchor[i3 + k] - home[i3 + k]) * leashK * dt;
      let fx = S.homeK * (home[i3] - pos[i3]) - S.homeC * vel[i3];
      let fy = S.homeK * (home[i3 + 1] - pos[i3 + 1]) - S.homeC * vel[i3 + 1];
      let fz = S.homeK * (home[i3 + 2] - pos[i3 + 2]) - S.homeC * vel[i3 + 2];
      if (hasRay) {
        const ox = pos[i3] - ro.x, oy = pos[i3 + 1] - ro.y, oz = pos[i3 + 2] - ro.z;
        const t = ox * rd.x + oy * rd.y + oz * rd.z;
        if (t > 0) {
          const dx = ox - rd.x * t, dy = oy - rd.y * t, dz = oz - rd.z * t, d = Math.hypot(dx, dy, dz);
          if (d < Rr && d > 1e-5) {
            // 1.8/d², limitada; some suave na borda para não dar tranco
            const a = Math.min(40, S.repelK / (d * d)) * (1 - smoothstep(0.8 * Rr, Rr, d)) / d;
            fx += dx * a; fy += dy * a; fz += dz * a;
          }
          if (wake && d < 0.4) {
            // esteira: o ponto do raio nesta profundidade se moveu; arrasta junto
            const k = 2.5 * (1 - smoothstep(0, 0.4, d)) / dt;
            let wx = (ro.x + rd.x * t - pro.x - prd.x * t), wy = (ro.y + rd.y * t - pro.y - prd.y * t), wz = (ro.z + rd.z * t - pro.z - prd.z * t);
            const wl = Math.hypot(wx, wy, wz) / dt;
            if (wl > 4) { const c = 4 / wl; wx *= c; wy *= c; wz *= c; }
            fx += wx * k; fy += wy * k; fz += wz * k;
          }
        }
      }
      vel[i3] += fx * dt; vel[i3 + 1] += fy * dt; vel[i3 + 2] += fz * dt;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      // giro em torno do eixo próprio (no mundo)
      dq.setFromAxisAngle(ax.set(axis[i3], axis[i3 + 1], axis[i3 + 2]), w[i] * dt);
      q.set(quat[i4], quat[i4 + 1], quat[i4 + 2], quat[i4 + 3]).premultiply(dq).normalize();
      quat[i4] = q.x; quat[i4 + 1] = q.y; quat[i4 + 2] = q.z; quat[i4 + 3] = q.w;
    }
    if (hasRay) { pro.copy(ro); prd.copy(rd); rayPrev = true; } else rayPrev = false;

    // bokeh: os 4 mais perto da câmera, dentro de BOKEH.far
    hidden.fill(0);
    if (bokeh) {
      let any = false;
      if (camera) {
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements, cx = e[12], cy = e[13], cz = e[14];
        const sl = bokeh.slot, ds = bokeh.dist, n = BOKEH.slots;
        sl.fill(-1); ds.fill(1e9);
        for (let i = 0; i < N; i++) {
          if (!active(i) || (borrowed[i] && !proxies[i].visible)) continue;
          const d = Math.hypot(pos[i * 3] - cx, pos[i * 3 + 1] - cy, pos[i * 3 + 2] - cz);
          if (d >= BOKEH.far || d >= ds[n - 1]) continue;
          let s = n - 1; while (s > 0 && ds[s - 1] > d) { ds[s] = ds[s - 1]; sl[s] = sl[s - 1]; s--; }
          ds[s] = d; sl[s] = i;
        }
        const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6];
        for (let s = 0; s < n; s++) {
          const i = sl[s], o = s * 12;
          let alpha = 0;
          if (i >= 0) {
            const d = ds[s];
            alpha = smoothstep(BOKEH.far, BOKEH.near, d) * smoothstep(0.03, 0.1, d);    // colado na lente some
            if (alpha > 0.5) hidden[i] = 1;
            const kind = i < nNut ? 0 : 1, h = half[kind] * (1 + 0.8 * (1 - d / BOKEH.far));
            const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
            const Rx = rx * h, Ry = ry * h, Rz = rz * h, Ux = ux * h, Uy = uy * h, Uz = uz * h;
            const bp = bokeh.bp;
            bp[o] = px - Rx + Ux; bp[o + 1] = py - Ry + Uy; bp[o + 2] = pz - Rz + Uz;      // TL
            bp[o + 3] = px + Rx + Ux; bp[o + 4] = py + Ry + Uy; bp[o + 5] = pz + Rz + Uz;  // TR
            bp[o + 6] = px - Rx - Ux; bp[o + 7] = py - Ry - Uy; bp[o + 8] = pz - Rz - Uz;  // BL
            bp[o + 9] = px + Rx - Ux; bp[o + 10] = py + Ry - Uy; bp[o + 11] = pz + Rz - Uz; // BR
            const u0 = kind * 0.5, u1 = u0 + 0.5, t = s * 8, buv = bokeh.buv;
            buv[t] = u0; buv[t + 1] = 1; buv[t + 2] = u1; buv[t + 3] = 1; buv[t + 4] = u0; buv[t + 5] = 0; buv[t + 6] = u1; buv[t + 7] = 0;
          } else bokeh.bp.fill(0, o, o + 12);
          for (let c = 0; c < 4; c++) bokeh.bc[s * 16 + c * 4 + 3] = alpha;
          if (alpha > 0.001) any = true;
        }
        bokeh.geo.attributes.position.needsUpdate = true;
        bokeh.geo.attributes.uv.needsUpdate = true;
        bokeh.geo.attributes.color.needsUpdate = true;
      }
      bokeh.mesh.visible = any;
    }

    // matrizes
    for (let i = 0; i < N; i++) {
      if (!active(i)) continue;
      const i3 = i * 3, i4 = i * 4;
      const off = hidden[i] || (borrowed[i] && !proxies[i].visible);
      p3.set(pos[i3], pos[i3 + 1], pos[i3 + 2]);
      q.set(quat[i4], quat[i4 + 1], quat[i4 + 2], quat[i4 + 3]);
      m4.compose(p3, q, off ? zero : one);
      if (i < nNut) nuts.setMatrixAt(i, m4); else bobs.setMatrixAt(i - nNut, m4);
    }
    nuts.instanceMatrix.needsUpdate = true;
    if (bobs) bobs.instanceMatrix.needsUpdate = true;
  }

  function borrow(i) {
    if (i < 0 || i >= N) throw new Error("debris.borrow: índice fora: " + i);
    let px = proxies[i];
    if (!px) { px = proxies[i] = new THREE.Object3D(); px.name = "debris.proxy" + i; root.add(px); }
    px.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    px.quaternion.set(quat[i * 4], quat[i * 4 + 1], quat[i * 4 + 2], quat[i * 4 + 3]);
    px.visible = true;
    borrowed[i] = 1;
    vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0;
    return px;
  }
  function release(i) {
    if (i < 0 || i >= N || !borrowed[i]) return;
    const px = proxies[i];
    borrowed[i] = 0;
    pos[i * 3] = px.position.x; pos[i * 3 + 1] = px.position.y; pos[i * 3 + 2] = px.position.z;
    q.copy(px.quaternion).normalize();
    quat[i * 4] = q.x; quat[i * 4 + 1] = q.y; quat[i * 4 + 2] = q.z; quat[i * 4 + 3] = q.w;
    const sp = Math.hypot(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]);
    if (sp > 2.5) { const c = 2.5 / sp; vel[i * 3] *= c; vel[i * 3 + 1] *= c; vel[i * 3 + 2] *= c; }
  }
  /** Corte do governador (tier baixo: 18). As porcas 0..4 ficam sempre. */
  function setCount(n) {
    n = clamp(Math.round(n), 1, N);
    nNutOn = Math.min(nNut, Math.max(Math.min(5, nNut), Math.round(n * ratio)));
    nBobOn = Math.min(nBob, Math.max(0, n - nNutOn));
    nuts.count = nNutOn; if (bobs) bobs.count = nBobOn;
  }
  update(0, null, null);

  return {
    root, nuts, bobbins: bobs, count: N, nutCount: nNut,
    bokehTexture: bokeh ? bokeh.atlas : null,
    borrow, release, update, setCount,
    /** posição atual da instância i (para mirar a porca que cruza a lente em B3) */
    positionOf(i, out = new THREE.Vector3()) { return out.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); },
    homeOf(i, out = new THREE.Vector3()) { return out.set(anchor[i * 3], anchor[i * 3 + 1], anchor[i * 3 + 2]); },
    dispose() {
      nutGeo.dispose(); bobGeo.dispose(); nuts.dispose(); if (bobs) bobs.dispose();
      if (bokeh) { bokeh.geo.dispose(); bokeh.mat.dispose(); bokeh.atlas.dispose(); }
    },
  };
}

/* ---------------- bancada: lab/v3.html?p=hardware ----------------
   Porca, bobbin e parafuso lado a lado em Z (eixo +X), um punhado de destroços em volta e o atlas de bokeh num
   cartão embaixo (a bancada não passa câmera para update, então os sprites não aparecem sozinhos). */
export function labPreview(ctx) {
  const { mats, tex, tier } = ctx;
  const root = new THREE.Group(); root.name = "hardwarePreview";
  const geos = [lugNutGeometry({ detail: "high" }), bobbinGeometry({ detail: "high" }), boltGeometry()];
  const nut = new THREE.Mesh(geos[0], mats.chromeBlack); nut.position.set(-0.0175, 0, 0.045);
  const bob = new THREE.Mesh(geos[1], mats.padSteel || mats.steel); bob.position.set(0, 0, 0);
  const bolt = new THREE.Mesh(geos[2], mats.steel); bolt.position.set(0.006, 0, -0.045);
  root.add(nut, bob, bolt);
  const debris = createDebris({ mats, tex, count: 9, tier, region: { center: [0, 0, 0], inner: 0.075, radius: 0.12 }, seed: 3 });
  root.add(debris.root);
  let card = null;
  if (debris.bokehTexture) {
    card = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), new THREE.MeshBasicMaterial({ map: debris.bokehTexture, transparent: true, toneMapped: false, depthWrite: false }));
    card.position.set(0, -0.085, 0); card.rotation.y = Math.atan2(CAMERA.hero.pos[0], CAMERA.hero.pos[2]);
    root.add(card);
  }
  return {
    root,
    anchors: { nut: nut.position.clone(), bobbin: bob.position.clone(), bolt: bolt.position.clone() },
    explodeAxis: new THREE.Vector3(1, 0, 0), explodeDist: 0,
    debris,
    update(dt) { debris.update(dt, null, null); },
    dispose() { geos.forEach((g) => g.dispose()); debris.dispose(); if (card) { card.geometry.dispose(); card.material.dispose(); } },
  };
}
