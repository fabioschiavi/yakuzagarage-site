/* v3 · LASCA DO PARA-LAMA (só no beat de fitment), seção 2 da spec.
   Mundo: cubo (em repouso) na origem, eixo da roda +X, +Y para cima. O arco é em torno do eixo X.
   Ângulo do arco: a = atan2(z, y): 0 no topo, positivo para +Z (frente). A lasca cobre a de -50 a +50 graus.
   Como foi feito: a SEÇÃO da chapa (o perfil visto de frente) é a Shape 2D; o ExtrudeGeometry a extruda reto
   em "z" e depois a gente enrola esse z no arco. Assim as tampas da extrusão são exatamente os planos de corte
   nas duas pontas (grupo 0 = vinho #810015, "plano de seção"), e a curvatura de seção, o tumblehome e
   o lábio enrolado saem do perfil, com densidade de verdade (a chapa reta da spec, extrudada 1.2 mm,
   seria triangulada pelo earcut de ponta a ponta e não guardaria a curvatura do vinco).
   Seção (x = X do mundo, r = distância ao eixo):
   - borda do arco r 0.36; lábio enrolado de 4 mm de raio com face externa em x = +0.107 (pneu 15 mm para dentro
     antes do espaçador, rente depois); o enrolado é a própria chapa de 1.2 mm dando ~286 graus de volta para dentro,
     então o corte mostra o "C" do friso, como num corte real;
   - painel de 0.12 m acima da borda (até r 0.48), 1.2 mm, com 3 graus de tumblehome (o topo cai para dentro)
     e curvatura de seção 0.08: o topo entra mais 0.08 x 0.12 = 9.6 mm, em parábola (ombro do para-lama).
   Desvio consciente: a spec pede o lábio como TubeGeometry r 4 mm; aqui ele é a mesma chapa enrolada (seção em C,
   raio externo 4 mm), para o corte vinho mostrar o friso como num corte de verdade e não um tubo maciço.
   Malha única com 2 grupos (vinho só na tampa +Z, como a spec pede), com o lábio contíguo
   para que setLipOnly(true) seja só um drawRange (risco 10 da spec: se a lasca ler como placa abstrata, fica só o lábio). */
import * as THREE from "three";
import { LAYOUT } from "../spec.js";
import { clamp, creaseNormals } from "./geomkit.js";

const F = LAYOUT.fender;
const D = Math.PI / 180;
const SPAN = F.spanDeg * D;            // 50 graus para cada lado do topo
const R0 = F.archR;                    // 0.36: borda do arco
const RL = F.lipTubeR;                 // 0.004: raio do enrolado
const T = F.sheet;                     // 0.0012: chapa
const XO = F.outerX;                   // 0.107: face externa do lábio
const RC = R0 + RL, XC = XO - RL;      // centro do enrolado: r 0.364, x 0.103
const RTOP = R0 + F.panelAbove;        // 0.48: topo do painel
const HP = RTOP - RC;                  // 0.116: altura do painel acima do centro do enrolado
const TAN = Math.tan(F.tumblehomeDeg * D);
const BOW = F.curvatureY * F.panelAbove; // 0.0096 m a mais para dentro no topo
const RMID = (R0 + RTOP) / 2;          // raio de referência do comprimento extrudado (UV em metros perto do real)
const LIP_R = RC + RL + 0.0012;        // tudo abaixo disso é lábio (o shader usa para o lábio entrar primeiro)

/** face externa do painel em função do raio */
const xOuter = (r) => { const h = Math.max(0, r - RC); return XO - h * TAN - BOW * (h / HP) * (h / HP); };

function panelShape() {
  // 16 pontos na altura bastam: o perfil é uma parábola suave; cada ponto aqui vira 2 x steps triângulos
  const pts = [], N = 16, rb = RC - 0.0005, rt = RTOP - T / 2;
  for (let k = 0; k <= N; k++) { const r = rb + (rt - rb) * (k / N); pts.push([xOuter(r), r]); }
  // topo: meia-volta de raio T/2 (a borda livre da lasca, arredondada, não um degrau)
  const cx = xOuter(rt) - T / 2;
  for (let k = 1; k < 8; k++) { const a = (k / 8) * Math.PI; pts.push([cx + Math.cos(a) * T / 2, rt + Math.sin(a) * T / 2]); }
  for (let k = N; k >= 0; k--) { const r = rb + (rt - rb) * (k / N); pts.push([xOuter(r) - T, r]); }
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

function lipShape() {
  // ângulos no plano (x, r) a partir de +x; desce pelo lado de fora, passa por baixo e sobe por dentro
  // 28 segmentos em 292 graus = 10.4 graus cada: abaixo do vinco de 40 graus, o enrolado fica liso
  const a0 = 6 * D, a1 = -286 * D, ro = RL, ri = RL - T, rm = RL - T / 2, n = 28, pts = [];
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * (k / n); pts.push([XC + Math.cos(a) * ro, RC + Math.sin(a) * ro]); }
  // ponta da chapa: meia-volta arredondada no sentido do avanço
  const ux = Math.cos(a1), uy = Math.sin(a1), tx = Math.sin(a1), ty = -Math.cos(a1);
  const mx = XC + ux * rm, my = RC + uy * rm;
  for (let k = 1; k < 6; k++) { const p = (k / 6) * Math.PI; pts.push([mx + (Math.cos(p) * ux + Math.sin(p) * tx) * T / 2, my + (Math.cos(p) * uy + Math.sin(p) * ty) * T / 2]); }
  for (let k = n; k >= 0; k--) { const a = a0 + (a1 - a0) * (k / n); pts.push([XC + Math.cos(a) * ri, RC + Math.sin(a) * ri]); }
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

/** extruda reto e enrola no arco: (x, r, z) -> (x, r cos a, r sin a), a = -SPAN + 2 SPAN z / comprimento.
    O enrolamento preserva orientação (det = +1), então a frente dos triângulos continua para fora. */
function sweep(shape, steps) {
  const len = RMID * 2 * SPAN;
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, steps, bevelEnabled: false, curveSegments: 1 });
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), r = P.getY(i), a = -SPAN + (2 * SPAN * P.getZ(i)) / len;
    P.setXYZ(i, x, r * Math.cos(a), r * Math.sin(a));
  }
  const groups = g.groups.map((q) => ({ ...q }));
  const out = creaseNormals(g, 40); // não indexada, mesma ordem: os grupos continuam válidos
  out.clearGroups(); for (const q of groups) out.addGroup(q.start, q.count, q.materialIndex);
  return out;
}

export function buildFender(ctx) {
  const { mats, tex, tier } = ctx;
  const steps = tier === "low" ? 64 : 112;
  const root = new THREE.Group(); root.name = "fender";

  const panel = sweep(panelShape(), steps), lip = sweep(lipShape(), steps);
  /* O ExtrudeGeometry põe as duas tampas no grupo 0: primeiro a de z = 0 (a = -50°, ponta -Z), depois a de z = len (+Z).
     A spec quer o plano de seção vinho só na ponta +Z; a ponta -Z leva a pintura (fica de costas para as câmeras).
     Ordem final: [tampa+Z painel | tampa+Z lábio | tampa-Z lábio | laterais lábio | laterais painel | tampa-Z painel]
     = grupo vinho no começo e o lábio inteiro contíguo (setLipOnly vira um drawRange). */
  const caps = (g, end) => { const q = g.groups.find((x) => x.materialIndex === 0), h = q.count / 2; return [q.start + (end > 0 ? h : 0), h]; };
  const sides = (g) => { const q = g.groups.find((x) => x.materialIndex === 1); return [q.start, q.count]; };
  const order = [[panel, caps(panel, 1)], [lip, caps(lip, 1)], [lip, caps(lip, -1)], [lip, sides(lip)], [panel, sides(panel)], [panel, caps(panel, -1)]];
  const total = order.reduce((s, [, r]) => s + r[1], 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const [g, [s, c]] of order) {
    pos.set(g.attributes.position.array.subarray(s * 3, (s + c) * 3), o * 3);
    nor.set(g.attributes.normal.array.subarray(s * 3, (s + c) * 3), o * 3);
    uv.set(g.attributes.uv.array.subarray(s * 2, (s + c) * 2), o * 2);
    o += c;
  }
  const nPanelCap = caps(panel, 1)[1], nLipCap = caps(lip, 1)[1], nLipSides = sides(lip)[1];
  panel.dispose(); lip.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.addGroup(0, nPanelCap + nLipCap, 0);                           // vinho: as duas tampas +Z
  geo.addGroup(nPanelCap + nLipCap, total - nPanelCap - nLipCap, 1);  // pintura: o resto
  const lipStart = nPanelCap, lipCount = 2 * nLipCap + nLipSides;
  geo.computeBoundingBox(); geo.computeBoundingSphere();

  /* ---- materiais: clones locais (o reveal recorta por ângulo no shader; não mexe nos compartilhados) ---- */
  const uni = { uRevLip: { value: SPAN + 0.02 }, uRevPanel: { value: SPAN + 0.02 } };
  const patch = (m, key) => {
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, uni);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vFendPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFendPos = position;");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vFendPos;\nuniform float uRevLip, uRevPanel;")
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
          {
            // revela do topo para as pontas; o lábio vai na frente do painel
            float fa = abs(atan(vFendPos.z, vFendPos.y));
            float lim = length(vFendPos.yz) < ${LIP_R.toFixed(5)} ? uRevLip : uRevPanel;
            if (fa > lim) discard;
          }`);
    };
    m.customProgramCacheKey = () => "v3fender:" + key;
    return m;
  };
  const paint = patch(mats.fenderWhite.clone(), "paint");
  paint.name = "v3.fender.paint";
  // casca de laranja leve no verniz: o reflexo do softbox ondula como em pintura de fábrica (UV em metros)
  let peel = null;
  if (tex && tex.grainNormal) {
    peel = tex.grainNormal().clone(); peel.repeat.set(30, 30); peel.needsUpdate = true;
    paint.clearcoatNormalMap = peel; paint.clearcoatNormalScale = new THREE.Vector2(0.035, 0.035);
  }
  const cut = patch(mats.fenderCut.clone(), "cut");
  cut.name = "v3.fender.cut";

  const mesh = new THREE.Mesh(geo, [cut, paint]);
  mesh.name = "fender.sliver";
  root.add(mesh);

  const pt = (x, r, a) => new THREE.Vector3(x, r * Math.cos(a), r * Math.sin(a));
  const anchors = {
    archCenter: new THREE.Vector3(0, 0, 0),
    lipTop: pt(XO, RC, 0),                               // face externa do lábio no topo: referência de "rente"
    lipFront: pt(XO, RC, SPAN),
    cutFront: pt(XO - 0.008, (R0 + RTOP) / 2, SPAN),     // meio da face de corte vinho (+Z)
    panelTop: pt(xOuter(RTOP) - T / 2, RTOP, 0),
  };

  let reveal = 1, lipOnly = false;
  const part = {
    root, anchors, mesh,
    explodeAxis: new THREE.Vector3(0, 1, 0),
    explodeDist: 0.15,
    /** 0..1: o arco se desenha do topo para as pontas (lábio primeiro). 0 = invisível. */
    setReveal(v) {
      reveal = clamp(v, 0, 1);
      const k = SPAN + 0.02;  // 0.02 rad a mais em 1 para as faces de corte não piscarem no limite
      uni.uRevLip.value = clamp(reveal * 1.15, 0, 1) * k;
      uni.uRevPanel.value = clamp(reveal * 1.15 - 0.15, 0, 1) * k;
      root.visible = reveal > 0.0005;
    },
    /** só o lábio enrolado (a saída de emergência do risco 10). */
    setLipOnly(on) {
      lipOnly = !!on;
      if (lipOnly) geo.setDrawRange(lipStart, lipCount); else geo.setDrawRange(0, Infinity);
    },
    get reveal() { return reveal; },
    dispose() { geo.dispose(); paint.dispose(); cut.dispose(); if (peel) peel.dispose(); },
  };
  part.setReveal(1);
  return part;
}
