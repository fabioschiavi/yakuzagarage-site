/* v3 · cubo de roda, rolamento, prisioneiros e espaçador 15 mm (SPEC-3D seção 2 HUB/STUDS/SPACER, contrato seção 7).
   Mundo da spec: metros, centro do cubo na origem, eixo em +X (para fora), +Y para cima, theta = atan2(y, -z).
   A raiz fica na origem e sem giro: as posições locais já são as do mundo, então as âncoras saem direto.

   Estações em X (e por quê):
     face de montagem do sino do disco    -0.0003 (rotor.js; a placa do sino ocupa -0.0075..-0.0003)
     face do flange do cubo               -0.0076 (logo atrás do sino; a "face de montagem x 0" da spec é a face
                                                   de fora do sino, onde a roda/espaçador encostam)
     pino de centragem (Ø72.4)            -0.0076 .. +0.0095 (atravessa o furo r 0.0365 do sino e centra a roda)
     prisioneiros M14 (r 7 mm, 45 mm)     da face do flange até +0.0374
     anel externo do rolamento            -0.031 .. -0.093, flange de 4 orelhas -0.062 .. -0.050 (fixo, não gira)
     espaçador assentado                   0 .. +0.015, ressalto de centragem até +0.0235, prisioneiros até +0.0524
   Peças que giram com a roda ficam em `spin` (cubo, prisioneiros, espaçador); o rolamento fica na raiz.

   Espaçador: a spec pede "5 prisioneiros prensados". Prisioneiro coaxial com o do cubo brigaria em profundidade,
   e um padrão defasado bateria nos furos da roda. Saída: os prisioneiros do espaçador são os prisioneiros longos
   do kit (coaxiais), e enquanto o espaçador desliza sobre o cubo os prisioneiros do cubo encurtam por escala até a
   face de trás dele (a parte escondida dentro do furo). Assentado, lê como "o kit trouxe prisioneiros 15 mm mais
   longos", que é o que se vê num carro de verdade. */
import * as THREE from "three";
import { LAYOUT } from "../spec.js";
import { P, revolveGeometry, mergeGeometries, roundedSlab, circlePts, boltGeometry, STUDS, LUG_SEAT_X } from "../hardware.js";

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut3 = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut3 = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const H = LAYOUT.hub, SP = H.spacer;
const FLANGE_FACE = -0.0076;                     // 0.1 mm atrás da placa do sino: sem z-fight, sem fresta visível
const PILOT_R = 0.0362;                          // furo da roda e do espaçador é Ø72.6 (r 0.0363)
const PILOT_TIP = 0.0095;                        // pino sai 9.5 mm além de x 0 (BMW ~10 mm)
const STUD_R = H.studs.r;                        // 0.007 (M14)
const STUD_BASE = FLANGE_FACE - 0.001;           // começa 1 mm dentro do flange: sem fresta na saída
const HUB_STUD_TIP = FLANGE_FACE + H.studs.length; // +0.0374: 45 mm visíveis desde o flange
const SPACER_T = SP.thickness;                   // 0.015
const SPACER_STUD_TIP = SPACER_T + HUB_STUD_TIP; // +0.0524: a porca rosca o mesmo tanto com e sem espaçador
const SPACER_HOLE_R = 0.0075;                    // furo do prisioneiro prensado (serrilhado r 7.4)
const LIP_TOP = SPACER_T + 0.0085;               // ressalto de centragem da roda: 8.5 mm além da face
// trajeto do espaçador: sobe por baixo (de dentro da laje, topo em -0.3118) já afastado dos prisioneiros, gira
// para alinhar os furos, depois desliza em -X até assentar
const SPACER_X_OUT = 0.050;                      // face de trás 12.6 mm além da ponta dos prisioneiros do cubo
const SPACER_Y_FROM = -0.42;                     // topo do espaçador (r 0.075) em -0.345: escondido na laje
const SPACER_TWIST = -0.30;                      // rad de desalinhamento no começo da subida
const SPACER_SPLIT = 0.62;                       // fração de t gasta subindo; o resto é o encaixe em X

// flange do rolamento: 4 orelhas a 45° (diagonais, longe do braço e do amortecedor), parafusos M10 em r 0.058
const BRG = { face: -0.0502, back: -0.0618, rBase: 0.050, rLobe: 0.0195, lobePow: 20, boltR: 0.058, lobes: [45, 135, 225, 315] };

// o rolamento quase nunca aparece (atrás do sino e do disco): menos gomos. O espaçador só aparece no B2 e na órbita,
// onde tem 7..35 px de espessura/raio no celular: bisel de 2 gomos basta fora do tier high.
const Q = {
  high: { hub: 96, stud: 24, head: 20, brg: 40, slab: 144, sOuter: 192, sBore: 128, sHole: 24, sSegs: 3, lip: 128, segQ: 3, bolt: "high" },
  base: { hub: 40, stud: 18, head: 12, brg: 24, slab: 72, sOuter: 112, sBore: 80, sHole: 16, sSegs: 2, lip: 80, segQ: 2, bolt: "low" },
  low: { hub: 48, stud: 14, head: 12, brg: 24, slab: 80, sOuter: 112, sBore: 72, sHole: 14, sSegs: 2, lip: 64, segQ: 2, bolt: "low" },
};

const studYZ = (k, r = STUDS.r) => [r * Math.sin(STUDS.thetas[k]), -r * Math.cos(STUDS.thetas[k])];

/* ---------------- perfis (x, r, filete, {ao}) no sentido horário: normais para fora (ver hardware.revolveGeometry) ---------------- */

/** Cubo que gira: ponta do eixo (escondida no rolamento), barril, flange com rebaixo de fundição atrás,
    pino de centragem com chanfro de entrada e o copo do pino com o rebordo do anel interno (rebitagem orbital). */
function hubProfile() {
  return [
    P(-0.0420, 0, 0, { ao: 0.3 }),                       // ponta do eixo dentro do rolamento
    P(-0.0420, 0.0385, 0.0008, { ao: 0.3 }),
    P(-0.0180, 0.0385, 0.0075, { ao: 0.5 }),             // barril -> costas do flange, raio de fundição 7.5 mm
    P(-0.0162, 0.0695, 0.0015, { ao: 0.85 }),            // costas com saída de molde (1.8 mm em 31 mm)
    P(FLANGE_FACE, 0.0695, 0.0012),                      // aro do flange: Ø139, 8.6 mm
    P(FLANGE_FACE, PILOT_R, 0.0006, { ao: 0.5 }),        // face do flange (atrás do sino) até a raiz do pino
    P(0.0080, PILOT_R, 0.0012),                          // pino Ø72.4
    P(PILOT_TIP, 0.0347, 0.0006),                        // chanfro de entrada 45° x 1.5 mm
    P(PILOT_TIP, 0.0306, 0.0006),                        // ponta do pino (parede de 4 mm)
    P(0.0062, 0.0300, 0.0005, { ao: 0.55 }),             // chanfro interno, entra no copo
    P(-0.0050, 0.0300, 0.0030, { ao: 0.32 }),            // fundo do copo, canto com raio
    P(-0.0050, 0.0228, 0.0012, { ao: 0.35 }),
    P(-0.0028, 0.0200, 0.0024, { ao: 0.5 }),             // rebordo rebitado do anel interno
    P(-0.0052, 0.0166, 0.0018, { ao: 0.3 }),
    P(-0.0130, 0.0150, 0.0010, { ao: 0.2 }),             // furo central (escuro)
    P(-0.0130, 0, 0, { ao: 0.18 }),
  ];
}

/** Cabeça do prisioneiro atrás do flange (só aparece de dentro). Frente 0.2 mm enterrada no flange. */
function studHeadProfile() {
  return [
    P(-0.0200, 0, 0, { ao: 0.7 }),
    P(-0.0200, 0.0095, 0.0012, { ao: 0.75 }),
    P(-0.0160, 0.0095, 0, { ao: 0.5 }),
    P(-0.0160, 0, 0, { ao: 0.5 }),
  ];
}

/** Prisioneiro M14 com origem na base (x 0) e ponta em len. knurl: trecho serrilhado prensado (r 7.4 mm).
    Rosca = normal map do mats.steel (vScale 0.045 com repeat 30 = passo 1.5 mm, uma volta de hélice por volta). */
function studProfile(len, knurl = 0) {
  const r = STUD_R, pts = [P(0, 0), P(0, knurl ? 0.0074 : r, 0.0003)];
  if (knurl) pts.push(P(knurl, 0.0074, 0.0003), P(knurl + 0.0006, r, 0.0003));
  pts.push(
    P(len - 0.0024, r, 0.0005),                          // fim da rosca no chanfro
    P(len - 0.0004, 0.0053, 0.0005),                     // chanfro de ponta ~40°
    P(len, 0.0046, 0.0004),
    P(len + 0.0002, 0),                                  // ponta levemente abaulada (forjada)
  );
  return pts;
}

/** Rolamento (anel externo, fixo): tampa traseira estampada, guia do cubo da manga, garganta que recebe o flange
    de orelhas (placa à parte), anel externo e o retentor de borracha (AO escuro) encostado no barril do cubo. */
function bearingProfile() {
  return [
    P(-0.0960, 0, 0, { ao: 0.45 }),                      // tampa traseira (lado da manga de eixo)
    P(-0.0960, 0.0300, 0.0020, { ao: 0.5 }),
    P(-0.0930, 0.0330, 0.0010, { ao: 0.55 }),
    P(-0.0930, 0.0410, 0.0008, { ao: 0.6 }),             // guia que entra na manga de eixo
    P(-0.0640, 0.0410, 0.0020, { ao: 0.55 }),            // concordância côncava até a placa
    P(BRG.back, 0.0480, 0, { ao: 0.6 }),                 // some dentro da placa de orelhas
    P(BRG.face, 0.0480, 0, { ao: 0.6 }),
    P(-0.0485, 0.0460, 0.0015, { ao: 0.6 }),             // concordância da frente da placa
    P(-0.0335, 0.0460, 0.0010, { ao: 0.8 }),             // anel externo
    P(-0.0310, 0.0440, 0.0006, { ao: 0.75 }),            // chanfro da frente
    P(-0.0310, 0.0418, 0.0002, { ao: 0.5 }),
    P(-0.0322, 0.0412, 0.0003, { ao: 0.22 }),            // retentor rebaixado
    P(-0.0322, 0.0396, 0.0003, { ao: 0.22 }),
    P(-0.0312, 0.0392, 0, { ao: 0.3, brk: true }),       // lábio no barril do cubo (r 0.0385); vinco: o perfil dá meia-volta aqui
    P(-0.0440, 0.0392, 0, { ao: 0.2 }),
    P(-0.0440, 0, 0, { ao: 0.2 }),
  ];
}

/** Ressalto de centragem do espaçador (laço fechado, coordenadas locais do espaçador: face de trás em x 0).
    Começa em 9.5 mm, onde o pino do cubo termina, e prolonga o pino para a roda: hub-centric de verdade. */
function lipProfile() {
  return [
    P(PILOT_TIP, 0.0303, 0),
    P(PILOT_TIP, 0.0360, 0.0003),
    P(LIP_TOP - 0.0017, 0.0360, 0.0010),
    P(LIP_TOP, 0.0343, 0.0005),                          // chanfro de entrada 45° x 1.7 mm
    P(LIP_TOP, 0.0313, 0.0005),
    P(LIP_TOP - 0.0010, 0.0303, 0),
  ];
}

/** Contorno da placa de orelhas do rolamento: círculo r 0.050 + 4 orelhas suaves (cos^20 do desvio angular), no plano da forma
    (ângulo da forma = theta). Ponta da orelha em r 0.0695, 6 mm de parede além da cabeça do parafuso. */
function lobeOutline(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    let bump = 0;
    for (const a of BRG.lobes) { const c = Math.cos(th - a * D2R); if (c > 0) bump = Math.max(bump, Math.pow(c, BRG.lobePow)); }
    const r = BRG.rBase + BRG.rLobe * bump;
    pts.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  return pts;
}

function paint(geo, v) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3).fill(v);
  geo.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
  return geo;
}

/* ---------------- a peça ---------------- */
export function buildHub(ctx) {
  const { mats } = ctx;
  const tier = ctx.tier || mats.tier || "base";
  const q = Q[tier] || Q.base;
  const geos = [];
  const keep = (g) => { geos.push(g); return g; };

  const root = new THREE.Group(); root.name = "hub";
  const spin = new THREE.Group(); spin.name = "hub.spin"; root.add(spin);   // gira junto com a roda: rotation.x = ângulo

  /* cubo + cabeças dos prisioneiros: um draw (ferro fundido com AO e revenimento) */
  const hubParts = [revolveGeometry(hubProfile(), { angles: q.hub, segQ: q.segQ, uLen: 1, vScale: 0.06, ao: true })];
  for (let k = 0; k < STUDS.count; k++) {
    const g = revolveGeometry(studHeadProfile(), { angles: q.head, segQ: 2, ao: true });
    const [y, z] = studYZ(k); g.translate(0, y, z);
    hubParts.push(g);
  }
  const hubMesh = new THREE.Mesh(keep(mergeGeometries(hubParts)), mats.ao("castGrey"));
  hubMesh.name = "hub.body";
  spin.add(hubMesh);

  /* prisioneiros do cubo: instanciados; a escala em X encurta pela ponta quando o espaçador entra */
  const studGeo = keep(revolveGeometry(studProfile(HUB_STUD_TIP - STUD_BASE), { angles: q.stud, segQ: 2, uLen: 1, vScale: 0.045 }));
  const studs = new THREE.InstancedMesh(studGeo, mats.steel, STUDS.count);
  studs.name = "hub.studs";
  const m4 = new THREE.Matrix4(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), qi = new THREE.Quaternion();
  let studTip = HUB_STUD_TIP;
  const writeStuds = () => {
    const sx = Math.max(0.02, (studTip - STUD_BASE) / (HUB_STUD_TIP - STUD_BASE));
    for (let k = 0; k < STUDS.count; k++) {
      const [y, z] = studYZ(k);
      m4.compose(pv.set(STUD_BASE, y, z), qi, sv.set(sx, 1, 1));
      studs.setMatrixAt(k, m4);
    }
    studs.instanceMatrix.needsUpdate = true;
  };
  writeStuds();
  studs.computeBoundingBox(); studs.computeBoundingSphere();          // com o comprimento cheio: conservador
  spin.add(studs);

  /* rolamento (fixo): anel externo + placa de 4 orelhas + 4 parafusos M10 com cabeça para fora, um draw */
  const brgParts = [revolveGeometry(bearingProfile(), { angles: q.brg, segQ: 2, uLen: 1, vScale: 0.06, ao: true })];
  const slab = roundedSlab({ outer: lobeOutline(q.slab), holes: [circlePts(0, 0, 0.0455, Math.round(q.slab / 2))], depth: BRG.face - BRG.back, bevel: 0.0010, segs: 2 });
  slab.translate(BRG.back, 0, 0);
  brgParts.push(paint(slab, 0.85));
  BRG.lobes.forEach((a, k) => {
    // cabeça para +X, haste atravessa a placa e sai 2.9 mm atrás (rosca na manga, que não existe aqui)
    const b = boltGeometry({ d: 0.010, length: 0.0145, af: 0.015, head: 0.0068, detail: q.bolt });
    b.rotateX(0.37 + k * 1.13);                                        // sextavados fora de fase, como apertados de verdade
    const th = a * D2R; b.translate(BRG.face, BRG.boltR * Math.sin(th), -BRG.boltR * Math.cos(th));
    brgParts.push(paint(b, 0.55));                                     // aço escuro sobre o fundido
  });
  const bearing = new THREE.Mesh(keep(mergeGeometries(brgParts)), mats.ao("castGrey"));
  bearing.name = "hub.bearing";
  root.add(bearing);

  /* espaçador 15 mm: placa jateada com furos e bordas arredondadas + ressalto torneado, prisioneiros prensados */
  const spacer = new THREE.Group(); spacer.name = "hub.spacer";
  const holes = [circlePts(0, 0, SP.bore / 2, q.sBore)];
  for (let k = 0; k < SP.holes; k++) {
    const th = STUDS.thetas[k], r = SP.pcd / 2;
    holes.push(circlePts(r * Math.cos(th), r * Math.sin(th), SPACER_HOLE_R, q.sHole, th));
  }
  const plate = roundedSlab({ outer: circlePts(0, 0, SP.rOuter, q.sOuter), holes, depth: SPACER_T, bevel: 0.0012, segs: q.sSegs });
  const lip = revolveGeometry(lipProfile(), { angles: q.lip, closed: true, segQ: 2, uLen: TAU * 0.033, vScale: 1 }); // UV em metros, como a placa
  // lookdev: o normal do beadAlu lia como martelado de perto (e a 3x como tapete repetido); jato de areia é microscópico,
  // então só a rugosidade variada no mapa original, sem relevo
  const spacerMat = mats.beadAlu.clone(); spacerMat.name = "v3.hub.spacer";
  spacerMat.normalMap = null; spacerMat.roughness = 0.5;
  const spacerBody = new THREE.Mesh(keep(mergeGeometries([plate, lip])), spacerMat);
  spacerBody.name = "hub.spacer.body";
  spacer.add(spacerBody);
  const spStudGeo = keep(revolveGeometry(studProfile(SPACER_STUD_TIP - 0.001, SPACER_T - 0.001), { angles: q.stud, segQ: 2, uLen: 1, vScale: 0.045 }));
  const spStuds = new THREE.InstancedMesh(spStudGeo, mats.steel, SP.holes);
  spStuds.name = "hub.spacer.studs";
  for (let k = 0; k < SP.holes; k++) { const [y, z] = studYZ(k); spStuds.setMatrixAt(k, m4.makeTranslation(0.001, y, z)); }
  spStuds.instanceMatrix.needsUpdate = true;
  spStuds.computeBoundingBox(); spStuds.computeBoundingSphere();
  spacer.add(spStuds);
  spin.add(spacer);

  /* setSpacer: subida no referencial do mundo (o "de baixo" não gira com a roda), encaixe ao longo do eixo local */
  const qw = new THREE.Quaternion(), vy = new THREE.Vector3();
  let tSpacer = 0, xOff = 0, yOff = 0, twist = 0;
  function placeSpacer() {
    vy.set(0, yOff, 0);
    const par = spacer.parent;
    if (par && yOff !== 0) { par.getWorldQuaternion(qw).invert(); vy.applyQuaternion(qw); }
    spacer.position.set(xOff + vy.x, vy.y, vy.z);
    spacer.rotation.set(twist, 0, 0);
  }
  function setSpacer(t) {
    t = clamp01(+t || 0); tSpacer = t;
    if (t <= 0.0005) {
      spacer.visible = false; xOff = SPACER_X_OUT; yOff = SPACER_Y_FROM; twist = SPACER_TWIST;
    } else {
      spacer.visible = true;
      if (t < SPACER_SPLIT) {
        const u = easeOut3(t / SPACER_SPLIT);
        xOff = SPACER_X_OUT; yOff = SPACER_Y_FROM * (1 - u); twist = SPACER_TWIST * (1 - u);
      } else {
        const u = easeInOut3((t - SPACER_SPLIT) / (1 - SPACER_SPLIT));
        xOff = SPACER_X_OUT * (1 - u); yOff = 0; twist = 0;
      }
    }
    placeSpacer();
    // coaxial e entrando: o prisioneiro do cubo termina na face de trás do espaçador (resto fica no furo)
    const tip = spacer.visible && yOff === 0 ? Math.min(HUB_STUD_TIP, xOff - 0.0004) : HUB_STUD_TIP;
    if (tip !== studTip) { studTip = tip; writeStuds(); }
  }
  setSpacer(0);

  const tint = mats.setHubTint ? mats.setHubTint : (v) => { if (mats.uniforms && mats.uniforms.tint) mats.uniforms.tint.uTint.value = v; };

  /* âncoras (raiz na origem: local = mundo) */
  const V = (x, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const anchors = {
    hub: V(0),
    flangeFace: V(FLANGE_FACE),
    pilotTip: V(PILOT_TIP),
    bearingFront: V(-0.031),
    bearingFlange: V(BRG.face),
    knuckle: V(-0.093),                                     // guia do rolamento: onde uma manga de eixo encaixaria
    studTip: V(HUB_STUD_TIP),
    spacerSeat: V(0),
    spacerFace: V(SPACER_T),
    spacerLip: V(LIP_TOP),
    spacerStudTip: V(SPACER_STUD_TIP),
    spacerStart: V(SPACER_X_OUT, SPACER_Y_FROM, 0),
    lugSeat: V(LUG_SEAT_X),                                 // palpite de hardware.js; quem manda é a roda
    lugSeatSpaced: V(SPACER_T + LUG_SEAT_X),
  };
  for (let k = 0; k < STUDS.count; k++) { const [y, z] = studYZ(k); anchors["stud" + k] = V(HUB_STUD_TIP, y, z); }

  return {
    root, anchors, spin, spacer, studs, bearing, body: hubMesh,
    // o cubo fica; explodeAxis/explodeDist valem para o espaçador (a peça deste módulo que entra na órbita do B5)
    explodeAxis: new THREE.Vector3(1, 0, 0),
    explodeDist: 0.12,
    studTipX: (spaced = false) => (spaced ? SPACER_STUD_TIP : HUB_STUD_TIP),
    /** 0 escondido (embaixo, dentro da laje) .. 0.62 subiu e alinhou .. 1 assentado em x 0..0.015. */
    setSpacer,
    /** 0..1: palha -> azul no fundido (uniform compartilhado do MaterialSet). */
    setHeatTint(v) { tint(clamp01(+v || 0)); },
    /** Ângulo da roda (ou gire `spin` direto). Reposiciona o espaçador se ele estiver no meio da subida. */
    setAngle(a) { spin.rotation.x = a; if (spacer.visible && yOff !== 0) placeSpacer(); },
    update() { if (spacer.visible && yOff !== 0) placeSpacer(); },
    get spacerT() { return tSpacer; },
    dispose() {
      for (const g of geos) g.dispose();
      studs.dispose(); spStuds.dispose(); spacerMat.dispose();
      root.removeFromParent();
    },
  };
}
