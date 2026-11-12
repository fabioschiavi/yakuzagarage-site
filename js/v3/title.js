/* v3: título gigante vazado atrás do canto. É o mesmo visual do .word do v2 (Anton só em contorno,
   osso a ~30%, sem preenchimento, deslizando de lado), agora como plano 3D: as peças o tapam pelo depth.
   Não toca no DOM. Custa 1 draw call parado e 2 só durante a troca de palavra (crossfade entre dois planos).
   Cor: o shader usa só o ALFA do canvas e pinta osso constante; assim a borda filtrada não puxa preto
   (o canvas transparente tem RGB 0) e o contorno não escurece ao reduzir. Sai em sRGB direto, sem tone
   mapping, para casar com o rgba(242,238,230,.34) do CSS do v2 sobre o preto. */
import * as THREE from "three";
import { LAYOUT, PALETTE, COPY, SIM, BEATS } from "./spec.js";

const T = LAYOUT.title;
// chave de beat -> palavra do 1º trecho que define title (null = sem título); sem nenhum: undefined (mantém)
const BEAT_TITLE = new Map();
for (const b of BEATS) {
  if (!BEAT_TITLE.has(b.key)) BEAT_TITLE.set(b.key, undefined);
  if (BEAT_TITLE.get(b.key) === undefined && "title" in b) BEAT_TITLE.set(b.key, b.title ? b.title.word : null);
}
const FADE_S = 0.35;          // mesma ordem de grandeza da troca de beat da UI (300 ms)
const DIP_MAX_PX = 6;         // seção 4d: mergulho de 6 px, preso
const [GLOW_T0, GLOW_T1] = SIM.heat.glow; // 480..950 °C, a mesma rampa do emissivo do disco

// cor em sRGB cru (o shader não converte espaço de cor)
function srgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

const VERT = /* glsl */ `
  uniform float uDip;
  uniform vec3 uHot;
  varying vec2 vUv;
  varying vec3 vClip;
  varying vec3 vHot;
  varying float vAsp;
  void main() {
    vUv = uv;
    vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    c.y -= uDip * c.w;                       // mergulho em espaço de tela: px fixos, qualquer distância
    gl_Position = c;
    vClip = c.xyw;                           // divide no fragmento (correto em perspectiva)
    vec4 h = projectionMatrix * viewMatrix * vec4(uHot, 1.0);
    vHot = h.xyw;
    vAsp = projectionMatrix[1][1] / projectionMatrix[0][0];
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uAlpha, uGain, uGlow, uGlowGain, uHotR;
  uniform vec3 uBone, uEmber;
  varying vec2 vUv;
  varying vec3 vClip;
  varying vec3 vHot;
  varying float vAsp;
  void main() {
    float a = texture2D(uMap, vUv).a * uAlpha * uGain;
    if (a < 0.002) discard;
    // calor: forte perto do arco quente na tela, um resto morno no resto da palavra
    float near = 0.0;
    if (vHot.z > 1e-4) {
      vec2 d = (vClip.xy / vClip.z - vHot.xy / vHot.z) * vec2(vAsp, 1.0);
      near = exp(-dot(d, d) / (uHotR * uHotR));
    }
    float g = uGlow * mix(0.18, 1.0, near);
    // tinge para o ember e soma luz sem somar alfa: é aditivo sobre o que está atrás
    vec3 col = mix(uBone, uEmber, clamp(g * 1.2, 0.0, 1.0)) * (1.0 + uGlowGain * g);
    gl_FragColor = vec4(col * a, a);
  }`;

/**
 * buildTitle(ctx, opts) -> { root, setWord, setX, setGlow, dip, setOpacity, preload, dispose }
 * ctx = { THREE, mats, tex, tier }. tex.titleTexture(word) desenha o canvas 4096x512.
 * root fica em (0, LAYOUT.title.y, LAYOUT.title.z) virado para +Z; a coreografia pode reposicionar/girar root
 * por beat (ex.: root.lookAt(camera.position) vira o plano para a câmera). setX desliza num grupo interno.
 */
export function buildTitle(ctx, { word = COPY.titles.hero, gain = 1, glowGain = 1.6, hotRadius = 0.75, hot = LAYOUT.caliper.center } = {}) {
  const { tex } = ctx;
  const [cw, ch] = T.canvas;
  const geo = new THREE.PlaneGeometry(T.width, (T.width * ch) / cw);

  // uniforms comuns aos dois planos (mesmo objeto {value} nos dois materiais)
  const shared = {
    uDip: { value: 0 },
    uHot: { value: new THREE.Vector3(...hot) },
    uHotR: { value: hotRadius },
    uGain: { value: gain },
    uGlow: { value: 0 },
    uGlowGain: { value: glowGain },
    uBone: { value: srgb(PALETTE.bone) },
    uEmber: { value: srgb(PALETTE.ember) },
  };
  const makeMat = () => new THREE.ShaderMaterial({
    uniforms: { ...shared, uMap: { value: null }, uAlpha: { value: 0 } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthTest: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.NormalBlending, toneMapped: false, side: THREE.FrontSide,
  });

  const root = new THREE.Group();
  root.name = "v3.title";
  root.position.set(0, T.y, T.z);
  const slide = new THREE.Group();
  slide.name = "v3.title.slide";
  root.add(slide);

  // dois planos: cada um guarda uma palavra; a troca cruza os dois
  const planes = [0, 1].map((i) => {
    const m = new THREE.Mesh(geo, makeMat());
    m.name = "v3.title." + i;
    m.visible = false;
    m.renderOrder = -1; // o mais distante: entre os transparentes, desenha antes
    slide.add(m);
    return { mesh: m, word: null, texture: null, from: 0, to: 0 };
  });

  let fadeStart = -1e9, opacity = 1, dipPx = 0, current = null;
  const _size = new THREE.Vector2();

  // peso de cada plano em função do tempo (sem estado por quadro: um plano invisível não trava o fade)
  const weightOf = (p, t) => {
    const k = smooth(0, 1, (t - fadeStart) / FADE_S);
    return p.from + (p.to - p.from) * k;
  };
  function syncVisible(t = now()) {
    for (const p of planes) p.mesh.visible = opacity > 0.001 && (weightOf(p, t) > 0.001 || p.to > 0);
  }

  for (const p of planes) {
    p.mesh.onBeforeRender = (renderer) => {
      const t = now(), w = weightOf(p, t);
      p.mesh.material.uniforms.uAlpha.value = w * opacity;
      renderer.getSize(_size);
      shared.uDip.value = (dipPx * 2) / Math.max(1, _size.y);
      // fade terminado e peso zero: sai da lista no próximo quadro (economiza a draw call)
      if (w <= 0.001 && p.to === 0 && t - fadeStart >= FADE_S) p.mesh.visible = false;
    };
  }

  function assign(p, w) {
    if (p.word === w) return;
    // libera a GPU da palavra que sai; o canvas fica no cache do tex e só reenvia se voltar
    if (p.texture && !planes.some((q) => q !== p && q.texture === p.texture)) p.texture.dispose();
    p.word = w;
    p.texture = w ? tex.titleTexture(w) : null;
    p.mesh.material.uniforms.uMap.value = p.texture;
  }

  /** Troca a palavra com crossfade. Aceita a palavra ("FITMENT") ou a chave de COPY.titles ("fitment"). null/"" apaga. */
  function setWord(w, { instant = false } = {}) {
    if (w && COPY.titles[w]) w = COPY.titles[w];
    else if (w && BEAT_TITLE.has(w)) {
      // chave de beat sem entrada em COPY.titles ("orbit", "reassembly", "carlinhos"): segue a tabela BEATS.
      // title null = some; beat sem título = mantém a palavra atual. Nunca desenha a chave como palavra.
      const bt = BEAT_TITLE.get(w);
      if (bt === undefined) return;
      w = bt;
    }
    w = w || null;
    if (w === current && !instant) return;
    const t = now();
    for (const p of planes) p.from = weightOf(p, t); // congela onde está
    let target = null;
    if (w) {
      // reaproveita o plano que já tem a palavra (ida e volta no scroll não redesenha nem reenvia)
      target = planes.find((p) => p.word === w);
      if (!target) {
        target = planes[0].from <= planes[1].from ? planes[0] : planes[1];
        assign(target, w);
        target.from = 0; // textura nova começa invisível
      }
    }
    for (const p of planes) p.to = p === target ? 1 : 0;
    fadeStart = instant ? t - FADE_S : t;
    if (instant) for (const p of planes) p.from = p.to;
    current = w;
    syncVisible(t);
  }

  /** Deslize lateral em metros, ao longo do X local do plano. */
  function setX(m) { slide.position.x = m; }

  /** Brilho pela temperatura máxima do disco (°C). hotWorld opcional: ponto do arco quente (padrão: centro da pinça). */
  function setGlow(Tmax, hotWorld = null) {
    shared.uGlow.value = smooth(GLOW_T0, GLOW_T1, Tmax || 0);
    if (hotWorld) shared.uHot.value.copy(hotWorld);
  }

  /** Mergulho em px de tela (positivo = para baixo), preso em +/-6 px. */
  function dip(px) { dipPx = Math.max(-DIP_MAX_PX, Math.min(DIP_MAX_PX, px || 0)); }

  function setOpacity(a) { opacity = Math.max(0, Math.min(1, a)); syncVisible(); }

  /** Desenha os canvases das palavras antes (só CPU; a GPU recebe quando a palavra entra). Bom para o loader. */
  function preload(words = Object.values(COPY.titles)) { for (const w of words) if (w) tex.titleTexture(w); }

  function dispose() {
    geo.dispose();
    for (const p of planes) { p.mesh.material.dispose(); if (p.texture) p.texture.dispose(); }
  }

  setWord(word, { instant: true });

  return {
    root, slide, planes: planes.map((p) => p.mesh),
    setWord, setX, setGlow, dip, setOpacity, preload, dispose,
    get word() { return current; },
    uniforms: shared,
  };
}

/** Bancada: lab/v3.html?p=title&view=hero. Um pneu de mentira na frente prova a oclusão; palavras giram, desliza e esquenta. */
export function labPreview(ctx) {
  const { THREE: T3 = THREE, mats } = ctx;
  const group = new T3.Group();
  const title = buildTitle(ctx);
  group.add(title.root);
  const r0 = LAYOUT.tyre.r0, w = LAYOUT.tyre.section;
  const tyre = new T3.Mesh(new T3.CylinderGeometry(r0, r0, w, 64, 1).rotateZ(Math.PI / 2), mats.tyre);
  tyre.position.x = (LAYOUT.x.tyre[0] + LAYOUT.x.tyre[1]) / 2;
  group.add(tyre);
  const words = Object.values(COPY.titles);
  let i = 0, next = 3;
  return {
    root: group,
    update(dt, t) {
      title.setX(0.9 * Math.cos(t * 0.35));
      title.setGlow(25 + 900 * Math.max(0, Math.sin(t * 0.6)));
      title.dip(6 * Math.sin(t * 5) * Math.max(0, Math.sin(t * 0.9)));
      if (t > next) { next = t + 3; i = (i + 1) % words.length; title.setWord(words[i]); }
    },
    dispose() { title.dispose(); tyre.geometry.dispose(); },
  };
}
