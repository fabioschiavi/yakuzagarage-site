/* v3: estúdio. Renderer, ambiente PMREM gerado de uma sala de softboxes (sem HDR), uma luz direcional,
   ACES, e o triângulo de tela cheia final com vinheta e grão (sem EffectComposer, sem render target).
   Lição já aprendida: face de metal virada para a câmera reflete o que está ATRÁS da câmera; se ali for vazio
   ela fica preta. Por isso a sala tem uma cúpula em degradê escura mas nunca zero, e um cartão frontal. */
import * as THREE from "three";
import { STUDIO, CAMERA } from "./spec.js";

const DEG = Math.PI / 180;

/** fovV a partir do fovH canônico e do aspecto, preso em 20..56 graus (seção 5). */
export function fovVFromH(fovH, aspect, [lo, hi] = STUDIO.fovVClamp) {
  const v = 2 * Math.atan(Math.tan((fovH * DEG) / 2) / aspect) / DEG;
  return Math.min(hi, Math.max(lo, v));
}

/** Sala do PMREM. Posições em metros em volta do cubo; a câmera herói fica em +X+Z. */
function envRoom() {
  const room = new THREE.Scene();
  room.background = new THREE.Color(0x000000);
  // cúpula em degradê: topo cinza baixo, horizonte quase preto, chão mais escuro ainda (nunca 0)
  const R = 14, dome = new THREE.SphereGeometry(R, 48, 24), pos = dome.attributes.position, col = [];
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / R;
    let v = h > 0 ? 0.05 + 0.17 * Math.pow(h, 1.4) : 0.05 * (1 + h) * (1 + h) + 0.008;
    // parede de luz macia do lado de fora (+X): disco, face da roda e costado refletem para lá de qualquer câmera
    const nx = pos.getX(i) / R; if (nx > 0) v += 0.30 * Math.pow(nx, 1.3) * (1 - 0.55 * Math.abs(h));
    col.push(v, v, v * 1.03);
  }
  dome.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  room.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const plane = new THREE.PlaneGeometry(1, 1);
  const panel = (hex, intensity, w, h, x, y, z) => {
    const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.scale.set(w, h, 1); m.position.set(x, y, z); m.lookAt(0, 0, 0); room.add(m); return m;
  };
  const S = STUDIO;
  // softbox grande acima e à frente: topo dos ombros do pneu, linha do lábio, topo da pinça
  panel(0xffffff, S.softbox.intensity, S.softbox.size[0], S.softbox.size[1], 0.9, 2.5, 1.3);
  // faixa alta atrás à direita (da câmera): é o espelho da face +X vista do herói, dá o risco comprido no verniz
  panel(0xffffff, S.strip.intensity, S.strip.size[0], S.strip.size[1], 1.7, 0.55, -2.0);
  // filete vermelho baixo atrás à esquerda: o fio vermelho em toda aresta de metal
  panel(S.redStrip.color, S.redStrip.intensity, 2.6, 0.16, -2.3, -0.3, -0.5);
  // cartão frontal fraco (atrás da câmera herói): faces viradas para a lente não morrem no preto
  panel(0xffffff, S.fill.intensity, 1.4, 1.4, 2.6, 0.5, 2.3);
  // cartão do lado de fora (+X): disco, face da roda e costado olham para lá; sem ele o ferro do disco lia preto na cena montada
  panel(0xffffff, 0.85, 2.4, 1.3, 3.2, 0.55, 0.3);
  return room;
}

export function createStudio(canvas, { tier = "base", transparent = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent, stencil: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, transparent ? 0 : 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = STUDIO.exposure;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  if (!transparent) scene.background = new THREE.Color(0x000000);

  // PMREM uma vez, 256 px; a sala é descartada depois
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = envRoom();
  const envRT = pmrem.fromScene(room, 0.02, 0.1, 40, { size: STUDIO.pmremSize });
  const envTex = envRT.texture;
  room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();
  scene.environment = envTex;

  const key = new THREE.DirectionalLight(0xffffff, STUDIO.key.intensity);
  key.position.set(...STUDIO.key.position);
  scene.add(key, key.target);

  const camera = new THREE.PerspectiveCamera(30, 1, STUDIO.near, STUDIO.far);
  camera.userData.fovH = CAMERA.hero.fovH;
  camera.position.set(...CAMERA.hero.pos);
  camera.lookAt(...CAMERA.hero.target);

  /* ---- triângulo final: vinheta 0.35 + grão 1.5% animado ----
     Sai em valores já codificados (sem tone mapping): escurece multiplicando via alfa, o grão soma um pouco. */
  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const overlayMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uVignette: { value: STUDIO.vignette }, uGrain: { value: STUDIO.grain } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uVignette, uGrain;
      varying vec2 vUv;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main() {
        float d = length(vUv - 0.5) * 1.41421356;
        float vig = uVignette * smoothstep(0.3, 1.05, d);
        float n = hash(gl_FragCoord.xy + floor(fract(uTime * 0.37) * 240.0) * vec2(17.0, 31.0)) - 0.5;
        float g = n * 2.0 * uGrain;
        gl_FragColor = vec4(vec3(max(g, 0.0) * 0.6), clamp(vig + max(-g, 0.0), 0.0, 1.0));
      }`,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const overlay = new THREE.Mesh(triGeo, overlayMat);
  overlay.name = "overlay"; overlay.frustumCulled = false; overlay.renderOrder = 1e9; overlay.userData.isOverlay = true;
  if (!transparent) scene.add(overlay);

  let dprOverride = null, W = 1, H = 1;
  const state = { tier };
  const dprFor = () => (dprOverride != null ? dprOverride : state.tier === "low" ? STUDIO.dprLow : Math.min(window.devicePixelRatio || 1, STUDIO.dprCap));

  function applyFov() {
    camera.fov = fovVFromH(camera.userData.fovH, camera.aspect);
    camera.updateProjectionMatrix();
  }
  function resize(w, h) {
    W = Math.max(1, Math.round(w ?? (canvas.clientWidth || window.innerWidth)));
    H = Math.max(1, Math.round(h ?? (canvas.clientHeight || window.innerHeight)));
    renderer.setPixelRatio(dprFor());
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    applyFov();
  }
  function setDPR(x) { dprOverride = x; resize(W, H); }
  function setFovH(deg) { camera.userData.fovH = deg; applyFov(); }

  const t0 = performance.now();
  function render() {
    overlayMat.uniforms.uTime.value = (performance.now() - t0) / 1000;
    renderer.render(scene, camera);
  }

  /** Mede o custo médio de um quadro (render + sync por readPixels de 1 px). Pula os 5 primeiros (aquecimento).
      rAF entrega o intervalo da tela (16.7 ms a 60 Hz), por isso a medida é do trabalho, não do intervalo. */
  function probe(frames = STUDIO.tiers.probeFrames) {
    return new Promise((resolve) => {
      const gl = renderer.getContext(), px = new Uint8Array(4), times = [];
      let i = 0;
      const next = (f) => (document.hidden ? setTimeout(f, 16) : requestAnimationFrame(f));
      const step = () => {
        const a = performance.now();
        render();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        times.push(performance.now() - a);
        if (++i < frames) next(step);
        else {
          const s = times.slice(Math.min(5, times.length - 1));
          const ms = s.reduce((x, y) => x + y, 0) / s.length;
          api.lastProbe = { ms, frames: times.length, times };
          resolve(ms);
        }
      };
      next(step);
    });
  }

  /** Liga o resize à janela: altura 100lvh, variações abaixo de 120 px (barra do Instagram) são ignoradas. Devolve o desligador. */
  function autoResize() {
    let lastW = 0, lastH = 0;
    const on = () => {
      const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      if (w === lastW && Math.abs(h - lastH) < STUDIO.heightJumpIgnorePx) return;
      lastW = w; lastH = h; resize(w, h);
    };
    on(); window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }

  resize();
  const api = {
    THREE, renderer, scene, camera, envTex, overlay, key,
    render, resize, setDPR, setFovH, probe, autoResize,
    get tier() { return state.tier; },
    set tier(t) { state.tier = t; resize(W, H); },
    get size() { return { w: W, h: H, dpr: renderer.getPixelRatio() }; },
    lastProbe: null,
    dispose() { envRT.dispose(); triGeo.dispose(); overlayMat.dispose(); renderer.dispose(); },
  };
  return api;
}
