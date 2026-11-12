/* v3 · BANDEJA INFERIOR (lower control arm), seção 2 da spec.
   Coordenadas do mundo: cubo na origem, eixo da roda em +X, +Y para cima, -Z = traseira.
   Montagem: root fica na origem; tudo gira num "pivot" posto no eixo das buchas (-0.45, -0.15, Z) com eixo de giro = Z.
   No referencial do pivot: +X aponta para o pivô esférico (L = 0.3306 m), Z = lateral, Y = espessura da chapa.
   Peças: chapa forjada em Y (contorno por SDF, furo de alívio, bisel 5 mm), aleta de reforço com cordão de solda
   em volta (TubeGeometry r 3 mm sobre CatmullRom tremido, ondulação de passada, mapa de revenimento),
   faixa de revenimento (ZTA) na chapa, 2 buchas (alojamento forjado + borracha + bucha de aço + parafuso),
   pivô esférico (copo de torno + esfera + pino cônico). 6 draws. */
import * as THREE from "three";
import { LAYOUT } from "../spec.js";
import { rng } from "../textures.js";
import { hexPrism } from "../../three/kit.js";
import { clamp, smoothstep, sdCircle, sdSegment, sdTriangle, smin, smax, sdfLoops, loopArea, simplifyLoop, roundPoly, lathe, creaseNormals, mergeGeos } from "./geomkit.js";

const A = LAYOUT.arm;
// eixo das buchas: reta x = -0.45, y = -0.15 ao longo de Z
const PIVOT = new THREE.Vector3(A.bushings[0][0], A.bushings[0][1], 0);
const BJ_SPEC = new THREE.Vector3(...A.ballJoint);
/* DESVIO DA SPEC: o pivô da spec (-0.08, -0.17, 0) cai DENTRO do disco de 380 mm (pista de x -0.082 a -0.048,
   raio 0.12 a 0.19; o pivô está em r 0.17). O olhal e a esfera atravessariam o ferro girando.
   A esfera vai para dentro do disco, mesma altura: olhal de 64 mm a 5.3 mm da face interna (medido na malha,
   o bisel e os raios de forja comem 0.7 mm). Para reverter: BJ = BJ_SPEC (a forma toda segue L). */
const BOSS_R = 0.032;      // olhal do pivô: 64 mm
const ROTOR_IN = LAYOUT.x.rotorMid - LAYOUT.rotor.thickness / 2;     // -0.082: face interna da pista
const BJ = new THREE.Vector3(ROTOR_IN - 0.006 - BOSS_R, BJ_SPEC.y, 0); // (-0.120, -0.17, 0)
const L = Math.hypot(BJ.x - PIVOT.x, BJ.y - PIVOT.y);       // 0.3306: braço de alavanca real (spec diz 0.38 para o pivô dela)
const REST = Math.atan2(BJ.y - PIVOT.y, BJ.x - PIVOT.x);    // -3.5 graus: o pivô fica 20 mm abaixo das buchas
const ZB = Math.abs(A.bushings[0][2]);                      // 0.15: meia distância entre buchas

/* chapa: 24 mm de espessura, deslocada 8 mm para baixo do eixo para o copo do pivô sobrar 4.5 mm acima dela */
const TH = A.depth, BEV = A.bevel;
const PLATE_MID = -0.008, PLATE_TOP = PLATE_MID + TH / 2;   // topo da chapa em y = +0.004 (local)

/* contorno em planta (x ao longo do braço a partir do eixo das buchas, z lateral). Medidas de bandeja forjada de verdade */
const LEG_R = 0.022;       // perna: 44 mm de largura
const STEM_R = 0.024;      // haste até o pivô: 48 mm
const JX = L - 0.128;      // 0.203: onde as pernas se juntam (haste de 128 mm até o centro da esfera)
const KX = 0.055;          // a perna entra reta (ao longo de X) nos últimos 55 mm: chega no meio do alojamento, não de quina
const WEB = 0.85;          // a alma entre as pernas vai até 85% do caminho J -> K
const WEB_CUT = { c: -0.30, r: 0.39 }; // círculo que escava a borda da alma: côncava ~13 mm, olhando para as buchas
const HOLE = { a: [0.118, 0.046], b: [0.118, -0.046], c: [0.172, 0], round: 0.008 }; // furo de alívio: parede mínima de 17.5 mm até a borda (medido no SDF)

/* aleta de reforço (gusset) em pé sobre a haste, 5 mm de chapa, soldada em volta; termina 14 mm antes do copo do pivô */
const FIN = { x0: L - 0.1485, x1: L - 0.0375, h: 0.026, half: 0.0025, bev: 0.0012 };
const finTop = (x) => (x <= FIN.x0 ? -0.002 : x >= FIN.x1 - 0.007 ? FIN.h : -0.002 + (FIN.h + 0.002) * Math.pow((x - FIN.x0) / (FIN.x1 - 0.007 - FIN.x0), 1.5));

export function buildArm(ctx) {
  const { mats, tex, tier } = ctx;
  const low = tier === "low";
  const root = new THREE.Group(); root.name = "arm";
  const pivot = new THREE.Group(); pivot.name = "arm.pivot";
  pivot.position.copy(PIVOT); pivot.rotation.z = REST;
  root.add(pivot);

  /* ---------------- chapa forjada ----------------
     SDF: pernas (cápsulas) + haste + olhal + alma, uniões suaves = raios de forja; menos o furo.
     Extraída em iso -BEV porque o bisel do ExtrudeGeometry empurra a parede 5 mm para fora: a largura final é a real. */
  const sdf = (x, zz) => {
    const z = Math.abs(zz); // simétrico em Z
    // perna em dois trechos (J -> K diagonal, K -> bucha reto); o fim fica escondido dentro do alojamento
    const leg = smin(sdSegment(x, z, JX, 0, KX, ZB), sdSegment(x, z, KX, ZB, 0.008, ZB), 0.03) - LEG_R;
    // a haste para 12 mm antes do centro: se fosse até L, a união suave incharia a ponta do olhal ~5 mm (encostaria no disco)
    const stem = sdSegment(x, z, JX - 0.02, 0, L - 0.012, 0) - STEM_R;
    const boss = sdCircle(x, z, L, 0, BOSS_R);
    const wx = JX + (KX - JX) * WEB, wz = ZB * WEB;
    let web = sdTriangle(x, z, [JX, 0], [wx, wz], [wx, -wz]);
    web = smax(web, -sdCircle(x, z, WEB_CUT.c, 0, WEB_CUT.r), 0.012);  // borda da alma levemente côncava, olhando para as buchas
    let d = smin(leg, stem, 0.03);
    d = smin(d, boss, 0.03);
    d = smin(d, web, 0.02);
    const hole = sdTriangle(x, z, HOLE.a, HOLE.b, HOLE.c) - HOLE.round;
    return smax(d, -hole, 0.008);
  };
  const loops = sdfLoops(sdf, { x0: -0.045, x1: L + BOSS_R + 0.012, y0: -(ZB + LEG_R + 0.012), y1: ZB + LEG_R + 0.012, step: low ? 0.0016 : 0.001, iso: -BEV })
    .filter((l) => Math.abs(loopArea(l)) > 2e-5)
    .map((l) => simplifyLoop(l, 0.00008))
    .sort((p, q) => Math.abs(loopArea(q)) - Math.abs(loopArea(p)));
  const V2 = (l) => l.map(([x, y]) => new THREE.Vector2(x, y));
  const shape = new THREE.Shape(V2(loops[0]));
  for (const h of loops.slice(1)) shape.holes.push(new THREE.Path(V2(h)));
  let plate = new THREE.ExtrudeGeometry(shape, { depth: TH - 2 * BEV, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: low ? 3 : 4, steps: 1, curveSegments: 1 });
  plate.rotateX(-Math.PI / 2);                 // extrusão vira +Y; forma y vira -Z (simétrica, tanto faz)
  plate.translate(0, PLATE_MID - (TH - 2 * BEV) / 2, 0);
  plate = creaseNormals(plate, 38);

  /* ---------------- aleta (gusset) ----------------
     Perfil em XY: base 2 mm enterrada na chapa, hipotenusa côncava, canto de cima com raio de 4 mm. */
  const finPts = [[FIN.x0, -0.002], [FIN.x1, -0.002], [FIN.x1, FIN.h]];
  for (let k = 0; k <= 12; k++) { const x = FIN.x1 - 0.007 - (k / 12) * (FIN.x1 - 0.007 - FIN.x0 - 0.002); finPts.push([x, finTop(x)]); }
  const finShape = new THREE.Shape(V2(roundPoly(finPts, finPts.map((_, i) => (i === 2 ? 0.004 : i === 3 ? 0.003 : 0)), { seg: 5 })));
  let fin = new THREE.ExtrudeGeometry(finShape, { depth: 2 * FIN.half - 2 * FIN.bev, bevelEnabled: true, bevelThickness: FIN.bev, bevelSize: FIN.bev, bevelSegments: 2, steps: 1, curveSegments: 1 });
  fin.translate(0, PLATE_TOP, -FIN.half + FIN.bev);
  fin = creaseNormals(fin, 40);

  /* ---------------- buchas ----------------
     Alojamento forjado (tubo 60 x 47 mm, 50 mm de comprimento, eixo Z), borracha (bombeada 2 mm para fora),
     bucha interna de aço (23 x 13 mm, 62 mm), arruela e parafuso M14 (cabeça sextavada de um lado, porca do outro). */
  /* quinas de torno: nada de 90 graus. Pontos por quarto de volta proporcionais ao raio (seg 2-3 em raio de 1 mm basta:
     cada ponto do perfil vira 2 x segmentos triângulos, e a bandeja fica quase toda atrás da roda) */
  const R = 0.0012;
  const housingP = roundPoly([[0.0235, -0.025], [0.030, -0.025], [0.030, 0.025], [0.0235, 0.025]], [R, R * 1.5, R * 1.5, R], { seg: 3 });
  housingP.push(housingP[0]);
  const rubberP = [[0.0115, -0.0262], [0.0150, -0.0274], [0.0195, -0.0270], [0.0226, -0.0256], [0.0233, -0.0240], [0.0233, 0.0240], [0.0226, 0.0256], [0.0195, 0.0270], [0.0150, 0.0274], [0.0115, 0.0262], [0.0115, -0.0262]];
  const sleeveP = roundPoly([[0.0065, -0.031], [0.0115, -0.031], [0.0115, 0.031], [0.0065, 0.031]], 0.0007, { seg: 2 }); sleeveP.push(sleeveP[0]);
  const washerP = roundPoly([[0.0072, -0.00125], [0.0145, -0.00125], [0.0145, 0.00125], [0.0072, 0.00125]], 0.0004, { seg: 2 }); washerP.push(washerP[0]);
  const tipP = roundPoly([[0, 0], [0.0068, 0], [0.0068, 0.008], [0, 0.008]], [0, 0.0005, 0.0012, 0], { closed: false, seg: 3 });
  const seg = low ? 32 : 48;
  const forgedParts = [plate, fin], rubberParts = [], chromeParts = [], darkParts = [];
  for (const s of [1, -1]) {
    const z = s * ZB, onAxis = (g, dz = 0, flip = false) => { g.rotateX(Math.PI / 2); if (flip) g.rotateX(Math.PI); g.translate(0, 0, z + dz); return g; };
    forgedParts.push(onAxis(lathe(housingP, seg)));
    rubberParts.push(onAxis(lathe(rubberP, seg)));
    chromeParts.push(onAxis(lathe(sleeveP, 24)));
    // fora (longe de z = 0): cabeça do parafuso; dentro: porca + ponta de rosca
    const out = s, ext = 0.031;
    darkParts.push(onAxis(lathe(washerP, 24), out * (ext + 0.00125)), onAxis(lathe(washerP, 24), -out * (ext + 0.00125)));
    // sextavados: normal com vinco, senão o chanfro de 0.8 mm fica facetado no reflexo
    const head = creaseNormals(hexPrism(THREE, 0.021, 0.009, 0.0008), 40); darkParts.push(onAxis(head, out * (ext + 0.0025 + 0.0045)));
    const nut = creaseNormals(hexPrism(THREE, 0.021, 0.011, 0.0008), 40); darkParts.push(onAxis(nut, -out * (ext + 0.0025 + 0.0055)));
    const tip = lathe(tipP, 20); darkParts.push(onAxis(tip, -out * (ext + 0.0025 + 0.011), out > 0));
  }

  /* ---------------- pivô esférico ----------------
     Copo prensado no olhal (eixo Y local), lábio repuxado segura a esfera de 32 mm; centro da esfera = âncora ballJoint. */
  const cup = [[0, -0.032], [0.016, -0.032], [0.0235, -0.026], [0.0235, 0.0035], [0.0222, 0.0072], [0.0185, 0.0088], [0.0142, 0.0082]];
  const rb = Math.hypot(0.0142, 0.0082); // segue a esfera por dentro até o eixo (sólido à esquerda)
  for (let k = 1; k <= 10; k++) { const a = Math.atan2(0.0082, 0.0142) - (k / 10) * (Math.atan2(0.0082, 0.0142) + Math.PI / 2); cup.push([Math.max(0, Math.cos(a) * rb), Math.sin(a) * rb]); }
  const cupG = lathe(roundPoly(cup, [0, 0.004, 0.003, 0.002, 0.0015, 0.001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { closed: false, seg: 4 }), seg);
  cupG.translate(L, 0, 0); darkParts.push(cupG);
  const ball = new THREE.SphereGeometry(0.016, 32, 20); ball.translate(L, 0, 0); chromeParts.push(ball);
  const stud = lathe(roundPoly([[0, 0.010], [0.0068, 0.010], [0.0068, 0.0172], [0.0100, 0.0195], [0.0100, 0.0218], [0.0078, 0.0400], [0.0062, 0.0412], [0.0062, 0.0560], [0.0052, 0.0570], [0, 0.0570]],
    [0, 0, 0.0012, 0.0008, 0.0008, 0.0006, 0.0004, 0, 0, 0], { closed: false, seg: 3 }), 32);
  stud.translate(L, 0, 0); chromeParts.push(stud);

  /* ---------------- cordão de solda ----------------
     Filete em volta da aleta: lado +Z, contorna a ponta, volta por -Z. Centro do tubo 1.2 mm fora de cada parede,
     então metade do tubo fica enterrada e o resto lê como filete de ~4 mm de perna. */
  const rand = rng(77), jit = (k) => (rand() - 0.5) * k;
  // começa onde a aleta já passou de ~2 mm acima da chapa (antes disso ela está enterrada)
  const yb = PLATE_TOP + 0.0012, zs = FIN.half + 0.0012, xa = FIN.x0 + 0.016, xe = FIN.x1 + FIN.bev - 0.0025;
  const ctrl = [];
  const nStr = 14;
  for (let k = 0; k <= nStr; k++) { const x = xa + (k / nStr) * (xe - 0.003 - xa); ctrl.push(new THREE.Vector3(x, yb + jit(0.0003), zs + jit(0.0005))); }
  for (let k = 0; k <= 6; k++) { const a = Math.PI / 2 - (k / 6) * Math.PI, r = zs + jit(0.0004); ctrl.push(new THREE.Vector3(xe + Math.cos(a) * r, yb + jit(0.0003), Math.sin(a) * r)); }
  for (let k = nStr; k >= 0; k--) { const x = xa + (k / nStr) * (xe - 0.003 - xa); ctrl.push(new THREE.Vector3(x, yb + jit(0.0003), -zs + jit(0.0005))); }
  const path = new THREE.CatmullRomCurve3(ctrl, false, "centripetal");
  // amostra a cada 0.5-0.9 mm: 3 a 5 amostras por crista de 2.4 mm, o mínimo para a ondulação ler
  const len = path.getLength(), TS = Math.round(len / (low ? 0.0009 : tier === "high" ? 0.0005 : 0.0007)), RS = 8, rw = A.weldBeadR;
  const bead = new THREE.TubeGeometry(path, TS, rw, RS, false);
  // direção "para fora" horizontal: do eixo da aleta para o cordão. Bissetriz do canto = meio entre +Y e essa direção.
  const outDir = (c, o) => o.set(c.x - clamp(c.x, FIN.x0, xe), 0, c.z).normalize();
  {
    const P = bead.attributes.position, UV = bead.attributes.uv, c = new THREE.Vector3(), o = new THREE.Vector3(), od = new THREE.Vector3(), bis = new THREE.Vector3();
    const PITCH = 0.0024; // passada de MIG: uma crista a cada 2.4 mm
    for (let i = 0; i <= TS; i++) {
      const u = i / TS, s = u * len;
      path.getPointAt(u, c); outDir(c, od); bis.set(0, 1, 0).add(od).normalize();
      const f = (s / PITCH) % 1, rip = 1 - 0.085 * f * f;                       // dente de serra: crista viva, rampa suave
      const taper = 0.12 + 0.88 * smoothstep(0, 0.006, s) * smoothstep(0, 0.006, len - s); // cratera no início e no fim
      for (let j = 0; j <= RS; j++) {
        const k = i * (RS + 1) + j;
        o.set(P.getX(k), P.getY(k), P.getZ(k)).sub(c);
        const along = o.dot(bis);
        o.addScaledVector(bis, -0.22 * along).multiplyScalar(rip * taper);   // filete é mais chato que redondo
        P.setXYZ(k, c.x + o.x, c.y + o.y, c.z + o.z);
        // cor: pé do cordão palha, crista roxo-azulada; manchas ao longo
        const crown = along / rw, heat = 0.24 + 0.36 * smoothstep(-0.1, 0.9, crown) + 0.05 * Math.sin(s * 1700 + j * 0.9) + 0.04 * Math.sin(s * 310);
        UV.setXY(k, clamp(heat, 0.02, 0.98), s * 6);
      }
    }
    bead.computeVertexNormals();
    // costura do tubo (j = 0 e j = RS no mesmo lugar): média, senão aparece um risco ao longo do cordão
    const N = bead.attributes.normal;
    for (let i = 0; i <= TS; i++) {
      const a = i * (RS + 1), b = a + RS, x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b), l = Math.hypot(x, y, z) || 1;
      N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l);
    }
  }

  /* ---------------- zona termicamente afetada ----------------
     Faixas finas coladas na chapa e nas faces da aleta, com a mesma rampa do mapa de revenimento em cor de vértice + alfa.
     Azul junto do cordão, palha mais longe, some no aço nu. É o que vende "isso foi soldado de verdade". */
  const stops = (tex && tex.heatTintMap && tex.heatTintMap().userData.stops) || [[0, [150, 152, 156]], [0.14, [205, 190, 140]], [0.28, [200, 158, 78]], [0.42, [158, 96, 50]], [0.54, [112, 52, 92]], [0.66, [52, 64, 146]], [0.8, [74, 118, 176]], [1, [118, 128, 140]]];
  const tint = (x, out) => {
    x = clamp(x, 0, 1);
    for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (x - a) / (b - a);
      return out.setRGB((ca[0] + (cb[0] - ca[0]) * t) / 255, (ca[1] + (cb[1] - ca[1]) * t) / 255, (ca[2] + (cb[2] - ca[2]) * t) / 255, THREE.SRGBColorSpace);
    }
    const l = stops[stops.length - 1][1]; return out.setRGB(l[0] / 255, l[1] / 255, l[2] / 255, THREE.SRGBColorSpace);
  };
  const ribbon = (cols, rows, at) => {
    // at(i, r) -> {p, n, heat, alpha}; grade cols x rows, triângulos com a frente para n
    const nV = cols * rows, pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), col = new Float32Array(nV * 4), idx = [], cc = new THREE.Color();
    for (let i = 0; i < cols; i++) for (let r = 0; r < rows; r++) {
      const k = i * rows + r, v = at(i, r);
      pos.set([v.p.x, v.p.y, v.p.z], k * 3); nor.set([v.n.x, v.n.y, v.n.z], k * 3);
      tint(v.heat, cc); col.set([cc.r, cc.g, cc.b, v.alpha], k * 4);
    }
    for (let i = 0; i < cols - 1; i++) for (let r = 0; r < rows - 1; r++) {
      const a = i * rows + r, b = a + rows, c = b + 1, d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 4)); g.setIndex(idx);
    // a frente do triângulo depende do sentido do caminho: confere com a normal pedida e vira se preciso
    // usa um triângulo do meio da faixa (as pontas podem ser degeneradas)
    const ia = g.index.array, t0 = 3 * Math.floor(ia.length / 6), p = (j) => new THREE.Vector3().fromArray(pos, ia[t0 + j] * 3);
    const e1 = p(1).sub(p(0)), e2 = p(2).sub(p(0)), fn = e1.cross(e2), want = new THREE.Vector3().fromArray(nor, ia[t0] * 3);
    if (fn.dot(want) < 0) for (let j = 0; j < ia.length; j += 3) { const t = ia[j + 1]; ia[j + 1] = ia[j + 2]; ia[j + 2] = t; }
    return g;
  };
  const COLS = low ? 90 : 160, noise = (s, d) => 0.05 * Math.sin(s * 820 + d * 900) + 0.035 * Math.sin(s * 211 + 1.7);
  const cP = new THREE.Vector3(), od2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const D0 = 0.003, D1 = 0.015; // do eixo do cordão até 15 mm na chapa (a parte plana do topo da haste acaba em z 19 mm)
  const hazPlate = ribbon(COLS, 7, (i, r) => {
    const u = i / (COLS - 1), s = u * len, t = r / 6, d = D0 + (D1 - D0) * t;
    path.getPointAt(u, cP); outDir(cP, od2);
    const fade = smoothstep(0, 0.012, s) * smoothstep(0, 0.012, len - s);
    return { p: new THREE.Vector3(cP.x + od2.x * d, PLATE_TOP + 0.00015, cP.z + od2.z * d), n: UP, heat: 0.7 * Math.pow(1 - t, 1.25) + noise(s, d), alpha: 0.88 * (1 - smoothstep(0.45, 1, t)) * fade };
  });
  const hazFin = [1, -1].map((sg) => ribbon(Math.round(COLS / 2), 6, (i, r) => {
    const x = xa + (i / (Math.round(COLS / 2) - 1)) * (xe - 0.004 - xa), t = r / 5;
    const hMax = clamp(finTop(x) + FIN.bev - 0.001, 0.0035, 0.014), h = 0.0035 + (hMax - 0.0035) * t;
    const fade = smoothstep(xa, xa + 0.012, x) * smoothstep(0.0035, 0.0065, finTop(x));
    return { p: new THREE.Vector3(x, PLATE_TOP + h, sg * (FIN.half + 0.00015)), n: new THREE.Vector3(0, 0, sg), heat: 0.66 * Math.pow(1 - t, 1.2) + noise(x, sg), alpha: 0.85 * (1 - smoothstep(0.4, 1, t)) * fade };
  }));
  const hazGeo = mergeGeometriesKeep([hazPlate, ...hazFin]);
  const hazMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, transparent: true, depthWrite: false, metalness: 1, roughness: 0.38,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  if (mats.forged && mats.forged.envMap) hazMat.envMap = mats.forged.envMap;
  hazMat.name = "v3.arm.haz";

  /* ---------------- malhas ---------------- */
  const mk = (g, m, name) => { const o = new THREE.Mesh(g, m); o.name = name; pivot.add(o); return o; };
  const meshes = {
    forged: mk(mergeGeos(forgedParts), mats.forged, "arm.forged"),
    rubber: mk(mergeGeos(rubberParts), mats.rubber, "arm.bushings"),
    chrome: mk(mergeGeos(chromeParts), mats.chrome, "arm.ball+sleeves"),
    dark: mk(mergeGeos(darkParts), mats.chromeBlack, "arm.cup+bolts"),
    weld: mk(bead, mats.weld, "arm.weld"),
    haz: mk(hazGeo, hazMat, "arm.haz"),
  };
  meshes.haz.renderOrder = 1;

  /* ---------------- âncoras (coordenadas do root = mundo, braço em repouso) ---------------- */
  pivot.updateMatrix();
  const toRoot = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(pivot.matrix);
  path.getPointAt(0.5, cP); // meio do cordão = ponta da aleta
  const anchors = {
    pivot: PIVOT.clone(),
    bushingFront: new THREE.Vector3(...A.bushings[0]),
    bushingRear: new THREE.Vector3(...A.bushings[1]),
    ballJoint: BJ.clone(),            // centro real da esfera (-0.120, -0.17, 0); ver o desvio no topo
    ballJointSpec: BJ_SPEC.clone(),   // o ponto da spec (-0.08, -0.17, 0), se a montagem quiser o pivô de cambagem dela
    weld: toRoot((xa + xe) / 2, yb + 0.002, zs + 0.002), // meio do lado +Z (frente), para a legenda "Exhaust and welding"
    weldTip: toRoot(cP.x, cP.y, cP.z),
    center: toRoot(L * 0.5, PLATE_MID, 0),
  };

  const _v = new THREE.Vector3();
  const part = {
    root, pivot, anchors, meshes,
    explodeAxis: new THREE.Vector3(-0.35, -1, 0).normalize(), // para dentro e para baixo, para longe do disco
    explodeDist: 0.18,
    restAngle: REST,
    lever: L,
    /** rad > 0 sobe o pivô esférico (curso positivo). Só mexe numa rotação. */
    setAngle(rad) { pivot.rotation.z = REST + rad; },
    /** curso relativo da suspensão (yu - ys, m) -> asin(curso / alavanca). Usa a alavanca real (0.3306), não os 0.38
        da spec, para a esfera acompanhar o grupo não suspenso ao milímetro. Root deve viajar no grupo suspenso. */
    setTravel(m) { pivot.rotation.z = REST + Math.asin(clamp(m / L, -0.95, 0.95)); },
    /** posição atual do centro da esfera, em coordenadas do root (sem alocar se out vier). */
    ballJointLocal(out = _v) { const a = pivot.rotation.z; return out.set(PIVOT.x + Math.cos(a) * L, PIVOT.y + Math.sin(a) * L, 0); },
    dispose() {
      for (const m of Object.values(meshes)) m.geometry.dispose();
      hazMat.dispose();
    },
  };
  return part;
}

/** junta geometrias indexadas mantendo o atributo de cor (o mergeGeos do kit só leva position/normal/uv). */
function mergeGeometriesKeep(list) {
  let nV = 0, nI = 0;
  for (const g of list) { nV += g.attributes.position.count; nI += g.index.count; }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), col = new Float32Array(nV * 4), idx = new Uint32Array(nI);
  let v = 0, i = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, v * 3); nor.set(g.attributes.normal.array, v * 3); col.set(g.attributes.color.array, v * 4);
    const ia = g.index.array; for (let k = 0; k < ia.length; k++) idx[i + k] = ia[k] + v;
    v += g.attributes.position.count; i += ia.length; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 4)); out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
