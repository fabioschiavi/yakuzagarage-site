/* v3 · COILOVER (spec §2 COILOVER, §4d, §5 B4).
   Corpo rosqueado de titânio, 2 contraporcas + prato inferior (anodizado preto, o mesmo do chapéu do disco),
   haste cromada, chapéu superior (assento da mola) e placa de cambagem com pillowball.
   MOLA: tubo sobre hélice unitária, a forma inteira sai do shader de vértice a partir de uL (pontas fechadas e
   retificadas, espira encostada em 9d). FOLE DE AR: 2 convoluções, raio e normal também no shader.

   Referencial: tudo é desenhado num grupo "axis" cujo +Y local É o eixo do amortecedor, com origem no ponto
   lowerPerch da spec (-0.15, 0.30, 0). O grupo é girado em Z pela inclinação real entre lowerPerch e topMount
   (atan(0.09/0.48) = 10.6°; a spec diz "cerca de 8°", os dois pontos mandam). root fica na origem do mundo,
   então anchors saem direto nas coordenadas compartilhadas.

   Massas (§4d): root inteiro vai no grupo NÃO suspenso (corpo, prato e contraporcas são unsprung).
   setLength(L) sobe part.upper (haste, chapéu, placa) por L - L_rest ao longo do eixo; como L - L_rest = ys - yu,
   a placa anda com ys no mundo (erro de cos 10.6° = 1.7%, invisível). Se a montagem preferir pendurar part.upper
   no grupo suspenso, ponha part.upperFollowsLength = false antes do primeiro setLength.

   Estações ao longo do eixo (s, metros a partir de lowerPerch; y do mundo = 0.30 + 0.983 s):
     corpo        s -0.020 .. 0.240  (260 mm; a ponta de baixo entra 3 cm no ombro interno do pneu, escondida.
                                      Com o centro da mola onde a câmera do B4 olha, não cabe 260 mm acima do pneu)
     contraporca de baixo  0.055 .. 0.065   (trava da altura; y 0.354, 2.4 cm acima do topo do pneu)
     contraporca de cima   0.1405 .. 0.1505 (a que "desrosca 2 voltas" no B4)
     prato        0.1505 .. 0.1625 + ressalto de centragem de 5 mm
     mola         0.1625 .. 0.3089 em repouso (centro y 0.532 ~ alvo 0.52 da câmera do B4)
     chapéu       base em 0.3089; erguido 0.14 o topo fica 13 mm abaixo da placa
     placa        centro em 0.4884 = topMount (-0.24, 0.78, 0)
   Espira encostada (L 0.099): base do chapéu em 0.2615, ressalto em 0.2555, tampa do retentor em 0.2525. Folga 3 mm.
     batente      0.2525 .. 0.2685 (16 mm livres; o ressalto do chapéu encosta nele em L 0.112, onde o sim liga Fb)

   Orçamento (tier base, modo mola): 9 draws, ~48k triângulos, dos quais 15.4k são a mola (640 x 12 da spec).
   O fole (4.9k) e os anéis de cinta (3.8k) só desenham no modo ar, e aí a mola some. */
import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { LAYOUT } from "../spec.js";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const CO = LAYOUT.coilover, SPR = LAYOUT.spring, BAG = LAYOUT.airBag;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const glf = (x) => { const s = (+x).toFixed(8); return s.indexOf(".") < 0 ? s + ".0" : s; };
// 50°: chanfros de 2 ou 3 segmentos (45° / 30°) e filetes de 2 segmentos sombreiam lisos; só quina de 90° fica viva
// (e não há nenhuma: toda extrusão aqui tem chanfro)
const CREASE = 50 * DEG;

/* ---------------- eixo ---------------- */
const P0 = CO.lowerPerch, P1 = CO.topMount;
const AXIS_LEN = Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]); // 0.4884 m
const LEAN = Math.atan2(P0[0] - P1[0], P1[1] - P0[1]);                  // 0.1855 rad: +Y local -> (-0.184, 0.983, 0)
const AX = [-Math.sin(LEAN), Math.cos(LEAN), 0];

/* ---------------- dimensões que a spec não dá (escolhidas de coilover real, comentadas) ---------------- */
const BODY = { r: CO.body.r, len: CO.body.length, bot: -0.020 };          // r 23 mm, 260 mm (spec)
BODY.top = BODY.bot + BODY.len;                                             // 0.240
const SHAFT_R = 0.011;                                                      // haste de 22 mm, típica
const COLLAR = { rIn: 0.0232, rOut: 0.033, h: 0.010, notchW: 0.005, notchD: 0.0035, bevel: 0.0007, fillet: 0.001 };
const PERCH = { rIn: 0.0232, rOut: 0.047, h: 0.012, notchW: 0.006, notchD: 0.004, bevel: 0.0008, fillet: 0.0012 };
const ST = {
  collarLowBot: 0.055,
  perchTop: 0.1625,
};
ST.perchBot = ST.perchTop - PERCH.h;                 // 0.1505
ST.collarTopBot = ST.perchBot - COLLAR.h;            // 0.1405
ST.springTopRest = ST.perchTop + SPR.Lrest;          // 0.3089
ST.topMount = AXIS_LEN;                              // 0.4884
ST.shaftBot = 0.130;                                 // dentro do corpo até com +60 mm de extensão
const PLATE = { h: 0.008, bevel: 0.0012, studR: 0.056, lobeR: 0.017, studHoleR: 0.0055 };

/* ---------------- mola: constantes do shader (spec §2 SPRING) ----------------
   h(t), t em voltas 0..8: passo d nas 0.75 voltas fechadas de cada ponta e p = (uL - 2.5d)/6.5 nas 6.5 ativas.
   A troca de passo é uma rampa smoothstep de ±W voltas com a integral preservada (comprimento exato, sem dobra).
   Retífica: a ponta da espira fechada desce G abaixo do plano (parábola até TG voltas) e o shader corta em y 0 / uL;
   isso só afasta a ponta da espira vizinha, então o sólido continua 9d = 99 mm com as espiras encostando. */
const SP = {
  R: SPR.R, D: SPR.d, ACT: SPR.activeCoils, TC: SPR.closedTurnsPerEnd,
  NT: SPR.activeCoils + 2 * SPR.closedTurnsPerEnd,   // 8 voltas
  SOLID: SPR.solid, LMAX: 0.32,
  W: 0.12,                                           // meia largura da rampa de passo (voltas)
  G: 0.85 * SPR.d,                                   // ponta retificada: sobra 0.15 d de arame na ponta
  TG: 0.9,                                           // até onde a retífica alcança (voltas): plano de ~105°
};
const spWin = (t, c) => smooth01((t - (c - SP.W)) / (2 * SP.W));
const spRamp = (t, c) => {
  const x = clamp((t - (c - SP.W)) / (2 * SP.W), 0, 1);
  return 2 * SP.W * (x * x * x - 0.5 * x * x * x * x) + Math.max(0, t - (c + SP.W));
};
/** Espelho em JS do shader da mola: mesma conta, para posição/normal na CPU (caixa, raycast, testes). */
export function springEval(th, ox, oy, cap, L, P, N) {
  const Lc = clamp(L, SP.SOLID, SP.LMAX), p = (Lc - 2.5 * SP.D) / SP.ACT, t = th / TAU, D = SP.D;
  const dB = Math.max(0, 1 - t / SP.TG), dT = Math.max(0, 1 - (SP.NT - t) / SP.TG);
  const h = 0.5 * D + D * t + (p - D) * (spRamp(t, SP.TC) - spRamp(t, SP.NT - SP.TC)) - SP.G * dB * dB + SP.G * dT * dT;
  const dh = D + (p - D) * (spWin(t, SP.TC) - spWin(t, SP.NT - SP.TC)) + (2 * SP.G / SP.TG) * (dB + dT);
  const c = Math.cos(th), s = Math.sin(th);
  let tx = -SP.R * s, ty = dh / TAU, tz = SP.R * c;
  const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
  const nx = -c, ny = 0, nz = -s;                                  // N = radial para dentro
  const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx; // B = T x N
  const ux = ox * nx + oy * bx, uy = ox * ny + oy * by, uz = ox * nz + oy * bz;
  P[0] = SP.R * c + ux; P[1] = h + uy; P[2] = SP.R * s + uz;
  if (cap !== 0) { N[0] = cap * tx; N[1] = cap * ty; N[2] = cap * tz; }
  else { const ul = Math.hypot(ux, uy, uz) || 1; N[0] = ux / ul; N[1] = uy / ul; N[2] = uz / ul; }
  if (P[1] < 0) { P[1] = 0; N[0] = 0; N[1] = -1; N[2] = 0; }
  if (P[1] > Lc) { P[1] = Lc; N[0] = 0; N[1] = 1; N[2] = 0; }
}

const SPRING_GLSL_COMMON = `
uniform float uL;
attribute float aTheta;
attribute vec2 aOff;
attribute float aCap;
#define SP_R ${glf(SP.R)}
#define SP_D ${glf(SP.D)}
#define SP_ACT ${glf(SP.ACT)}
#define SP_TC ${glf(SP.TC)}
#define SP_NT ${glf(SP.NT)}
#define SP_SOLID ${glf(SP.SOLID)}
#define SP_LMAX ${glf(SP.LMAX)}
#define SP_W ${glf(SP.W)}
#define SP_G ${glf(SP.G)}
#define SP_TG ${glf(SP.TG)}
float spRamp(float t, float c) {
  float x = clamp((t - (c - SP_W)) / (2.0 * SP_W), 0.0, 1.0);
  return 2.0 * SP_W * (x * x * x - 0.5 * x * x * x * x) + max(0.0, t - (c + SP_W));
}
float spWin(float t, float c) { return smoothstep(c - SP_W, c + SP_W, t); }
`;
// substitui beginnormal_vertex: calcula posição e normal juntas; begin_vertex só usa spPos
const SPRING_GLSL_MAIN = `
  float spL = clamp(uL, SP_SOLID, SP_LMAX);
  float spP = (spL - 2.5 * SP_D) / SP_ACT;
  float spT = aTheta / 6.28318530718;
  float spDB = max(0.0, 1.0 - spT / SP_TG);
  float spDT = max(0.0, 1.0 - (SP_NT - spT) / SP_TG);
  float spH = 0.5 * SP_D + SP_D * spT + (spP - SP_D) * (spRamp(spT, SP_TC) - spRamp(spT, SP_NT - SP_TC))
            - SP_G * spDB * spDB + SP_G * spDT * spDT;
  float spDH = SP_D + (spP - SP_D) * (spWin(spT, SP_TC) - spWin(spT, SP_NT - SP_TC)) + (2.0 * SP_G / SP_TG) * (spDB + spDT);
  float spC = cos(aTheta), spS = sin(aTheta);
  vec3 spTan = normalize(vec3(-SP_R * spS, spDH / 6.28318530718, SP_R * spC));
  vec3 spN = vec3(-spC, 0.0, -spS);
  vec3 spB = cross(spTan, spN);
  vec3 spOff = aOff.x * spN + aOff.y * spB;
  vec3 spPos = vec3(SP_R * spC, spH, SP_R * spS) + spOff;
  vec3 spNrm = aCap != 0.0 ? aCap * spTan : normalize(spOff);
  // retífica: corta no plano do prato e no do chapéu, face plana com normal do plano
  if (spPos.y < 0.0) { spPos.y = 0.0; spNrm = vec3(0.0, -1.0, 0.0); }
  if (spPos.y > spL) { spPos.y = spL; spNrm = vec3(0.0, 1.0, 0.0); }
  vec3 objectNormal = spNrm;
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(tangent.xyz);
  #endif
`;

/* ---------------- fole: constantes ----------------
   r(v) = (0.058 + 0.014 sin²(pi NC v) * A) * S, v = y / L em 0..1, NC = 2 convoluções (a spec escreve sin²(pi y/h)
   com h = altura de UMA convolução). A = pressão (só a onda: anéis de cinta e pontas ficam no raio 0.058, como fole real).
   S = enchimento do toggle coil/ar: 0.42 cabe dentro da mola (bojo 30 mm < 31 mm do diâmetro interno), 1 engole a mola.
   Altura = uL (o mesmo vão prato-chapéu da mola): o sim já resolve L com a pressão. */
const BG = {
  R0: BAG.r0, AMP: BAG.amp, NC: BAG.convolutions,
  RIN_BOT: 0.0236,                // tampa de baixo abraça o corpo (r 23 mm)
  RIN_TOP: 0.0118,                // tampa de cima abraça a haste (r 11 mm)
  S0: 0.42, HIDE_SPRING: 0.75,    // S em que o fole (0.058 S) passa por fora da mola (0.042 + folga) e ela some
  OVER: BAG.overshoot,            // 6% de sobrepasso no raio
  RING_R: 0.0585, RING_TUBE: 0.0032,
};
const BAG_GLSL_COMMON = `
uniform float uBagL;
uniform float uInflate;
uniform float uPressure;
attribute float aV;
attribute float aKind;
attribute float aRf;
attribute float aAng;
#define BG_R0 ${glf(BG.R0)}
#define BG_AMP ${glf(BG.AMP)}
#define BG_NC ${glf(BG.NC)}
#define BG_RIN_BOT ${glf(BG.RIN_BOT)}
#define BG_RIN_TOP ${glf(BG.RIN_TOP)}
`;
const BAG_GLSL_MAIN = `
  float bgL = max(uBagL, 0.04);
  float bgW = sin(3.14159265359 * BG_NC * aV);
  float bgR = (BG_R0 + BG_AMP * uPressure * bgW * bgW) * uInflate;
  float bgDr = uInflate * BG_AMP * uPressure * 3.14159265359 * BG_NC * sin(6.28318530718 * BG_NC * aV) / bgL;
  float bgSa = sin(aAng), bgCa = cos(aAng);
  float bgRin = aKind < 0.0 ? BG_RIN_BOT : BG_RIN_TOP;
  float bgRr = aKind == 0.0 ? bgR : mix(bgRin, BG_R0 * uInflate, aRf);
  vec3 bgPos = vec3(bgRr * bgSa, aV * bgL, bgRr * bgCa);
  vec3 objectNormal = aKind == 0.0 ? normalize(vec3(bgSa, -bgDr, bgCa)) : vec3(0.0, aKind, 0.0);
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(tangent.xyz);
  #endif
`;
function bagEval(v, kind, rf, ang, L, S, A, P, N) {
  const w = Math.sin(Math.PI * BG.NC * v), r = (BG.R0 + BG.AMP * A * w * w) * S;
  const dr = S * BG.AMP * A * Math.PI * BG.NC * Math.sin(TAU * BG.NC * v) / Math.max(L, 0.04);
  const sa = Math.sin(ang), ca = Math.cos(ang);
  const rr = kind === 0 ? r : (kind < 0 ? BG.RIN_BOT : BG.RIN_TOP) + (BG.R0 * S - (kind < 0 ? BG.RIN_BOT : BG.RIN_TOP)) * rf;
  P[0] = rr * sa; P[1] = v * L; P[2] = rr * ca;
  if (kind === 0) { const l = Math.hypot(sa, dr, ca); N[0] = sa / l; N[1] = -dr / l; N[2] = ca / l; }
  else { N[0] = 0; N[1] = kind; N[2] = 0; }
}
/** Curva do toggle: enchimento com 6% de sobrepasso no raio já embutido em m (o toggle tweena m em 400 ms). */
function inflateOf(m) {
  const peak = 1 + BG.OVER / (1 - BG.S0);           // g máximo que dá raio 1.06
  const g = m < 0.78 ? peak * smooth01(m / 0.78) : peak - (peak - 1) * smooth01((m - 0.78) / 0.22);
  return BG.S0 + (1 - BG.S0) * g;
}

/* ---------------- utilidades de contorno 2D ---------------- */
/** Arredonda cantos de um polígono [[x,y]...]: nenhum canto vivo. Pula vértices quase colineares (arcos já amostrados). */
// step 0.45 rad: 4 segmentos num canto de 90° (bem abaixo do CREASE, sombreia liso)
function roundCorners(pts, rad, { closed = true, minDefl = 0.35, step = 0.45 } = {}) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const P = pts[i];
    if (!closed && (i === 0 || i === n - 1)) { out.push(P); continue; }
    const A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
    const r = typeof rad === "function" ? rad(i, P) : rad;
    let ax = A[0] - P[0], ay = A[1] - P[1], bx = B[0] - P[0], by = B[1] - P[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!(r > 0) || la < 1e-9 || lb < 1e-9) { out.push(P); continue; }
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const ang = Math.acos(clamp(ax * bx + ay * by, -1, 1));
    if (Math.PI - ang < minDefl) { out.push(P); continue; }
    let t = r / Math.tan(ang / 2), rr = r;
    const tMax = 0.45 * Math.min(la, lb);
    if (t > tMax) { t = tMax; rr = t * Math.tan(ang / 2); }
    let sx = ax + bx, sy = ay + by; const sl = Math.hypot(sx, sy); sx /= sl; sy /= sl;
    const dc = rr / Math.sin(ang / 2), cx = P[0] + sx * dc, cy = P[1] + sy * dc;
    const a1 = Math.atan2(P[1] + ay * t - cy, P[0] + ax * t - cx);
    let sw = Math.atan2(P[1] + by * t - cy, P[0] + bx * t - cx) - a1;
    while (sw > Math.PI) sw -= TAU; while (sw < -Math.PI) sw += TAU;
    const m = Math.max(2, Math.ceil(Math.abs(sw) / step));
    for (let k = 0; k <= m; k++) { const a = a1 + (sw * k) / m; out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
  }
  return out;
}
const circlePts = (r, n, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * TAU) * r, cy + Math.sin((i / n) * TAU) * r]);
/** Contorno externo com n rasgos de chave de gancho (paredes paralelas, largura w, profundidade d). */
function notchedOutline(rOut, n, w, d, arcStep = 0.13) {   // flecha de 0.1 mm em r 47: silhueta redonda
  const pts = [], hw = w / 2, rIn = rOut - d, aOut = Math.asin(hw / rOut);
  for (let k = 0; k < n; k++) {
    const c = (k / n) * TAU, c2 = ((k + 1) / n) * TAU;
    const a0 = c + aOut, a1 = c2 - aOut, m = Math.max(2, Math.ceil((a1 - a0) / arcStep));
    for (let i = 0; i <= m; i++) { const a = a0 + ((a1 - a0) * i) / m; pts.push([Math.cos(a) * rOut, Math.sin(a) * rOut]); }
    const ex = Math.cos(c2), ey = Math.sin(c2), fx = -ey, fy = ex;
    pts.push([ex * rIn - fx * hw, ey * rIn - fy * hw], [ex * rIn + fx * hw, ey * rIn + fy * hw]);
  }
  return pts;
}
/** Extrusão plana em Y (base y 0, topo y h), chanfro redondo de 3 segmentos que não muda as medidas nominais. */
function extrudeY(outline, holes, h, bevel, segs = 3) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hp of holes) shape.holes.push(new THREE.Path(hp.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel,
    bevelSegments: segs, curveSegments: 1, steps: 1,
  });
  g.rotateX(-Math.PI / 2); g.translate(0, bevel, 0);   // Z da extrusão vira +Y; forma (x, y) cai em (x, -z)
  return toCreasedNormals(g, CREASE);
}
/** Torno com UV em metros (u = arco na volta de raio rRef, v = comprimento do perfil): grão do mesmo tamanho em toda peça. */
function latheM(profile, segments, rRef = null) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), segments);
  const np = profile.length, uv = g.attributes.uv, acc = [0];
  for (let j = 1; j < np; j++) acc[j] = acc[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]);
  const rr = rRef || Math.max(...profile.map((p) => p[0]));
  for (let i = 0; i <= segments; i++) for (let j = 0; j < np; j++) uv.setXY(i * np + j, (i / segments) * TAU * rr, acc[j]);
  return g;
}
/** Perfil fechado (anti-horário em r,y: normal para fora) começando no meio de uma face escondida; fecha repetindo o 1º ponto. */
// step 0.7: 3 segmentos por canto de 90°; no torno a normal sai da média do perfil, então 3 já leem como filete
function closedProfile(pts, rad, step = 0.7) {
  const r = roundCorners(pts, rad, { closed: true, step });
  r.push(r[0].slice());
  return r;
}
const flat = (g) => (g.index ? g.toNonIndexed() : g);

/* ---------------- geometrias ---------------- */
function springGeometry(K, M) {
  const rw = SP.D / 2, nTube = (K + 1) * (M + 1), nCap = M + 2, total = nTube + 2 * nCap;
  const aTheta = new Float32Array(total), aOff = new Float32Array(total * 2), aCap = new Float32Array(total);
  const uv = new Float32Array(total * 2), pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3);
  const thMax = SP.NT * TAU, idx = [];
  let v = 0;
  for (let k = 0; k <= K; k++) {
    const th = (k / K) * thMax;
    for (let m = 0; m <= M; m++, v++) {
      const ph = (m / M) * TAU;
      aTheta[v] = th; aOff[v * 2] = Math.cos(ph) * rw; aOff[v * 2 + 1] = Math.sin(ph) * rw;
      uv[v * 2] = th * SP.R; uv[v * 2 + 1] = ph * rw;            // metros: grão da pintura isotrópico
    }
  }
  for (let k = 0; k < K; k++) for (let m = 0; m < M; m++) {
    const a = k * (M + 1) + m, b = (k + 1) * (M + 1) + m, c = b + 1, d = a + 1;
    idx.push(a, d, b, b, d, c);
  }
  // tampas: a ponta retificada fecha o tubo (senão sobra uma fresta escura de 1.6 mm na ponta)
  for (const [cap, th] of [[-1, 0], [1, thMax]]) {
    const ring = v;
    for (let m = 0; m <= M; m++, v++) {
      const ph = (m / M) * TAU;
      aTheta[v] = th; aOff[v * 2] = Math.cos(ph) * rw; aOff[v * 2 + 1] = Math.sin(ph) * rw; aCap[v] = cap;
      uv[v * 2] = th * SP.R + Math.cos(ph) * rw; uv[v * 2 + 1] = Math.sin(ph) * rw;
    }
    const ctr = v; aTheta[v] = th; aCap[v] = cap; uv[v * 2] = th * SP.R; v++;
    for (let m = 0; m < M; m++) cap < 0 ? idx.push(ctr, ring + m + 1, ring + m) : idx.push(ctr, ring + m, ring + m + 1);
  }
  const P = [0, 0, 0], N = [0, 0, 0];
  for (let i = 0; i < total; i++) {
    springEval(aTheta[i], aOff[i * 2], aOff[i * 2 + 1], aCap[i], SPR.Lrest, P, N);
    pos.set(P, i * 3); nrm.set(N, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aTheta", new THREE.BufferAttribute(aTheta, 1));
  g.setAttribute("aOff", new THREE.BufferAttribute(aOff, 2));
  g.setAttribute("aCap", new THREE.BufferAttribute(aCap, 1));
  g.setIndex(idx);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-SP.R - rw, 0, -SP.R - rw), new THREE.Vector3(SP.R + rw, SPR.Lrest, SP.R + rw));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SPR.Lrest / 2, 0), Math.hypot(SP.R + rw, SPR.Lrest / 2));
  return g;
}

function bagGeometry(seg, wallRows) {
  // linhas do perfil em ordem anti-horária (r, y): tampa de baixo de dentro p/ fora, parede subindo, tampa de cima p/ dentro
  const rows = [];
  for (const rf of [0, 0.5, 1]) rows.push([-1, 0, rf]);
  for (let j = 0; j <= wallRows; j++) rows.push([0, j / wallRows, 1]);
  for (const rf of [1, 0.5, 0]) rows.push([1, 1, rf]);
  const NR = rows.length, total = (seg + 1) * NR;
  const aV = new Float32Array(total), aKind = new Float32Array(total), aRf = new Float32Array(total), aAng = new Float32Array(total);
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const P = [0, 0, 0], N = [0, 0, 0], idx = [];
  for (let i = 0; i <= seg; i++) {
    const ang = (i / seg) * TAU;
    for (let j = 0; j < NR; j++) {
      const k = i * NR + j, [kind, v, rf] = rows[j];
      aV[k] = v; aKind[k] = kind; aRf[k] = rf; aAng[k] = ang;
      bagEval(v, kind, rf, ang, SPR.Lrest, 1, 1, P, N);
      pos.set(P, k * 3); nrm.set(N, k * 3);
      uv[k * 2] = ang * BG.R0;
      uv[k * 2 + 1] = kind === 0 ? 0.02 + v * SPR.Lrest : kind < 0 ? rf * 0.02 : 0.04 + SPR.Lrest - rf * 0.02;
    }
  }
  // mesma ordem de índices do LatheGeometry da three (x = r sen, z = r cos): faces para fora
  for (let i = 0; i < seg; i++) for (let j = 0; j < NR - 1; j++) {
    const a = i * NR + j, b = a + NR, c = b + 1, d = a + 1;
    idx.push(a, b, d, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aV", new THREE.BufferAttribute(aV, 1));
  g.setAttribute("aKind", new THREE.BufferAttribute(aKind, 1));
  g.setAttribute("aRf", new THREE.BufferAttribute(aRf, 1));
  g.setAttribute("aAng", new THREE.BufferAttribute(aAng, 1));
  g.setIndex(idx);
  const rMax = (BG.R0 + BG.AMP * 2) * (1 + BG.OVER) + 0.002;   // pressão até 2 (mesmo teto do sim)
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-rMax, 0, -rMax), new THREE.Vector3(rMax, SPR.Lrest, rMax));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SPR.Lrest / 2, 0), Math.hypot(rMax, SPR.Lrest / 2));
  return g;
}

/** Contraporca / prato: anel com 12 rasgos de chave de gancho na borda. Base em y 0. */
function notchedRing(o) {
  // filete de 1 mm nos rasgos com 2 segmentos e chanfro de 0.7 mm com 2: abaixo de 1 px no macro, e são 3 anéis
  const outline = roundCorners(notchedOutline(o.rOut, CO.collars.notches, o.notchW, o.notchD), o.fillet, { step: 0.8 });
  return extrudeY(outline, [circlePts(o.rIn, 40)], o.h, o.bevel, 2);   // furo encostado no corpo: 40 lados bastam
}

/** Porca sextavada (extrusão de hexágono com cantos arredondados, furo do prisioneiro). Base em y 0. */
function hexNut(af, h, holeR) {
  const rc = af / Math.sqrt(3), hex = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + Math.PI / 6; hex.push([Math.cos(a) * rc, Math.sin(a) * rc]); }
  return extrudeY(roundCorners(hex, 0.0012), [circlePts(holeR, 16)], h, 0.0007);
}

/** Placa de cambagem: triângulo arredondado (casca convexa de 3 lóbulos nos prisioneiros), rasgo central de cambagem
    ao longo de X (lateral no mundo), 2 rasgos em arco acima/abaixo e 3 furos. Centro em y 0, espessura PLATE.h. */
function camberPlateGeometry() {
  const out = [], { studR, lobeR } = PLATE, lobes = [90, 210, 330].map((d) => d * DEG);
  for (const b of lobes) {
    const cx = Math.cos(b) * studR, cy = Math.sin(b) * studR;
    for (let k = 0; k <= 12; k++) { const a = b - 60 * DEG + (120 * DEG * k) / 12; out.push([cx + Math.cos(a) * lobeR, cy + Math.sin(a) * lobeR]); }
  }
  const holes = [];
  // rasgo central (estádio): a caixa do pillowball corre 22 mm para cada lado
  const slot = [], sr = 0.0135, sl = 0.022;
  for (let k = 0; k <= 12; k++) { const a = -Math.PI / 2 + (Math.PI * k) / 12; slot.push([sl + Math.cos(a) * sr, Math.sin(a) * sr]); }
  for (let k = 0; k <= 12; k++) { const a = Math.PI / 2 + (Math.PI * k) / 12; slot.push([-sl + Math.cos(a) * sr, Math.sin(a) * sr]); }
  holes.push(slot);
  // rasgos em arco (marcas de ajuste): r 31 mm, largura 7 mm, ±25°
  for (const c of [90 * DEG, 270 * DEG]) {
    const k = [], rm = 0.031, hw = 0.0035, span = 25 * DEG;
    for (let i = 0; i <= 8; i++) { const a = c - span + (2 * span * i) / 8; k.push([Math.cos(a) * (rm + hw), Math.sin(a) * (rm + hw)]); }
    for (let i = 1; i < 6; i++) { const e = c + span, a = e + (Math.PI * i) / 6; k.push([Math.cos(e) * rm + Math.cos(a) * hw, Math.sin(e) * rm + Math.sin(a) * hw]); }
    for (let i = 8; i >= 0; i--) { const a = c - span + (2 * span * i) / 8; k.push([Math.cos(a) * (rm - hw), Math.sin(a) * (rm - hw)]); }
    for (let i = 1; i < 6; i++) { const e = c - span, a = e + Math.PI + (Math.PI * i) / 6; k.push([Math.cos(e) * rm + Math.cos(a) * hw, Math.sin(e) * rm + Math.sin(a) * hw]); }
    holes.push(k);
  }
  for (const b of lobes) holes.push(circlePts(PLATE.studHoleR, 14, Math.cos(b) * studR, Math.sin(b) * studR));
  const g = extrudeY(out, holes, PLATE.h, PLATE.bevel);
  g.translate(0, -PLATE.h / 2, 0);
  return { geo: g, lobes };
}

/* ---------------- construtor ---------------- */
export function buildCoilover(ctx) {
  const { mats, tex = null, tier = "base" } = ctx;
  const low = tier === "low";
  // voltas do torno: 48 lados dão flecha de 0.1 mm em r 47 (abaixo de 1 px no macro do B4); o corpo fica com 64
  // porque a rosca helicoidal do normal map anda em u e lado largo faz o reflexo serrilhar
  const SEG = low ? 36 : 48, SEG_BODY = low ? 48 : 64;
  const owned = [];                                           // geometrias/materiais/texturas que este módulo criou

  const root = new THREE.Group(); root.name = "coilover";
  const axis = new THREE.Group(); axis.name = "coilover.axis";
  axis.position.set(P0[0], P0[1], P0[2]); axis.rotation.z = LEAN;
  root.add(axis);
  const lower = new THREE.Group(); lower.name = "coilover.lower";   // não suspenso: corpo, contraporcas, prato, mola/fole
  const upper = new THREE.Group(); upper.name = "coilover.upper";   // anda com L: haste, chapéu, placa
  axis.add(lower, upper);
  const mesh = (geo, mat, name, parent) => { const m = new THREE.Mesh(geo, mat); m.name = name; owned.push(geo); parent.add(m); return m; };

  /* ---- corpo rosqueado (titânio): UV u = volta, v = comprimento/260 mm, que é o que o repeat da rosca espera ---- */
  const bodyProf = closedProfile([
    [0.012, 0.11], [0.012, BODY.bot], [BODY.r, BODY.bot], [BODY.r, BODY.top], [0.012, BODY.top],
  ], (i, p) => (p[0] > 0.02 ? 0.0012 : 0.0005));
  const bodyGeo = new THREE.LatheGeometry(bodyProf.map(([r, y]) => new THREE.Vector2(r, y)), SEG_BODY);
  {
    const uv = bodyGeo.attributes.uv, pos = bodyGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getY(i) - BODY.bot) / BODY.len);
  }
  mesh(bodyGeo, mats.titanium, "coilover.body", lower);

  /* ---- peças anodizadas fixas ao corpo, numa malha só: prato + ressalto, contraporca de baixo, tampas ---- */
  const collarGeo = notchedRing(COLLAR); owned.push(collarGeo);
  const perchGeo = notchedRing(PERCH); perchGeo.translate(0, ST.perchBot, 0);
  const lowCollar = collarGeo.clone(); lowCollar.translate(0, ST.collarLowBot, 0);
  // ressalto de centragem: 30 mm de raio entra no diâmetro interno da mola (62 mm)
  const pt = ST.perchTop;
  const spigot = latheM(closedProfile([
    [0.0233, pt + 0.002], [0.0233, pt - 0.001], [0.0300, pt - 0.001], [0.0300, pt + 0.0040], [0.0278, pt + 0.0055], [0.0233, pt + 0.0055],
  ], 0.0007), SEG);
  // tampa do retentor no topo do corpo (a haste sai por ela) e tampa de baixo
  const seal = latheM(closedProfile([
    [0.0118, 0.244], [0.0118, BODY.top - 0.004], [0.0236, BODY.top - 0.004], [0.0236, BODY.top + 0.007], [0.0195, BODY.top + 0.0125], [0.0118, BODY.top + 0.0125],
  ], (i, p) => (p[0] > 0.015 ? 0.0015 : 0.0006)), SEG);
  const capBot = latheM(roundCorners([
    [0, BODY.bot - 0.014], [0.019, BODY.bot - 0.014], [0.0236, BODY.bot - 0.008], [0.0236, BODY.bot + 0.004], [0, BODY.bot + 0.004],
  ], 0.0015, { closed: false }), SEG);
  const staticGeo = mergeGeometries([perchGeo, lowCollar, flat(spigot), flat(seal), flat(capBot)], false);
  for (const g of [perchGeo, lowCollar, spigot, seal, capBot]) g.dispose();
  mesh(staticGeo, mats.anodBlack, "coilover.perch", lower);

  /* ---- contraporca de cima: gira e desce pela rosca no B4 ---- */
  const topCollar = new THREE.Mesh(collarGeo, mats.anodBlack); topCollar.name = "coilover.topCollar";
  topCollar.position.y = ST.collarTopBot; lower.add(topCollar);

  /* ---- MOLA ---- */
  const springMat = mats.powderRed.clone(); springMat.name = "v3.coilover.spring"; owned.push(springMat);
  const U = { uL: { value: SPR.Lrest }, uBagL: { value: SPR.Lrest }, uInflate: { value: BG.S0 }, uPressure: { value: 1 } };
  springMat.onBeforeCompile = (s) => {
    s.uniforms.uL = U.uL;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\n" + SPRING_GLSL_COMMON)
      .replace("#include <beginnormal_vertex>", SPRING_GLSL_MAIN)
      .replace("#include <begin_vertex>", "vec3 transformed = spPos;");
  };
  springMat.customProgramCacheKey = () => "v3spring";
  const spring = mesh(low ? springGeometry(480, 10) : springGeometry(SPR.segments.tubular, SPR.segments.radial), springMat, "coilover.spring", lower);

  /* ---- FOLE DE AR + anéis de cinta (base, cintura, topo) ---- */
  const bagMat = mats.rubber.clone(); bagMat.name = "v3.coilover.bag"; owned.push(bagMat);
  if (tex && typeof tex.grainNormal === "function") {
    // borracha com lona: grão de ~1 mm (UV em metros)
    const gn = tex.grainNormal().clone(); gn.repeat.set(30, 30); gn.needsUpdate = true; owned.push(gn);
    bagMat.normalMap = gn; bagMat.normalScale = new THREE.Vector2(0.18, 0.18);
  }
  bagMat.onBeforeCompile = (s) => {
    s.uniforms.uBagL = U.uBagL; s.uniforms.uInflate = U.uInflate; s.uniforms.uPressure = U.uPressure;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\n" + BAG_GLSL_COMMON)
      .replace("#include <beginnormal_vertex>", BAG_GLSL_MAIN)
      .replace("#include <begin_vertex>", "vec3 transformed = bgPos;");
  };
  bagMat.customProgramCacheKey = () => "v3bag";
  const bag = mesh(bagGeometry(low ? 48 : BAG.segments[0], BAG.segments[1]), bagMat, "coilover.bag", lower);
  bag.visible = false;
  const ringGeo = new THREE.TorusGeometry(BG.RING_R, BG.RING_TUBE, 10, low ? 48 : 64); ringGeo.rotateX(Math.PI / 2); owned.push(ringGeo);
  const crimps = new THREE.InstancedMesh(ringGeo, mats.beadAlu, 3); crimps.name = "coilover.crimps";
  crimps.frustumCulled = false;   // instâncias andam com L; a esfera calculada uma vez ficaria velha
  crimps.visible = false; lower.add(crimps);

  /* ---- batente (poliuretano preto) na haste, sentado na tampa do retentor ----
     Altura livre 16 mm = vão até o ressalto do chapéu quando L = 0.112, exatamente onde o sim liga Fb (§4d):
     o que se vê encostar é o que a física está fazendo. 2 gomos, como batente progressivo de verdade. */
  const BUMP_BASE = BODY.top + 0.0125, BUMP_H = 0.016, HAT_SPIGOT = 0.006;
  const bumpGeo = latheM(closedProfile([
    [0.0117, 0.008], [0.0117, 0], [0.0168, 0], [0.0174, 0.0030], [0.0152, 0.0062], [0.0170, 0.0096],
    [0.0148, 0.0128], [0.0136, BUMP_H], [0.0117, BUMP_H],
  ], 0.0008), SEG);
  const bump = mesh(bumpGeo, mats.rubber, "coilover.bumpStop", lower);
  bump.position.y = BUMP_BASE;

  /* ---- haste cromada (sobe com L) ---- */
  const tm = ST.topMount;
  const shaftGeo = latheM(roundCorners([
    [0, ST.shaftBot], [SHAFT_R, ST.shaftBot], [SHAFT_R, tm + 0.017], [0.006, tm + 0.019], [0.006, tm + 0.035], [0, tm + 0.035],
  ], (i, p) => (p[0] > 0.008 ? 0.0012 : 0.0006), { closed: false }), SEG);
  mesh(shaftGeo, mats.chrome, "coilover.shaft", upper);

  /* ---- chapéu (assento de cima da mola): flange r 47, ressalto r 29.8 dentro da mola, bossa até 22 mm ---- */
  const hatGeo = latheM(closedProfile([
    [0.0118, 0.008], [0.0118, -0.006], [0.0298, -0.006], [0.0298, 0], [0.047, 0], [0.047, 0.008], [0.032, 0.010], [0.027, 0.022], [0.0118, 0.022],
  ], (i, p) => (p[0] > 0.013 ? 0.0012 : 0.0006)), SEG);
  const topHat = mesh(hatGeo, mats.anodBlack, "coilover.topHat", upper);
  topHat.position.y = ST.springTopRest;

  /* ---- placa de cambagem (alumínio jateado) + caixa do pillowball; ferragens num só mesh ---- */
  const plateGroup = new THREE.Group(); plateGroup.name = "coilover.camberPlate";
  plateGroup.position.y = tm; upper.add(plateGroup);
  const { geo: plateGeo, lobes } = camberPlateGeometry();
  const ph = PLATE.h / 2;
  const housing = latheM(closedProfile([
    [0.0115, 0.0], [0.0115, -0.014], [0.0128, -0.014], [0.0128, ph], [0.030, ph], [0.030, ph + 0.005], [0.0215, ph + 0.007], [0.0185, 0.016], [0.0115, 0.016],
  ], (i, p) => (p[0] > 0.0125 && p[0] < 0.013 ? 0.0004 : 0.001)), SEG);
  const plateAll = mergeGeometries([plateGeo, flat(housing)], false);
  plateGeo.dispose(); housing.dispose();
  mesh(plateAll, mats.beadAlu, "coilover.plate", plateGroup);
  // ferragens: rótula esférica (r 12.5 mm), porca da haste (19 mm), 3 prisioneiros M10 e porcas flangeadas de 14 mm
  const hw = [];
  const ball = new THREE.SphereGeometry(0.0125, 24, 16); ball.translate(0, 0.010, 0); hw.push(flat(ball));
  const topNut = hexNut(0.019, 0.010, 0.006); topNut.translate(0, 0.0215, 0); hw.push(topNut);
  const stud = latheM(roundCorners([[0, -0.020], [0.005, -0.020], [0.005, 0.016], [0, 0.016]], 0.0008, { closed: false }), 12);
  const nut = hexNut(0.014, 0.008, 0.005);
  for (const b of lobes) {
    const x = Math.cos(b) * PLATE.studR, z = -Math.sin(b) * PLATE.studR;   // forma (x, y) -> local (x, -z)
    const s = flat(stud.clone()); s.translate(x, 0, z); hw.push(s);
    const n = nut.clone(); n.rotateY(b * 0.37); n.translate(x, ph, z); hw.push(n);
  }
  const hwGeo = mergeGeometries(hw, false);
  for (const g of [...hw, ball, stud, nut]) g.dispose();
  mesh(hwGeo, mats.chromeBlack, "coilover.hardware", plateGroup);

  /* ---- âncoras (mundo, em repouso) ---- */
  const W = (s, lx = 0) => new THREE.Vector3(P0[0] + lx * Math.cos(LEAN) + s * AX[0], P0[1] + lx * Math.sin(LEAN) + s * AX[1], P0[2]);
  const anchors = {
    lowerPerch: W(0),                                   // ponto da spec (início do eixo)
    perchTop: W(ST.perchTop),                           // face onde a mola apoia
    springCenter: W(ST.perchTop + SPR.Lrest / 2),       // (-0.193, 0.532, 0)
    springTop: W(ST.springTopRest),
    bodyTop: W(BODY.top),
    collarTop: W(ST.collarTopBot + COLLAR.h),
    topMount: W(ST.topMount),                           // (-0.24, 0.78, 0)
    shaftTop: W(ST.topMount + 0.035),
  };
  const explodeAxis = new THREE.Vector3(AX[0], AX[1], AX[2]);

  /* ---- estado e aplicação (sem alocação: chamado todo quadro) ---- */
  const st = { L: SPR.Lrest, mode: 0, p: 1, turns: 0, lift: 0 };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const rw = SP.D / 2, liftRatio = CO.springLiftOpen / CO.topHatLiftOpen; // a mola sobe 90 mm quando o chapéu sobe 140
  const part = {
    root, anchors, explodeAxis, explodeDist: 0.12,
    lower, upper, axis, spring, bag, crimps, topCollar, topHat, camberPlate: plateGroup, bumpStop: bump,
    uniforms: U, state: st,
    upperFollowsLength: true,
    stations: { ...ST, bodyBot: BODY.bot, bodyTop: BODY.top, axisLen: AXIS_LEN, lean: LEAN },
  };

  function applyLength() {
    const springLift = st.lift * liftRatio;
    // mola solta no B4: topo vai com o chapéu, base sobe menos; volta a ~L_free (0.196 de 0.203), como mola descarregada
    const uL = clamp(st.L + st.lift - springLift, SP.SOLID, SP.LMAX);
    const base = ST.perchTop + springLift;
    U.uL.value = uL; U.uBagL.value = uL;
    spring.position.y = base; bag.position.y = base;
    const gb = spring.geometry.boundingBox, gs = spring.geometry.boundingSphere;
    gb.max.y = uL; gs.center.y = uL / 2; gs.radius = Math.hypot(SP.R + rw, uL / 2);
    const bb = bag.geometry.boundingBox, bs = bag.geometry.boundingSphere;
    bb.max.y = uL; bs.center.y = uL / 2; bs.radius = Math.hypot(bb.max.x, uL / 2);
    upper.position.y = part.upperFollowsLength ? st.L - SPR.Lrest : 0;
    topHat.position.y = ST.springTopRest + st.lift;
    plateGroup.rotation.y = CO.camberPlateTurnDeg * DEG * clamp(st.lift / CO.topHatLiftOpen, 0, 1);
    // batente: esmaga quando o ressalto do chapéu encosta (L < 0.112); para no mínimo de 35%, o resto entra no chapéu
    const gap = ST.perchTop + st.L + st.lift - HAT_SPIGOT - BUMP_BASE;
    const sy = clamp(gap / BUMP_H, 0.35, 1), sr = Math.min(1.3, 1 / Math.sqrt(sy));   // volume ~constante
    bump.scale.set(sr, sy, sr);
    if (bag.visible || !crimpsReady) updateCrimps(base, uL);
  }
  let crimpsReady = false;
  function updateCrimps(base, uL) {
    // anéis rígidos: escalam só com o enchimento (o toggle), não com a pressão. Base, cintura e topo do fole.
    const s = U.uInflate.value; _s.set(s, s, s);
    for (let i = 0; i < 3; i++) { _p.set(0, base + (uL * i) / 2, 0); _m.compose(_p, _q, _s); crimps.setMatrixAt(i, _m); }
    crimps.instanceMatrix.needsUpdate = true;
    crimpsReady = true;
  }

  /** Comprimento da mola em metros (saída L do quarter-car). Preso em 0.099 (espira encostada) .. 0.32. */
  part.setLength = (m) => { st.L = clamp(+m || SPR.Lrest, SP.SOLID, SP.LMAX); applyLength(); };
  /** 0 = mola, 1 = bolsa de ar. O toggle tweena isto em 400 ms; o sobrepasso de 6% do raio já está na curva. */
  part.setMode = (m) => {
    st.mode = clamp(+m || 0, 0, 1);
    U.uInflate.value = inflateOf(st.mode);
    bag.visible = crimps.visible = st.mode > 0.001;
    // o fole passa por fora da mola quando o raio dele vence 42 mm + folga: daí a mola some (não dá para ver a troca)
    spring.visible = !(bag.visible && U.uInflate.value >= BG.HIDE_SPRING);
    applyLength();
  };
  /** Pressão relativa do sim (airP, 1 = estática, até 2). Infla o bojo das convoluções; altura vem de setLength. */
  part.setPressure = (p) => { st.p = clamp(+p, 0, 2); if (!(st.p >= 0)) st.p = 1; U.uPressure.value = 0.55 + 0.45 * st.p; };
  /** Voltas da contraporca de cima: gira e desce pela rosca de 1.5 mm (2 voltas = 3 mm, a leitura é o giro dos rasgos). */
  part.setCollarTurns = (n) => {
    st.turns = +n || 0;
    topCollar.rotation.y = -st.turns * TAU;           // rosca direita: descer = horário visto de cima
    topCollar.position.y = ST.collarTopBot - st.turns * CO.body.threadPitch;
  };
  /** Chapéu sobe m (0..0.2) pela haste; a mola sobe m * 90/140 e a placa gira até 15° em m = 0.14 (B4 0.56..0.60). */
  part.setTopLift = (m) => { st.lift = clamp(+m || 0, 0, 0.2); applyLength(); };

  part.dispose = () => {
    root.removeFromParent();
    for (const o of owned) o.dispose();
    crimps.dispose();
  };

  part.setMode(0); part.setPressure(1); part.setCollarTurns(0); part.setLength(SPR.Lrest);
  return part;
}
