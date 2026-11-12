/* v3 · LAJE de basalto (o lugar do canto, como o bloco da xícara), seção 2 da spec.
   Mundo: cubo na origem, eixo da roda +X, +Y para cima. Topo da laje em y = -0.3118 (r0 - 18.7 mm de deflexão estática).
   Centro (-0.0355, -0.3818, 0): sob o meio do pneu em X (-0.163..0.092), meia altura abaixo do topo.
   2 draws: a laje (RoundedBox 1.0 x 0.14 x 1.6, raio 8 mm, 3 segmentos de quina) e a sombra de contato.
   Sem shadow map: a escuridão do contato é a sombra-mancha (canvas radial) + um núcleo retangular analítico
   do tamanho da pegada do pneu, que só existe com o pneu encostado. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { LAYOUT } from "../spec.js";
import { clamp } from "./geomkit.js";

const S = LAYOUT.slab;
const [SX, SY, SZ] = S.size;                 // 1.0 (X) x 0.14 x 1.6 (Z)
const C = new THREE.Vector3(...S.center);    // (-0.0355, -0.3818, 0)
const TOP = S.topY;                          // -0.3118
const SH = S.shadow;                         // lift 2 mm, opacidade 0.85 -> 0.2, escala 1.0 -> 1.6, folga de 0.25 m = mínimo

/* sombra-mancha: metade da força em r ~0.41 do meio-lado (gaussiana exp(-4.2 r^2) do textures.blobShadow).
   Plano base 0.60 (X) x 1.00 (Z): meia força em +/-0.12 x +/-0.20 m, ou seja a largura do pneu (0.255)
   e o trecho em que o pneu está a menos de ~6 cm da pedra (r0 - sqrt(r0^2 - z^2) em z = 0.2). */
const BLOB = new THREE.Vector2(0.60, 1.00);
/* núcleo: retângulo suave do tamanho da pegada (255 mm de banda + folga; 2 sqrt(2 r0 d) = 222 mm de comprimento) */
const CORE_HALF = new THREE.Vector2(0.135, 0.125);
const CORE_MAX = 0.6;                        // opacidade do núcleo encostado; some até 25 mm de folga
const CORE_GAP = 0.025;
const SHADOW_X = (LAYOUT.x.tyre[0] + LAYOUT.x.tyre[1]) / 2; // -0.0355: meio do pneu em X

/* UV em metros por "desdobramento" a partir do topo: no topo uv = (x, z); descendo pela quina de 8 mm soma o
   comprimento de arco, depois a altura da lateral. Contínuo do topo para os 4 lados (os mapas de grão do basalto
   têm repeat pensado para UV em metros, ver materials.js). O RoundedBox da three dá UV 0..1 por face,
   o que esticaria o fBm 1.6x em Z no topo. */
function unfoldUV(g, hx, hy, hz, r) {
  const P = g.attributes.position, N = g.attributes.normal, uv = g.attributes.uv;
  const ix = hx - r, iy = hy - r, iz = hz - r;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const cx = clamp(x, -ix, ix), cy = clamp(y, -iy, iy), cz = clamp(z, -iz, iz);
    const ny = clamp(N.getY(i), -1, 1), hl = Math.hypot(N.getX(i), N.getZ(i));
    // distância descida a partir da borda do topo: arco da quina (r * ângulo) + trecho reto da lateral
    const down = r * Math.acos(ny) + (iy - cy);
    const dx = hl > 1e-6 ? N.getX(i) / hl : 0, dz = hl > 1e-6 ? N.getZ(i) / hl : 0;
    uv.setXY(i, cx + dx * down, cz + dz * down);
  }
  uv.needsUpdate = true;
  return g;
}

const SHADOW_VS = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const SHADOW_FS = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uBlob, uCoreHalf, uOffset;
  uniform vec4 uBounds;      // xmin, xmax, zmin, zmax do topo plano, no referencial da laje
  uniform float uScale, uBroad, uCore;
  varying vec2 vP;
  void main() {
    // mancha larga: o canvas radial, esticado pelo tamanho base x escala da folga
    float broad = texture2D(uMap, vP / (uBlob * uScale) + 0.5).a * uBroad;
    // núcleo: retângulo de quinas macias na pegada; mais duro nas laterais do pneu, mais solto na frente/trás
    vec2 q = abs(vP) / uCoreHalf;
    float core = (1.0 - smoothstep(0.55, 1.0, q.x)) * (1.0 - smoothstep(0.30, 1.0, q.y)) * uCore;
    // nunca sombrear fora da pedra: a roda desliza +0.6 m em X no beat do freio
    vec2 w = vP + uOffset;
    float edge = smoothstep(uBounds.x, uBounds.x + 0.01, w.x) * (1.0 - smoothstep(uBounds.y - 0.01, uBounds.y, w.x))
               * smoothstep(uBounds.z, uBounds.z + 0.01, w.y) * (1.0 - smoothstep(uBounds.w - 0.01, uBounds.w, w.y));
    float a = (1.0 - (1.0 - broad) * (1.0 - core)) * edge;
    if (a < 0.002) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }`;

export function buildSlab(ctx) {
  const { mats, tex } = ctx;
  const root = new THREE.Group(); root.name = "slab";

  /* ---------------- laje ---------------- */
  const geo = unfoldUV(new RoundedBoxGeometry(SX, SY, SZ, S.segments, S.radius), SX / 2, SY / 2, SZ / 2, S.radius);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  // clone local: ganha um mapa de cor (o mesmo fBm, outro repeat) para a pedra ter mancha de cristal, não preto chapado.
  // O clone da textura divide a imagem na GPU (mesmo Source): custo zero de memória.
  const stone = mats.basalt.clone();
  stone.name = "v3.slab.basalt";
  let mottle = null;
  if (tex && tex.fbmRoughness) {
    mottle = tex.fbmRoughness().clone();
    mottle.repeat.set(0.7, 0.7); mottle.offset.set(0.31, 0.57); mottle.needsUpdate = true;
    stone.map = mottle;
    // o fBm vai de 0.55 a 1 (média ~0.78): compensa para a média continuar #0e0e0e
    stone.color.multiplyScalar(1 / 0.78);
  }
  const slab = new THREE.Mesh(geo, stone);
  slab.name = "slab.basalt";
  slab.position.copy(C);
  root.add(slab);

  /* ---------------- sombra de contato ----------------
     Plano já do tamanho máximo (escala 1.6): a escala da mancha é feita no shader, então o núcleo não cresce junto. */
  const PW = BLOB.x * SH.scale[1], PL = BLOB.y * SH.scale[1];
  const sGeo = new THREE.PlaneGeometry(PW, PL, 1, 1);
  sGeo.rotateX(-Math.PI / 2);                // normal +Y; position.xz = coordenadas no plano do topo
  const blob = tex && tex.blobShadow ? tex.blobShadow() : null;
  const uni = {
    uMap: { value: blob },
    uBlob: { value: BLOB.clone() },
    uCoreHalf: { value: CORE_HALF.clone() },
    uOffset: { value: new THREE.Vector2(SHADOW_X, 0) },
    uBounds: { value: new THREE.Vector4(C.x - SX / 2 + S.radius, C.x + SX / 2 - S.radius, C.z - SZ / 2 + S.radius, C.z + SZ / 2 - S.radius) },
    uScale: { value: 1 },
    uBroad: { value: SH.opacity[0] },
    uCore: { value: CORE_MAX },
  };
  const sMat = new THREE.ShaderMaterial({
    name: "v3.slab.shadow", uniforms: uni, vertexShader: SHADOW_VS, fragmentShader: SHADOW_FS,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  if (!blob) uni.uBroad.value = 0; // sem a textura só o núcleo analítico (não quebra a bancada)
  const shadow = new THREE.Mesh(sGeo, sMat);
  shadow.name = "slab.shadow";
  shadow.position.set(SHADOW_X, TOP + SH.lift, 0);   // 2 mm acima do topo: sem z-fight a 3 m com near 0.01
  shadow.renderOrder = 1;                            // depois da laje opaca; antes das faíscas aditivas tanto faz
  root.add(shadow);

  const anchors = {
    center: C.clone(),
    top: new THREE.Vector3(C.x, TOP, C.z),
    contact: new THREE.Vector3(SHADOW_X, TOP, 0),    // = LAYOUT.anchors.contact
    edgeFront: new THREE.Vector3(C.x, TOP, C.z + SZ / 2),
    edgeOut: new THREE.Vector3(C.x + SX / 2, TOP, C.z),
  };

  const part = {
    root, anchors, slab, shadow,
    topY: TOP,
    explodeAxis: new THREE.Vector3(0, -1, 0),
    explodeDist: 0,                                  // a laje não entra na órbita
    /** gapM = folga pneu-pedra (quartercar.gap(), 0 encostado). dx = deslocamento da roda em X (fitment/freio),
        k = multiplicador geral (0 esconde, ex. na órbita). Só escreve uniforms: barato por quadro. */
    setShadow(gapM, dx = 0, k = 1) {
      const g = gapM > 0 ? gapM : 0;
      const t = clamp(g / SH.gapForMin, 0, 1), e = 1 - (1 - t) * (1 - t); // cai rápido no primeiro centímetro, como AO real
      uni.uScale.value = SH.scale[0] + (SH.scale[1] - SH.scale[0]) * e;
      uni.uBroad.value = blob ? (SH.opacity[0] + (SH.opacity[1] - SH.opacity[0]) * e) * k : 0;
      const c = clamp(g / CORE_GAP, 0, 1);
      uni.uCore.value = CORE_MAX * (1 - c * c * (3 - 2 * c)) * k;
      shadow.position.x = SHADOW_X + dx;
      uni.uOffset.value.set(shadow.position.x, shadow.position.z);
      shadow.visible = k > 0.001;
    },
    dispose() {
      geo.dispose(); sGeo.dispose(); stone.dispose(); sMat.dispose();
      if (mottle) mottle.dispose();
    },
  };
  part.setShadow(0);
  return part;
}
