/* v3: a órbita do B5. Elipse a 0.85 x b 0.30 m, inclinada 12 graus, com seis vagas para as peças.
   Duas draw calls: o tubo osso (desenha com a fase via drawRange) e a fita de legendas (uma tira só, um canvas).
   Não toca no DOM. Convenções:
   - parâmetro t em 0..1 é COMPRIMENTO DE ARCO (não ângulo): o texto da fita não estica perto das pontas.
   - local: elipse no plano XZ, P(theta) = (a cos, 0, -b sin). A frente (local +Z, lado da câmera) fica em t = 0.75
     e t cresce para a direita de quem olha de frente, por isso a fita lê da esquerda para a direita.
   - root: yaw que põe o eixo maior de lado para a câmera do B5, depois inclinação de 12 graus no eixo maior
     (o fundo sobe), centrado no alvo da câmera do B5. A coreografia pode mover root à vontade.
   - setAngle(rad) gira o CONJUNTO ao longo da elipse (2 pi = uma volta); peças e legendas andam juntas, o tubo fica.
   - Os índices do tubo estão ordenados pela distância até a frente: drawRange(0, n) cresce para os dois lados. */
import * as THREE from "three";
import { LAYOUT, PALETTE, COPY, BEATS } from "./spec.js";

const O = LAYOUT.orbit;
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const B5 = BEATS.find((b) => b.key === "orbit");
export const ORBIT_PARTS = B5.objects.parts.slice(); // wheel, spacer, rotor, caliper, coilover, arm
const ALIAS = { wheelFace: "wheel", tyre: "wheel", tire: "wheel", spring: "coilover", air: "coilover", weld: "arm", brake: "rotor" };
// raio do círculo de toque de cada peça (m): metade da maior medida real da peça
const PART_R = { wheel: LAYOUT.tyre.r0, spacer: LAYOUT.hub.spacer.rOuter, rotor: LAYOUT.rotor.R, caliper: 0.11, coilover: 0.26, arm: 0.24 };
const T_FRONT = 0.75;
const FONT_SERIF = '"Instrument Serif", "Times New Roman", serif'; // igual ao textures.js

function srgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const wrap01 = (x) => ((x % 1) + 1) % 1;
const cdist = (a, b) => Math.abs(wrap01(a - b + 0.5) - 0.5); // distância circular em t
const cdiff = (a, b) => wrap01(a - b + 0.5) - 0.5;            // a - b em (-0.5, 0.5]

/* ---------------- elipse parametrizada por arco ---------------- */
function makeEllipse(a, b, n = 2048) {
  const s = new Float64Array(n + 1);
  let px = a, pz = 0;
  for (let i = 1; i <= n; i++) {
    const th = (i / n) * TAU, x = a * Math.cos(th), z = -b * Math.sin(th);
    s[i] = s[i - 1] + Math.hypot(x - px, z - pz); px = x; pz = z;
  }
  const S = s[n];
  const thetaAt = (t) => {
    const target = wrap01(t) * S;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= target) lo = m; else hi = m; }
    const f = (target - s[lo]) / Math.max(1e-12, s[hi] - s[lo]);
    return ((lo + f) / n) * TAU;
  };
  const point = (t, out = new THREE.Vector3()) => { const th = thetaAt(t); return out.set(a * Math.cos(th), 0, -b * Math.sin(th)); };
  // normal para fora, no plano da elipse
  const normal = (t, out = new THREE.Vector3()) => { const th = thetaAt(t); return out.set(b * Math.cos(th), 0, -a * Math.sin(th)).normalize(); };
  return { S, thetaAt, point, normal };
}

/* ---------------- medida do texto (sem DOM: OffscreenCanvas, senão estimativa) ---------------- */
let _measure;
function textWidthPx(text, fontPx, italic) {
  if (_measure === undefined) {
    try { _measure = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(8, 8).getContext("2d") : null; } catch { _measure = null; }
  }
  if (_measure) {
    _measure.font = `${italic ? "italic " : ""}400 ${fontPx}px ${FONT_SERIF}`;
    const w = _measure.measureText(text).width;
    if (w > 0) return w;
  }
  return text.length * 0.42 * fontPx; // Instrument Serif itálico: ~0.4 em por caractere
}

/* Distribui as legendas na volta: cada uma quer ficar sob a sua peça; empurra até não encostar (ordem mantida). */
function layoutLabels(items, gapMin) {
  const n = items.length;
  if (!n) return;
  const order = items.map((it, i) => ({ it, i })).sort((p, q) => wrap01(p.it.want - T_FRONT + 0.5) - wrap01(q.it.want - T_FRONT + 0.5) || p.i - q.i);
  const sumW = items.reduce((s, it) => s + it.w, 0);
  const gap = Math.max(0, Math.min(gapMin, (1 - sumW) / n));
  // desenrola em torno da frente para não brigar com a emenda 0/1
  const c = order.map(({ it }) => T_FRONT - 0.5 + wrap01(it.want - T_FRONT + 0.5));
  for (let iter = 0; iter < 400; iter++) {
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n, A = order[k].it, B = order[j].it;
      const need = (A.w + B.w) / 2 + gap, have = (j === 0 ? c[j] + 1 : c[j]) - c[k];
      // no par que fecha a volta (último, primeiro) o primeiro conta +1; empurrar para fora vale igual
      if (have < need && n > 1) { const push = (need - have) / 2; c[k] -= push; c[j] += push; }
    }
    // as 100 últimas voltas só separam, para terminar sem encostar
    if (iter < 300) for (let k = 0; k < n; k++) c[k] += 0.08 * cdiff(order[k].it.want, c[k]);
  }
  let overlap = 0;
  for (let k = 0; k < n && n > 1; k++) {
    const j = (k + 1) % n, A = order[k].it, B = order[j].it;
    overlap = Math.max(overlap, (A.w + B.w) / 2 - (j === 0 ? c[j] + 1 : c[j]) + c[k]);
  }
  order.forEach(({ it }, k) => { it.u = wrap01(c[k]); });
  return { gap, sumW, overflow: overlap > 1e-4 };
}

const TUBE_VERT = /* glsl */ `
  attribute vec3 aOff;
  uniform float uR, uMinPx, uViewH, uFloor, uOpacity;
  varying float vA;
  void main() {
    vec4 wc = modelMatrix * vec4(position, 1.0);
    vec3 wo = normalize(mat3(modelMatrix) * aOff);
    vec4 vc = viewMatrix * wc;
    // tamanho de 1 px do dispositivo nessa profundidade: abaixo disso o tubo engorda e perde alfa (cobertura)
    float px = max(-vc.z, 1e-4) * 2.0 / (projectionMatrix[1][1] * uViewH);
    float r = max(uR, uMinPx * 0.5 * px);
    vA = uOpacity * max(uR / r, uFloor);
    gl_Position = projectionMatrix * (vc + viewMatrix * vec4(wo * r, 0.0));
  }`;
const TUBE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() { gl_FragColor = vec4(uColor * vA, vA); }`;

const RIB_VERT = /* glsl */ `
  uniform float uShift;
  varying vec2 vUv;
  varying float vT;
  varying float vFacing;
  void main() {
    vUv = vec2(uv.x - uShift, uv.y);         // sem fract: o RepeatWrapping emenda sem costura de mip
    vT = uv.x;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vFacing = dot(n, normalize(cameraPosition - wp.xyz));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const RIB_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity, uReveal, uFront;
  varying vec2 vUv;
  varying float vT;
  varying float vFacing;
  void main() {
    float a = texture2D(uMap, vUv).a;
    float face = smoothstep(0.05, 0.45, vFacing);          // metade de trás some (lá o texto lê espelhado)
    float d = abs(fract(vT - uFront + 0.5) - 0.5);
    float rev = 1.0 - smoothstep(uReveal - 0.06, uReveal, d); // aparece atrás da linha que desenha
    a *= face * rev * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }`;

/**
 * buildOrbit(ctx, labels, opts) -> { root, setPhase, setAngle, slot, hit, ... }
 * labels: COPY.orbitLabels ({part, text}) ou strings (string i fica sob a peça i).
 * opts: center, yaw (rad), tiltDeg, ribbonDrop (m, topo da fita abaixo da linha), tubeSegments.
 */
export function buildOrbit(ctx, labels = COPY.orbitLabels, opts = {}) {
  const { tex } = ctx;
  const cam = B5.cam;
  const {
    center = cam.target,
    yaw = Math.atan2(cam.pos[0] - cam.target[0], cam.pos[2] - cam.target[2]),
    tiltDeg = O.tiltDeg,
    ribbonDrop = LAYOUT.tyre.r0 + 0.015,   // a fita passa logo abaixo da maior peça (a roda)
    tubeSegments = 512,
    radial = 6,
    ribbonSegments = 512,
    labelOpacity = 0.9,
  } = opts;

  const E = makeEllipse(O.a, O.b);
  const [RW, RH] = O.ribbonCanvas;
  const bandH = (E.S * RH) / RW;           // altura com aspecto correto do canvas (~0.12 m)
  const slotCount = ORBIT_PARTS.length;
  const slotIndex = (name) => { const k = ORBIT_PARTS.indexOf(ALIAS[name] || name); return k; };

  const root = new THREE.Group();
  root.name = "v3.orbit";
  root.position.set(...center);
  root.rotation.set(tiltDeg * D2R, yaw, 0, "YXZ"); // inclina no eixo maior local, depois gira no Y

  /* ---- legendas: medir, posicionar, desenhar ---- */
  const fontPx = Math.round(RH * 0.6); // igual ao labelRibbonTexture
  const items = labels.map((l, i) => {
    const text = typeof l === "string" ? l : l.text;
    const part = typeof l === "string" ? ORBIT_PARTS[i % slotCount] : l.part;
    let s = slotIndex(part);
    if (s < 0) s = i % slotCount;
    return { text, part, slot: s, want: wrap01(T_FRONT + s / slotCount), w: textWidthPx(text, fontPx, true) / RW, u: 0 };
  });
  const layout = layoutLabels(items, 0.03) || { gap: 0, sumW: 0, overflow: false };
  const ribbonTex = tex.labelRibbonTexture(items.map((it) => ({ text: it.text, u: it.u })));

  // serviço de cada peça para o toque: a primeira legenda dela, senão a legenda mais perto na volta
  const partService = ORBIT_PARTS.map((_, s) => {
    const own = items.find((it) => it.slot === s);
    if (own) return own.text;
    const tS = wrap01(T_FRONT + s / slotCount);
    let best = null, bd = 9;
    for (const it of items) { const d = cdist(it.u, tS); if (d < bd) { bd = d; best = it.text; } }
    return best;
  });

  const bone = srgb(PALETTE.bone);

  /* ---- tubo: anéis em t, quads ordenados pela distância até a frente ---- */
  const N = tubeSegments, R = radial;
  const pos = new Float32Array(N * R * 3), off = new Float32Array(N * R * 3);
  const p = new THREE.Vector3(), nOut = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let j = 0; j < N; j++) {
    const t = j / N;
    E.point(t, p); E.normal(t, nOut);
    for (let k = 0; k < R; k++) {
      const ph = (k / R) * TAU, c = Math.cos(ph), s = Math.sin(ph), q = (j * R + k) * 3;
      pos[q] = p.x; pos[q + 1] = p.y; pos[q + 2] = p.z;
      off[q] = nOut.x * c + up.x * s; off[q + 1] = nOut.y * c + up.y * s; off[q + 2] = nOut.z * c + up.z * s;
    }
  }
  const quads = Array.from({ length: N }, (_, j) => ({ j, d: cdist((j + 0.5) / N, T_FRONT) })).sort((x, y) => x.d - y.d);
  const idx = new (N * R > 65535 ? Uint32Array : Uint16Array)(N * R * 6);
  let w = 0;
  for (const { j } of quads) {
    const j1 = (j + 1) % N;
    for (let k = 0; k < R; k++) {
      const k1 = (k + 1) % R, a = j * R + k, b = j1 * R + k, c = j1 * R + k1, d = j * R + k1;
      idx[w++] = a; idx[w++] = b; idx[w++] = d; idx[w++] = b; idx[w++] = c; idx[w++] = d;
    }
  }
  const quadD = Float32Array.from(quads, (q) => q.d);
  const tubeGeo = new THREE.BufferGeometry();
  tubeGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  tubeGeo.setAttribute("aOff", new THREE.BufferAttribute(off, 3));
  tubeGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tubeGeo.computeBoundingSphere();
  tubeGeo.boundingSphere.radius += 0.02;
  const tubeMat = new THREE.ShaderMaterial({
    uniforms: {
      uR: { value: O.tubeR }, uMinPx: { value: 1.25 }, uViewH: { value: 1000 }, uFloor: { value: 0.55 },
      uOpacity: { value: O.opacity }, uColor: { value: bone },
    },
    vertexShader: TUBE_VERT, fragmentShader: TUBE_FRAG,
    transparent: true, depthTest: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending, toneMapped: false,
  });
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  tube.name = "v3.orbit.tube";
  const _db = new THREE.Vector2(), _css = new THREE.Vector2();
  // guarda também o tamanho CSS do último quadro: hit(x, y, camera) do contrato funciona sem viewport
  tube.onBeforeRender = (renderer) => { renderer.getDrawingBufferSize(_db); renderer.getSize(_css); tubeMat.uniforms.uViewH.value = Math.max(1, _db.y); };

  /* ---- fita: tira vertical (normal para fora), abaixo da linha ---- */
  const M = ribbonSegments;
  const rPos = new Float32Array((M + 1) * 2 * 3), rNor = new Float32Array((M + 1) * 2 * 3), rUv = new Float32Array((M + 1) * 2 * 2);
  const yTop = -ribbonDrop, yBot = -ribbonDrop - bandH;
  for (let j = 0; j <= M; j++) {
    const t = j / M;
    E.point(t, p); E.normal(t, nOut);
    for (let r = 0; r < 2; r++) {
      const v = j * 2 + r, y = r ? yTop : yBot;
      rPos[v * 3] = p.x; rPos[v * 3 + 1] = y; rPos[v * 3 + 2] = p.z;
      rNor[v * 3] = nOut.x; rNor[v * 3 + 1] = 0; rNor[v * 3 + 2] = nOut.z;
      rUv[v * 2] = t; rUv[v * 2 + 1] = r; // topo = v 1 (canvas com flipY)
    }
  }
  const rIdx = [];
  for (let j = 0; j < M; j++) { const a = j * 2, b = a + 1, c = a + 2, d = a + 3; rIdx.push(a, c, b, b, c, d); }
  const ribGeo = new THREE.BufferGeometry();
  ribGeo.setAttribute("position", new THREE.BufferAttribute(rPos, 3));
  ribGeo.setAttribute("normal", new THREE.BufferAttribute(rNor, 3));
  ribGeo.setAttribute("uv", new THREE.BufferAttribute(rUv, 2));
  ribGeo.setIndex(rIdx);
  ribGeo.computeBoundingSphere();
  const ribMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: ribbonTex }, uColor: { value: bone }, uOpacity: { value: labelOpacity },
      uShift: { value: 0 }, uReveal: { value: 0 }, uFront: { value: T_FRONT },
    },
    vertexShader: RIB_VERT, fragmentShader: RIB_FRAG,
    transparent: true, depthTest: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending,
    toneMapped: false, side: THREE.DoubleSide,
  });
  const ribbon = new THREE.Mesh(ribGeo, ribMat);
  ribbon.name = "v3.orbit.ribbon";
  root.add(tube, ribbon);

  /* ---- estado ---- */
  let phase = 0, shift = 0;
  const tSlot = (i) => wrap01(T_FRONT + i / slotCount + shift);

  /** 0..1: o tubo desenha a partir da frente para os dois lados; as legendas aparecem logo atrás da linha. */
  function setPhase(ph) {
    phase = Math.max(0, Math.min(1, ph));
    root.visible = phase > 0.001;
    const D = phase * 0.5;
    let lo = 0, hi = quadD.length; // quantos quads têm d <= D
    while (lo < hi) { const m = (lo + hi) >> 1; if (quadD[m] <= D + 1e-9) lo = m + 1; else hi = m; }
    tubeGeo.setDrawRange(0, phase >= 1 ? Infinity : lo * R * 6);
    ribMat.uniforms.uReveal.value = Math.max(0, phase * 0.62 - 0.06);
  }

  /** Gira o conjunto ao longo da elipse (rad; 2 pi = uma volta). Peças e legendas andam juntas. */
  function setAngle(rad) {
    shift = (rad || 0) / TAU;
    ribMat.uniforms.uShift.value = shift;
  }

  /** Posição no MUNDO da vaga i (ordem de ORBIT_PARTS) para a montagem levar a peça até lá. */
  function slot(i, out = new THREE.Vector3()) {
    root.updateWorldMatrix(true, false);
    return E.point(tSlot(i), out).applyMatrix4(root.matrixWorld);
  }

  /* ---- toque: só círculos projetados ---- */
  const _c = new THREE.Vector3(), _e = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _v = new THREE.Vector3();
  const _cv = new THREE.Vector3(), _nm = new THREE.Matrix3();
  function project(world, camera, W, H, out) {
    _cv.copy(world).applyMatrix4(camera.matrixWorldInverse);
    if (_cv.z > -camera.near) return false; // atrás da câmera
    out.copy(world).project(camera);
    out.set((out.x * 0.5 + 0.5) * W, (0.5 - out.y * 0.5) * H, 0);
    return true;
  }
  const _pc = new THREE.Vector3(), _pe = new THREE.Vector3();
  function circleScore(world, radius, x, y, camera, W, H, minPx) {
    if (!project(world, camera, W, H, _pc)) return Infinity;
    _e.copy(world).addScaledVector(_r, radius);
    if (!project(_e, camera, W, H, _pe)) return Infinity;
    const rpx = Math.max(minPx, Math.hypot(_pe.x - _pc.x, _pe.y - _pc.y));
    const d = Math.hypot(x - _pc.x, y - _pc.y) / rpx;
    return d <= 1 ? d : Infinity;
  }

  /**
   * hit(x, y, camera, viewport?): x, y em px CSS relativos ao canvas; viewport {width, height} (ou {w, h}) em px CSS.
   * Sem viewport usa o tamanho CSS do renderer no último quadro desenhado (o tubo anota em onBeforeRender).
   * Devolve o texto do serviço (ex.: "Rims and tires") ou null. Legendas viradas para trás não contam.
   */
  function hit(x, y, camera, viewport) {
    if (!root.visible || phase < 0.6 || !camera) return null;
    const W = viewport ? viewport.width ?? viewport.w : _css.x, H = viewport ? viewport.height ?? viewport.h : _css.y;
    if (!W || !H) return null;
    camera.updateMatrixWorld();
    root.updateWorldMatrix(true, false);
    _r.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    _nm.getNormalMatrix(root.matrixWorld);
    const scale = root.matrixWorld.getMaxScaleOnAxis();
    const minPx = 22; // alvo de 44 px
    let best = null, bestScore = Infinity;

    // legendas: uma fileira de círculos do tamanho da altura da fita ao longo do texto
    const rr = bandH * 0.75 * scale, yMid = -ribbonDrop - bandH / 2;
    for (const it of items) {
      const tc = wrap01(it.u + shift);
      E.normal(tc, _n).applyMatrix3(_nm).normalize();
      E.point(tc, _c); _c.y = yMid; _c.applyMatrix4(root.matrixWorld);
      _v.copy(camera.position).sub(_c).normalize();
      if (_n.dot(_v) < 0.25) continue;
      const k = Math.max(1, Math.ceil(it.w / ((bandH * 1.2) / E.S)));
      for (let q = 0; q < k; q++) {
        const tq = wrap01(tc + it.w * ((q + 0.5) / k - 0.5));
        E.point(tq, _c); _c.y = yMid; _c.applyMatrix4(root.matrixWorld);
        const s = circleScore(_c, rr, x, y, camera, W, H, minPx) * 0.85; // legenda vence a peça de leve
        if (s < bestScore) { bestScore = s; best = it.text; }
      }
    }
    // peças: círculo do tamanho real em volta da vaga
    for (let i = 0; i < slotCount; i++) {
      slot(i, _c);
      const s = circleScore(_c, (PART_R[ORBIT_PARTS[i]] || 0.15) * scale, x, y, camera, W, H, minPx);
      if (s < bestScore) { bestScore = s; best = partService[i]; }
    }
    return best;
  }

  function dispose() { tubeGeo.dispose(); ribGeo.dispose(); tubeMat.dispose(); ribMat.dispose(); }

  setPhase(0);
  setAngle(0);

  return {
    root, tube, ribbon,
    setPhase, setAngle, slot, hit, dispose,
    parts: ORBIT_PARTS.slice(),
    partIndex: slotIndex,
    labels: items.map(({ text, part, slot: s, u, w: wt }) => ({ text, part, slot: s, u, w: wt })),
    layout: { ...layout, bandH, perimeter: E.S },
    setLabelOpacity(a) { ribMat.uniforms.uOpacity.value = a; },
    get phase() { return phase; },
    get angle() { return shift * TAU; },
  };
}

/** Bancada: lab/v3.html?p=orbit. Seis esferas de mentira (1 draw call) seguem as vagas; a fase e o giro animam em laço. */
export function labPreview(ctx) {
  const { mats } = ctx;
  const group = new THREE.Group();
  const orbit = buildOrbit(ctx, COPY.orbitLabels);
  group.add(orbit.root);
  const proxy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), mats.chromeBlack || mats.anodBlack, ORBIT_PARTS.length);
  proxy.name = "v3.orbit.proxies";
  group.add(proxy);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
  const place = () => {
    for (let i = 0; i < ORBIT_PARTS.length; i++) {
      orbit.slot(i, v); group.worldToLocal(v);
      const r = (PART_R[ORBIT_PARTS[i]] || 0.15) * 0.5;
      proxy.setMatrixAt(i, m4.compose(v, q, sc.set(r, r, r)));
    }
    proxy.instanceMatrix.needsUpdate = true;
    proxy.computeBoundingSphere();
  };
  orbit.setPhase(1); place();
  return {
    root: group,
    orbit,
    update(dt, t) {
      const c = t % 10;
      orbit.setPhase(Math.min(1, c / 3));
      orbit.setAngle(c < 4 ? 0 : (Math.PI / 3) * (0.5 - 0.5 * Math.cos(((c - 4) / 6) * Math.PI)));
      place();
    },
    dispose() { orbit.dispose(); proxy.geometry.dispose(); },
  };
}
