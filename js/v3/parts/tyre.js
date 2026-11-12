/* v3: pneu 255/35R19 (seção 2 TYRE). Metros, centro do cubo na origem, eixo +X (para fora), +Y para cima.
   Torno escrito à mão em vez de LatheGeometry porque o pneu precisa de:
   - dois UVs (banda: u em volta x v de ombro a ombro; costado: u em volta x v radial) com layouts diferentes;
   - máscaras por ponto do perfil (banda, letra, complacência radial, bojo, AO assado);
   - normais de perfil ponderadas pelo comprimento do segmento: os arredondados de 1 mm dos sulcos ficam no sulco
     e não "amolecem" 1 cm de coroa (computeVertexNormals faria isso).
   Ângulo em volta idêntico ao torno da three girado por rotateZ(-PI/2): y = -r sin(2pi u), z = r cos(2pi u).
   Com isso o topo do mundo cai em u = 0.75 e theta = atan2(y, -z) = 90 graus, que é o que textures.sidewallNormal assume
   (centerU 0.75, flipU true: lido de +X, da esquerda para a direita, de pé). Girar spin.rotation.x = a soma a ao theta. */
import * as THREE from "three";
import { LAYOUT } from "../spec.js";

const T = LAYOUT.tyre;
const TAU = Math.PI * 2;

/* ---------------- números do perfil (todos em metros) ---------------- */
const X0 = LAYOUT.x.tyre[0], X1 = LAYOUT.x.tyre[1];  // -0.163 .. +0.092
const XC = (X0 + X1) / 2;                            // -0.0355: plano médio do pneu (meio do aro ET35 também)
const HALF = T.section / 2;                          // 0.1275: meia largura de seção, no bojo máximo
const R0 = T.r0;                                     // 0.3305: raio externo no centro da coroa
const BEAD = T.beadR;                                // 0.2413: assento do talão (19 pol / 2)
const RS = T.shoulderRadius;                         // 0.018: raio do ombro
const BULGE = T.sidewallBulge;                       // 0.005: bojo do costado sobre a corda talão-ombro
const GW = T.grooves.width, GD = T.grooves.depth;    // 8 mm x 7 mm
// largura de coroa que o treadNormal cobre em v 0..1 (mesma conta de textures.js): os sulcos de geometria têm de cair
// em v 0.2/0.4/0.6/0.8, onde o mapa deixa a borracha lisa
const CROWN_MAP = T.section - 0.03;                  // 0.225
const GROOVE_A = [0.2, 0.4, 0.6, 0.8].map((v) => (v - 0.5) * CROWN_MAP); // -0.0675, -0.0225, +0.0225, +0.0675
// queda da coroa até a borda: pequena de propósito, sob carga a banda inteira encosta na laje
const CROWN_DROP = 0.001;
// corda do costado: 0.123 no alto, 0.122 embaixo; + 5 mm de bojo no meio = 0.1275 = HALF (largura de seção exata)
const SIDE_TOP_A = HALF - BULGE + 0.0005;            // 0.1230
const SIDE_BOT_A = HALF - BULGE - 0.0005;            // 0.1220
const CROWN_HALF = SIDE_TOP_A - RS;                  // 0.1050: onde a coroa vira arco de ombro
const rc = (a) => R0 - CROWN_DROP * (a / CROWN_HALF) ** 2; // raio da coroa (sem sulco) na estação a
const SHOULDER_R = rc(CROWN_HALF) - RS;              // 0.3115: centro do arco do ombro e topo do costado
// o bojo máximo fica no raio do texto moldado (rText padrão de sidewallNormal): a letra senta na parte mais larga
const R_TEXT = 0.289;
const SIDE_BOT_R = 2 * R_TEXT - SHOULDER_R;          // 0.2665: fim do costado, começo do protetor de aro
// talão: o aro (LAYOUT.x.rim) vai a +/-0.120 do plano médio contando a aba; a aba tem ~6.5 mm, então o calcanhar
// do talão fica em +/-0.1135. Tudo abaixo de r 0.2588 (topo da aba J, 17.5 mm) fica escondido pela aba da roda.
const PROTECTOR_A = HALF - 0.003, PROTECTOR_R = 0.2622; // nervura protetora: 4.5 mm além da face da aba (0.120)
const TUCK_A = 0.1190, TUCK_R = 0.2572;              // dobra que encosta no topo da aba
const HEEL_A = 0.1135, HEEL_R = BEAD + 0.0035;       // calcanhar, apoiado na face interna da aba
// a base do talão fica 2 mm ACIMA do assento: o fechamento da seção nunca atravessa o barril da roda
const TOE_A = 0.0950, TOE_R = BEAD + 0.002;

// sulco em meia-seção a partir do centro dele: [deslocamento axial, profundidade, AO, peso do mapa de banda]
// arredondado de ~0.8 mm na quina de cima, parede com 5 graus de saída, fundo arredondado de ~1.5 mm
const hw = GW / 2;
const GROOVE_HALF = [
  [-(hw + 0.0009), 0, 1, 1],              // coroa, começo do arredondado
  [-(hw + 0.0001), 0.00055, 0.82, 0.3],   // meio do arredondado da quina
  [-(hw - 0.00015), 0.0015, 0.62, 0],     // topo da parede
  [-(hw - 0.0008), GD - 0.0008, 0.4, 0],  // pé da parede
  [-(hw - 0.0015), GD, 0.3, 0],           // fundo (5 mm de largura entre os dois pontos)
];
const GROOVE = [...GROOVE_HALF, ...GROOVE_HALF.slice().reverse().map(([da, d, ao, tr]) => [-da, d, ao, tr])];

/** Meia-seção de 34 pontos, do centro da coroa (a = 0) até a ponta do talão. a = x - XC, r = raio.
    tread: peso do mapa de banda · letter: peso do endereço moldado · comp: quanto o ponto acompanha a coroa no
    esmagamento (1 coroa, 0 talão) · bulge: quanto ele estufa para fora no contato · ao: oclusão assada. */
export function tyreSection() {
  const P = [];
  const sideW = (r) => Math.min(1, Math.max(0, (r - BEAD) / (R0 - BEAD))); // costado comprime linear do talão até a coroa
  const push = (a, r, o = {}) => P.push({ a, r, tread: 0, letter: 0, comp: sideW(r), bulge: 0, ao: 1, ...o });

  push(0, rc(0), { tread: 1, comp: 1 });                                        // 1: centro da coroa
  for (const g of GROOVE_A.filter((a) => a > 0))                                // 2-21: dois sulcos, 10 pontos cada
    for (const [da, d, ao, tr] of GROOVE) push(g + da, rc(g + da) - d, { tread: tr, ao, comp: 1 });
  push(CROWN_HALF, rc(CROWN_HALF), { tread: 1, comp: 1 });                      // 22: borda da coroa
  [[67.5, 1, 0.05], [45, 0.8, 0.1], [22.5, 0.45, 0.2]].forEach(([deg, tr, bu]) => { // 23-25: ombro de 3 pontos, r 18 mm
    const t = (deg * Math.PI) / 180;
    push(CROWN_HALF + RS * Math.cos(t), SHOULDER_R + RS * Math.sin(t), { tread: tr, bulge: bu });
  });
  push(SIDE_TOP_A, SHOULDER_R, { letter: 1, bulge: 0.35 });                    // 26: topo do costado (fim do arco)
  [[0.25, 0.8], [0.5, 1], [0.75, 0.85], [1, 0.55]].forEach(([t, bu]) => {       // 27-30: costado com bojo de 5 mm
    const r = SHOULDER_R - t * (SHOULDER_R - SIDE_BOT_R);
    const a = SIDE_TOP_A + (SIDE_BOT_A - SIDE_TOP_A) * t + BULGE * Math.sin(Math.PI * t);
    push(a, r, { letter: 1, bulge: bu, ao: t === 1 ? 0.96 : 1 });
  });
  push(PROTECTOR_A, PROTECTOR_R, { letter: 0.5, bulge: 0.35, ao: 0.92 });       // 31: protetor de aro
  push(TUCK_A, TUCK_R, { bulge: 0.15, ao: 0.55 });                             // 32: encosta na aba
  push(HEEL_A, HEEL_R, { ao: 0.3, comp: 0 });                                  // 33: calcanhar do talão
  push(TOE_A, TOE_R, { ao: 0.25, comp: 0 });                                   // 34: ponta do talão
  return P;
}

/** Seção inteira, fechada: talão de dentro -> coroa -> talão de fora -> base do talão de volta.
    Calcula normal 2D (ponderada por comprimento), v da banda e v do costado. */
function fullSection() {
  const half = tyreSection();
  const prof = [];
  for (let i = half.length - 1; i >= 1; i--) prof.push({ ...half[i], a: -half[i].a, side: -1, letter: 0 }); // endereço só do lado de fora (+X)
  prof.push({ ...half[0], side: 0 });
  for (let i = 1; i < half.length; i++) prof.push({ ...half[i], side: 1 });
  const N = prof.length;

  // percurso horário no plano (a para a direita, r para cima): normal para fora = (-dr, da).
  // Sem normalizar cada segmento: o segmento longo manda no vértice, o arredondado curto não vaza.
  for (let k = 0; k < N; k++) {
    const p = prof[(k - 1 + N) % N], c = prof[k], n = prof[(k + 1) % N];
    const na = -(c.r - p.r) - (n.r - c.r), nr = (c.a - p.a) + (n.a - c.a), l = Math.hypot(na, nr) || 1;
    c.na = na / l; c.nr = nr / l;
  }
  // v da banda: na coroa segue o eixo (os sulcos caem certinho em 0.2..0.8 apesar das paredes); depois da borda
  // segue o comprimento de arco, para os rasgos do ombro descerem o ombro sem esticar
  const s = new Float32Array(N);
  for (let k = 1; k < N; k++) s[k] = s[k - 1] + Math.hypot(prof[k].a - prof[k - 1].a, prof[k].r - prof[k - 1].r);
  const crownIdx = prof.map((p, k) => (Math.abs(Math.abs(p.a) - CROWN_HALF) < 1e-9 && p.tread === 1 ? k : -1)).filter((k) => k >= 0);
  const edgeIn = crownIdx[0], edgeOut = crownIdx[crownIdx.length - 1];
  for (let k = 0; k < N; k++) {
    const p = prof[k];
    if (k >= edgeIn && k <= edgeOut) p.v = 0.5 + p.a / CROWN_MAP;
    else if (k > edgeOut) p.v = 0.5 + (CROWN_HALF + s[k] - s[edgeOut]) / CROWN_MAP;
    else p.v = 0.5 - (CROWN_HALF + s[edgeIn] - s[k]) / CROWN_MAP;
    p.vs = (p.r - BEAD) / (R0 - BEAD); // v do costado = (r - beadR) / (r0 - beadR), contrato do sidewallNormal
  }
  return prof;
}

function tyreGeometry(radial) {
  const prof = fullSection();
  const NP = prof.length + 1, NU = radial + 1; // linha extra fecha a seção; coluna extra fecha a costura em u
  const n = NU * NP;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const side = new Float32Array(n * 2), tyre = new Float32Array(n * 4), ao = new Float32Array(n);
  for (let i = 0; i < NU; i++) {
    const u = i / radial, phi = u * TAU, sy = -Math.sin(phi), cz = Math.cos(phi);
    for (let j = 0; j < NP; j++) {
      const p = prof[j % prof.length], k = i * NP + j;
      pos[k * 3] = XC + p.a; pos[k * 3 + 1] = p.r * sy; pos[k * 3 + 2] = p.r * cz;
      nrm[k * 3] = p.na; nrm[k * 3 + 1] = p.nr * sy; nrm[k * 3 + 2] = p.nr * cz;
      uv[k * 2] = u; uv[k * 2 + 1] = p.v;
      side[k * 2] = u; side[k * 2 + 1] = p.vs;
      tyre[k * 4] = p.tread; tyre[k * 4 + 1] = p.letter; tyre[k * 4 + 2] = p.comp; tyre[k * 4 + 3] = p.bulge;
      ao[k] = p.ao;
    }
  }
  // (i,j) (i+1,j) (i,j+1): dP/du x dP/dj aponta para fora com y = -r sin, z = r cos e o perfil horário
  const idx = new (n > 65535 ? Uint32Array : Uint16Array)(radial * (NP - 1) * 6);
  let w = 0;
  for (let i = 0; i < radial; i++) for (let j = 0; j < NP - 1; j++) {
    const a = i * NP + j, b = (i + 1) * NP + j, c = a + 1, d = b + 1;
    idx[w++] = a; idx[w++] = b; idx[w++] = c;
    idx[w++] = b; idx[w++] = d; idx[w++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aSideUv", new THREE.BufferAttribute(side, 2));
  g.setAttribute("aTyre", new THREE.BufferAttribute(tyre, 4));
  g.setAttribute("aAO", new THREE.BufferAttribute(ao, 1));
  // o shader estufa o costado até 0.5 x excesso para fora em X: caixa à mão, senão a bancada enquadra errado e o culling corta
  g.computeBoundingBox(); g.boundingBox.min.x -= 0.03; g.boundingBox.max.x += 0.03;
  g.computeBoundingSphere(); g.boundingSphere.radius += 0.03;
  g.userData = { profilePoints: prof.length, halfPoints: (prof.length + 1) / 2, radial, xc: XC };
  return g;
}

/* ---------------- shader: esmagamento, dois mapas normais, AO, faixa aveludada ---------------- */
const VERT_PARS = /* glsl */`
attribute vec4 aTyre;   // banda, letra, complacência, bojo
attribute vec2 aSideUv;
attribute float aAO;
uniform float uPen, uR0, uXc, uKnee;
uniform vec3 uDown;
varying vec2 vSideUv;
varying vec4 vTyre;     // banda, letra, ao, bojo (bojo > 0 = costado)
`;
// roda depois de beginnormal_vertex: a normal precisa mudar antes de defaultnormal_vertex
const VERT_SQUASH = /* glsl */`
vec3 tyreP = position;
{
  vec3 D = uDown;
  float rr = length(position.yz);
  vec2 dir = position.yz / max(rr, 1e-5);
  // ponto da coroa (r0) no mesmo ângulo e na mesma estação axial; o termo em x deixa a cambagem inclinar o chão
  float sc = uR0 * dot(dir, D.yz) + position.x * D.x;
  float lim = uR0 - uPen;
  // joelho suave de até 3 mm: a borda do contato dobra em vez de quinar; some quando uPen -> 0
  float k = clamp(uPen, 1e-5, uKnee);
  float xk = sc - lim + 0.5 * k;
  float e = xk <= 0.0 ? 0.0 : (xk < k ? xk * xk / (2.0 * k) : xk - 0.5 * k);
  // coroa (comp 1) assenta exatamente no plano; o costado acompanha proporcional ao raio; o talão fica
  tyreP -= D * (e * aTyre.z);
  tyreP.x += sign(position.x - uXc) * 0.5 * e * aTyre.w;
  // a pegada achatada olha para o chão; paredes de sulco (banda 0) mantêm a normal
  float fw = aTyre.x * smoothstep(0.0, k, xk);
  objectNormal = normalize(mix(objectNormal, D, fw));
}
vSideUv = aSideUv;
vTyre = vec4(aTyre.xy, aAO, aTyre.w);
`;
const FRAG_PARS = /* glsl */`
uniform sampler2D uSideMap;
uniform float uSideScale;
varying vec2 vSideUv;
varying vec4 vTyre;
`;
// faixa aveludada logo acima do texto (r ~0.304..0.312): fosca e um pouco mais escura, como no pneu de verdade
const FRAG_BAND = /* glsl */`
float tyreBand = step(0.001, vTyre.w) * smoothstep(0.70, 0.712, vSideUv.y) * (1.0 - smoothstep(0.788, 0.80, vSideUv.y));
diffuseColor.rgb *= 1.0 - 0.18 * tyreBand;
`;
const FRAG_ROUGH = /* glsl */`
roughnessFactor = clamp(roughnessFactor * (1.0 + 0.05 * vTyre.x) + 0.08 * tyreBand, 0.0, 1.0);
`;
// dois mapas normais em espaço tangente com UVs diferentes; o do costado tem a própria base (derivadas de vSideUv).
// Sem if: derivada e mip dentro de ramo divergente são indefinidos.
const FRAG_NORMAL = /* glsl */`
#ifdef USE_NORMALMAP_TANGENTSPACE
{
  vec3 tyreGeoN = normal;
  vec3 tyreMT = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  tyreMT.xy *= normalScale * vTyre.x;
  vec3 tyreNT = normalize( tbn * tyreMT );
  vec3 tyreMS = texture2D( uSideMap, vSideUv ).xyz * 2.0 - 1.0;
  tyreMS.xy *= uSideScale * vTyre.y;
  mat3 tyreTbnS = getTangentFrame( - vViewPosition, tyreGeoN, vSideUv );
  vec3 tyreNS = normalize( tyreTbnS * tyreMS );
  normal = normalize( tyreNT + tyreNS - tyreGeoN );
  // letra moldada: a borda levanta o brilho e alisa um pouco a borracha (de cabeça o mapa normal sozinho some)
  float tyreEdge = clamp( length( tyreMS.xy ) * 2.0, 0.0, 1.0 ) * clamp( uSideScale, 0.0, 1.0 ) * vTyre.y;
  diffuseColor.rgb *= 1.0 + 1.8 * tyreEdge;
  roughnessFactor = mix( roughnessFactor, 0.5, tyreEdge * 0.6 );
}
#endif
`;
// AO assado: tira o ambiente (e metade da luz direta) do fundo dos sulcos e do talão sob a aba
const FRAG_AO = /* glsl */`
{
  float tyreAO = vTyre.z, tyreAOd = mix(1.0, tyreAO, 0.6);
  reflectedLight.indirectDiffuse *= tyreAO;
  reflectedLight.indirectSpecular *= tyreAO;
  reflectedLight.directDiffuse *= tyreAOd;
  reflectedLight.directSpecular *= tyreAOd;
  #ifdef USE_SHEEN
  sheenSpecularIndirect *= tyreAO;
  sheenSpecularDirect *= tyreAOd;
  #endif
}
`;

function must(src, token) {
  if (!src.includes(token)) throw new Error("tyre: chunk da three não encontrado: " + token);
  return src;
}

/** buildTyre(ctx) -> Part & { setSquash(penM, downLocal), setLetter(0..1), spin } */
export function buildTyre(ctx) {
  const { mats, tex, tier = "base" } = ctx;
  const radial = tier === "low" ? T.segments.radialLow : T.segments.radial; // 64 | 128

  const geometry = tyreGeometry(radial);

  // borracha: o mats.tyre é liso de propósito; o pneu leva um clone com os dois mapas e o vertex shader próprio
  const material = mats.tyre.clone();
  material.name = "v3.tyre.part";
  // lookdev: #0b0b0b com env 0.5 some no estúdio escuro (nem a silhueta lê). Borracha real sob softbox é carvão ~#1d1d1e com
  // aveludado largo no costado; sobe base, env e sheen, mantém rugosidade alta (sem ponto quente)
  material.color.set("#2b2b2c"); material.envMapIntensity = 1.9;
  if (material.sheen > 0) { material.sheen = 0.9; material.sheenColor.set("#707072"); material.sheenRoughness = 0.5; }
  material.normalMap = tex.treadNormal();          // repeat (32, 1) já vem do textures.js
  material.normalScale = new THREE.Vector2(0.9, 0.9);
  const SIDE_K = 1.3;                              // força do endereço em uLetter 1 (spec: afinar entre 0.6 e 1.2)
  const U = {
    uPen: { value: 0 },
    uDown: { value: new THREE.Vector3(0, -1, 0) },
    uR0: { value: R0 },
    uXc: { value: XC },
    uKnee: { value: 0.003 },
    uSideMap: { value: tex.sidewallNormal() },     // sem argumentos: mesma textura de quem mais pedir o endereço padrão
    uSideScale: { value: 0 },                      // = SIDE_K * uLetter
  };
  material.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    let v = s.vertexShader, f = s.fragmentShader;
    v = must(v, "#include <common>").replace("#include <common>", "#include <common>\n" + VERT_PARS);
    v = must(v, "#include <beginnormal_vertex>").replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n" + VERT_SQUASH);
    v = must(v, "#include <begin_vertex>").replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = tyreP;");
    f = must(f, "#include <common>").replace("#include <common>", "#include <common>\n" + FRAG_PARS);
    f = must(f, "#include <color_fragment>").replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAG_BAND);
    f = must(f, "#include <roughnessmap_fragment>").replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" + FRAG_ROUGH);
    f = must(f, "#include <normal_fragment_maps>").replace("#include <normal_fragment_maps>", FRAG_NORMAL);
    f = must(f, "#include <aomap_fragment>").replace("#include <aomap_fragment>", "#include <aomap_fragment>\n" + FRAG_AO);
    s.vertexShader = v; s.fragmentShader = f;
  };
  material.customProgramCacheKey = () => "v3tyre";

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "tyre.mesh";

  // spin: gira em X com a roda (rotation.x = ângulo). A malha fica na identidade dentro dele, então o
  // referencial da malha É o referencial girante que uDownLocal pede.
  const spin = new THREE.Group(); spin.name = "tyre.spin";
  spin.add(mesh);
  const root = new THREE.Group(); root.name = "tyre";
  root.add(spin);

  // baixo do mundo no referencial girante: automático (a partir da matrixWorld no próprio render, sem atraso de
  // quadro) até alguém passar um downLocal explícito. setSquash(pen) ou setSquash(pen, null) volta ao automático.
  let autoDown = true;
  mesh.onBeforeRender = () => {
    if (!autoDown) return;
    const e = mesh.matrixWorld.elements; // colunas = eixos locais no mundo; local = R^T (0,-1,0)
    U.uDown.value.set(-e[1], -e[5], -e[9]).normalize();
  };

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  /** penM: penetração do pneu na laje em m (quartercar.pen(); negativo = no ar). downLocal: Vector3 | [x,y,z] | null. */
  function setSquash(penM = 0, downLocal = null) {
    const p = +penM;
    U.uPen.value = p > 0 ? p : 0;
    if (downLocal) {
      if (downLocal.isVector3) U.uDown.value.copy(downLocal);
      else U.uDown.value.set(+downLocal[0], +downLocal[1], +downLocal[2]);
      if (U.uDown.value.lengthSq() < 1e-12) U.uDown.value.set(0, -1, 0);
      U.uDown.value.normalize();
      autoDown = false;
    } else autoDown = true;
  }
  /** 0 em todo lugar, 1 só no beat de contato: liga o relevo do endereço no costado de fora. */
  function setLetter(t) { U.uSideScale.value = SIDE_K * clamp01(+t || 0); }

  // âncoras no mundo compartilhado (a raiz fica na origem)
  const anchors = {
    hub: new THREE.Vector3(0, 0, 0),
    center: new THREE.Vector3(XC, 0, 0),                                // plano médio, no eixo
    top: new THREE.Vector3(XC, R0, 0),                                  // topo da coroa (rótulo "Rims and tires")
    contact: new THREE.Vector3(XC, -(R0 - T.staticDeflection), 0),      // centro da pegada em repouso = topo da laje (-0.3118)
    outerFace: new THREE.Vector3(X1, 0, 0),                             // +0.092
    innerFace: new THREE.Vector3(X0, 0, 0),                             // -0.163
    letter: new THREE.Vector3(XC + HALF, R_TEXT, 0),                    // centro do arco do endereço com a roda no ângulo 0
  };

  return {
    root, spin, mesh, material, geometry, anchors,
    uniforms: U,
    explodeAxis: new THREE.Vector3(1, 0, 0),
    explodeDist: 0.3,
    setSquash, setLetter,
    dispose() {
      geometry.dispose(); material.dispose(); // texturas são do cache compartilhado (tex.dispose)
      mesh.onBeforeRender = () => {};
    },
  };
}
