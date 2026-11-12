/* Estúdio: renderer, ambiente e luzes de um estúdio preto de produto.
   Tudo gerado em código: o mapa de ambiente é uma cena de "softboxes" renderizada pelo PMREM (sem arquivo HDR). */
import * as THREE from "three";

export const isPhone = () => Math.min(innerWidth, innerHeight) < 760;

/** Cena de ambiente: caixas de luz brancas num quarto preto. Dá reflexos de estúdio em metal e verniz. */
function softboxRoom() {
  const room = new THREE.Scene();
  // cúpula em degradê (claro em cima, quase preto embaixo): sem ela, uma face de metal virada para a câmera só reflete o vazio
  const dome = new THREE.SphereGeometry(20, 32, 16), col = [], pos = dome.attributes.position;
  for (let i = 0; i < pos.count; i++) { const h = pos.getY(i) / 20, v = h > 0 ? 0.16 + 0.5 * h * h : 0.16 * (1 + h) * (1 + h) + 0.015; col.push(v, v, v * 1.02); }
  dome.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  room.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const light = (color, intensity, w, h, x, y, z, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
    m.scale.set(w, h, 0.02); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); room.add(m); return m;
  };
  light(0xffffff, 12, 8, 5, 0, 4.4, 0.5, Math.PI / 2);                 // teto: caixa grande e macia
  light(0xffffff, 7, 3.2, 3.6, -4.2, 1.6, 3.6, 0, Math.PI / 3.4);      // frente-esquerda: a luz principal nos metais
  light(0xffffff, 3.2, 2.2, 3.0, 4.4, 1.2, 3.0, 0, -Math.PI / 3.2);    // frente-direita: preenchimento
  light(0xffffff, 8, 0.7, 5.0, -5.2, 1.0, -0.5, 0, Math.PI / 2);       // faixa lateral: risco de luz comprido
  light(0xfff1e0, 5, 0.7, 4.0, 5.2, 0.8, -1.5, 0, -Math.PI / 2);       // faixa lateral direita, morna
  light(0xffffff, 3, 7, 0.6, 0, -0.4, -5.5);                           // filete baixo ao fundo: contorno
  light(0x3a3d42, 1, 14, 0.1, 0, -2.2, 0, Math.PI / 2);                // chão: um cinza muito escuro para o metal não cair no preto total
  light(0xd0101f, 1.6, 1.4, 1.4, -3.2, -1.4, -3.5, 0, 0.6);            // um toque vermelho por trás (o único acento)
  return room;
}

export function createStudio(canvas, { fov = 32, post = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(softboxRoom(), 0.035).texture;
  scene.environment = env;
  scene.environmentIntensity = 1.0;

  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 60);
  camera.position.set(0, 0.25, 2.4);

  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-2.5, 3.5, 2.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1); rim.position.set(2.5, 1.5, -3); scene.add(rim);

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, isPhone() ? 2 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  addEventListener("resize", resize);

  return { THREE, renderer, scene, camera, env, key, rim, resize, render: () => renderer.render(scene, camera) };
}
