/* v3 · disco de freio 380x34 de duas peças, ventilado e furado (SPEC-3D seção 2 ROTOR, contrato seção 7).
   Mundo da spec: metros, centro do cubo na origem, eixo da roda em +X (para fora), +Y para cima.
   Ângulo no plano do disco: theta = atan2(y, -z) (0 = horizontal traseira, 90° = topo). É o mesmo ângulo do
   calor (sim/heat.js), da pinça (60°) e do shader do ferro em materials.js. Toda a geometria é "assada" já
   no referencial do mundo e fica dentro de `spin`; NENHUMA malha recebe rotation.x própria (o shader de calor lê
   a posição local da malha, então girar a malha em X desalinharia o calor). Quem gira é só `spin`.

   Estações em X (do contrato):
     face de fora do prato externo (pista de atrito)  -0.048
     vão das aletas (15 mm)                            -0.0725 .. -0.0575, plano médio -0.065
     face de fora do prato interno                     -0.082
     sino: face de montagem -0.0003 (rente ao cubo/roda em x 0), aba -0.0478 .. -0.0418 apoiada nas orelhas do anel
           (a spec põe cubo E roda em x 0, sem espessura de sino; a placa do sino, -0.0075..-0.0003, r 0.0365..0.085,
           ocupa o mesmo X do flange do cubo. Quem fizer hub.js: flange com r <= 0.07 fica escondido dentro dela)
   Peças:
     pratos   2 coroas extrudadas R 0.19 / r 0.12, 9.5 mm, chanfro 0.6 mm, 36 furos Ø7 em 3 fileiras (1 malha)
              o prato de fora tem 12 orelhas de arraste para dentro (r 0.1015) com furo Ø10.4 do bobbin
     aletas   48 aletas curvas (para trás no sentido do giro), InstancedMesh, ferro fundido com AO por vértice
     sino     torno preto anodizado com AO no degrau interno e na cavidade
     bobbins  12 carretéis flutuantes de aço, instanciados, viajam com o sino (setHatLift mostra a haste)
     legenda  anel polar r 0.193..0.215 com o texto da seção 5 B3, gira junto, acende sobre a faixa quente
     brilho   anel aditivo r 0.112..0.24 que lê a textura de calor e faz o papel de bloom em volta do arco quente
   Triângulos medidos (base): pratos 21.8k, aletas 6.5k, sino 9k, bobbins 8.7k, legenda+brilho 2k (só quando visíveis)
   = 48k; low 29k, high 59k. Para cortar, mexa em Q (holeSeg e outerSeg pesam mais nos pratos).
   Draw calls: 4 sempre (pratos, aletas, sino, bobbins) + legenda no B3 + brilho só acima de 470 °C. */
import * as THREE from "three";
import { mergeVertices, mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LAYOUT } from "../spec.js";

const D = Math.PI / 180, TAU = Math.PI * 2;
const RT = LAYOUT.rotor;
const XM = LAYOUT.x.rotorMid;                 // -0.065 plano médio da pista
const HG = RT.ventGap / 2;                    // 7.5 mm, meio vão
const X_FACE_OUT = XM + HG + RT.plate;        // -0.048 pista de atrito de fora (a que a câmera vê)
const X_FACE_IN = XM - HG - RT.plate;         // -0.082 pista de dentro
const X_PLATE_OUT = XM + HG + RT.plate / 2;   // -0.05275 centro do prato externo
const X_PLATE_IN = XM - HG - RT.plate / 2;    // -0.07725 centro do prato interno

// orelhas de arraste + bobbins: raio escolhido para caber entre a pista (0.12) e o sino; fase 15° fica entre colunas de furos
const R_BOB = 0.111;
const BOB_PHASE = 15 * D;
const LUG_TIP = 0.1015;                        // ponta da orelha (raio)
const LUG_HALF = 0.0115;                       // meia largura plana da orelha medida em R_BOB (23 mm de orelha)
const LUG_EASE = 0.008;                        // transição arredondada de cada lado (8 mm)
const LUG_HOLE = 0.0052;                       // furo do bobbin, haste Ø10 com folga

// Furos: fileira j em theta = i*30° + j*10°. As aletas são espirais theta(r) = 3.75° - 5°/20mm * (r - 0.135) + k*7.5°;
// com essa fase cada furo cai no meio do vão entre duas aletas nas três fileiras (0.135, 0.155, 0.175).
// Olhando de lado pelo furo se vê a lateral da aleta, como num disco real (o furo nunca atravessa uma aleta).
const HOLE_PHASE = 0;
const VANE_PHI0 = 3.75 * D;
const VANE_K = -(5 * D) / 0.02;                // dtheta/dr (rad/m): curva para trás, ponta externa atrasada no giro

// por tier: segmentos em volta e passo angular dos filetes do perfil (rad por segmento de arco).
// Orçamento base ~37k tris com legenda e brilho (cena inteira: 150k). Bobbin tem ~5 px no herói: filete grosso basta.
const Q = {
  // lookdev: o canto inteiro estourava 150k, o disco foi de 46k para ~28k no base (flecha do polígono < 0.1 mm em todos)
  high: { outerSeg: 160, innerSeg: 112, holeSeg: 12, bevelSeg: 2, hatSeg: 96, hatFil: 0.4, bobSeg: 14, bobFil: 0.7, vaneSide: 12 },
  base: { outerSeg: 120, innerSeg: 96, holeSeg: 10, bevelSeg: 1, hatSeg: 64, hatFil: 0.55, bobSeg: 10, bobFil: 1.0, vaneSide: 10 },
  low: { outerSeg: 96, innerSeg: 72, holeSeg: 8, bevelSeg: 1, hatSeg: 48, hatFil: 0.8, bobSeg: 8, bobFil: 1.2, vaneSide: 7 },
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ---------------- 2D ---------------- */
function circlePts(r, n, cx = 0, cy = 0, a0 = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * TAU; out.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); }
  return out;
}

/** Caminho 2D com cantos arredondados e normais analíticas (sem degrau de sombreamento entre reta e arco).
    corners: [[x, y, raioDoFilete], ...]. Percorrido no sentido anti-horário, a normal (dy, -dx) aponta para fora.
    Raio 0 = aresta viva (ponto duplicado com duas normais). Devolve [{x, y, nx, ny}]. */
function filletPath(corners, { closed = true, seg = 0.26 } = {}) {
  const n = corners.length, out = [];
  const P = (i) => corners[(i + n) % n];
  const push = (x, y, tx, ty) => out.push({ x, y, nx: ty, ny: -tx });
  for (let i = 0; i < n; i++) {
    const [x, y, f = 0] = corners[i];
    const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    if (!hasPrev || !hasNext) {
      const [ox, oy] = hasNext ? P(i + 1) : P(i - 1);
      let tx = hasNext ? ox - x : x - ox, ty = hasNext ? oy - y : y - oy;
      const l = Math.hypot(tx, ty); push(x, y, tx / l, ty / l); continue;
    }
    const [px, py] = P(i - 1), [qx, qy] = P(i + 1);
    let ax = x - px, ay = y - py; const la = Math.hypot(ax, ay); ax /= la; ay /= la;
    let bx = qx - x, by = qy - y; const lb = Math.hypot(bx, by); bx /= lb; by /= lb;
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by); // >0 convexo (laço anti-horário), <0 côncavo
    if (Math.abs(turn) < 1e-4) { push(x, y, ax, ay); continue; }
    if (f <= 0) { push(x, y, ax, ay); push(x, y, bx, by); continue; }
    // o filete nunca come mais que 48% do segmento vizinho
    let tl = f * Math.tan(Math.abs(turn) / 2);
    const tlMax = 0.48 * Math.min(la, lb), rr = tl > tlMax ? tlMax / Math.tan(Math.abs(turn) / 2) : f;
    tl = Math.min(tl, tlMax);
    const sg = Math.sign(turn), t0x = x - ax * tl, t0y = y - ay * tl;
    const cx = t0x - sg * rr * ay, cy = t0y + sg * rr * ax; // centro à esquerda (convexo) ou à direita (côncavo)
    const k = Math.max(1, Math.ceil(Math.abs(turn) / seg)), a0 = Math.atan2(ay, ax);
    for (let s = 0; s <= k; s++) {
      const ang = a0 + (turn * s) / k, tx = Math.cos(ang), ty = Math.sin(ang);
      push(cx + sg * rr * ty, cy - sg * rr * tx, tx, ty);
    }
  }
  return out;
}

/* ---------------- geometria ---------------- */
/** Torno em volta do eixo +X. path: {x: raio, y: x do mundo, nx, ny} no sentido anti-horário (normal para fora).
    Posição = (y, r sin th, -r cos th): o mesmo theta da spec. ao(p) opcional vira atributo color (AO assado). */
function revolve(path, { segments = 96, ao = null, vScale = 1, closed = false } = {}) {
  // perfil fechado (sino): repete o 1º ponto no fim, senão o último trecho (o furo central) fica sem parede
  if (closed) path = [...path, path[0]];
  const n = path.length, N = segments, cols = N + 1, cnt = n * cols;
  const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2), col = ao ? new Float32Array(cnt * 3) : null;
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  for (let i = 0; i < n; i++) {
    const p = path[i], a = ao ? ao(p) : 1;
    for (let j = 0; j <= N; j++) {
      const th = (j / N) * TAU, sn = Math.sin(th), cs = Math.cos(th), k = i * cols + j;
      pos[k * 3] = p.y; pos[k * 3 + 1] = p.x * sn; pos[k * 3 + 2] = -p.x * cs;
      nor[k * 3] = p.ny; nor[k * 3 + 1] = p.nx * sn; nor[k * 3 + 2] = -p.nx * cs;
      uv[k * 2] = j / N; uv[k * 2 + 1] = arc[i] * vScale;
      if (col) { col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = a; }
    }
  }
  // (i,j) (i,j+1) (i+1,j+1): com o perfil anti-horário a face olha para fora (conferido no topo, theta 90°)
  const idx = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < N; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols + 1, d = a + cols;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Parede extrudada de um contorno fechado (sem tampas: as tampas das aletas ficam enterradas nos pratos).
    pts no plano do disco (x = r cos th, y = r sin th), anti-horário; extrude em X de x0 a x1.
    Normais suavizadas pelo contorno, UV em metros (u = comprimento do contorno, v = X). */
function wallGeometry(pts, x0, x1, steps, aoFn) {
  const M = pts.length, cols = M + 1, rows = steps + 1;
  const en = [];
  for (let i = 0; i < M; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % M], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    en.push([dy / l, -dx / l]);
  }
  const vn = pts.map((_, i) => { const a = en[(i - 1 + M) % M], b = en[i], x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; });
  const s = [0];
  for (let i = 1; i <= M; i++) s.push(s[i - 1] + Math.hypot(pts[i % M][0] - pts[i - 1][0], pts[i % M][1] - pts[i - 1][1]));
  const pos = new Float32Array(cols * rows * 3), nor = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2), col = new Float32Array(cols * rows * 3);
  for (let st = 0; st < rows; st++) {
    const x = x0 + ((x1 - x0) * st) / steps;
    for (let i = 0; i < cols; i++) {
      const [px, py] = pts[i % M], [nx, ny] = vn[i % M], v = st * cols + i;
      // plano do disco -> mundo: (px, py, w) -> (w, py, -px), a mesma rotação Y +90° do resto do disco
      pos[v * 3] = x; pos[v * 3 + 1] = py; pos[v * 3 + 2] = -px;
      nor[v * 3] = 0; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = -nx;
      uv[v * 2] = s[i]; uv[v * 2 + 1] = x - x0;
      const a = aoFn(x, py, -px); col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = a;
    }
  }
  const idx = [];
  for (let st = 0; st < steps; st++) for (let i = 0; i < M; i++) {
    const A = st * cols + i, B = A + 1, C = A + cols + 1, Dd = A + cols;
    idx.push(A, B, C, A, C, Dd);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Anel plano olhando para +X com UV polar: u = -i/segs (cresce no sentido horário visto de +X, assim o texto
    lê da esquerda para a direita no topo e o topo das letras aponta para fora), v = 0 dentro, 1 fora. */
function polarRing(r0, r1, segs, rings, x) {
  const cols = segs + 1, cnt = cols * (rings + 1);
  const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2);
  for (let j = 0; j <= rings; j++) {
    const r = r0 + ((r1 - r0) * j) / rings;
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * TAU, k = j * cols + i;
      pos[k * 3] = x; pos[k * 3 + 1] = r * Math.sin(th); pos[k * 3 + 2] = -r * Math.cos(th);
      nor[k * 3] = 1;
      uv[k * 2] = -i / segs; uv[k * 2 + 1] = j / rings;
    }
  }
  const idx = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols + 1, d = a + cols;
    idx.push(a, c, b, a, d, c); // frente em +X (theta cresce de -Z para +Y: e_theta x e_r = -X, por isso invertido)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/* ---------------- pratos de atrito ---------------- */
function drilledHoles() {
  const H = RT.holes, out = [];
  H.rows.forEach((r, j) => {
    for (let i = 0; i < H.perRow; i++) out.push([r, HOLE_PHASE + (i / H.perRow) * TAU + j * H.rowOffsetDeg * D]);
  });
  return out;
}

/** Borda interna do prato externo: círculo r 0.12 com 12 orelhas de arraste (ponta r 0.1015, flancos em smoothstep,
    então os quatro cantos de cada orelha já saem arredondados). Amostragem densa só nos flancos. */
function lugContour() {
  const n = RT.bobbins, half = Math.PI / n, wA = LUG_HALF / R_BOB, tA = LUG_EASE / R_BOB;
  const lin = (a, b, k) => Array.from({ length: k }, (_, i) => a + ((b - a) * i) / k); // sem o último
  const halfPts = [...lin(0, wA, 3), ...lin(wA, wA + tA, 6), ...lin(wA + tA, half, 3)];
  const seq = [-half, ...halfPts.slice(1).map((v) => -v).reverse(), ...halfPts];
  const pts = [];
  for (let k = 0; k < n; k++) {
    const c = BOB_PHASE + (k / n) * TAU;
    for (const d of seq) {
      const L = 1 - sstep(wA, wA + tA, Math.abs(d)), r = RT.r - (RT.r - LUG_TIP) * L, a = c + d;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
  }
  return pts;
}

/** Recorta um grupo de um BufferGeometry não indexado (o Extrude: grupo 0 = tampas, 1 = paredes e chanfros). */
function groupSlice(g, gi) {
  const { start, count } = g.groups[gi], out = new THREE.BufferGeometry();
  for (const name of ["position", "uv"]) {
    const a = g.attributes[name], k = a.itemSize;
    out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * k, (start + count) * k), k));
  }
  return out;
}

/** Um prato: Extrude com chanfro de 0.6 mm. bevelOffset = -bevel deixa a parede EXATAMENTE no contorno
    (R 0.19, r 0.12, furo Ø7) e recua só as tampas, então as cotas da spec são as cotas da silhueta.
    Normais: tampas chapadas (±Z exato) e paredes+chanfros suavizados SEPARADOS. Fundir tudo junto inclinaria a
    normal da borda da tampa e o earcut (triângulos longos entre 36 furos) espalharia essa inclinação em
    manchas diagonais na pista, bem onde o softbox reflete. O primeiro anel do chanfro recebe a normal da tampa:
    chanfro redondo é tangente à face, então o reflexo entra no raio sem vinco. */
function plateGeometry(lugs, q) {
  const shape = new THREE.Shape(circlePts(RT.R, q.outerSeg)); // anti-horário: o Extrude acerta o sentido dos furos
  shape.holes.push(new THREE.Path(lugs ? lugContour() : circlePts(RT.r, q.innerSeg)));
  for (const [r, a] of drilledHoles()) shape.holes.push(new THREE.Path(circlePts(RT.holes.d / 2, q.holeSeg, Math.cos(a) * r, Math.sin(a) * r, a)));
  if (lugs) for (let k = 0; k < RT.bobbins; k++) {
    const a = BOB_PHASE + (k / RT.bobbins) * TAU;
    shape.holes.push(new THREE.Path(circlePts(LUG_HOLE, q.holeSeg + 4, Math.cos(a) * R_BOB, Math.sin(a) * R_BOB, a)));
  }
  const b = RT.plateBevel, depth = RT.plate - 2 * b;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, curveSegments: 1, bevelEnabled: true,
    bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: q.bevelSeg,
  });
  g.translate(0, 0, -depth / 2);                                   // espessura total 9.5 mm centrada em 0
  // UV planar 0..1 sobre o diâmetro 2R: convenção do torneado/rasgos/aniso em materials.js
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / (2 * RT.R) + 0.5; uv[i * 2 + 1] = p.getY(i) / (2 * RT.R) + 0.5; }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const zCap = depth / 2 + b;                                     // plano das tampas
  // tampas: normal por face (já sai ±Z exato), fundidas só para indexar
  const capsRaw = groupSlice(g, 0); capsRaw.computeVertexNormals();
  const caps = mergeVertices(capsRaw, 1e-7); capsRaw.dispose();
  // paredes e chanfros: lisos entre si
  const sidesRaw = groupSlice(g, 1);
  const sides = mergeVertices(sidesRaw, 1e-7); sidesRaw.dispose();
  sides.computeVertexNormals();
  const sp = sides.attributes.position, sn = sides.attributes.normal;
  for (let i = 0; i < sp.count; i++) {
    const z = sp.getZ(i);
    if (Math.abs(Math.abs(z) - zCap) < 1e-7) sn.setXYZ(i, 0, 0, Math.sign(z));
  }
  g.dispose();
  const m = mergeGeometries([caps, sides], false);
  caps.dispose(); sides.dispose();
  return m;
}

// AO dos pratos (função da posição, então vértices fundidos continuam iguais): faces que olham para o vão
// escurecem; a luz entra pela borda externa e pela garganta interna
function plateAO(x, y, z) {
  const r = Math.hypot(y, z), ax = Math.abs(x - XM);
  const inGap = 1 - sstep(HG, HG + 0.0012, ax);
  const light = Math.max(sstep(0.168, RT.R, r), 0.6 * (1 - sstep(RT.r, RT.r + 0.01, r)));
  return 1 - inGap * 0.68 * (1 - light);
}
function vaneAO(x, y, z) {
  const r = Math.hypot(y, z), ax = Math.abs(x - XM);
  const open = Math.max(sstep(0.165, RT.R, r), 0.7 * (1 - sstep(RT.r, RT.r + 0.012, r)));
  return Math.min(1, 0.34 + 0.6 * open) * (1 - 0.22 * sstep(0.0035, HG, ax)); // canto com o prato mais fechado
}
function paintAO(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const a = fn(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = a; }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

/* ---------------- aletas ---------------- */
/** Uma aleta (a de índice 0): faixa curva ao longo da espiral, 5 mm na entrada -> 6.5 mm na saída, pontas redondas
    (fundido). Vai de r 0.1205 a 0.1895 (0.5 mm para dentro das bordas da pista) e entra 1 mm em cada prato,
    então a junção não tem fresta nem face coplanar visível. */
function vaneGeometry(q) {
  const phi = (r) => VANE_PHI0 + VANE_K * (r - RT.holes.rows[0]);
  const r0 = RT.r + 0.0005, r1 = RT.R - 0.0005, tIn = 0.005, tOut = 0.0065;
  const th = (r) => tIn + (tOut - tIn) * clamp01((r - r0) / (r1 - r0));
  const ca = r0 + tIn / 2, cb = r1 - tOut / 2;                     // centro das pontas redondas
  const cen = (r) => { const a = phi(r); return [r * Math.cos(a), r * Math.sin(a)]; };
  const tan = (r) => {
    const a = phi(r), x = Math.cos(a) - r * VANE_K * Math.sin(a), y = Math.sin(a) + r * VANE_K * Math.cos(a), l = Math.hypot(x, y);
    return [x / l, y / l];
  };
  const pts = [], NS = q.vaneSide, NC = 5;
  // lado direito (-L) de dentro para fora: interior fica à esquerda -> contorno anti-horário
  for (let i = 0; i <= NS; i++) { const r = ca + ((cb - ca) * i) / NS, [cx, cy] = cen(r), [tx, ty] = tan(r), h = th(r) / 2; pts.push([cx + ty * h, cy - tx * h]); }
  { const [cx, cy] = cen(cb), [tx, ty] = tan(cb), h = th(cb) / 2, b = Math.atan2(ty, tx);
    for (let s = 1; s < NC; s++) { const a = b - Math.PI / 2 + (Math.PI * s) / NC; pts.push([cx + Math.cos(a) * h, cy + Math.sin(a) * h]); } }
  for (let i = NS; i >= 0; i--) { const r = ca + ((cb - ca) * i) / NS, [cx, cy] = cen(r), [tx, ty] = tan(r), h = th(r) / 2; pts.push([cx - ty * h, cy + tx * h]); }
  { const [cx, cy] = cen(ca), [tx, ty] = tan(ca), h = th(ca) / 2, b = Math.atan2(ty, tx);
    for (let s = 1; s < NC; s++) { const a = b + Math.PI / 2 + (Math.PI * s) / NC; pts.push([cx + Math.cos(a) * h, cy + Math.sin(a) * h]); } }
  return wallGeometry(pts, XM - HG - 0.001, XM + HG + 0.001, 2, vaneAO);
}

/* ---------------- sino (chapéu) ----------------
   Perfil (raio, x do mundo), anti-horário, com filete em todo canto. Furo central r 0.0365 (pino do cubo Ø72.6 + folga).
   Placa de montagem 7.2 mm; parede cônica de ~7.7 mm descendo até a aba que assenta nas orelhas do anel. */
const HAT_PROFILE = [
  [0.0365, -0.0075, 0.0008],  // c0 canto inferior do furo central
  [0.0830, -0.0075, 0.0040],  // c1 canto interno placa/parede (côncavo, cavidade)
  [0.0935, -0.0478, 0.0015],  // c2 pé interno da parede = borda de baixo da aba
  [0.1185, -0.0478, 0.0008],  // c3 aba: 0.2 mm acima das orelhas (x -0.048), 1.5 mm de folga radial até a pista
  [0.1185, -0.0418, 0.0008],  // c4 aba 6 mm
  [0.1005, -0.0418, 0.0030],  // c5 degrau aba/parede (côncavo): AO assado aqui
  [0.0890, -0.0003, 0.0070],  // c6 ombro externo, raio largo para o risco do softbox
  [0.0365, -0.0003, 0.0008],  // c7 face de montagem (0.3 mm atrás de x 0 para não brigar com cubo/roda)
];
function hatAO(p) {
  // cavidade (normal para dentro ou para o cubo) escura; degrau c5 com sombra de contato
  const facing = Math.max(-p.ny, -p.nx), cav = sstep(-0.1, 0.5, facing);
  const d5 = Math.hypot(p.x - 0.1005, p.y + 0.0418);
  return (1 - 0.6 * cav) * (0.55 + 0.45 * sstep(0, 0.007, d5));
}

/* ---------------- bobbin flutuante ----------------
   Carretel de aço: flange de baixo Ø13.6 sob a orelha, haste Ø10 atravessando orelha e aba, cabeça Ø16.4 sobre a aba.
   y relativo à face de fora das orelhas (x -0.048). */
const BOBBIN_PROFILE = [
  [0, -0.0130, 0],
  [0.0068, -0.0130, 0.0007],
  [0.0068, -0.0102, 0.0005],
  [0.0050, -0.0102, 0.0004],  // topo da flange 0.7 mm abaixo da orelha
  [0.0050, 0.0064, 0.0004],   // haste até a cabeça
  [0.0082, 0.0064, 0.0005],   // cabeça 0.2 mm acima da aba do sino (x -0.0416)
  [0.0082, 0.0080, 0.0010],
  [0.0050, 0.0094, 0.0012],   // chanfro 30° da cabeça
  [0, 0.0094, 0],
];
function bobbinGeo(seg, fil = 0.6) { return revolve(filletPath(BOBBIN_PROFILE, { closed: false, seg: fil }), { segments: seg }); }
/** Bobbin isolado, centrado na origem, eixo +X (para os destroços de hardware.js reaproveitarem o mesmo desenho). */
export function rotorBobbinGeometry(seg = 16) { const g = bobbinGeo(seg); g.translate(-(BOBBIN_PROFILE[0][1] + BOBBIN_PROFILE[8][1]) / 2, 0, 0); return g; }

/* ---------------- shaders da legenda e do brilho ----------------
   Mesma leitura do calor que materials.js (u = theta/2pi no referencial do disco, v = (r - 0.12)/0.07, T = r * 1100). */
const HEAT_GLSL = /* glsl */ `
uniform sampler2D uHeat; uniform vec2 uHeatR; uniform vec3 uHeatC1, uHeatC2, uHeatC3; uniform float uHeatScale;
varying vec3 vRotorPos;
float rotorHeatAt(float th, float v) { return texture2D(uHeat, vec2(fract(th / 6.28318530718), v)).r * uHeatScale; }
vec3 rotorHeatRamp(float T) {
  vec3 c = mix(vec3(0.0), uHeatC1, smoothstep(480.0, 550.0, T));
  c = mix(c, uHeatC2, smoothstep(550.0, 700.0, T));
  return mix(c, uHeatC3, smoothstep(700.0, 900.0, T));
}`;

function heatUniforms(mats) {
  if (mats && mats.uniforms && mats.uniforms.heat) return mats.uniforms.heat;
  // sem o MaterialSet da fundação: uniforms locais frios, só para não quebrar
  const G = LAYOUT.heatGrid, t = new THREE.DataTexture(new Uint8Array(G.nA * G.nR), G.nA, G.nR, THREE.RedFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return {
    uHeat: { value: t }, uHeatR: { value: new THREE.Vector2(G.rInner, G.rOuter) },
    uHeatC1: { value: new THREE.Color("#3a0000") }, uHeatC2: { value: new THREE.Color("#b81d08") }, uHeatC3: { value: new THREE.Color("#ff7a1a") },
    uHeatScale: { value: G.tMaxStored }, uMaxT: { value: 25 },
  };
}
/** decl: declarações GLSL dos uniforms de `extra` (o chunk entra dentro do main, lá não pode declarar). */
function patchBasic(m, key, H, extra, anchor, chunk, decl = "") {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, H, extra); // mesmos objetos de uniform: setHeatTexture da fundação chega aqui sozinho
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRotorPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRotorPos = position;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\n" + HEAT_GLSL + "\n" + decl)
      .replace(anchor, anchor + "\n" + chunk);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/* ---------------- a peça ---------------- */
export function buildRotor(ctx) {
  const { mats, tex } = ctx;
  const tier = ctx.tier || mats.tier || "base";
  const q = Q[tier] || Q.base;
  if (ctx.heatTex && mats.setHeatTexture && mats.heatTex !== ctx.heatTex) mats.setHeatTexture(ctx.heatTex);
  const H = heatUniforms(mats);
  const ownGeo = [], ownMat = [];
  const keep = (g) => { ownGeo.push(g); return g; };

  const root = new THREE.Group(); root.name = "rotor";
  const spin = new THREE.Group(); spin.name = "rotor.spin"; root.add(spin); // gira em torno de +X: spin.rotation.x = ângulo

  /* pratos: Extrude no plano XY, giro Y +90° leva o eixo Z do extrude para +X e o ângulo do plano vira theta */
  const orient = (g, xc) => { g.rotateY(Math.PI / 2); g.translate(xc, 0, 0); return paintAO(g, plateAO); };
  const pOut = orient(plateGeometry(true, q), X_PLATE_OUT);
  const pIn = orient(plateGeometry(false, q), X_PLATE_IN);
  const platesGeo = mergeGeometries([pOut, pIn], false);
  pOut.dispose(); pIn.dispose();
  if (!platesGeo) throw new Error("rotor: mergeGeometries dos pratos falhou");
  platesGeo.computeBoundingBox(); platesGeo.computeBoundingSphere();
  // estúdio escuro: ferro de frente reflete a parede preta. Sobe o reflexo do ambiente (só este material é do disco)
  const ironMat = mats.ao("iron"); ironMat.envMapIntensity = 2.0;
  const plates = new THREE.Mesh(keep(platesGeo), ironMat);
  plates.name = "rotor.plates";
  spin.add(plates);

  /* aletas: 48 instâncias girando em X (o shader de calor usa instanceMatrix, então o theta continua certo) */
  const castMat = mats.ao("ironCast"); castMat.envMapIntensity = 1.8;
  const vanes = new THREE.InstancedMesh(keep(vaneGeometry(q)), castMat, RT.vanes);
  vanes.name = "rotor.vanes";
  const m4 = new THREE.Matrix4();
  for (let k = 0; k < RT.vanes; k++) vanes.setMatrixAt(k, m4.makeRotationX((k / RT.vanes) * TAU));
  vanes.instanceMatrix.needsUpdate = true;
  vanes.computeBoundingBox(); vanes.computeBoundingSphere();
  spin.add(vanes);

  /* sino + bobbins: sobem juntos em setHatLift (os bobbins prendem a aba, então saem com ela e mostram a haste e as orelhas) */
  const hat = new THREE.Group(); hat.name = "rotor.hat"; spin.add(hat);
  // anodizado preto: #141414 puro some no estúdio preto (vira buraco). Cinza muito escuro + reflexo do ambiente mais alto
  // faz o sino ler como peça preta com brilho, não como vazio. Clone próprio: o anodBlack é dividido com o coilover.
  const hatMat = mats.ao("anodBlack").clone(); hatMat.color.set("#2c2d30"); hatMat.roughness = 0.3; hatMat.envMapIntensity = 2.4; hatMat.name = "v3.rotor.hat";
  hatMat.roughnessMap = null;                       // o fbm em UV polar esticava em rachaduras radiais na placa; anodizado é acetinado liso
  ownMat.push(hatMat);
  const hatMesh = new THREE.Mesh(keep(revolve(filletPath(HAT_PROFILE, { seg: q.hatFil }), { segments: q.hatSeg, ao: hatAO, vScale: 1 / (TAU * 0.1), closed: true })), hatMat);
  hatMesh.name = "rotor.hatShell";
  hat.add(hatMesh);

  const bobMat = mats.chrome.clone(); // aço inox jateado leve, não espelho
  bobMat.color.set("#c4c7cb"); bobMat.roughness = 0.26; bobMat.name = "v3.rotor.bobbin";
  ownMat.push(bobMat);
  const bobGeo = keep(bobbinGeo(q.bobSeg, q.bobFil)); bobGeo.translate(X_FACE_OUT, 0, 0); bobGeo.computeBoundingBox(); bobGeo.computeBoundingSphere();
  const bobbins = new THREE.InstancedMesh(bobGeo, bobMat, RT.bobbins);
  bobbins.name = "rotor.bobbins";
  for (let k = 0; k < RT.bobbins; k++) {
    const a = BOB_PHASE + (k / RT.bobbins) * TAU;
    bobbins.setMatrixAt(k, m4.makeTranslation(0, R_BOB * Math.sin(a), -R_BOB * Math.cos(a)));
  }
  bobbins.instanceMatrix.needsUpdate = true;
  bobbins.computeBoundingBox(); bobbins.computeBoundingSphere();
  hat.add(bobbins);

  /* anel de legenda (B3): 0.5 mm à frente do plano da pista, fora do diâmetro do disco. Dentro da pinça ele some
     atrás do corpo dela (fica dentro da ponte), o que lê como o texto passando por baixo da pinça. */
  const LR = LAYOUT.labelRing;
  const labelMat = new THREE.MeshBasicMaterial({ map: tex.ringLabelTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  labelMat.name = "v3.rotor.label";
  patchBasic(labelMat, "v3rotorLabel", H, {}, "#include <map_fragment>", /* glsl */ `{
    float th = atan(vRotorPos.y, -vRotorPos.z);
    float T = max(rotorHeatAt(th, 0.9), rotorHeatAt(th, 0.6));
    T = max(T, 0.85 * max(rotorHeatAt(th - 0.07, 0.8), rotorHeatAt(th + 0.07, 0.8)));
    float k = smoothstep(220.0, 760.0, T);
    diffuseColor.rgb = mix(diffuseColor.rgb, uHeatC3 * 1.6, 0.55 * k) * (1.0 + 1.4 * k);
  }`);
  ownMat.push(labelMat);
  const label = new THREE.Mesh(keep(polarRing(LR.inner, LR.outer, 256, 1, X_FACE_OUT + 0.0005)), labelMat);
  label.name = "rotor.label"; label.visible = false; label.renderOrder = 3;
  spin.add(label);

  /* brilho aditivo (bloom falso): lê o calor com 5 amostras em ângulo (borrão) e vaza ~16 mm além da pista.
     Fica 1.2 mm à frente da face; o que estiver na frente (pinça, aba do sino) tampa pelo depth test. */
  const glowU = { uGlow: { value: 0.28 }, uGlowR: { value: 0.016 } };
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  glowMat.name = "v3.rotor.glow";
  patchBasic(glowMat, "v3rotorGlow", H, glowU, "#include <color_fragment>", /* glsl */ `{
    float r = length(vRotorPos.yz);
    float th = atan(vRotorPos.y, -vRotorPos.z);
    float v = clamp((r - uHeatR.x) / (uHeatR.y - uHeatR.x), 0.08, 0.92);
    float T = rotorHeatAt(th, v) * 0.32
            + (rotorHeatAt(th - 0.06, v) + rotorHeatAt(th + 0.06, v)) * 0.22
            + (rotorHeatAt(th - 0.13, v) + rotorHeatAt(th + 0.13, v)) * 0.12;
    float d = max(max(uHeatR.x - r, r - uHeatR.y), 0.0);
    float w = exp(-d * d / (uGlowR * uGlowR));
    vec3 g = rotorHeatRamp(T) * smoothstep(480.0, 950.0, T) * 3.0;
    diffuseColor = vec4(g * w * uGlow, 1.0);
  }`, "uniform float uGlow;\nuniform float uGlowR;");
  ownMat.push(glowMat);
  const glow = new THREE.Mesh(keep(polarRing(0.112, 0.24, 128, 6, X_FACE_OUT + 0.0012)), glowMat);
  glow.name = "rotor.glow"; glow.visible = false; glow.renderOrder = 2;
  spin.add(glow);

  // o brilho só existe acima do limiar de cor; decide no quadro anterior (pratos sempre visíveis), custo zero frio
  const GLOW_ON = 470;
  let forceGlow = false;
  plates.onBeforeRender = () => { const on = forceGlow || H.uMaxT.value > GLOW_ON; if (glow.visible !== on) glow.visible = on; };

  /* ---- âncoras (coordenadas locais da raiz = mundo, raiz na origem) ---- */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const anchors = {
    hub: V(0, 0, 0),
    center: V(XM, 0, 0),                          // plano médio da pista
    faceOut: V(X_FACE_OUT, 0, 0),
    faceIn: V(X_FACE_IN, 0, 0),
    hatFace: V(-0.0003, 0, 0),                    // face de montagem do sino (cubo atrás, roda/espaçador na frente)
    hatFlange: V(-0.0418, 0, 0),
    rimTop: V(XM, RT.R, 0),                       // borda no topo (theta 90°) com o giro em 0
    caliper: V(...LAYOUT.caliper.center),         // centro do setor da pastilha (theta 60°)
    label: V(X_FACE_OUT + 0.0005, 0, 0),
    orbitLabel: V(X_FACE_OUT, RT.R + 0.03, 0),    // onde a fita da órbita pode encostar "Big brake kit upgrades"
  };

  let debugOmega = 0, debugTex = null;

  const part = {
    root, anchors, spin, hat, plates, vanes, bobbins, label, glow,
    explodeAxis: new THREE.Vector3(1, 0, 0),      // sai pelo lado de fora, depois da roda
    explodeDist: 0.16,

    /** Sobe o sino (+X) com os bobbins. B3 explode: 0.03. */
    setHatLift(m) { hat.position.x = m; },
    /** 0..1 mostra o anel de legenda (B3). */
    setLabel(v) { labelMat.opacity = v; label.visible = v > 0.002; },
    /** Ângulo da roda (o assembly pode girar part.spin direto). */
    setAngle(a) { spin.rotation.x = a; },
    /** Força do bloom falso (0 desliga). */
    setGlow(k) { glowU.uGlow.value = k; },
    /** Opcional por quadro; a visibilidade do brilho já se resolve sozinha no onBeforeRender dos pratos. */
    update(dt = 0) { if (debugOmega) spin.rotation.x += debugOmega * dt; },

    /* ---- só para a bancada (lab/v3.html?p=rotor&call=debugHeat:820&call=debugSpin:1.5&call=setLabel:1) ---- */
    /** Rastro quente saindo da pastilha (theta 60° no mundo). Mexe no estado compartilhado do MaterialSet. */
    debugHeat(T = 820) {
      const G = LAYOUT.heatGrid;
      if (!debugTex) { debugTex = new THREE.DataTexture(new Uint8Array(G.nA * G.nR), G.nA, G.nR, THREE.RedFormat, THREE.UnsignedByteType); }
      const d = debugTex.image.data, pad = LAYOUT.caliper.angle - spin.rotation.x;
      for (let r = 0; r < G.nR; r++) for (let a = 0; a < G.nA; a++) {
        let dt = ((a + 0.5) / G.nA) * TAU - pad;
        dt = ((((dt + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
        const w = Math.exp(-Math.pow((dt - 0.35) / 0.75, 2));                 // mais quente na saída da pastilha (+theta)
        const rv = (r + 0.5) / G.nR, rad = 0.55 + 0.45 * Math.sin(Math.PI * clamp01((rv - 0.08) / 0.9));
        d[r * G.nA + a] = Math.min(255, Math.round(((25 + (T - 25) * w * rad) / G.tMaxStored) * 255));
      }
      debugTex.needsUpdate = true;
      if (mats.setHeatTexture) mats.setHeatTexture(debugTex); else H.uHeat.value = debugTex;
      if (mats.setHeatUniforms) mats.setHeatUniforms(T); else H.uMaxT.value = T;
      forceGlow = T > GLOW_ON;
    },
    debugSpin(omega = 1) { debugOmega = omega; },

    dispose() {
      for (const g of ownGeo) g.dispose();
      for (const m of ownMat) m.dispose();
      if (debugTex) debugTex.dispose();
      plates.onBeforeRender = () => {};
      root.removeFromParent();
    },
  };
  return part;
}
