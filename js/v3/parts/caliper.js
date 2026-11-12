/* v3 · pinça monobloco de 6 pistões (SPEC-3D seção 2 CALIPER, contrato seção 7). Construir e julgar primeiro.
   Mundo da spec: metros, centro do cubo na origem, eixo da roda em +X (para fora), +Y para cima.
   Ângulo no plano do disco: theta = atan2(y, -z). A pinça fica em theta 60° (centro (-0.065, 0.153, -0.089)).

   Referencial local da pinça (todas as cotas abaixo usam ele):
     x  = eixo da roda (igual ao mundo)
     a  = tangente (theta crescente), e_t = (0, cos60, sin60)
     b  = radial no centro da pinça, e_r = (0, sin60, -cos60)
     mundo = (x, a e_t + b e_r).  r = |(a, b)|,  phi = atan2(a, b) = theta - 60° (phi > 0 = saída da pastilha).
   O disco gira com theta crescente (rotation.x > 0): phi < 0 é a borda de ENTRADA, phi > 0 a de SAÍDA (mais quente,
   onde nascem as faíscas). Por isso o pistão pequeno fica na entrada e o grande na saída (pistões escalonados).

   Por que o corpo é um campo de distância (SDF) poligonizado e não ExtrudeGeometry:
   o risco nº 1 da spec é "feijão vermelho". Uma peça fundida de verdade tem filete em toda junção (ponte com a
   parede, lóbulos dos pistões na borda interna, cantos da janela). Com união suave (smin) esses filetes saem de
   graça, e a normal vem do gradiente do campo, então o risco do softbox corre liso no verniz sem facetas.
   Detalhe menor que a grade (cúpulas de 30/34/38 mm subindo 4 mm, ressalto do sangrador) é torno exato fundido na
   mesma malha (saia enterrada + filete tangente), como a spec pede ("merged short lathe domes").
   As cotas da spec continuam valendo: setor de 92°, R 0.135..0.215, 38 mm por metade, arredondamento de 7 mm.
   As pastilhas, que são chapa, saem de extrusão exata com bordas redondas.
   Conferido sem navegador (rasterizador em Node sobre as malhas reais): sem NaN, normais unitárias, nenhum
   triângulo contra a normal, partição e janela sem serrilhado. Falta o olhar no Chrome com o estúdio de verdade.

   Estações em X (metade de fora; a de dentro é o espelho em torno de x = -0.065):
     pista de fora do disco                 -0.0480
     material de atrito (8.5 mm)            -0.0478 .. -0.0393   (0.2 mm de folga até o disco)
     chapa da pastilha (5 mm)               -0.0393 .. -0.0343
     face interna da metade (XI)            -0.0335              (0.8 mm de folga; os pistões encostam na chapa)
     face externa da metade (XO)            +0.0045              (38 mm de parede)
     topo das cúpulas                       +0.0085
     cabeça dos parafusos da ponte          ~+0.0115
   Folga até os raios da roda: a roda ainda não existe. Se o fundo do raio côncavo em r 0.2 ficar a menos de
   ~+0.015, quem montar a roda move a roda, não a pinça (a pinça está presa à cota da pista do disco).

   Ponto mais alto: ponta dos sangradores em r 0.228 (x -0.0145 e -0.1155). O tambor da roda tem de passar acima.

   Triângulos (base): metade de fora 17.7k, de dentro 10.1k (grade mais grossa), pastilhas+pino 4.2k,
   parafusos 1.6k, sangradores 1k = ~34.5k visíveis; pistões +4.6k só no B3. high ~48k, low ~23k.
   Botão de orçamento: Q[tier].cell / cellIn (triângulos caem com o quadrado da célula).
   Tempo de construção: ~80 ms no desktop (campo + AO assado); no celular contar 3-4x, dentro do loader.
   Draw calls com tudo montado: 6 (2 metades, chapa+pino, atrito, parafusos, sangradores); +1 com os pistões. */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LAYOUT } from "../spec.js";
import { boltGeometry } from "../hardware.js";

const D = Math.PI / 180;
const CP = LAYOUT.caliper;
const RT = LAYOUT.rotor;

/* ---------------- referencial ---------------- */
const TH = CP.angle;                                   // 60°
const ER_Y = Math.sin(TH), ER_Z = -Math.cos(TH);       // e_r
const ET_Y = Math.cos(TH), ET_Z = Math.sin(TH);        // e_t (theta crescente)

/* ---------------- cotas (todas em metros) ---------------- */
const XM = LAYOUT.x.rotorMid;                          // -0.065 plano médio do disco = plano de partição
const X_FO = XM + RT.thickness / 2;                    // -0.048 pista de fora
const FR_T = 0.0085;                                   // espessura do material de atrito (não está na spec)
const BK_T = 0.005;                                    // chapa de aço da pastilha (não está na spec)
const X_FR0 = X_FO + 0.0002;                           // -0.0478 face de atrito
const X_FR1 = X_FR0 + FR_T;                            // -0.0393 atrito/chapa
const X_BK1 = X_FR1 + BK_T;                            // -0.0343 costas da chapa (pistões encostam aqui)
const XI = X_BK1 + 0.0008;                             // -0.0335 face interna da metade
const XO = XI + CP.depth;                              // +0.0045 face externa (38 mm de parede, bisel incluso)
const XC = (XI + XO) / 2;                              // meio da parede (sangrador)

const R0 = CP.R[0];                                    // 0.135 borda interna (fundo dos lóbulos)
const R1 = CP.R[1];                                    // 0.215 borda externa
const R0_BAND = 0.145;                                 // borda interna entre lóbulos: 10 mm acima de R0 (fundido, não arco liso)
const PHI = (CP.sectorDeg / 2) * D;                    // 46° meia abertura do setor de 92°
const RB = CP.bevel.size;                              // 7 mm raio de toda aresta do corpo
const RC_OUT = 0.014;                                  // canto externo das pontas (vista de lado)
const RC_IN = 0.009;                                   // canto interno das pontas

// ponte: dois braços sobre a borda do disco; a janela da pastilha é o vão entre eles, fechado em X pelas metades
const R_BR = 0.196;                                    // fundo da ponte: 6 mm acima do disco (R 0.19)
const PHI_W = 33.5 * D;                                // meia janela: a pastilha (±31.5°) sai por ela no B3
const PART = 0.0003;                                   // meia folga da linha de partição em x = XM (fio escuro de 0.6 mm)

// pistões / cúpulas: diâmetros 30/34/38 da entrada para a saída, num raio só, 22 mm de parede entre furos
const PISTON_R = 0.163;
const DIAMS = CP.domes.diameters;                      // [0.030, 0.034, 0.038]
const PIST_GAP = 0.022;
const PIST_S = [-(DIAMS[1] / 2 + DIAMS[0] / 2 + PIST_GAP), 0, DIAMS[1] / 2 + DIAMS[2] / 2 + PIST_GAP]; // arco em PISTON_R
const PIST = DIAMS.map((d, i) => { const phi = PIST_S[i] / PISTON_R; return { d, phi, a: PISTON_R * Math.sin(phi), b: PISTON_R * Math.cos(phi) }; });
const LOBE_R = PISTON_R - R0;                          // 0.028: cada lóbulo da borda interna desce até R0
/* Coroa da face de fora: o topo fica em XO no meio da faixa radial e desce 5 mm até as bordas. Uma face plana
   reflete um ponto só do softbox (vira mancha chapada); com a coroa o reflexo varre a faixa e vira o risco longo
   que corre ao longo do arco. Nunca passa de XO, então a folga até a roda continua a mesma. */
const CROWN = 0.005, CROWN_T = 0.004, CR_C = (R0 + R1) / 2, CR_HW = 0.042, CR_AH = 0.15;
const crownAt = (a, b) => {
  const u = (Math.hypot(a, b) - CR_C) / CR_HW, v = a / CR_AH;               // radial + tangencial (abaulado nas pontas)
  return -CROWN * Math.min(1, u * u) - CROWN_T * Math.min(1, v * v);
};
/** [dcr/da, dcr/db] por diferença central: a normal da face coroada é (1, -dcr/da, -dcr/db). */
const crownGrad = (a, b) => { const e = 1e-4; return [(crownAt(a + e, b) - crownAt(a - e, b)) / (2 * e), (crownAt(a, b + e) - crownAt(a, b - e)) / (2 * e)]; };
const DOME_RAISE = CP.domes.raise;                     // 4 mm
const DOME_X0 = XO - 0.006, DOME_X1 = XO + DOME_RAISE; // a cúpula entra 6 mm no corpo (some na união)
const DOME_RE = 0.0022;                                // arredondado da borda da cúpula
const DOME_CAP = 0.0012;                               // a calota sobe 1.2 mm além da borda: "domo", não disco chato
const DOMES = PIST.map((p) => {
  const R = p.d / 2, Rs = ((R - DOME_RE) ** 2 + DOME_CAP ** 2) / (2 * DOME_CAP);
  return { a: p.a, b: p.b, R, Rs, sx: DOME_X1 - Rs, cr: crownAt(p.a, p.b) };
});

// sangrador no ponto mais alto da pinça (theta 90° = phi 30°), num ressalto de 12 mm sobre a borda de cima.
// Ressalto 1.5 mm + sangrador 11.5 mm: ponta em r 0.228, o ponto mais alto da peça. O tambor da roda precisa
// passar por cima disso em x -0.0145 e -0.1155 (se não passar, encurtar o sangrador, não mexer no corpo).
const PHI_BLEED = 90 * D - TH;
const BOSS_R = 0.006, BOSS_T0 = R1 - 0.010, BOSS_T1 = R1 + 0.0015, BOSS_RE = 0.0010;
const BLEED_LEN = 0.0115;
// parafusos da ponte: no meio de cada braço, na face externa, dentro da área plana (o bisel começa em r 0.208)
const PHI_BOLT = ((PHI_W + PHI) / 2);                  // ~39.75°
const R_BOLT = 0.1995;
// pino da pastilha: atravessa a janela no centro, 3.5 mm acima da borda do disco
const PIN_R = 0.003, PIN_RC = 0.1965;

// pastilha (desenho em phi): a chapa tem uma orelha central furada para o pino
const PAD_BK = { rIn: 0.132, rOut: 0.1905, phi: 31.5 * D, rcIn: 0.004, rcOut: 0.006 };
const PAD_FR = { rIn: 0.1335, rOut: 0.1885, phi: 29.5 * D, rcIn: 0.005, rcOut: 0.005 };
const TAB = { w: 0.0085, top: 0.2015, rt: 0.0025, rf: 0.0015 };

// cell = lado da grade do campo (m). A metade de dentro fica atrás do disco em todo beat: grade mais grossa,
// mesmo desenho (o espelho é do campo, não da malha). arcStep = passo angular do contorno das pastilhas.
const Q = {
  // orçamento do canto inteiro é 150k: a pinça cabe em ~22k no base (lookdev: o resto do canto já passava de 170k)
  high: { cell: 0.0034, cellIn: 0.0048, lathe: 32, arcStep: 2.0 * D, bolt: "high" },
  base: { cell: 0.0040, cellIn: 0.0054, lathe: 24, arcStep: 2.8 * D, bolt: "low" },
  low: { cell: 0.0048, cellIn: 0.0064, lathe: 18, arcStep: 3.6 * D, bolt: "low" },
};

/* ---------------- utilidades ---------------- */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Interseção arredondada: distância exata ao canto de dois semiplanos quase perpendiculares. */
const roundInt = (u, v) => (u > 0 || v > 0 ? Math.sqrt((u > 0 ? u * u : 0) + (v > 0 ? v * v : 0)) : u > v ? u : v);
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
const smax = (a, b, k) => -smin(-a, -b, k);
const toWY = (a, b) => a * ET_Y + b * ER_Y;
const toWZ = (a, b) => a * ET_Z + b * ER_Z;
const V3 = (x, a, b) => new THREE.Vector3(x, toWY(a, b), toWZ(a, b));
const polar = (r, phi) => [r * Math.sin(phi), r * Math.cos(phi)];

/* ---------------- campo da metade de fora ----------------
   fast = true só na grade: longe da caixa devolve a distância à caixa (cota inferior, nunca troca o sinal).
   AO e normais pedem o campo exato. */
const cP = Math.cos(PHI), sP = Math.sin(PHI), cW = Math.cos(PHI_W), sW = Math.sin(PHI_W);
const sB = Math.sin(PHI_BLEED), cB = Math.cos(PHI_BLEED);
const LOBES = PIST.map((p) => [p.a, p.b]);
const AX0 = XM - 0.01, AXC = (AX0 + XO) / 2, AHH = (XO - AX0) / 2;   // prisma do contorno até além da partição
const DPC = (DOME_X0 + DOME_X1) / 2, DPH = (DOME_X1 - DOME_X0) / 2;
const BTC = (BOSS_T0 + BOSS_T1) / 2, BTH = (BOSS_T1 - BOSS_T0) / 2;
const BOX = { x0: XM + PART - 0.0005, x1: DOME_X1 + 0.0005, a: R1 * Math.sin(PHI) + 0.001, b0: 0.091, b1: BOSS_T1 + 0.0005 };

// domes = true só no AO: cúpulas e ressalto do sangrador são torno exato (lathedLocal); no campo só escurecem o filete.
// (Detalhe de 12 mm com 1.5 mm de altura não cabe numa grade de 3.6-4.8 mm: virava estrela de facetas.)
function halfSDF(x, a, b, fast = false, domes = false) {
  if (fast) {
    const dx = Math.max(BOX.x0 - x, 0, x - BOX.x1), da = Math.max(Math.abs(a) - BOX.a, 0), db = Math.max(BOX.b0 - b, 0, b - BOX.b1);
    const box = Math.sqrt(dx * dx + da * da + db * db);
    if (box > 0.01) return box;
  }
  const aa = Math.abs(a), r = Math.sqrt(a * a + b * b);
  // contorno de lado: setor com cantos arredondados (externos 14 mm, internos 9 mm) + lóbulos dos furos na borda de baixo
  const dw = aa * cP - b * sP;                                        // < 0 dentro da cunha de ±46°
  const co = roundInt(r - (R1 - RC_OUT), dw + RC_OUT) - RC_OUT;
  const ci = roundInt(R0_BAND + RC_IN - r, dw + RC_IN) - RC_IN;
  let s = co > ci ? co : ci;
  for (let i = 0; i < 3; i++) {
    const la = a - LOBES[i][0], lb = b - LOBES[i][1];
    s = smin(s, Math.sqrt(la * la + lb * lb) - LOBE_R, 0.012);
  }
  /* Parede + meia ponte sem nenhuma superfície coplanar na mistura (união suave de faces coplanares estufa a
     peça: era a listra no topo dos braços). Construção:
       Aext = contorno lateral extrudado de XM até XO, arestas com 7 mm
       L    = (seção dos braços: r >= 0.196 e fora da janela, sem topo nem pontas) U (x >= XI), filete côncavo 6 mm
       metade = Aext ∩ L com arredondado exato de 7 mm nas arestas convexas, depois o corte da partição.
     L não tem topo nem ponta, então nada dele coincide com o Aext. */
  const Aext = roundInt(s + RB, Math.abs(x - crownAt(a, b) - AXC) - (AHH - RB)) - RB;
  let L = XI - x;
  if (r > R_BR - 0.025 && x < XI + 0.025) {
    const sb = smax(R_BR - r, b * sW - aa * cW, 0.008);               // b sW - |a| cW > 0 dentro da janela
    L = smin(sb, L, 0.006);
  }
  let d = roundInt(L + RB, Aext + RB) - RB;
  d = smax(d, XM + PART - x, 0.0015);                                 // partição: fio de 0.6 mm, cantos de 1.5 mm

  // cúpulas (só AO): disco com borda redonda + calota esférica, fundidos na face
  if (domes && x > DOME_X0 - 0.006) {
    for (let i = 0; i < 3; i++) {
      const m = DOMES[i], da = a - m.a, db = b - m.b, rr2 = da * da + db * db;
      if (rr2 > (m.R + 0.01) * (m.R + 0.01)) continue;
      const rr = Math.sqrt(rr2);
      const xd = x - m.cr;                                             // cúpula acompanha a coroa da face
      const pk = roundInt(rr - (m.R - DOME_RE), Math.abs(xd - DPC) - (DPH - DOME_RE)) - DOME_RE;
      const sx = xd - m.sx, sp = Math.sqrt(rr2 + sx * sx) - m.Rs;
      d = smin(d, smax(pk, sp, 0.0015), 0.003);
    }
  }

  // ressalto do sangrador (só AO; a malha é torno em lathedLocal). Eixo radial em phi 30°
  const t = a * sB + b * cB;
  if (domes && t > BOSS_T0 - 0.006) {
    const u = a * cB - b * sB, ux = x - XC;
    if (Math.abs(u) < 0.014 && Math.abs(ux) < 0.014) {
      const bs = roundInt(Math.sqrt(u * u + ux * ux) - (BOSS_R - BOSS_RE), Math.abs(t - BTC) - (BTH - BOSS_RE)) - BOSS_RE;
      d = smin(d, bs, 0.002);
    }
  }
  return d;
}

/** Cena só para o AO assado: as duas metades (dobra em XM), o disco e as pastilhas. Contato montado. */
const cPad = Math.cos(PAD_BK.phi), sPad = Math.sin(PAD_BK.phi);
const PAD_XC = (X_FR0 + X_BK1) / 2, PAD_HH = (X_BK1 - X_FR0) / 2;
function sceneSDF(x, a, b) {
  const xf = XM + Math.abs(x - XM);
  let d = halfSDF(xf, a, b, false, true);
  const r = Math.sqrt(a * a + b * b);
  d = Math.min(d, roundInt(Math.max(r - RT.R, RT.r - r), Math.abs(x - XM) - RT.thickness / 2));
  const dwp = Math.abs(a) * cPad - b * sPad;
  d = Math.min(d, roundInt(Math.max(r - PAD_BK.rOut, PAD_BK.rIn - r, dwp), Math.abs(xf - PAD_XC) - PAD_HH));
  return d;
}

/* ---------------- poligonização (surface nets com vértice por QEF, à la dual contouring) ----------------
   Um vértice por célula cruzada, um quadrilátero por aresta cruzada. O vértice não é a média dos cruzamentos
   (isso serrilha toda aresta que não está alinhada à grade: partição, janela, borda das cúpulas): ele minimiza a
   distância aos planos tangentes dos cruzamentos, então cai em cima da aresta. Regularizado para a média (LAMBDA)
   e preso à célula. Depois: projeção na superfície e normal = gradiente (lisa, sem facetas). */
const QEF_LAMBDA = 0.05;
function surfaceNets(f, lo, hi, h) {
  const nx = Math.ceil((hi[0] - lo[0]) / h), na = Math.ceil((hi[1] - lo[1]) / h), nb = Math.ceil((hi[2] - lo[2]) / h);
  const NX = nx + 1, NA = na + 1, NB = nb + 1;
  const F = new Float32Array(NX * NA * NB);
  for (let k = 0; k < NB; k++) for (let j = 0; j < NA; j++) {
    const base = NX * (j + NA * k), a = lo[1] + j * h, b = lo[2] + k * h;
    for (let i = 0; i < NX; i++) F[base + i] = f(lo[0] + i * h, a, b, true);
  }
  const node = (i, j, k) => i + NX * (j + NA * k);
  const cellV = new Int32Array(nx * na * nb).fill(-1);
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8), V = [];
  const px = new Float64Array(12), py = new Float64Array(12), pz = new Float64Array(12);
  const e = 0.0003;
  for (let k = 0; k < nb; k++) for (let j = 0; j < na; j++) for (let i = 0; i < nx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const o = CO[c], v = F[node(i + o[0], j + o[1], k + o[2])]; cv[c] = v; if (v < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let n = 0, cx = 0, cy = 0, cz = 0;
    for (let ed = 0; ed < 12; ed++) {
      const e0 = ED[ed][0], e1 = ED[ed][1], v0 = cv[e0], v1 = cv[e1];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1), o0 = CO[e0], o1 = CO[e1];
      px[n] = lo[0] + (i + o0[0] + (o1[0] - o0[0]) * t) * h;
      py[n] = lo[1] + (j + o0[1] + (o1[1] - o0[1]) * t) * h;
      pz[n] = lo[2] + (k + o0[2] + (o1[2] - o0[2]) * t) * h;
      cx += px[n]; cy += py[n]; cz += pz[n]; n++;
    }
    cx /= n; cy /= n; cz /= n;
    // QEF: (sum n n^T + L I) d = sum n (n . (p - c)), vértice = c + d
    let a00 = QEF_LAMBDA, a01 = 0, a02 = 0, a11 = QEF_LAMBDA, a12 = 0, a22 = QEF_LAMBDA, b0 = 0, b1 = 0, b2 = 0;
    for (let s = 0; s < n; s++) {
      const X = px[s], A = py[s], B = pz[s];
      let gx = f(X + e, A, B) - f(X - e, A, B), gy = f(X, A + e, B) - f(X, A - e, B), gz = f(X, A, B + e) - f(X, A, B - e);
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (gl < 1e-12) continue;
      gx /= gl; gy /= gl; gz /= gl;
      const dd = gx * (X - cx) + gy * (A - cy) + gz * (B - cz);
      a00 += gx * gx; a01 += gx * gy; a02 += gx * gz; a11 += gy * gy; a12 += gy * gz; a22 += gz * gz;
      b0 += gx * dd; b1 += gy * dd; b2 += gz * dd;
    }
    const c00 = a11 * a22 - a12 * a12, c01 = a01 * a22 - a12 * a02, c02 = a01 * a12 - a11 * a02;
    const det = a00 * c00 - a01 * c01 + a02 * c02;
    let vx = cx, vy = cy, vz = cz;
    if (det > 1e-12) {
      const dx = (b0 * c00 - a01 * (b1 * a22 - a12 * b2) + a02 * (b1 * a12 - a11 * b2)) / det;
      const dy = (a00 * (b1 * a22 - b2 * a12) - b0 * c01 + a02 * (a01 * b2 - b1 * a02)) / det;
      const dz = (a00 * (a11 * b2 - a12 * b1) - a01 * (a01 * b2 - b1 * a02) + b0 * c02) / det;
      const qx = cx + dx, qy = cy + dy, qz = cz + dz, m = 0.5 * h;
      const x0 = lo[0] + i * h, y0 = lo[1] + j * h, z0 = lo[2] + k * h;
      // fora da célula (+ meia célula) = plano quase paralelo, solução instável: fica a média
      if (qx > x0 - m && qx < x0 + h + m && qy > y0 - m && qy < y0 + h + m && qz > z0 - m && qz < z0 + h + m) { vx = qx; vy = qy; vz = qz; }
    }
    cellV[i + nx * (j + na * k)] = V.length / 3;
    V.push(vx, vy, vz);
  }
  const cell = (i, j, k) => cellV[i + nx * (j + na * k)];
  const I = [];
  const quad = (q0, q1, q2, q3) => {
    if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) return;
    // diagonal mais curta: menos triângulo comprido em borda arredondada
    const d02 = (V[q0 * 3] - V[q2 * 3]) ** 2 + (V[q0 * 3 + 1] - V[q2 * 3 + 1]) ** 2 + (V[q0 * 3 + 2] - V[q2 * 3 + 2]) ** 2;
    const d13 = (V[q1 * 3] - V[q3 * 3]) ** 2 + (V[q1 * 3 + 1] - V[q3 * 3 + 1]) ** 2 + (V[q1 * 3 + 2] - V[q3 * 3 + 2]) ** 2;
    if (d02 <= d13) I.push(q0, q1, q2, q0, q2, q3); else I.push(q0, q1, q3, q1, q2, q3);
  };
  for (let k = 0; k < NB; k++) for (let j = 0; j < NA; j++) for (let i = 0; i < NX; i++) {
    const s0 = F[node(i, j, k)] < 0;
    if (i < nx && j >= 1 && j < na && k >= 1 && k < nb && (F[node(i + 1, j, k)] < 0) !== s0)
      quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k));
    if (j < na && i >= 1 && i < nx && k >= 1 && k < nb && (F[node(i, j + 1, k)] < 0) !== s0)
      quad(cell(i - 1, j, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i - 1, j, k));
    if (k < nb && i >= 1 && i < nx && j >= 1 && j < na && (F[node(i, j, k + 1)] < 0) !== s0)
      quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k));
  }
  return { V, I };
}

/** Enrolamento decidido pela normal: o surface nets e o espelho não garantem o sentido dos triângulos. */
function orient(pos, nor, idx) {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = nor[a] + nor[b] + nor[c], ny = nor[a + 1] + nor[b + 1] + nor[c + 1], nz = nor[a + 2] + nor[b + 2] + nor[c + 2];
    if (fx * nx + fy * ny + fz * nz < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
}

/* AO de campo: quanto o espaço ao longo da normal está "fechado" (filetes, janela, contato com pastilha e disco).
   Assado para o estado montado; no B3 explodido e no B5 a face interna fica um pouco escura demais, é aceito. */
const AO_H = [0.0025, 0.006, 0.011, 0.018, 0.028], AO_W = [0.34, 0.26, 0.2, 0.14, 0.08];
function bakeAO(x, a, b, nx, na, nb) {
  let occ = 0;
  for (let s = 0; s < AO_H.length; s++) {
    const hh = AO_H[s], q = sceneSDF(x + nx * hh, a + na * hh, b + nb * hh);
    occ += AO_W[s] * Math.max(0, hh - q) / hh;
  }
  return Math.min(1, Math.max(0.22, 1 - 1.15 * occ));
}
/** UV em metros por eixo dominante (x / radial / tangencial): só leva a casca de laranja do verniz. */
const ARC = LAYOUT.caliper.radius || 0.177;           // u = comprimento de arco neste raio
function paintUV(UV, v, x, a, b, nx, na, nb) {
  const r = Math.sqrt(a * a + b * b) || 1e-9, phi = Math.atan2(a, b), sn = a / r, cs = b / r;
  const nr = na * sn + nb * cs, nt = na * cs - nb * sn, ax = Math.abs(nx), ar = Math.abs(nr), at = Math.abs(nt);
  if (ax >= ar && ax >= at) { UV[v * 2] = phi * ARC; UV[v * 2 + 1] = r; }
  else if (ar >= at) { UV[v * 2] = phi * ARC; UV[v * 2 + 1] = x; }
  else { UV[v * 2] = r; UV[v * 2 + 1] = x; }
}

/** Ressalto torneado sobre uma face da metade: cúpula de furo (a spec: "merged short lathe domes raised 4 mm") ou
    ressalto do sangrador. Saia 0.4 mm enterrada, filete côncavo f tangente à face (emenda invisível: mesma normal),
    parede, borda redonda rim, calota que sobe cap até a altura H. Perfil (r, h acima da face).
    o = centro na face (x, a, b local), w = eixo (sai da face), e1/e2 = base radial do torno. */
const DOME_F = 0.002, DOME_RIM = 0.0016;
function lathedLocal({ R, H, f, rim, cap, o, w, e1, e2 }, seg) {
  const Hr = H - cap, pr = [[R + f + 0.0008, -0.0004], [R + f, 0]];
  for (let t = 1; t <= 4; t++) { const an = (t / 4) * Math.PI / 2; pr.push([R + f - f * Math.sin(an), f - f * Math.cos(an)]); }
  for (let t = 0; t <= 4; t++) { const an = (t / 4) * Math.PI / 2; pr.push([R - rim + rim * Math.cos(an), Hr - rim + rim * Math.sin(an)]); }
  const Rc = R - rim, nc = cap > 0 ? 5 : 1;
  for (let k = 1; k <= nc; k++) { const r = Rc * (1 - k / nc); pr.push([r, Hr + cap * (1 - (r / Rc) ** 2)]); }
  const g = new THREE.LatheGeometry(pr.map(([r, h]) => new THREE.Vector2(Math.max(r, 1e-5), h)), seg);
  const gp = g.attributes.position, gn = g.attributes.normal, n = gp.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2), CO = new Float32Array(n * 3);
  const map = (X, Y, Z, k) => o[k] + w[k] * Y + e1[k] * X + e2[k] * Z;
  for (let v = 0; v < n; v++) {
    // torno: eixo Y -> w; (X, Z) do torno -> (e1, e2) em volta do centro
    const X = gp.getX(v), Y = gp.getY(v), Z = gp.getZ(v), NX = gn.getX(v), NY = gn.getY(v), NZ = gn.getZ(v);
    const x = map(X, Y, Z, 0), a = map(X, Y, Z, 1), b = map(X, Y, Z, 2);
    let nx = w[0] * NY + e1[0] * NX + e2[0] * NZ, na = w[1] * NY + e1[1] * NX + e2[1] * NZ, nb = w[2] * NY + e1[2] * NX + e2[2] * NZ;
    const l = Math.hypot(nx, na, nb) || 1; nx /= l; na /= l; nb /= l;
    P[v * 3] = x; P[v * 3 + 1] = a; P[v * 3 + 2] = b;
    N[v * 3] = nx; N[v * 3 + 1] = na; N[v * 3 + 2] = nb;
    CO[v * 3] = CO[v * 3 + 1] = CO[v * 3 + 2] = bakeAO(x, a, b, nx, na, nb);
    paintUV(UV, v, x, a, b, nx, na, nb);
  }
  const idx = Uint32Array.from(g.index.array);
  g.dispose();
  return { pos: P, nor: N, uv: UV, col: CO, idx };
}
function mergeLocal(list) {
  let nv = 0, ni = 0;
  for (const L of list) { nv += L.pos.length / 3; ni += L.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const L of list) {
    const n = L.pos.length / 3;
    pos.set(L.pos, ov * 3); nor.set(L.nor, ov * 3); uv.set(L.uv, ov * 2);
    if (L.col) col.set(L.col, ov * 3); else col.fill(1, ov * 3, (ov + n) * 3);
    for (let i = 0; i < L.idx.length; i++) idx[oi + i] = L.idx[i] + ov;
    ov += n; oi += L.idx.length;
  }
  return { pos, nor, uv, col, idx };
}

/** Metade de fora (x, a, b local) pronta: corpo poligonizado (projeção, normais, AO, UV) + 3 cúpulas de torno. */
function buildHalfLocal(cell, domeSeg) {
  const lo = [XM - 0.003, -BOX.a - 0.004, BOX.b0 - 0.004];
  const hi = [DOME_X1 + 0.004, BOX.a + 0.004, BOX.b1 + 0.004];
  const { V, I } = surfaceNets(halfSDF, lo, hi, cell);
  const n = V.length / 3, P = new Float32Array(V), N = new Float32Array(n * 3), UV = new Float32Array(n * 2), CO = new Float32Array(n * 3);
  const e = 0.0004, g = [0, 0, 0];
  const grad = (x, a, b) => {
    g[0] = halfSDF(x + e, a, b) - halfSDF(x - e, a, b);
    g[1] = halfSDF(x, a + e, b) - halfSDF(x, a - e, b);
    g[2] = halfSDF(x, a, b + e) - halfSDF(x, a, b - e);
    g[0] /= 2 * e; g[1] /= 2 * e; g[2] /= 2 * e;
  };
  for (let v = 0; v < n; v++) {
    let x = P[v * 3], a = P[v * 3 + 1], b = P[v * 3 + 2];
    for (let it = 0; it < 4; it++) {                                   // 4 passos: com a célula maior 2 deixavam a face ondulada
      const f = halfSDF(x, a, b);
      grad(x, a, b);
      const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (g2 < 1e-6) break;
      let k = f / g2;
      const step = Math.abs(k) * Math.sqrt(g2);
      if (step > 0.6 * cell) k *= (0.6 * cell) / step;                 // nunca pula para outra parede
      x -= k * g[0]; a -= k * g[1]; b -= k * g[2];
    }
    grad(x, a, b);
    let l = Math.hypot(g[0], g[1], g[2]) || 1;
    const nx = g[0] / l, na = g[1] / l, nb = g[2] / l;
    P[v * 3] = x; P[v * 3 + 1] = a; P[v * 3 + 2] = b;
    N[v * 3] = nx; N[v * 3 + 1] = na; N[v * 3 + 2] = nb;
    CO[v * 3] = CO[v * 3 + 1] = CO[v * 3 + 2] = bakeAO(x, a, b, nx, na, nb);
    paintUV(UV, v, x, a, b, nx, na, nb);
  }
  const idx = Uint32Array.from(I);
  orient(P, N, idx);
  // cúpula assenta na face coroada: eixo = normal da face (inclinada ~4°), base tangente ao arco
  const lathed = DOMES.map((m) => {
    const [ga, gb] = crownGrad(m.a, m.b), wl = Math.hypot(1, ga, gb), w = [1 / wl, -ga / wl, -gb / wl];
    // e1 = qualquer vetor da face perpendicular a w: o radial local girado (a cúpula é de revolução)
    let e1 = [w[1], -w[0], 0]; const l1 = Math.hypot(e1[0], e1[1]); e1 = [e1[0] / l1, e1[1] / l1, 0];
    const e2 = [w[1] * e1[2] - w[2] * e1[1], w[2] * e1[0] - w[0] * e1[2], w[0] * e1[1] - w[1] * e1[0]];
    return lathedLocal({ R: m.R, H: DOME_RAISE, f: DOME_F, rim: DOME_RIM, cap: DOME_CAP, o: [XO + m.cr, m.a, m.b], w, e1, e2 }, domeSeg);
  });
  // ressalto do sangrador: sobre o topo (r = R1) no meio da parede, eixo radial em phi 30°
  lathed.push(lathedLocal({
    R: BOSS_R, H: BOSS_T1 - R1, f: 0.0015, rim: 0.0008, cap: 0,
    o: [XC, R1 * sB, R1 * cB], w: [0, sB, cB], e1: [1, 0, 0], e2: [0, cB, -sB],
  }, Math.max(16, domeSeg - 8)));
  const out = mergeLocal([{ pos: P, nor: N, uv: UV, col: CO, idx }, ...lathed]);
  orient(out.pos, out.nor, out.idx);
  return out;
}

/** Local (x, a, b) -> geometria no mundo. mirror = espelho em x = XM (metade de dentro, pastilha de dentro). */
function localToGeometry(L, mirror = false) {
  const n = L.pos.length / 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const x = L.pos[v * 3], a = L.pos[v * 3 + 1], b = L.pos[v * 3 + 2];
    const nx = L.nor[v * 3], na = L.nor[v * 3 + 1], nb = L.nor[v * 3 + 2];
    pos[v * 3] = mirror ? 2 * XM - x : x; pos[v * 3 + 1] = toWY(a, b); pos[v * 3 + 2] = toWZ(a, b);
    nor[v * 3] = mirror ? -nx : nx; nor[v * 3 + 1] = toWY(na, nb); nor[v * 3 + 2] = toWZ(na, nb);
  }
  const idx = L.idx.slice();
  // e_t, e_r, X tem determinante -1 (reflexão) e o espelho é outra: o orient no mundo resolve os dois casos
  orient(pos, nor, idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(L.uv.slice(), 2));
  if (L.col) g.setAttribute("color", new THREE.BufferAttribute(L.col.slice(), 3));
  g.setIndex(new THREE.BufferAttribute(n > 65535 ? idx : Uint16Array.from(idx), 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/* ---------------- contornos 2D (plano a-b) ---------------- */
/** Arco de concordância de raio rc entre os pontos T1 e T2, centro C, pelo lado curto. */
function filletArc(out, C, T1, T2, n) {
  const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
  let da = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
  while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const rc = Math.hypot(T1[0] - C[0], T1[1] - C[1]);
  for (let k = 0; k <= n; k++) { const an = a1 + (da * k) / n; out.push([C[0] + Math.cos(an) * rc, C[1] + Math.sin(an) * rc]); }
}
/** Setor de coroa rIn..rOut, ±phi, com os 4 cantos concordados (raios exatos, tangentes calculadas).
    tab: orelha central no arco externo (pastilha), com cantos de topo rt e pé côncavo rf. */
function sectorOutline({ rIn, rOut, phi, rcIn, rcOut }, step, tab = null) {
  const pts = [];
  const arc = (r, p0, p1) => { const k = Math.max(1, Math.ceil(Math.abs(p1 - p0) / step)); for (let i = 0; i <= k; i++) pts.push(polar(r, p0 + ((p1 - p0) * i) / k)); };
  // centros dos filetes e tangentes (lado +phi; o lado - é o espelho em a)
  const rhoI = rIn + rcIn, pcI = phi - Math.asin(rcIn / rhoI);
  const rhoO = rOut - rcOut, pcO = phi - Math.asin(rcOut / rhoO);
  const sideI = rhoI * Math.cos(phi - pcI), sideO = rhoO * Math.cos(phi - pcO);
  const CI = polar(rhoI, pcI), CO = polar(rhoO, pcO);
  const m = (p) => [-p[0], p[1]];
  // borda interna de -phi a +phi
  arc(rIn, -pcI, pcI);
  filletArc(pts, CI, polar(rIn, pcI), polar(sideI, phi), 4);
  filletArc(pts, CO, polar(sideO, phi), polar(rOut, pcO), 5);
  if (!tab) arc(rOut, pcO, -pcO);
  else {
    // pé côncavo: centro fora do arco, tangente ao lado vertical a = w
    const yc = Math.sqrt((rOut + tab.rf) ** 2 - (tab.w + tab.rf) ** 2), Cr = [tab.w + tab.rf, yc];
    const Ta = [Cr[0] * rOut / (rOut + tab.rf), Cr[1] * rOut / (rOut + tab.rf)], pTa = Math.atan2(Ta[0], Ta[1]);
    arc(rOut, pcO, pTa);
    filletArc(pts, Cr, Ta, [tab.w, yc], 3);
    filletArc(pts, [tab.w - tab.rt, tab.top - tab.rt], [tab.w, tab.top - tab.rt], [tab.w - tab.rt, tab.top], 3);
    filletArc(pts, [-tab.w + tab.rt, tab.top - tab.rt], [-tab.w + tab.rt, tab.top], [-tab.w, tab.top - tab.rt], 3);
    filletArc(pts, m(Cr), [-tab.w, yc], m(Ta), 3);
    arc(rOut, -pTa, -pcO);
  }
  filletArc(pts, m(CO), m(polar(rOut, pcO)), m(polar(sideO, phi)), 5);
  filletArc(pts, m(CI), m(polar(sideI, phi)), m(polar(rIn, pcI)), 4);
  // tira duplicados de junção (arco termina onde o filete começa)
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p); }
  const f = out[0], l = out[out.length - 1];
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) out.pop();
  return out;
}
const circle2 = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return [cx + Math.cos(t) * r, cy + Math.sin(t) * r]; });

/** Chapa extrudada em X (x0..x1) a partir de contornos no plano a-b, com borda em quarto de círculo (bv) nas duas
    faces e normais analíticas. O ExtrudeGeometry da three sai com normal por face e facetaria o bisel. UV em metros. */
function extrudeRounded(outer, holes, x0, x1, bv, segs) {
  const area = (c) => { let s = 0; for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
  const O = area(outer) > 0 ? outer : outer.slice().reverse();
  const H = holes.map((h) => (area(h) < 0 ? h : h.slice().reverse()));
  // normal "para fora do material" = (dy, -dx) com o de fora anti-horário e os furos horários
  const prep = (c) => {
    const m = c.length, nn = new Float64Array(m * 2), q = new Float64Array(m * 2);
    for (let i = 0; i < m; i++) {
      const A = c[(i - 1 + m) % m], P = c[i], B = c[(i + 1) % m];
      let e1x = P[1] - A[1], e1y = -(P[0] - A[0]), e2x = B[1] - P[1], e2y = -(B[0] - P[0]);
      const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1; e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
      let nx = e1x + e2x, ny = e1y + e2y; const ln = Math.hypot(nx, ny) || 1; nx /= ln; ny /= ln;
      const miter = 1 / Math.max(0.5, nx * e1x + ny * e1y);
      nn[i * 2] = nx; nn[i * 2 + 1] = ny; q[i * 2] = P[0] - nx * bv * miter; q[i * 2 + 1] = P[1] - ny * bv * miter;
    }
    return { c, m, nn, q };
  };
  const C = [prep(O), ...H.map(prep)];
  const pos = [], nor = [], uv = [], idx = [];
  const put = (x, a, b, nx, na, nb, u, v) => { pos.push(x, a, b); nor.push(nx, na, nb); uv.push(u, v); };
  // tampas (miolo recuado bv)
  const vec = ({ q, m }) => Array.from({ length: m }, (_, i) => new THREE.Vector2(q[i * 2], q[i * 2 + 1]));
  const capPts = C.map(vec), flat = capPts.flat();
  const faces = THREE.ShapeUtils.triangulateShape(capPts[0], capPts.slice(1));
  for (const [x, s] of [[x1, 1], [x0, -1]]) {
    const base = pos.length / 3;
    for (const p of flat) put(x, p.x, p.y, s, 0, 0, p.x, p.y);
    for (const [i, j, k] of faces) idx.push(base + i, base + j, base + k);
  }
  // paredes: quarto de círculo na frente, reta, quarto de círculo atrás
  const rows = [];
  for (let k = 0; k <= segs; k++) { const ps = (k / segs) * Math.PI / 2; rows.push([x1 - bv + bv * Math.cos(ps), ps]); }
  for (let k = 0; k <= segs; k++) { const ps = Math.PI / 2 + (k / segs) * Math.PI / 2; rows.push([x0 + bv + bv * Math.cos(ps), ps]); }
  for (const { c, m, nn, q } of C) {
    const base = pos.length / 3, cols = m + 1, lens = [0];
    for (let i = 1; i <= m; i++) lens.push(lens[i - 1] + Math.hypot(c[i % m][0] - c[i - 1][0], c[i % m][1] - c[i - 1][1]));
    for (const [x, ps] of rows) {
      const sn = Math.sin(ps), cs = Math.cos(ps);
      for (let i = 0; i < cols; i++) {
        const ii = i % m, nx = nn[ii * 2], ny = nn[ii * 2 + 1];
        put(x, q[ii * 2] + nx * bv * sn, q[ii * 2 + 1] + ny * bv * sn, cs, nx * sn, ny * sn, lens[i], x);
      }
    }
    for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < m; i++) {
      const A = base + r * cols + i, B = A + 1, Cc = A + cols, Dd = Cc + 1;
      idx.push(A, B, Dd, A, Dd, Cc);
    }
  }
  const P = new Float32Array(pos), N = new Float32Array(nor), I = Uint32Array.from(idx);
  orient(P, N, I);
  return { pos: P, nor: N, uv: new Float32Array(uv), idx: I, col: null };
}

/* ---------------- tornos (eixo Y da LatheGeometry; quem chama orienta) ---------------- */
function lathe(profile, seg) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), seg);
  const p = g.attributes.position.array, n = g.attributes.normal.array, i = g.index.array.slice();
  orient(p, n, i);
  g.setIndex(new THREE.BufferAttribute(i, 1));
  return g;
}
/** Pistão (diâmetro 38, escalado por instância): copo de inox, boca para a pastilha (menos calor no fluido).
    y = 0 no fundo (dentro do furo), y = L na boca. */
const PIST_L = 0.024;
function pistonGeometry(seg) {
  const R = DIAMS[2] / 2, W = 0.0025, L = PIST_L, DP = 0.013;
  const g = lathe([
    [0, 0], [R - 0.0012, 0], [R - 0.0004, 0.0001], [R, 0.0008],          // fundo com raio
    [R, L - 0.0009], [R - 0.0003, L - 0.0002], [R - 0.0009, L],          // chanfro da boca por fora
    [R - W + 0.0005, L], [R - W, L - 0.0005],                            // lábio arredondado
    [R - W, L - DP + 0.0015], [R - W - 0.0006, L - DP + 0.0003], [R - W - 0.0015, L - DP], // raio interno do copo
    [0, L - DP],
  ], seg);
  // boca em x = 0 olhando para -X, fundo em +X (dentro da metade de fora); y e z ficam radiais para a escala
  g.translate(0, -L, 0);
  g.rotateZ(Math.PI / 2);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
/** Sangrador M8 compacto: sextavado de 8 mm (faces chapadas) + bico arredondado, BLEED_LEN de altura.
    Base em y = 0, eixo +Y. */
function bleedGeometry(seg) {
  const RH = 0.004 / Math.cos(Math.PI / 6), L = BLEED_LEN;
  const hex = new THREE.LatheGeometry([[0, 0], [RH - 0.0004, 0], [RH, 0.0004], [RH, 0.0039], [RH - 0.0007, 0.0045], [0, 0.0045]]
    .map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), 6, Math.PI / 6).toNonIndexed();
  hex.computeVertexNormals();                                           // sextavado com face plana de verdade
  const hn = hex.attributes.normal.array, hp = hex.attributes.position.array;
  for (let i = 0; i < hn.length; i += 3) {
    // triângulos degenerados no eixo dão normal nula: aponta pelo eixo para não virar NaN no shader
    if (Math.hypot(hn[i], hn[i + 1], hn[i + 2]) < 0.5) { hn[i] = 0; hn[i + 1] = hp[i + 1] > 0.002 ? 1 : -1; hn[i + 2] = 0; }
  }
  const tip = new THREE.LatheGeometry([[0, 0.0044], [0.0022, 0.0044], [0.0022, 0.0064], [0.0027, 0.0068], [0.0029, 0.0072],
    [0.0029, L - 0.0026], [0.0026, L - 0.0014], [0.0018, L - 0.0005], [0.0009, L - 0.0001], [0, L]]
    .map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), seg).toNonIndexed();
  const g = mergeGeometries([hex, tip], false);
  hex.dispose(); tip.dispose();
  const p = g.attributes.position.array, n = g.attributes.normal.array, I = new Uint32Array(p.length / 3);
  for (let i = 0; i < n.length; i += 3) {
    // a LatheGeometry não normaliza a normal do último ponto do perfil (polo da ponta)
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (l > 1e-9) { n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; } else { n[i] = 0; n[i + 1] = 1; n[i + 2] = 0; }
  }
  for (let i = 0; i < I.length; i++) I[i] = i;
  orient(p, n, I);
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/* ---------------- a peça ---------------- */
export function buildCaliper(ctx) {
  const { mats } = ctx;
  const tier = ctx.tier || (mats && mats.tier) || "base";
  const q = Q[tier] || Q.base;
  const ownGeo = [], ownMat = [];
  const keep = (g) => { ownGeo.push(g); return g; };
  const own = (m) => { ownMat.push(m); return m; };
  const phys = (o) => own(new THREE.MeshPhysicalMaterial(o));

  const root = new THREE.Group(); root.name = "caliper";
  const outerG = new THREE.Group(); outerG.name = "caliper.outer"; root.add(outerG);
  const innerG = new THREE.Group(); innerG.name = "caliper.inner"; root.add(innerG);
  const padsG = new THREE.Group(); padsG.name = "caliper.pads"; root.add(padsG);

  /* ---- materiais: verniz vermelho com AO por vértice; ferragens próprias (clones, não mexem no MaterialSet) ---- */
  // clone próprio: a casca de laranja da fundação (0.06) estava grossa demais, vira martelado; 0.006 só ondula o risco
  const paint = own((mats.ao ? mats.ao("caliperPaint") : mats.caliperPaint).clone());
  if (paint.clearcoatNormalScale) paint.clearcoatNormalScale.set(0.006, 0.006);
  const hwBase = (hex, rough) => {
    const m = mats.chrome ? own(mats.chrome.clone()) : phys({ metalness: 1 });
    m.color.set(hex); m.roughness = rough; return m;
  };
  const pistonMat = hwBase("#c6c9cd", 0.16); pistonMat.name = "v3.caliper.piston";   // inox polido
  const boltMat = hwBase("#a7abb0", 0.3); boltMat.name = "v3.caliper.bolt";           // aço zincado
  const bleedMat = hwBase("#c4ad7c", 0.28); bleedMat.name = "v3.caliper.bleed";       // zincado amarelo (sangrador real)
  const backMat = mats.padSteel || phys({ color: "#8a8c8f", metalness: 1, roughness: CP.pad.backing.roughness });
  const fricMat = mats.padFriction || phys({ color: CP.pad.friction.color, metalness: 0, roughness: CP.pad.friction.roughness });

  /* ---- metades: campo -> malha; a de dentro é o espelho exato (a spec pede metades espelhadas) ---- */
  const halfL = buildHalfLocal(q.cell, q.lathe + 8);
  const halfLin = buildHalfLocal(q.cellIn, q.lathe - 8);
  if (!paint.vertexColors) halfL.col = halfLin.col = null;
  const outerMesh = new THREE.Mesh(keep(localToGeometry(halfL, false)), paint);
  outerMesh.name = "caliper.outerHalf";
  outerG.add(outerMesh);
  const innerMesh = new THREE.Mesh(keep(localToGeometry(halfLin, true)), paint);
  innerMesh.name = "caliper.innerHalf";
  innerG.add(innerMesh);

  /* ---- parafusos da ponte: cabeça na face de fora, haste atravessa a ponte e rosca na metade de dentro.
          No split a haste aparece saindo da partição, como numa vista explodida de verdade. ---- */
  const boltLen = XO - XM + 0.018;
  const boltGeo = keep(boltGeometry({ d: 0.008, length: boltLen, af: 0.012, head: 0.0055, flange: true, detail: q.bolt }));
  const bolts = new THREE.InstancedMesh(boltGeo, boltMat, CP.bridgeBolts);
  bolts.name = "caliper.bridgeBolts";
  const m4 = new THREE.Matrix4(), m4b = new THREE.Matrix4();
  [-1, 1].slice(0, CP.bridgeBolts).forEach((sgn, i) => {
    const [a, b] = polar(R_BOLT, sgn * PHI_BOLT);
    // o parafuso assenta na face coroada: eixo na normal da face, base tangente ao arco
    const [ga, gb] = crownGrad(a, b), wl = Math.hypot(1, ga, gb);
    const wv = [1 / wl, -ga / wl, -gb / wl], e1v = [wv[1], -wv[0], 0], l1 = Math.hypot(e1v[0], e1v[1]);
    const w = V3(wv[0], wv[1], wv[2]), e1 = V3(e1v[0] / l1, e1v[1] / l1, 0), e2 = new THREE.Vector3().crossVectors(w, e1);
    m4.makeBasis(w, e1, e2).multiply(m4b.makeRotationX(0.37 + i * 0.61)); // fase do sextavado diferente: apertado de verdade
    m4.setPosition(XO + crownAt(a, b), toWY(a, b), toWZ(a, b));
    bolts.setMatrixAt(i, m4);
  });
  bolts.instanceMatrix.needsUpdate = true;
  bolts.computeBoundingBox(); bolts.computeBoundingSphere();
  outerG.add(bolts);

  /* ---- sangradores: um por metade, no topo (theta 90°), eixo radial. Instanciados, matriz refeita no split ---- */
  const bleedGeo = keep(bleedGeometry(Math.max(16, q.lathe - 8)));
  const bleeds = new THREE.InstancedMesh(bleedGeo, bleedMat, CP.bleedNipples);
  bleeds.name = "caliper.bleeders"; bleeds.frustumCulled = false;
  const [bla, blb] = polar(BOSS_T1, PHI_BLEED);
  const bleedY = new THREE.Vector3(0, toWY(Math.sin(PHI_BLEED), Math.cos(PHI_BLEED)), toWZ(Math.sin(PHI_BLEED), Math.cos(PHI_BLEED))).normalize();
  const bleedX = new THREE.Vector3(1, 0, 0), bleedZ = new THREE.Vector3().crossVectors(bleedX, bleedY);
  const bleedBasis = new THREE.Matrix4().makeBasis(bleedX, bleedY, bleedZ);
  const bleedPos = [new THREE.Vector3(XC, toWY(bla, blb), toWZ(bla, blb)), new THREE.Vector3(2 * XM - XC, toWY(bla, blb), toWZ(bla, blb))];
  root.add(bleeds);

  /* ---- pistões: 3 por metade, escondidos até o B3. Instância = escala radial pelo diâmetro (normal certa na three) ---- */
  const pistons = new THREE.InstancedMesh(keep(pistonGeometry(q.lathe)), pistonMat, CP.pistons);
  pistons.name = "caliper.pistons"; pistons.frustumCulled = false; pistons.visible = false;
  const X_PFRONT = X_BK1 + 0.0001;                                       // boca encostada na chapa
  const rotPi = new THREE.Matrix4().makeRotationZ(Math.PI);
  root.add(pistons);

  /* ---- pastilhas: chapa de aço com orelha furada + material de atrito; pino atravessa a janela ---- */
  const bkOutline = sectorOutline(PAD_BK, q.arcStep, TAB);
  const bkHole = circle2(0, PIN_RC, PIN_R + 0.0002, 18);
  const frOutline = sectorOutline(PAD_FR, q.arcStep);
  const bkL = extrudeRounded(bkOutline, [bkHole], X_FR1, X_BK1, 0.0006, 2);
  const frL = extrudeRounded(frOutline, [], X_FR0, X_FR1 + 0.0002, 0.0008, 2); // 0.2 mm dentro da chapa: sem fresta
  const pinLen = (XI + 0.008) - (2 * XM - XI - 0.008);                   // 8 mm enterrado em cada metade
  const pinGeo = lathe([[0, 0], [PIN_R - 0.0005, 0], [PIN_R, 0.0005], [PIN_R, pinLen - 0.0005], [PIN_R - 0.0005, pinLen], [0, pinLen]], 16);
  pinGeo.translate(0, -pinLen / 2, 0); pinGeo.rotateZ(-Math.PI / 2);     // eixo Y -> +X
  pinGeo.translate(XM, toWY(0, PIN_RC), toWZ(0, PIN_RC));
  const bkO = localToGeometry(bkL, false), bkI = localToGeometry(bkL, true);
  const backGeo = keep(mergeGeometries([bkO, bkI, pinGeo], false));
  bkO.dispose(); bkI.dispose(); pinGeo.dispose();
  if (!backGeo) throw new Error("caliper: mergeGeometries das chapas falhou");
  backGeo.computeBoundingBox(); backGeo.computeBoundingSphere();
  const frO = localToGeometry(frL, false), frI = localToGeometry(frL, true);
  const fricGeo = keep(mergeGeometries([frO, frI], false));
  frO.dispose(); frI.dispose();
  if (!fricGeo) throw new Error("caliper: mergeGeometries do atrito falhou");
  fricGeo.computeBoundingBox(); fricGeo.computeBoundingSphere();
  const backing = new THREE.Mesh(backGeo, backMat); backing.name = "caliper.padBacking";
  const friction = new THREE.Mesh(fricGeo, fricMat); friction.name = "caliper.padFriction";
  padsG.add(backing, friction);

  /* ---- estado e matrizes (só recalcula quando muda: barato por quadro) ---- */
  const ER = new THREE.Vector3(0, ER_Y, ER_Z);
  const state = { split: 0, pist: 0, pads: 0 };
  const STAGGER = 0.06;                                                  // ~30 ms entre pistões numa janela de ~0.5 s
  const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
  function writeInstances() {
    const sp = state.split;
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? 0 : 1, k = i % 3, p = PIST[k];
      const t = clamp01((state.pist - i * STAGGER) / (1 - 5 * STAGGER));
      const ext = CP.pistonExtend * easeOut(t), s = p.d / DIAMS[2];
      m4.makeScale(1, s, s);
      if (side === 1) m4.premultiply(rotPi);
      const x = side === 0 ? X_PFRONT - ext + sp : 2 * XM - X_PFRONT + ext - sp;
      m4.setPosition(x, toWY(p.a, p.b), toWZ(p.a, p.b));
      pistons.setMatrixAt(i, m4);
    }
    pistons.instanceMatrix.needsUpdate = true;
    pistons.visible = sp > 0.0005 || state.pist > 0.001;
    for (let i = 0; i < CP.bleedNipples; i++) {
      m4b.copy(bleedBasis).setPosition(bleedPos[i].x + (i === 0 ? sp : -sp), bleedPos[i].y, bleedPos[i].z);
      bleeds.setMatrixAt(i, m4b);
    }
    bleeds.instanceMatrix.needsUpdate = true;
  }
  writeInstances();

  /* ---- âncoras (raiz na origem: local = mundo) ---- */
  const anchors = {
    center: new THREE.Vector3(...CP.center),
    outerFace: V3(XO, 0, PISTON_R),
    innerFace: V3(2 * XM - XO, 0, PISTON_R),
    window: V3(XM, 0, R1),                                               // topo da janela da pastilha
    bleedOuter: V3(XC, ...polar(BOSS_T1 + BLEED_LEN, PHI_BLEED)),        // ponta do sangrador
    bleedInner: V3(2 * XM - XC, ...polar(BOSS_T1 + BLEED_LEN, PHI_BLEED)),
    padLeading: V3(X_FO, ...polar(0.16, -PAD_FR.phi)),                   // entrada da pastilha na pista de fora
    padTrailing: V3(X_FO, ...polar(0.16, PAD_FR.phi)),                   // saída: onde nascem as faíscas
    padTrailingInner: V3(2 * XM - X_FO, ...polar(0.16, PAD_FR.phi)),
    dome0: V3(DOME_X1, PIST[0].a, PIST[0].b),
    dome1: V3(DOME_X1, PIST[1].a, PIST[1].b),
    dome2: V3(DOME_X1, PIST[2].a, PIST[2].b),
  };

  const part = {
    root, anchors,
    outer: outerG, inner: innerG, pads: padsG, pistons, bolts, bleeds,
    explodeAxis: ER.clone().normalize(),                                 // sai radialmente, por cima do disco
    explodeDist: 0.12,
    /** Setor da pastilha para a sim de calor: ângulo theta do centro e largura (64° da spec). */
    padSector: { angle: CP.angle, width: CP.padSectorDeg * D },

    /** Abre as metades: +m a de fora, -m a de dentro (B3: 0.04). Parafusos vão com a de fora. */
    setSplit(m) {
      m = Math.max(0, +m || 0);
      if (m === state.split) return;
      state.split = m; outerG.position.x = m; innerG.position.x = -m; writeInstances();
    },
    /** 0..1: pistões saem 18 mm dos furos em direção ao disco, escalonados (~30 ms entre cada). */
    setPistons(v) {
      v = clamp01(+v || 0);
      if (v === state.pist) return;
      state.pist = v; writeInstances();
    },
    /** 0..1: pastilhas (com o pino) saem 25 mm radialmente pela janela. */
    setPads(v) {
      v = clamp01(+v || 0);
      if (v === state.pads) return;
      state.pads = v; padsG.position.copy(ER).multiplyScalar(CP.padSlide * v);
    },

    dispose() {
      for (const g of ownGeo) g.dispose();
      for (const m of ownMat) m.dispose();
      root.removeFromParent();
    },
  };
  return part;
}
