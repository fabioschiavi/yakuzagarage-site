/* v3 · roda forjada 19x9.5 ET35, 5 raios, côncava (SPEC-3D seção 2 WHEEL, contrato seção 7).
   Mundo da spec: metros, centro do cubo na origem, eixo em +X (para fora), +Y para cima, theta = atan2(y, -z).
   A raiz fica na origem e sem giro: posições locais = mundo. O conteúdo fica em `spin` (rotation.x = ângulo da roda,
   caso a montagem gire a parte em vez de pendurar a raiz no spinGroup dela).

   Estações em X (sem espaçador; com ele tudo anda +0.015, quem faz isso é a montagem):
     face de montagem (almofada do cubo)   0        (achatada: o prato côncavo da spec deixaria uma cunha de 5 mm)
     aro (abas por fora)                    -0.155 .. +0.085 (LAYOUT.x.rim; centro -0.035 = ET35)
     aba J                                  6.5 mm de espessura, topo r 0.2588 (talão 0.2413 + 17.5 mm)
     lábio escalonado 22 mm                 face do lábio +0.085 -> degrau +0.074 (r 0.236 -> 0.2275) -> piso +0.063
     face (raios)                           extrusão de 28 mm no total, borda da frente em +0.065 (2 mm acima do piso
                                            do lábio), centro 38 mm mais fundo pela fórmula do prato
     frente da face no furo central          +0.0287; calota até +0.0345
     sede da porca                          +0.017 (prisioneiro do cubo vai a +0.0374: 20 mm de rosca, ponta dentro da porca)
   Raios alinhados com os prisioneiros (hardware.STUDS: o 0 no topo, theta 90°), janelas a +36° deles.
   Janela k: centro theta = STUDS.thetas[k] + 36°, raio médio 0.14 (anchors.window0..4).

   Malhas e draws: barril (AO por vértice), lábio, face (raios + 5 sedes de porca fundidas), calota, 5 porcas
   (1 InstancedMesh), impostor borrado (só acima de 30 rad/s) = 5 draws, 6 no giro rápido.
   Triângulos medidos (base): face 20.7k, barril 12.1k, lábio 5.6k, calota 2.8k, porcas 15.1k (5 x "high" do hardware)
   = 56k; low 35k. Para cortar: porcas em "mid" (-9k) ou spacing da tampa e passos do contorno em faceGeometry.
   Malha da face conferida em Node: tampa sem vértice perdido, sem lasca virada, paredes fechadas (só as bordas das
   sedes de porca ficam abertas, enterradas na parede do bolsão). */
import * as THREE from "three";
import { LAYOUT } from "../spec.js";
import { blurredDisc } from "../textures.js";
import { P, revolveGeometry, lugNutGeometry, STUDS } from "../hardware.js";

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const W = LAYOUT.wheel, F = W.face, WIN = F.windows;

/* ---------------- números do aro (metros) ---------------- */
const XI = LAYOUT.x.rim[0];                 // -0.155 aba de dentro, face de trás
const XO = LAYOUT.x.rim[1];                 // +0.085 aba de fora, face do lábio
const R_SEAT = LAYOUT.tyre.beadR;           // 0.2413 assento do talão (19 pol / 2)
const FL_T = 0.0065;                        // espessura da aba: o calcanhar do pneu (tyre.js) encosta na face de dentro dela
const R_FLANGE = R_SEAT + 0.0175;           // 0.2588 topo da aba J; tyre.js dobra o pneu sobre ele
const FL_R = FL_T / 2, FL_C = R_FLANGE - FL_R; // topo da aba é meia-cana de raio 3.25 mm (a linha clara do lábio)
const LIP_FLOOR = XO - W.barrel.lipStep;    // +0.063 piso do lábio (22 mm de profundidade)
const LIP_STEP = XO - W.barrel.lipStep / 2; // +0.074 degrau no meio do lábio
const R_LIP1 = 0.2360;                      // primeiro cilindro do lábio (parede de 5.3 mm sob o assento)
const R_LIP2 = 0.2275;                      // segundo cilindro, depois do degrau de 8.5 mm
const R_IN = 0.2325;                        // barril por dentro sobre a pinça: a pinça vai a r 0.222 (0.215 + bisel 7)
const RING_X = 0.0362;                      // costas do anel que prende a face: rente às costas dela (0.0350 em r 0.21)

/* ---------------- números da face ---------------- */
const FACE_R = F.r;                         // 0.215: a parede externa da face (contorno = parede, o bisel fica para dentro)
const FACE_D = F.depth;                     // 0.028 espessura TOTAL (bisel de 4 mm incluso dos dois lados)
const BEV = F.bevel.size;                   // 0.004 arredondado em quarto de círculo, 3 gomos (bevelSegments)
const FRONT_EDGE = LIP_FLOOR + 0.002;       // +0.065 a borda da face sai 2 mm do piso do lábio
const XB = FRONT_EDGE - FACE_D;             // +0.037 costas da face antes do prato
const BORE_R = F.bore / 2;                  // 0.0363
const PCD_R = F.pcd / 2;                    // 0.060 (= STUDS.r)
const DISH_C = F.concave.depth, DISH_E = F.concave.exponent;
/** x_offset da spec: -0.038 (1 - (r/0.215)^1.6) */
const dish = (r) => -DISH_C * (1 - Math.pow(r / FACE_R, DISH_E));
const dishP = (r) => (DISH_C * DISH_E * Math.pow(Math.max(r, 1e-6), DISH_E - 1)) / Math.pow(FACE_R, DISH_E);
/** frente da face no raio r (com o prato). Exportado para quem precisa mirar a superfície (varredura de luz, B5). */
export const faceFrontX = (r) => XB + FACE_D + dish(r);
// almofada de montagem: costas planas em x 0 até r 0.072, mistura até 0.100 (o flange do espaçador tem r 0.075)
const PAD = [0.072, 0.100];

/* ---------------- porcas e bolsões ---------------- */
const SEAT_X = 0.017;                       // plano da sede cônica (origem da porca do hardware)
const T30 = Math.tan(Math.PI / 6);          // cone de 60 graus: dr/dx = tan 30
const NUT_CONE_R0 = 0.0074;                 // raio da porca na origem (hardware.lugNutGeometry)
const HOLE_R = 0.0075;                      // furo do prisioneiro: 0.5 mm de folga sobre o M14 (r 7 da spec colaria na malha do prisioneiro e brigaria em profundidade)
const SEAT_TOP_R = 0.0112;                  // fim do cone (a porca para em 0.01086)
const POCKET_R = 0.0125;                    // bolsão Ø25: soquete de parede fina passa em volta do sextavado de 17
const POCKET_BEV = 0.0025;                  // borda do bolsão: com 4 mm o arredondado comeria a parede inteira
const SEAT_FLOOR = SEAT_X + (SEAT_TOP_R - NUT_CONE_R0) / T30; // +0.0236 piso do bolsão
const NUT_PHASE = [0.13, 0.41, 0.77, 0.29, 0.58]; // fase do sextavado: cinco porcas iguais leriam como clone

/* ---------------- 1. barril e lábio (torno em +X, hardware.revolveGeometry) ----------------
   Perfil em sentido horário (x para a direita, r para cima): material sempre à direita de quem anda.
   O barril começa escondido dentro da face, desce pelas costas do anel, corre por dentro (AO escuro), sobe a aba
   de dentro, volta por fora (lado do pneu, sempre coberto) e termina no topo da aba de fora. O lábio começa ali. */
function arcRows(cx, cr, rad, a0deg, a1deg, n, o = {}) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = ((a0deg + ((a1deg - a0deg) * k) / n) * Math.PI) / 180;
    out.push(P(cx + rad * Math.cos(a), cr + rad * Math.sin(a), 0, o));
  }
  return out;
}
function barrelProfile() {
  return [
    P(LIP_FLOOR, 0.2120, 0, { ao: 0.5 }),                 // escondido sob a borda da face (face cobre até r 0.2137)
    P(0.0560, 0.2080, 0, { ao: 0.5 }),                    // escondido dentro do anel da face (r 0.205..0.215 é maciço)
    P(RING_X, 0.2080, 0, { ao: 0.45 }),                   // sai pelas costas da face em r ~0.212
    P(RING_X, R_IN, 0.008, { ao: 0.5 }),                 // costas do anel -> barril: filete côncavo de 8 mm
    P(-0.0880, R_IN, 0.004, { ao: 0.58 }),                // barril por dentro, por cima da pinça
    P(-0.0955, 0.2205, 0.003, { ao: 0.46 }),              // poço (drop centre) por dentro, junto da aba de dentro
    P(-0.1125, 0.2205, 0.003, { ao: 0.46 }),
    P(-0.1195, 0.2335, 0.003, { ao: 0.5 }),
    P(XI, 0.2345, 0.0025, { ao: 0.78 }),                  // borda de dentro do barril
    ...arcRows(XI + FL_R, FL_C, FL_R, 180, 0, 12, { ao: 1 }), // aba de dentro: meia-cana
    P(XI + FL_T, R_SEAT, 0.0015, { ao: 0.7 }),            // -0.1485 face da aba onde o talão encosta
    // lado do pneu: sempre coberto pela borracha (e pelo fechamento r 0.2433 do tyre.js), por isso sem filetes
    P(-0.1265, R_SEAT - 0.0019, 0, { ao: 0.6 }),          // assento com 5 graus
    P(-0.1235, 0.2410, 0, { ao: 0.6 }),                   // hump
    P(-0.1195, 0.2385, 0, { ao: 0.6 }),
    P(-0.1125, 0.2250, 0, { ao: 0.6 }),                   // poço por fora (parede 4.5 mm)
    P(-0.0955, 0.2250, 0, { ao: 0.6 }),
    P(-0.0880, 0.2370, 0, { ao: 0.6 }),
    P(0.0435, 0.2370, 0, { ao: 0.6 }),
    P(0.0485, 0.2408, 0, { ao: 0.6 }),                    // hump de fora
    P(0.0525, R_SEAT - 0.0020, 0, { ao: 0.6 }),
    P(XO - FL_T, R_SEAT, 0.0015, { ao: 0.75 }),           // +0.0785 face da aba de fora
    ...arcRows(XO - FL_R, FL_C, FL_R, 180, 90, 8, { ao: 1 }), // meia aba: termina no ápice (r 0.2588), onde o lábio começa
  ];
}
function lipProfile() {
  return [
    ...arcRows(XO - FL_R, FL_C, FL_R, 90, 0, 8, { ao: 1 }), // do ápice da aba à face do lábio
    P(XO, R_LIP1, 0.0015, { ao: 0.95 }),                  // anel polido de 22.8 mm (r 0.2588 -> 0.236), quina arredondada
    P(LIP_STEP, R_LIP1, 0.0010, { ao: 0.72 }),            // cilindro 1 -> degrau (canto côncavo)
    P(LIP_STEP, R_LIP2, 0.0010, { ao: 0.82 }),            // aresta do degrau
    P(LIP_FLOOR, R_LIP2, 0.0010, { ao: 0.55 }),           // cilindro 2 -> piso (canto côncavo, fundo do lábio)
    P(LIP_FLOOR, 0.2120, 0, { ao: 0.55 }),                // piso até debaixo da face
  ];
}
/** A emenda barril/lábio cai no ápice da aba; cada torno calcula a normal só com o próprio lado (meio gomo de
    diferença = costura clara na linha mais brilhante da roda). Ali a normal certa é radial pura. */
function radialNormalsAtRow(geo, row) {
  const p = geo.attributes.position, n = geo.attributes.normal, cols = p.count / (geo.userData.rows || 1);
  for (let j = 0; j < cols; j++) {
    const i = row * cols + j, y = p.getY(i), z = p.getZ(i), r = Math.hypot(y, z) || 1;
    n.setXYZ(i, 0, y / r, z / r);
  }
  n.needsUpdate = true;
}
function rimGeometries(angles) {
  const barrel = revolveGeometry(barrelProfile(), { angles, segQ: 2, vScale: 0.37, ao: true }); // vScale: grão do fbm quase quadrado (4 ladrilhos na volta)
  const lip = revolveGeometry(lipProfile(), { angles, segQ: 3, vScale: 0.37, ao: true });
  const cols = angles + 1;
  barrel.userData.rows = barrel.attributes.position.count / cols;
  lip.userData.rows = lip.attributes.position.count / cols;
  radialNormalsAtRow(barrel, barrel.userData.rows - 1);
  radialNormalsAtRow(lip, 0);
  return { barrel, lip };
}

/* ---------------- 2. contornos da face (plano da forma: x = -z do mundo, y = y; ângulo da forma = theta) ---------------- */
const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });

/** Janela afunilada: 2 arcos (r0, r1) e 2 retas paralelas aos raios vizinhos a meia largura de raio (19 mm),
    cantos com filete de 6 mm calculado exato (círculo tangente à reta e ao arco). phi = theta do centro da janela. */
function windowLoop(phi, { r0 = WIN.r0, r1 = WIN.r1, d = WIN.spokeWidth / 2, rho = WIN.fillet, half = Math.PI / WIN.count, arcStep = 0.005, lineStep = 0.006, filletSeg = 7 } = {}) {
  const a1 = phi - half, a2 = phi + half;                                  // linhas de centro dos raios vizinhos
  const u1 = [Math.cos(a1), Math.sin(a1)], n1 = [-Math.sin(a1), Math.cos(a1)]; // n aponta para dentro da janela
  const u2 = [Math.cos(a2), Math.sin(a2)], n2 = [Math.sin(a2), -Math.cos(a2)];
  const corner = (u, n, R, inner) => {
    const Rc = inner ? R + rho : R - rho, s = Math.sqrt(Rc * Rc - (d + rho) * (d + rho));
    const c = [s * u[0] + (d + rho) * n[0], s * u[1] + (d + rho) * n[1]];
    const k = R / Rc;
    return { c, tl: [s * u[0] + d * n[0], s * u[1] + d * n[1]], ta: [c[0] * k, c[1] * k] };
  };
  const A = corner(u1, n1, r0, true), B = corner(u1, n1, r1, false), C = corner(u2, n2, r1, false), D = corner(u2, n2, r0, true);
  const pts = [];
  const line = (p, q) => { const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / lineStep)); for (let k = 0; k < n; k++) pts.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]); };
  const fillet = (c, p, q) => {
    const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]); let da = Math.atan2(q[1] - c[1], q[0] - c[0]) - a0;
    while (da > Math.PI) da -= TAU; while (da <= -Math.PI) da += TAU;
    for (let k = 0; k < filletSeg; k++) { const a = a0 + (da * k) / filletSeg; pts.push([c[0] + rho * Math.cos(a), c[1] + rho * Math.sin(a)]); }
  };
  const arc = (R, p, q, dir) => {
    const a0 = Math.atan2(p[1], p[0]); let da = Math.atan2(q[1], q[0]) - a0;
    if (dir > 0) { while (da <= 0) da += TAU; while (da > TAU) da -= TAU; } else { while (da >= 0) da -= TAU; while (da < -TAU) da += TAU; }
    const n = Math.max(2, Math.ceil((Math.abs(da) * R) / arcStep));
    for (let k = 0; k < n; k++) { const a = a0 + (da * k) / n; pts.push([R * Math.cos(a), R * Math.sin(a)]); }
  };
  line(A.tl, B.tl); fillet(B.c, B.tl, B.ta);
  arc(r1, B.ta, C.ta, +1); fillet(C.c, C.ta, C.tl);
  line(C.tl, D.tl); fillet(D.c, D.tl, D.ta);
  arc(r0, D.ta, A.ta, -1); fillet(A.c, A.ta, A.tl);
  return pts;
}

/* ---------------- 3. chapa extrudada com bisel redondo, pontos de Steiner e prato ----------------
   Por que não o ExtrudeGeometry: ele sai com normal chapada por face (o reflexo do softbox fica em degraus no bisel)
   e triangula a tampa com triângulos que atravessam o raio inteiro; o prato é deformação por vértice e precisa de
   malha fina no meio da tampa. Aqui: contorno = parede; tampa no contorno recuado do bisel; quarto de círculo de
   `segs` gomos na frente e atrás; pontos de Steiner (buracos de 1 vértice no earcut) a cada ~9 mm na tampa.
   Coordenada local: x = 0 (costas) .. depth (frente), forma (sx, sy) -> mundo (z = -sx, y = sy). */
function areaOf(c) { let s = 0; for (let i = 0; i < c.length; i++) { const a = c[i], b = c[(i + 1) % c.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function prepContour(c, b) {
  const m = c.length, n = new Float64Array(m * 2), q = new Float64Array(m * 2);
  for (let i = 0; i < m; i++) {
    const a = c[(i - 1 + m) % m], p = c[i], d = c[(i + 1) % m];
    let e1x = p[1] - a[1], e1y = -(p[0] - a[0]), e2x = d[1] - p[1], e2y = -(d[0] - p[0]); // à direita de quem anda = fora do material
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1; e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    let nx = e1x + e2x, ny = e1y + e2y; const ln = Math.hypot(nx, ny) || 1; nx /= ln; ny /= ln;
    const miter = 1 / Math.max(0.5, nx * e1x + ny * e1y);
    // tremida de 0.5 µm ao longo da normal: o earcut descarta ponto exatamente colinear (lados retos da janela) e a
    // parede ficaria com vértice que a tampa não tem: rachadura em T depois do prato
    const jit = (i % 2 ? 1 : -1) * 5e-7;
    n[i * 2] = nx; n[i * 2 + 1] = ny; q[i * 2] = p[0] - nx * (b * miter + jit); q[i * 2 + 1] = p[1] - ny * (b * miter + jit);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < m; i++) { const x = q[i * 2], y = q[i * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { m, n, q, b, box: [x0, y0, x1, y1] };
}
function inPoly(px, py, q, m) {
  let c = false;
  for (let i = 0, j = m - 1; i < m; j = i++) {
    const xi = q[i * 2], yi = q[i * 2 + 1], xj = q[j * 2], yj = q[j * 2 + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist2(px, py, ax, ay, bx, by) {
  const ux = bx - ax, uy = by - ay, l2 = ux * ux + uy * uy || 1e-18, t = clamp(((px - ax) * ux + (py - ay) * uy) / l2, 0, 1);
  const dx = px - ax - ux * t, dy = py - ay - uy * t; return dx * dx + dy * dy;
}
/** Grade polar escalonada dentro da tampa, a pelo menos `margin` de qualquer contorno (sem lasca de triângulo). */
function steinerPoints(items, h) {
  const out = [], margin = 0.55 * h, m2 = margin * margin, outer = items[0];
  const rMax = Math.max(Math.abs(outer.box[0]), Math.abs(outer.box[1]), outer.box[2], outer.box[3]);
  let ring = 0;
  for (let r = h * 0.6; r < rMax; r += h * 0.866, ring++) {
    const n = Math.max(3, Math.round((TAU * r) / h)), off = (ring % 2) * 0.5;
    for (let k = 0; k < n; k++) {
      const a = ((k + off) / n) * TAU, x = r * Math.cos(a), y = r * Math.sin(a);
      if (!inPoly(x, y, outer.q, outer.m)) continue;
      let ok = true;
      for (let c = 0; c < items.length && ok; c++) {
        const it = items[c], bx = it.box;
        if (x < bx[0] - margin || x > bx[2] + margin || y < bx[1] - margin || y > bx[3] + margin) continue;
        if (c > 0 && inPoly(x, y, it.q, it.m)) { ok = false; break; }
        for (let i = 0; i < it.m; i++) {
          const j = (i + 1) % it.m;
          if (segDist2(x, y, it.q[i * 2], it.q[i * 2 + 1], it.q[j * 2], it.q[j * 2 + 1]) < m2) { ok = false; break; }
        }
      }
      if (ok) out.push([x, y]);
    }
  }
  return out;
}
/** Troca de arestas de Lawson (Delaunay com restrição): o earcut deixa lascas longas entre pontos do contorno que,
    depois do prato, viram aletas de até 3.5 mm em pé. As arestas do contorno ficam presas. tris: [a, b, c] em
    qualquer ordem; devolve tudo anti-horário no plano da forma. */
function delaunayFlip(V, tris, fixed) {
  const N = V.length;
  const orient = (a, b, c) => (V[b].x - V[a].x) * (V[c].y - V[a].y) - (V[b].y - V[a].y) * (V[c].x - V[a].x);
  const inCircle = (a, b, c, d) => {
    const ax = V[a].x - V[d].x, ay = V[a].y - V[d].y, bx = V[b].x - V[d].x, by = V[b].y - V[d].y, cx = V[c].x - V[d].x, cy = V[c].y - V[d].y;
    return (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
  };
  const T = tris.map(([a, b, c]) => (orient(a, b, c) >= 0 ? [a, b, c] : [a, c, b]));
  const key = (a, b) => (a < b ? a * N + b : b * N + a);
  const E = new Map();
  const addE = (a, b, t) => { const k = key(a, b), e = E.get(k); if (e) e[1] = t; else E.set(k, [t, -1]); };
  T.forEach((t, i) => { addE(t[0], t[1], i); addE(t[1], t[2], i); addE(t[2], t[0], i); });
  const swap = (a, b, from, to) => { const e = E.get(key(a, b)); if (!e) return; if (e[0] === from) e[0] = to; else if (e[1] === from) e[1] = to; };
  const has = (t, a, b) => (t[0] === a && t[1] === b) || (t[1] === a && t[2] === b) || (t[2] === a && t[0] === b);
  const third = (t, a, b) => (t[0] !== a && t[0] !== b ? t[0] : t[1] !== a && t[1] !== b ? t[1] : t[2]);
  const stack = [...E.keys()];
  for (let guard = 0; stack.length && guard < 400000; guard++) {
    const k = stack.pop(), e = E.get(k);
    if (!e || e[1] < 0 || fixed.has(k)) continue;
    const a = Math.floor(k / N), b = k - a * N, i0 = e[0], i1 = e[1];
    let t0 = T[i0], t1 = T[i1], j0 = i0, j1 = i1;
    if (!has(t0, a, b)) { [t0, t1] = [t1, t0]; [j0, j1] = [j1, j0]; }          // t0 = (a, b, c) anti-horário
    const c = third(t0, a, b), d = third(t1, a, b);
    if (inCircle(a, b, c, d) <= 1e-16) continue;
    if (orient(a, d, c) <= 0 || orient(d, b, c) <= 0) continue;            // quadrilátero côncavo: não troca
    T[j0] = [a, d, c]; T[j1] = [d, b, c];
    E.delete(k); E.set(key(c, d), [j0, j1]);
    swap(b, c, j0, j1); swap(a, d, j1, j0);
    stack.push(key(a, d), key(d, b), key(b, c), key(c, a));
  }
  return T;
}

function roundedPlate({ outer, holes, depth, segs = 3, spacing = 0.009, uvR = FACE_R }) {
  // contorno de fora anti-horário, furos horários; cada um com o próprio bisel
  const items = [outer, ...holes].map(({ pts, b }, i) => {
    const ccw = areaOf(pts) > 0, c = i === 0 ? (ccw ? pts : pts.slice().reverse()) : (ccw ? pts.slice().reverse() : pts);
    return prepContour(c, b);
  });
  const pos = [], nor = [], uv = [], idx = [];
  const put = (sx, sy, xl, nsx, nsy, nax) => { pos.push(xl, sy, -sx); nor.push(nax, nsy, -nsx); uv.push(sx / (2 * uvR) + 0.5, sy / (2 * uvR) + 0.5); };

  // tampas
  const capV = items.map(({ q, m }) => Array.from({ length: m }, (_, i) => new THREE.Vector2(q[i * 2], q[i * 2 + 1])));
  const st = steinerPoints(items, spacing).map(([x, y]) => [new THREE.Vector2(x, y)]);
  const flat = [...capV.flat(), ...st.map((s) => s[0])];
  const fixed = new Set();
  let off = 0;
  for (const { m } of items) { for (let i = 0; i < m; i++) { const a = off + i, b = off + ((i + 1) % m); fixed.add(a < b ? a * flat.length + b : b * flat.length + a); } off += m; }
  const faces = delaunayFlip(flat, THREE.ShapeUtils.triangulateShape(capV[0], [...capV.slice(1), ...st]), fixed);
  for (const [xl, nax] of [[depth, 1], [0, -1]]) {
    const base = pos.length / 3;
    for (const p of flat) put(p.x, p.y, xl, 0, 0, nax);
    // faces já vêm anti-horárias na forma = anti-horárias vistas de +X (direita da tela = -z = sx): frente direto, costas invertidas
    for (const [a, b, c] of faces) { if (nax > 0) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b); }
  }
  // paredes: quarto de círculo na frente, parede reta, quarto de círculo atrás
  const phis = [];
  for (let k = 0; k <= segs; k++) phis.push([(k / segs) * (Math.PI / 2), true]);
  for (let k = 0; k <= segs; k++) phis.push([Math.PI / 2 + (k / segs) * (Math.PI / 2), false]);
  for (const { m, n, q, b } of items) {
    const base = pos.length / 3;
    for (const [phi, front] of phis) {
      const s = Math.sin(phi), co = Math.cos(phi), xl = front ? depth - b + b * co : b + b * co;
      for (let i = 0; i < m; i++) { const nx = n[i * 2], ny = n[i * 2 + 1]; put(q[i * 2] + nx * b * s, q[i * 2 + 1] + ny * b * s, xl, nx * s, ny * s, co); }
    }
    // enrolamento: normal geométrica do primeiro quad da parede contra a analítica
    const at = (r, i) => base + r * m + (i % m), r0 = segs;
    const P0 = at(r0, 0) * 3, P1 = at(r0, 1) * 3, P2 = at(r0 + 1, 0) * 3;
    const ux = pos[P1] - pos[P0], uy = pos[P1 + 1] - pos[P0 + 1], uz = pos[P1 + 2] - pos[P0 + 2];
    const wx = pos[P2] - pos[P0], wy = pos[P2 + 1] - pos[P0 + 1], wz = pos[P2 + 2] - pos[P0 + 2];
    const flip = (uy * wz - uz * wy) * nor[P0] + (uz * wx - ux * wz) * nor[P0 + 1] + (ux * wy - uy * wx) * nor[P0 + 2] < 0;
    for (let r = 0; r < phis.length - 1; r++) for (let i = 0; i < m; i++) {
      const a = at(r, i), bb = at(r, i + 1), c = at(r + 1, i), d = at(r + 1, i + 1);
      if (flip) idx.push(a, c, bb, bb, c, d); else idx.push(a, bb, c, bb, d, c);
    }
  }
  return { pos, nor, uv, idx, steiner: st.length };
}

/** Prato côncavo + almofada plana, por vértice, com a normal levada pela inversa transposta do jacobiano
    (x' = G(x, r): n' = (nx/Gx, ny - Gr (y/r) nx/Gx, nz - Gr (z/r) nx/Gx)). Mantém o bisel liso depois de entortar. */
function dishInPlace(pos, nor, from, to) {
  const pd = PAD[1] - PAD[0];
  for (let v = from; v < to; v++) {
    const i = v * 3, xl = pos[i], y = pos[i + 1], z = pos[i + 2], r = Math.hypot(y, z), t = xl / FACE_D;
    const fr = dish(r), fpr = dishP(r), s = clamp((r - PAD[0]) / pd, 0, 1);
    const w = 1 - s * s * (3 - 2 * s), wp = s > 0 && s < 1 ? (-6 * s * (1 - s)) / pd : 0;
    const base = XB + fr;                                              // costas com o prato puro; a almofada puxa para 0
    pos[i] = XB + xl + fr - (1 - t) * w * base;
    const Gx = 1 + (w * base) / FACE_D, Gr = fpr - (1 - t) * (wp * base + w * fpr);
    const k = nor[i] / Gx, ry = r > 1e-9 ? y / r : 0, rz = r > 1e-9 ? z / r : 0;
    const nx = k, ny = nor[i + 1] - Gr * ry * k, nz = nor[i + 2] - Gr * rz * k, l = Math.hypot(nx, ny, nz) || 1;
    nor[i] = nx / l; nor[i + 1] = ny / l; nor[i + 2] = nz / l;
  }
}

/** Sede da porca: cone de 60 graus + piso com filete até a parede do bolsão + furo de 7.5 mm. Torno em volta do
    eixo do prisioneiro, x absoluto (não entra no prato: a almofada já é plana em x 0). */
function seatProfile() {
  return [
    P(SEAT_FLOOR + 0.0015, POCKET_R - 0.00025, 0, { ao: 0.6 }), // 0.25 mm para dentro da parede do bolsão: cobre a quina
    P(SEAT_FLOOR, POCKET_R - 0.00025, 0.0012, { ao: 0.45 }),    // filete côncavo piso/parede
    P(SEAT_FLOOR, SEAT_TOP_R, 0.0004, { ao: 0.5 }),
    P(SEAT_X + (HOLE_R - NUT_CONE_R0) / T30, HOLE_R, 0.0005, { ao: 0.35 }), // cone 60 graus (a porca assenta aqui)
    P(0, HOLE_R, 0.0004, { ao: 0.2 }),
    P(0, POCKET_R),
  ];
}

function faceGeometry(tier) {
  const fine = tier !== "low";
  const outer = { pts: circle(0, 0, FACE_R, fine ? 160 : 120), b: BEV };
  const holes = [{ pts: circle(0, 0, BORE_R, 48), b: BEV }];
  for (let k = 0; k < STUDS.count; k++) holes.push({ pts: circle(PCD_R * Math.cos(STUDS.thetas[k]), PCD_R * Math.sin(STUDS.thetas[k]), POCKET_R, 28), b: POCKET_BEV });
  for (let k = 0; k < WIN.count; k++) holes.push({ pts: windowLoop(STUDS.thetas[k] + Math.PI / WIN.count, tier === "high" ? {} : fine ? { arcStep: 0.0065, lineStep: 0.008, filletSeg: 6 } : { arcStep: 0.008, lineStep: 0.010, filletSeg: 5 }), b: BEV });
  const plate = roundedPlate({ outer, holes, depth: FACE_D, segs: F.bevel.segments, spacing: tier === "high" ? 0.009 : fine ? 0.0115 : 0.014 });
  const { pos, nor, uv, idx } = plate;
  dishInPlace(pos, nor, 0, pos.length / 3);

  // 5 sedes de porca fundidas na mesma malha (mesmo material, 1 draw)
  const seat = revolveGeometry(seatProfile(), { angles: fine ? 32 : 20, segQ: 3 });
  const sp = seat.attributes.position, sn = seat.attributes.normal, si = seat.index.array;
  for (let k = 0; k < STUDS.count; k++) {
    const th = STUDS.thetas[k], cy = PCD_R * Math.sin(th), cz = -PCD_R * Math.cos(th), base = pos.length / 3;
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i) + cy, z = sp.getZ(i) + cz;
      pos.push(sp.getX(i), y, z); nor.push(sn.getX(i), sn.getY(i), sn.getZ(i));
      uv.push(-z / (2 * FACE_R) + 0.5, y / (2 * FACE_R) + 0.5);
    }
    for (let i = 0; i < si.length; i++) idx.push(si[i] + base);
  }
  seat.dispose();

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData = { steiner: plate.steiner };
  return g;
}

/* ---------------- 4. calota com o oni ----------------
   Disco de torno pressionado no furo central; frente levemente abaulada. UV planar na frente (vista de +X:
   direita da tela = -Z, cima = +Y), oni de pé com a roda no ângulo 0. Inlay osso fosco sob verniz, sem emissivo. */
const CAP_UV_R = 0.034;                     // o oni ocupa 92% do quadro: ~63 mm dentro da frente plana (r 0.036)
function capProfile() {
  const dome = [0.036, 0.027, 0.018, 0.009, 0].map((r) => P(0.0345 - 0.0009 * (r / 0.036) ** 2, r));
  return [
    P(0.0170, 0),                                     // fundo do corpo (o pino do cubo vai a +0.0095)
    P(0.0170, 0.0335, 0.0010, { ao: 0.4 }),           // corpo com as presilhas, folga de 3 mm no furo
    P(0.0288, 0.0335, 0.0005, { ao: 0.4 }),
    P(0.0288, 0.0410, 0.0006, { ao: 0.6 }),           // aba apoiada na frente da face (0.0292 em r 0.041)
    P(0.0322, 0.0410, 0.0012),
    ...dome.map((p, i) => (i === 0 ? { ...p, f: 0.002 } : p)),
  ];
}
function capGeometry(tier) {
  const g = revolveGeometry(capProfile(), { angles: tier === "low" ? 48 : 64, segQ: 3 });
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, -p.getZ(i) / (2 * CAP_UV_R) + 0.5, p.getY(i) / (2 * CAP_UV_R) + 0.5);
  uv.needsUpdate = true;
  return g;
}
function capMaterial({ tex, envTex, tier }) {
  const oni = tex && typeof tex.oniDecal === "function" ? tex.oniDecal() : null;
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#16171a"), metalness: 1, roughness: 0.22,
    clearcoat: tier === "low" ? 0 : 0.6, clearcoatRoughness: 0.08,
    map: oni,
  });
  if (envTex) m.envMap = envTex;
  m.name = "v3.wheel.cap";
  const U = { uInlayColor: { value: new THREE.Color("#F2EEE6") }, uInlayRough: { value: 0.62 }, uInlay: { value: 1 } };
  // o alfa do oniDecal é o traço: troca cor, rugosidade e metal (tinta osso é dielétrica). O mapa não multiplica a cor.
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uInlayColor;\nuniform float uInlayRough, uInlay;")
      .replace("#include <map_fragment>", `float oniA = 0.0;
        #ifdef USE_MAP
          oniA = texture2D( map, vMapUv ).a * uInlay;
          diffuseColor.rgb = mix( diffuseColor.rgb, uInlayColor, oniA );
        #endif`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, uInlayRough, oniA );")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, 0.0, oniA );");
  };
  m.customProgramCacheKey = () => "v3wheelcap";
  return { material: m, oni, uniforms: U };
}

/* ---------------- 5. impostor borrado (giro rápido) ----------------
   Disco com o mesmo prato da frente da face (+2 mm), UV planar do blurredDisc (lado userData.radius). Gira junto. */
function blurDiscGeometry(half) {
  const NR = 20, NA = 96, rMax = FACE_R + 0.0015, pos = [], uv = [], idx = [];
  const xAt = (r) => Math.max(faceFrontX(r), 0.0345) + 0.002;          // no miolo, a calota e as porcas ficam acima do prato
  pos.push(xAt(0), 0, 0); uv.push(0.5, 0.5);
  for (let i = 1; i <= NR; i++) {
    const r = (rMax * i) / NR;
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * TAU, sx = r * Math.cos(a), sy = r * Math.sin(a);
      pos.push(xAt(r), sy, -sx); uv.push(sx / (2 * half) + 0.5, sy / (2 * half) + 0.5);
    }
  }
  const ring = (i, j) => 1 + (i - 1) * NA + (j % NA);
  for (let j = 0; j < NA; j++) idx.push(0, ring(1, j), ring(1, j + 1));   // anti-horário visto de +X
  for (let i = 1; i < NR; i++) for (let j = 0; j < NA; j++) {
    const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

/** buildWheel(ctx) -> Part & { face, lugNuts, setLug(i, turns, outM), setSwirl(0..1), setBlur(omega), spin, ready } */
export function buildWheel(ctx) {
  const { mats, tex = null, tier = "base" } = ctx;
  const low = tier === "low";
  const envTex = (mats.face && mats.face.envMap) || (tex && tex.env) || null;
  const angles = low ? 64 : W.barrel.segments;                       // 96 (spec), 64 no tier baixo

  const root = new THREE.Group(); root.name = "wheel";
  const spin = new THREE.Group(); spin.name = "wheel.spin"; root.add(spin);
  // o que o impostor substitui no giro rápido (barril e lábio são de revolução: borrados ficam iguais)
  const sharp = new THREE.Group(); sharp.name = "wheel.sharp"; spin.add(sharp);

  /* aro */
  const { barrel: barrelGeo, lip: lipGeo } = rimGeometries(angles);
  // clone sem o fbm: com ele o barril refletia nuvens (manchas de rugosidade em escala de 5 cm); barril torneado de verdade é liso e uniforme
  const barrelMat = mats.barrel.clone(); barrelMat.roughnessMap = null; barrelMat.roughness = 0.34; barrelMat.name = "v3.wheel.barrel";
  const barrel = new THREE.Mesh(barrelGeo, barrelMat); barrel.name = "wheel.barrel";   // mats.barrel já liga vertexColors
  const lipMat = typeof mats.ao === "function" ? mats.ao("lip") : mats.lip;
  if (lipMat === mats.lip) lipGeo.deleteAttribute("color");
  const lip = new THREE.Mesh(lipGeo, lipMat); lip.name = "wheel.lip";
  spin.add(barrel, lip);

  /* face */
  const faceGeo = faceGeometry(tier);
  const face = new THREE.Mesh(faceGeo, mats.face); face.name = "wheel.face";
  sharp.add(face);

  /* calota */
  const capGeo = capGeometry(tier);
  const cap = capMaterial({ tex, envTex, tier });
  const capMesh = new THREE.Mesh(capGeo, cap.material); capMesh.name = "wheel.cap";
  sharp.add(capMesh);

  /* porcas: 1 InstancedMesh, geometria do hardware (eixo +X, origem na sede) */
  const nutGeo = lugNutGeometry({ detail: tier === "high" ? "high" : low ? "low" : "mid" });
  const lugNuts = new THREE.InstancedMesh(nutGeo, mats.chromeBlack, STUDS.count);
  lugNuts.name = "wheel.lugNuts";
  lugNuts.frustumCulled = false;                                     // saem 70 mm no B2: a esfera de culling ficaria velha
  const nutTurns = new Float32Array(STUDS.count), nutOut = new Float32Array(STUDS.count);
  const nutY = STUDS.thetas.map((t) => PCD_R * Math.sin(t)), nutZ = STUDS.thetas.map((t) => -PCD_R * Math.cos(t));
  const m4 = new THREE.Matrix4();
  const writeNut = (i) => { m4.makeRotationX(NUT_PHASE[i % NUT_PHASE.length] + nutTurns[i] * TAU); m4.setPosition(SEAT_X + nutOut[i], nutY[i], nutZ[i]); lugNuts.setMatrixAt(i, m4); };
  for (let i = 0; i < STUDS.count; i++) writeNut(i);
  lugNuts.instanceMatrix.needsUpdate = true;
  sharp.add(lugNuts);

  /** turns > 0 desaperta (anti-horário visto de fora = +X); outM empurra a porca para fora em +X. */
  function setLug(i, turns = 0, outM = 0) {
    i |= 0;
    if (i < 0 || i >= STUDS.count) return;
    nutTurns[i] = +turns || 0; nutOut[i] = +outM || 0;
    writeNut(i); lugNuts.instanceMatrix.needsUpdate = true;
  }
  /** 1 = lavagem errada (swirl), 0 = espelho. Uniform compartilhado do mats.face (no tier baixo não há verniz). */
  function setSwirl(v) { if (typeof mats.setSwirl === "function") mats.setSwirl(clamp(+v || 0, 0, 1)); }

  /* impostor borrado: renderiza o `sharp` de +X e borra em ângulo (textures.blurredDisc). Refaz quando o oni chega. */
  let blurTex = null, blurMesh = null, blurMat = null, blurGeo = null;
  const renderBlur = () => {
    if (!tex || !tex.renderer) return null;
    // clone solto (sem pai): referencial da roda no ângulo 0, mesmo que a refação aconteça com a roda girada/montada
    const probe = sharp.clone(true);
    probe.visible = true; probe.position.set(0, 0, 0); probe.quaternion.identity(); probe.scale.set(1, 1, 1);
    probe.updateMatrixWorld(true);
    try { return blurredDisc(probe, tex.renderer, { env: tex.env || envTex }); }
    catch (e) { console.warn("wheel: impostor borrado desligado", e); return null; }
  };
  blurTex = renderBlur();
  if (blurTex) {
    blurGeo = blurDiscGeometry(blurTex.userData.radius);
    // a textura já vem com ACES + sRGB aplicados em JS: sem tone mapping de novo
    blurMat = new THREE.MeshBasicMaterial({ map: blurTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    blurMat.name = "v3.wheel.blur";
    blurMesh = new THREE.Mesh(blurGeo, blurMat); blurMesh.name = "wheel.blur"; blurMesh.visible = false;
    spin.add(blurMesh);
  }
  const oniReady = cap.oni && cap.oni.userData && cap.oni.userData.ready ? cap.oni.userData.ready : Promise.resolve();
  const ready = oniReady.then(() => {
    if (!blurMat) return;
    const t = renderBlur();
    if (!t) return;
    const old = blurMat.map; blurMat.map = t; blurMat.needsUpdate = true; blurTex = t;
    if (old && old !== t) old.dispose();
  }).catch(() => {});

  let blurK = -1;
  /** omega em rad/s (sinal não importa): de 30 a 42 rad/s o impostor entra; no fim a face nítida some. */
  function setBlur(omega) {
    const k = blurMesh ? smoothstep(W.blurOmega, W.blurOmega * 1.4, Math.abs(+omega || 0)) : 0;
    if (k === blurK) return;
    blurK = k;
    if (blurMesh) { blurMesh.visible = k > 0.002; blurMat.opacity = k; }
    sharp.visible = k < 0.998;
  }
  setBlur(0);

  /* âncoras (mundo, roda no ângulo 0, sem espaçador) */
  const V = (x, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const windows = [];
  const anchors = {
    hub: V(0),
    mountFace: V(0),
    faceCenter: V(faceFrontX(BORE_R)),                               // frente da face na borda do furo central
    cap: V(0.0345),                                                  // frente da calota (oni)
    lugSeat: V(SEAT_X),                                              // plano da sede (origem da porca); hub.js tem um palpite, vale este
    lipFace: V(XO, R_FLANGE - 0.011, 0),                             // meio do anel polido, no topo
    lipTop: V(XO - FL_R, R_FLANGE, 0),                               // ápice da aba de fora
    rimInner: V(XI),
    rimOuter: V(XO),
    face: V(faceFrontX(0.14), 0.14, 0),                              // topo do raio de cima, meio do raio ("Paint correction and ceramic")
  };
  for (let k = 0; k < WIN.count; k++) {
    const theta = STUDS.thetas[k] + Math.PI / WIN.count, r = (WIN.r0 + WIN.r1) / 2;
    const x = faceFrontX(r) - FACE_D / 2;                            // meio da espessura no centro da janela
    anchors["window" + k] = V(x, r * Math.sin(theta), -r * Math.cos(theta));
    windows.push({ theta, r, x });
  }
  for (let k = 0; k < STUDS.count; k++) anchors["lug" + k] = V(SEAT_X, nutY[k], nutZ[k]);

  return {
    root, spin, anchors,
    explodeAxis: new THREE.Vector3(1, 0, 0),
    explodeDist: 0.3,
    face, lugNuts, barrel, lip, cap: capMesh, blur: blurMesh, sharp,
    windows,                                                          // [{theta, r, x}] para travar o ângulo no mergulho do B3
    spokeThetas: STUDS.thetas.slice(),
    lugSeatX: SEAT_X,
    ready,                                                            // resolve quando o oni carregou e o impostor foi refeito com ele
    setLug, setSwirl, setBlur,
    dispose() {
      barrelGeo.dispose(); barrelMat.dispose(); lipGeo.dispose(); faceGeo.dispose(); capGeo.dispose(); nutGeo.dispose();
      cap.material.dispose(); lugNuts.dispose();
      if (blurGeo) blurGeo.dispose();
      if (blurMat) blurMat.dispose();
      if (blurTex) blurTex.dispose();                                // o impostor é desta parte (fora do cache do tex)
      // mats.* e tex.oniDecal são compartilhados: quem os criou descarta
    },
  };
}
