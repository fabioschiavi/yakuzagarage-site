/* v3: utilidades de geometria de arm.js, fender.js e slab.js. Metros, sem DOM, sem material.
   Por que existe: o toCreasedNormals da three agrupa vértices numa grade de 1 cm (serve para modelo em unidade 1,
   não para peça em metros com detalhe de mm), e o ExtrudeGeometry sai com normal chapada por triângulo,
   o que facetaria o reflexo do softbox em metal e verniz. */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------------- SDF 2D (contorno forjado: união suave de cápsulas) ---------------- */
export const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
export function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}
/** Triângulo exato (Quilez). a, b, c = [x, y]. Negativo dentro. */
export function sdTriangle(px, py, a, b, c) {
  const e0x = b[0] - a[0], e0y = b[1] - a[1], e1x = c[0] - b[0], e1y = c[1] - b[1], e2x = a[0] - c[0], e2y = a[1] - c[1];
  const v0x = px - a[0], v0y = py - a[1], v1x = px - b[0], v1y = py - b[1], v2x = px - c[0], v2y = py - c[1];
  const k0 = clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y), 0, 1);
  const k1 = clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y), 0, 1);
  const k2 = clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y), 0, 1);
  const q0x = v0x - e0x * k0, q0y = v0y - e0y * k0, q1x = v1x - e1x * k1, q1y = v1y - e1y * k1, q2x = v2x - e2x * k2, q2y = v2y - e2y * k2;
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const dx = Math.min(q0x * q0x + q0y * q0y, q1x * q1x + q1y * q1y, q2x * q2x + q2y * q2y);
  const dy = Math.min(s * (v0x * e0y - v0y * e0x), s * (v1x * e1y - v1y * e1x), s * (v2x * e2y - v2y * e2x));
  return -Math.sqrt(dx) * Math.sign(dy);
}
/** União suave polinomial: k = raio do filete em metros. */
export function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
export const smax = (a, b, k) => -smin(-a, -b, k);

/** Marching squares: laços fechados de f = iso. A borda do domínio precisa ficar fora (f > iso).
    Devolve [[x, y], ...] por laço, sem repetir o primeiro ponto. */
export function sdfLoops(f, { x0, x1, y0, y1, step, iso = 0 }) {
  const nx = Math.ceil((x1 - x0) / step) + 1, ny = Math.ceil((y1 - y0) / step) + 1, NH = nx * ny;
  const v = new Float64Array(NH);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f(x0 + i * step, y0 + j * step) - iso;
  const pts = new Map(), adj = new Map();
  const point = (id) => {
    if (pts.has(id)) return;
    let i, j, i2, j2;
    if (id < NH) { j = Math.floor(id / nx); i = id - j * nx; i2 = i + 1; j2 = j; }
    else { const k = id - NH; j = Math.floor(k / nx); i = k - j * nx; i2 = i; j2 = j + 1; }
    const a = v[j * nx + i], b = v[j2 * nx + i2], t = a / (a - b);
    pts.set(id, [x0 + (i + (i2 - i) * t) * step, y0 + (j + (j2 - j) * t) * step]);
  };
  const link = (p, q) => {
    point(p); point(q);
    if (!adj.has(p)) adj.set(p, []); if (!adj.has(q)) adj.set(q, []);
    adj.get(p).push(q); adj.get(q).push(p);
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const va = v[j * nx + i], vb = v[j * nx + i + 1], vc = v[(j + 1) * nx + i + 1], vd = v[(j + 1) * nx + i];
    const c = (va < 0 ? 1 : 0) | (vb < 0 ? 2 : 0) | (vc < 0 ? 4 : 0) | (vd < 0 ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const e0 = j * nx + i, e1 = NH + j * nx + i + 1, e2 = (j + 1) * nx + i, e3 = NH + j * nx + i;
    const centerIn = va + vb + vc + vd < 0;
    switch (c) {
      case 1: case 14: link(e3, e0); break;
      case 2: case 13: link(e0, e1); break;
      case 3: case 12: link(e3, e1); break;
      case 4: case 11: link(e1, e2); break;
      case 6: case 9: link(e0, e2); break;
      case 7: case 8: link(e3, e2); break;
      case 5: if (centerIn) { link(e0, e1); link(e2, e3); } else { link(e3, e0); link(e1, e2); } break;
      case 10: if (centerIn) { link(e3, e0); link(e1, e2); } else { link(e0, e1); link(e2, e3); } break;
    }
  }
  const seen = new Set(), loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let prev = -1, cur = start;
    for (let guard = 0; guard < 1e6; guard++) {
      seen.add(cur); loop.push(pts.get(cur));
      const nb = adj.get(cur), next = nb[0] !== prev ? nb[0] : nb[1];
      if (next === undefined || next === start || seen.has(next)) break;
      prev = cur; cur = next;
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
export function loopArea(l) { let a = 0; for (let i = 0, n = l.length; i < n; i++) { const p = l[i], q = l[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

/** Douglas-Peucker em laço fechado: tol em metros (flecha máxima da corda). */
export function simplifyLoop(loop, tol) {
  const n = loop.length; if (n < 8) return loop;
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) { const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (d > best) { best = d; far = i; } }
  const open = (p) => {
    const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
    const st = [[0, p.length - 1]];
    while (st.length) {
      const [s, e] = st.pop(); const ax = p[s][0], ay = p[s][1], bx = p[e][0] - ax, by = p[e][1] - ay, L2 = bx * bx + by * by || 1e-18;
      let k = -1, dm = tol * tol;
      for (let i = s + 1; i < e; i++) {
        const px = p[i][0] - ax, py = p[i][1] - ay, t = clamp((px * bx + py * by) / L2, 0, 1), dx = px - bx * t, dy = py - by * t, d = dx * dx + dy * dy;
        if (d > dm) { dm = d; k = i; }
      }
      if (k > 0) { keep[k] = 1; st.push([s, k], [k, e]); }
    }
    return p.filter((_, i) => keep[i]);
  };
  const a = open(loop.slice(0, far + 1)), b = open(loop.slice(far).concat([loop[0]]));
  return a.concat(b.slice(1, -1));
}

/** Polígono com cantos arredondados (filete circular real). r: número ou lista por vértice. closed = laço. */
export function roundPoly(pts, r, { closed = true, seg = 6 } = {}) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const P = pts[i], ri0 = Array.isArray(r) ? r[i] : r;
    if ((!closed && (i === 0 || i === n - 1)) || !(ri0 > 0)) { out.push([P[0], P[1]]); continue; }
    const A = pts[(i - 1 + n) % n], C = pts[(i + 1) % n];
    let ux = A[0] - P[0], uy = A[1] - P[1], vx = C[0] - P[0], vy = C[1] - P[1];
    const la = Math.hypot(ux, uy), lc = Math.hypot(vx, vy);
    if (la < 1e-9 || lc < 1e-9) { out.push([P[0], P[1]]); continue; }
    ux /= la; uy /= la; vx /= lc; vy /= lc;
    const phi = Math.acos(clamp(ux * vx + uy * vy, -1, 1));
    if (phi > Math.PI - 1e-3) { out.push([P[0], P[1]]); continue; }
    const half = phi / 2; let d = ri0 / Math.tan(half), ri = ri0;
    const dmax = 0.5 * Math.min(la, lc); if (d > dmax) { d = dmax; ri = d * Math.tan(half); }
    let bx = ux + vx, by = uy + vy; const bl = Math.hypot(bx, by); bx /= bl; by /= bl;
    const cx = P[0] + bx * (ri / Math.sin(half)), cy = P[1] + by * (ri / Math.sin(half));
    const t1x = P[0] + ux * d, t1y = P[1] + uy * d, t2x = P[0] + vx * d, t2y = P[1] + vy * d;
    const a1 = Math.atan2(t1y - cy, t1x - cx); let da = Math.atan2(t2y - cy, t2x - cx) - a1;
    while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    const m = Math.max(2, Math.ceil((seg * Math.abs(da)) / (Math.PI / 2)));
    for (let k = 0; k <= m; k++) { const a = a1 + (da * k) / m; out.push([cx + Math.cos(a) * ri, cy + Math.sin(a) * ri]); }
  }
  return out;
}

/** Torno: perfil [[r, y], ...] percorrido com o sólido à esquerda (anti-horário no plano r-y), assim a normal sai para fora.
    A LatheGeometry calcula a normal pelo perfil; não chamar computeVertexNormals (criaria costura no fechamento). */
export function lathe(profile, segments = 64) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), segments);
}

/** Normais suaves com vinco: média ponderada por área das faces que tocam a mesma posição (hash de 0.01 mm)
    e cuja normal difere menos que angleDeg. Bisel de 3-4 segmentos fica liso, quina de 90 graus continua viva. */
export function creaseNormals(geo, angleDeg = 35) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position, n = P.count, nf = n / 3, cosT = Math.cos((angleDeg * Math.PI) / 180);
  const wn = new Float32Array(nf * 3), un = new Float32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const a = f * 3, ax = P.getX(a), ay = P.getY(a), az = P.getZ(a);
    const bx = P.getX(a + 1), by = P.getY(a + 1), bz = P.getZ(a + 1), cx = P.getX(a + 2), cy = P.getY(a + 2), cz = P.getZ(a + 2);
    // mesma convenção da three: (c - b) x (a - b)
    const ex = cx - bx, ey = cy - by, ez = cz - bz, fx = ax - bx, fy = ay - by, fz = az - bz;
    const x = ey * fz - ez * fy, y = ez * fx - ex * fz, z = ex * fy - ey * fx, l = Math.hypot(x, y, z);
    wn[f * 3] = x; wn[f * 3 + 1] = y; wn[f * 3 + 2] = z;
    if (l > 0) { un[f * 3] = x / l; un[f * 3 + 1] = y / l; un[f * 3 + 2] = z / l; }
  }
  const groups = new Map(), key = (i) => `${Math.round(P.getX(i) * 1e5)},${Math.round(P.getY(i) * 1e5)},${Math.round(P.getZ(i) * 1e5)}`;
  for (let i = 0; i < n; i++) { const k = key(i); let l = groups.get(k); if (!l) groups.set(k, (l = [])); l.push(i); }
  const N = new Float32Array(n * 3);
  for (const list of groups.values()) for (const i of list) {
    const fi = (i / 3) | 0; let x = 0, y = 0, z = 0;
    for (const j of list) {
      const fj = (j / 3) | 0;
      if (un[fi * 3] * un[fj * 3] + un[fi * 3 + 1] * un[fj * 3 + 1] + un[fi * 3 + 2] * un[fj * 3 + 2] > cosT) { x += wn[fj * 3]; y += wn[fj * 3 + 1]; z += wn[fj * 3 + 2]; }
    }
    let l = Math.hypot(x, y, z);
    if (l < 1e-20) { x = un[fi * 3]; y = un[fi * 3 + 1]; z = un[fi * 3 + 2]; l = Math.hypot(x, y, z) || 1; if (l === 1 && !x && !y && !z) y = 1; }
    N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l;
  }
  g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  return g;
}

/** Junta geometrias de mesmo material num draw só (position, normal, uv; índice removido). */
export function mergeGeos(list) {
  const parts = list.map((g) => {
    const h = g.index ? g.toNonIndexed() : g, o = new THREE.BufferGeometry();
    o.setAttribute("position", h.attributes.position);
    o.setAttribute("normal", h.attributes.normal);
    o.setAttribute("uv", h.attributes.uv || new THREE.BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
    return o;
  });
  const m = mergeGeometries(parts, false);
  for (const g of list) g.dispose();
  return m;
}
