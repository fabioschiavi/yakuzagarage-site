/* v3: o MaterialSet. Todos os parâmetros vêm da seção 2 da spec (via spec.js).
   O tier é decidido no loader e nunca muda depois: nada aqui liga/desliga recurso que recompile shader após a íris.
   Convenções de UV que os construtores precisam respeitar:
   - iron / turning / slots / aniso: UV planar 0..1 sobre o diâmetro 2R do disco (kit.planarUV(g, 0.19)).
   - face (swirl): UV planar sobre a face r 0.215 (kit.planarUV(g, 0.215)).
   - ExtrudeGeometry sem remapear tem UV em metros: os mapas de grão abaixo já vêm com repeat para isso.
   - barrel tem vertexColors (AO assado): a geometria PRECISA do atributo color, senão fica preta. */
import * as THREE from "three";
import { LAYOUT, PALETTE, SIM } from "./spec.js";

const G = LAYOUT.heatGrid;

/** Rampa de corpo negro da spec em JS (pastilha, faíscas, título). Devolve {color, intensity}. */
const RAMP = SIM.heat.ramp.map(([T, hex]) => [T, new THREE.Color(hex)]);
export function heatRamp(T, out = new THREE.Color()) {
  out.setRGB(0, 0, 0);
  for (let i = 1; i < RAMP.length; i++) {
    const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
    if (T >= t0) out.copy(c0).lerp(c1, Math.min(1, Math.max(0, (T - t0) / (t1 - t0))));
  }
  const [a, b, k] = SIM.heat.glow, x = Math.min(1, Math.max(0, (T - a) / (b - a)));
  return { color: out, intensity: x * x * (3 - 2 * x) * k };
}

export function createMaterials({ envTex = null, tex, tier = "base", heatTex = null } = {}) {
  const high = tier === "high", low = tier === "low";

  // textura de calor provisória (tudo frio) até a sim entregar a dela
  const blankHeat = new THREE.DataTexture(new Uint8Array(G.nA * G.nR), G.nA, G.nR, THREE.RedFormat, THREE.UnsignedByteType);
  blankHeat.minFilter = blankHeat.magFilter = THREE.LinearFilter; blankHeat.wrapS = THREE.RepeatWrapping; blankHeat.needsUpdate = true;
  const prepHeat = (t) => { if (t) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; } return t; };

  // uniforms compartilhados: um set só para todo material que lê calor
  const heat = {
    uHeat: { value: prepHeat(heatTex) || blankHeat },
    uHeatR: { value: new THREE.Vector2(G.rInner, G.rOuter) },
    uHeatC1: { value: new THREE.Color(SIM.heat.ramp[1][1]) },
    uHeatC2: { value: new THREE.Color(SIM.heat.ramp[2][1]) },
    uHeatC3: { value: new THREE.Color(SIM.heat.ramp[3][1]) },
    uHeatScale: { value: G.tMaxStored },
    uMaxT: { value: 25 },
  };
  const swirl = { uSwirl: { value: 1 } };
  const tint = { uTint: { value: 0 }, uTintMap: { value: tex.heatTintMap() } };

  const rep = (t, x, y = x) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };
  const withEnv = (m) => { if (envTex) m.envMap = envTex; return m; };
  const P = (o) => withEnv(new THREE.MeshPhysicalMaterial(o));

  /* ---- injeções de shader ---- */
  // calor no referencial do disco: theta = atan2(y, -z), r = |yz| (posição local, antes do giro do grupo)
  function patchHeat(m, key) {
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, heat);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRotorPos;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vRotorPos = position;
          #ifdef USE_INSTANCING
            vRotorPos = (instanceMatrix * vec4(position, 1.0)).xyz;
          #endif`);
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vRotorPos;
          uniform sampler2D uHeat; uniform vec2 uHeatR; uniform vec3 uHeatC1, uHeatC2, uHeatC3; uniform float uHeatScale;
          float rotorT() {
            float th = atan(vRotorPos.y, -vRotorPos.z);
            float u = fract(th / 6.28318530718);
            float v = clamp((length(vRotorPos.yz) - uHeatR.x) / (uHeatR.y - uHeatR.x), 0.0, 1.0);
            return texture2D(uHeat, vec2(u, v)).r * uHeatScale;
          }
          vec3 rotorRamp(float T) {
            vec3 c = mix(vec3(0.0), uHeatC1, smoothstep(480.0, 550.0, T));
            c = mix(c, uHeatC2, smoothstep(550.0, 700.0, T));
            return mix(c, uHeatC3, smoothstep(700.0, 900.0, T));
          }`)
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
          float heatTc = rotorT();
          roughnessFactor = max(0.03, roughnessFactor - 0.1 * smoothstep(580.0, 620.0, heatTc));`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          totalEmissiveRadiance += rotorRamp(heatTc) * smoothstep(480.0, 950.0, heatTc) * 3.0;`);
    };
    m.customProgramCacheKey = () => "v3heat:" + key;
    return m;
  }
  // swirl: o clearcoat vai de "lavado errado" (uSwirl 1) a espelho (0); recalcula depois do chunk da three
  function patchSwirl(m) {
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, swirl);
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uSwirl;")
        .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>
          #if defined( USE_CLEARCOAT ) && defined( USE_CLEARCOAT_ROUGHNESSMAP )
          {
            float sw = texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
            float ccr = mix( 0.0, clearcoatRoughness * ( 0.35 + 1.9 * sw ), uSwirl );
            material.clearcoatRoughness = min( max( ccr, 0.0525 ) + geometryRoughness, 1.0 );
          }
          #endif`);
    };
    m.customProgramCacheKey = () => "v3swirl";
    return m;
  }
  // revenimento do cubo: mais forte perto do eixo (r pequeno), manchado em volta
  function patchTint(m) {
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, tint);
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vHubPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHubPos = position;\n#ifdef USE_INSTANCING\nvHubPos = (instanceMatrix * vec4(position, 1.0)).xyz;\n#endif");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vHubPos;\nuniform float uTint;\nuniform sampler2D uTintMap;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          {
            float a = atan(vHubPos.y, -vHubPos.z) / 6.28318530718 + 0.5;
            float k = clamp(uTint * (1.25 - length(vHubPos.yz) * 5.0), 0.0, 1.0);
            vec3 tc = texture2D(uTintMap, vec2(k, a)).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, tc, smoothstep(0.0, 0.08, k));
          }`);
    };
    m.customProgramCacheKey = () => "v3tint";
    return m;
  }

  /* ---- mapas compartilhados ---- */
  const grainR = tex.fbmRoughness();
  const grainN = tex.grainNormal();
  const turning = tex.turningRoughness();
  const slots = tex.rotorSlotsNormal();
  const swirlTex = tex.swirlMap();

  /* ---- fábricas: ao(name) refaz o material com vertexColors, mantendo injeções e uniforms ---- */
  const C = (hex) => new THREE.Color(hex);
  const make = {
    caliperPaint: (o = {}) => P({
      color: C(LAYOUT.caliper.paint.color), metalness: 0, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.06,
      // casca de laranja leve só no verniz: o risco do softbox ondula como em pintura de verdade (UV em metros)
      clearcoatNormalMap: rep(grainN, 22), clearcoatNormalScale: new THREE.Vector2(0.06, 0.06), ...o,
    }),
    iron: (o = {}) => patchHeat(P({
      color: C(PALETTE.iron), metalness: 1, roughness: 0.32, roughnessMap: turning,
      normalMap: slots, normalScale: new THREE.Vector2(1, 1),
      ...(high ? { anisotropy: LAYOUT.rotor.iron.anisotropy, anisotropyMap: tex.anisoCircular() } : {}), ...o,
    }), "iron" + (high ? "A" : "") + (o.vertexColors ? "V" : "")),
    // aletas e garganta do disco: ferro fundido bruto, também esquenta
    ironCast: (o = {}) => patchHeat(P({ color: C("#5a5957"), metalness: 1, roughness: 0.55, roughnessMap: rep(grainR, 30), ...o }), "ironCast" + (o.vertexColors ? "V" : "")),
    anodBlack: (o = {}) => P({ color: C(PALETTE.anodBlack), metalness: 1, roughness: 0.35, roughnessMap: rep(grainR, 18), ...o }),
    face: (o = {}) => {
      const m = P({
        // lookdev: #2b2d30 da spec lê como plástico preto no estúdio escuro (F0 linear 0.024); o gunmetal real de roda forjada é ~#5d6269
        color: C("#5d6269"), metalness: 1, roughness: 0.30,
        clearcoat: low ? 0 : 0.7, clearcoatRoughness: 0.12, clearcoatRoughnessMap: swirlTex, ...o,
      });
      return low ? m : patchSwirl(m);
    },
    lip: (o = {}) => P({ color: C("#e4e6e9"), metalness: 1, roughness: 0.07, ...o }),
    barrel: (o = {}) => P({ color: C("#a9acb0"), metalness: 1, roughness: 0.40, roughnessMap: rep(grainR, 4, 1), vertexColors: true, ...o }),
    tyre: (o = {}) => P({
      color: C(PALETTE.tyre), metalness: 0, roughness: 0.84, envMapIntensity: 0.5,
      ...(low ? {} : { sheen: 0.35, sheenColor: C(PALETTE.tyreSheen), sheenRoughness: 0.6 }), ...o,
    }),
    powderRed: (o = {}) => P({
      color: C(LAYOUT.spring.color), metalness: 0, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.3,
      normalMap: rep(grainN, 40), normalScale: new THREE.Vector2(0.12, 0.12), ...o,
    }),
    titanium: (o = {}) => {
      const b = LAYOUT.coilover.body, th = rep(tex.threadNormal(b.threadPitch), 1, b.length / b.threadPitch);
      return P({ color: C(PALETTE.titanium), metalness: 1, roughness: 0.28, normalMap: th, normalScale: new THREE.Vector2(0.9, 0.9), ...o });
    },
    chromeBlack: (o = {}) => P({ color: C(PALETTE.chromeBlack), metalness: 1, roughness: 0.18, ...o }),
    beadAlu: (o = {}) => P({ color: C("#c3c5c8"), metalness: 1, roughness: 0.55, roughnessMap: rep(grainR, 25), normalMap: rep(grainN, 60), normalScale: new THREE.Vector2(0.25, 0.25), ...o }),
    rubber: (o = {}) => P({ color: C(PALETTE.rubber), metalness: 0, roughness: 0.75, ...(low ? {} : { sheen: 0.3, sheenColor: C("#2a2a2a"), sheenRoughness: 0.6 }), ...o }),
    basalt: (o = {}) => P({ color: C(PALETTE.basalt), metalness: 0, roughness: 0.62, roughnessMap: rep(grainR, 1.5), normalMap: rep(grainN, 6), normalScale: new THREE.Vector2(0.35, 0.35), ...o }),
    fenderWhite: (o = {}) => P({ color: C(PALETTE.fenderWhite), metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03, ...o }),
    fenderCut: (o = {}) => new THREE.MeshBasicMaterial({ color: C(LAYOUT.fender.cutColor), ...o }),
    // linhas 3D (arco de cambagem, tubo da órbita): osso puro, sem tone mapping para não acinzentar
    bone: (o = {}) => new THREE.MeshBasicMaterial({ color: C(PALETTE.bone), toneMapped: false, ...o }),
    castGrey: (o = {}) => patchTint(P({ color: C(PALETTE.castGrey), metalness: 1, roughness: 0.5, roughnessMap: rep(grainR, 6, 2), ...o })),
    forged: (o = {}) => P({ color: C(PALETTE.forged), metalness: 1, roughness: 0.45, roughnessMap: rep(grainR, 14), ...o }),

    /* extras pedidos pelas peças (fora da lista mínima da spec) */
    chrome: (o = {}) => P({ color: C("#eef0f2"), metalness: 1, roughness: 0.06, ...o }),
    steel: (o = {}) => P({ color: C("#b6b9bd"), metalness: 1, roughness: 0.3, normalMap: rep(tex.threadNormal(0.0015), 1, 30), normalScale: new THREE.Vector2(0.8, 0.8), ...o }),
    padSteel: (o = {}) => P({ color: C("#8a8c8f"), metalness: 1, roughness: 0.5, roughnessMap: rep(grainR, 20), ...o }),
    padFriction: (o = {}) => P({ color: C(LAYOUT.caliper.pad.friction.color), metalness: 0, roughness: 0.9, normalMap: rep(grainN, 30), normalScale: new THREE.Vector2(0.6, 0.6), emissive: C("#000000"), ...o }),
    weld: (o = {}) => P({ color: C("#ffffff"), map: tex.heatTintMap(), metalness: 1, roughness: 0.5, normalMap: rep(grainN, 8, 2), normalScale: new THREE.Vector2(0.5, 0.5), ...o }),
    boneOrbit: (o = {}) => new THREE.MeshBasicMaterial({ color: C(PALETTE.bone), toneMapped: false, transparent: true, opacity: LAYOUT.orbit.opacity, depthWrite: false, ...o }),
  };

  const set = {};
  for (const name of Object.keys(make)) set[name] = make[name]();
  for (const [name, m] of Object.entries(set)) m.name = "v3." + name;

  const aoCache = new Map();
  /** versão com vertexColors (AO assado na geometria) do mesmo material; uniforms e injeções iguais. */
  set.ao = (name) => {
    if (!make[name]) throw new Error("material desconhecido: " + name);
    if (!aoCache.has(name)) { const m = make[name]({ vertexColors: true }); m.name = "v3." + name + ".ao"; aoCache.set(name, m); }
    return aoCache.get(name);
  };
  set.uniforms = { heat, swirl, tint };
  set.heatTex = heat.uHeat.value;
  set.setHeatTexture = (t) => { heat.uHeat.value = prepHeat(t) || blankHeat; set.heatTex = heat.uHeat.value; };
  set.setSwirl = (v) => { swirl.uSwirl.value = v; };
  set.setHubTint = (v) => { tint.uTint.value = v; };
  const padC = new THREE.Color();
  /** Chamado por frame com a temperatura máxima do disco. A pastilha brilha junto (ela está no setor quente). */
  set.setHeatUniforms = (maxT) => {
    heat.uMaxT.value = maxT;
    const { color, intensity } = heatRamp(maxT * 0.92, padC);
    set.padFriction.emissive.copy(color); set.padFriction.emissiveIntensity = intensity;
  };
  set.tier = tier;
  set.dispose = () => {
    for (const m of [...Object.values(set).filter((m) => m && m.isMaterial), ...aoCache.values()]) m.dispose();
    blankHeat.dispose();
  };
  return set;
}
