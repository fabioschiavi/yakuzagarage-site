// Calor do freio (SPEC-3D 4b). Grade polar no referencial do disco: coluna = ângulo, linha = raio.
// Núcleo numérico puro; Three.js só entra por parâmetro, para rodar nos testes em node.
//
// Mapa da textura (o shader do disco tem que bater com isto):
//   u = coluna / nA, coluna c cobre o ângulo local do disco [c, c+1) * 2pi/nA,
//       ângulo no mundo = ângulo local + spin.angle (mesma convenção de padSector.angle)
//   v = (r - R_IN) / (R_OUT - R_IN), anel de atrito 0.12..0.19 m
//   texel.r * 1100 = temperatura em °C (heatDecode no GLSL)

const TWO_PI = Math.PI * 2;

export const HEAT = {
  T_AMB: 25,          // °C, nunca abaixo disto
  T_SCALE: 1100,      // R8 guarda T / 1100
  R_IN: 0.12,         // m, anel de atrito (rotor 380: R 0.19 / r 0.12)
  R_OUT: 0.19,
  PAD_WIDTH: 64 * Math.PI / 180,
  PAD_R0: 2,          // linhas radiais da pastilha, inclusivo
  PAD_R1: 15,
  ALPHA: 0.12,        // difusão explícita, 2 passes por frame (estável abaixo de 0.25)
  H0: 0.08,           // 1/s, resfriamento parado
  H1: 0.0015,         // 1/s por rad/s: ventilação cresce com o giro
  DRILL_K: 1.15,      // furos resfriam mais
  DRILL_R: [0.135, 0.155, 0.175], // raios das 3 fileiras de furos
  // Calibrado no teste: parada do hero (62.8 rad/s, rampa 250 ms, 240 Hz, 60 fps) pica 820 °C
  // na borda de saída (média das linhas 2-15; a célula mais quente chega a ~894). O calor é
  // linear em Kq, então ajustar é uma regra de três. Unidade: °C por J por célula de pastilha.
  // Se h0 mudar, recalibrar (h0 0.065 pede Kq 11.88).
  Kq: 12.02,
  TINT_CAP: 20000,    // °C·s de maxT acima do ambiente para o tint do cubo saturar (~3 paradas)
  T_GLOW: 480,
};

// ---------- rampa de corpo negro, única para disco, pastilha e faíscas ----------
// Paradas em sRGB convertidas para linear e arredondadas em 5 casas: JS e GLSL usam os mesmos números.
function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function hexLin(h) {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => Number(srgbToLinear(v / 255).toFixed(5)));
}
const C1 = hexLin(0x3a0000), C2 = hexLin(0xb81d08), C3 = hexLin(0xff7a1a);
const g3 = (c) => 'vec3(' + c.map((v) => v.toFixed(5)).join(', ') + ')';

function smooth(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// rampColor(T, out): escreve em out[0..2] a cor linear da rampa e devolve a intensidade emissiva
// (smoothstep(480, 950, T) x 3). Emissivo final = out * retorno. Abaixo de 480 °C tudo zero.
export function rampColor(T, out) {
  let a, b, t;
  if (T < 550) { t = (T - 480) / 70; t = t < 0 ? 0 : t; out[0] = C1[0] * t; out[1] = C1[1] * t; out[2] = C1[2] * t; }
  else {
    if (T < 700) { a = C1; b = C2; t = (T - 550) / 150; }
    else if (T < 900) { a = C2; b = C3; t = (T - 700) / 200; }
    else { a = C3; b = C3; t = 0; }
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
  }
  return smooth(480, 950, T) * 3.0;
}

// Queda de rugosidade do ferro quente: 0.1 acima de 600 °C (transição curta para não serrilhar).
export function rampRoughDrop(T) { return 0.1 * smooth(590, 610, T); }

// Mesmo código em GLSL. Injetar no onBeforeCompile (disco, pastilha) e no shader das faíscas.
export const HEAT_RAMP_GLSL = /* glsl */`
float heatDecode(float r) { return r * ${HEAT.T_SCALE.toFixed(1)}; }
vec3 heatColor(float T) {
  vec3 c1 = ${g3(C1)};
  vec3 c2 = ${g3(C2)};
  vec3 c3 = ${g3(C3)};
  if (T < 550.0) return c1 * max((T - 480.0) / 70.0, 0.0);
  if (T < 700.0) return mix(c1, c2, (T - 550.0) / 150.0);
  if (T < 900.0) return mix(c2, c3, (T - 700.0) / 200.0);
  return c3;
}
float heatIntensity(float T) { return smoothstep(480.0, 950.0, T) * 3.0; }
vec3 heatEmissive(float T) { return heatColor(T) * heatIntensity(T); }
float heatRoughDrop(float T) { return 0.1 * smoothstep(590.0, 610.0, T); }
`;

// ---------- simulação ----------
// createHeat({nA, nR, THREE}) -> { texture, data, T, maxT, trailingT, tint,
//   step(dt, {omega, angle, brakePower, padSector}), cool(dt, omega), frame(dt?, omega?), reset() }
// Laço esperado: por subpasso spin.step -> heat.step(dt, {omega: spin.omega, angle: spin.angle,
// brakePower: spin.brakePower, padSector}); por frame UMA chamada heat.cool(dtSimulado, spin.omega)
// (difusão, resfriamento, upload). frame é o mesmo que cool; sem dt só difunde 2x e sobe.
// Kq e h0 aceitam override só para calibração/testes; o padrão é o da spec.
export function createHeat({ nA = 96, nR = 16, THREE = null, Kq = HEAT.Kq, h0 = HEAT.H0 } = {}) {
  const N = nA * nR;
  const T = new Float32Array(N).fill(HEAT.T_AMB);
  const tmp = new Float32Array(N);
  const data = new Uint8Array(N);

  // linhas da pastilha (2..15 na grade de 16; escala se nR mudar)
  const r0 = Math.min(nR - 1, Math.round(HEAT.PAD_R0 * nR / 16));
  const r1 = Math.min(nR - 1, Math.round((HEAT.PAD_R1 + 1) * nR / 16) - 1);
  const nPadR = r1 - r0 + 1;

  // multiplicador de h por linha: as fileiras furadas trocam mais calor
  const hMul = new Float32Array(nR).fill(1);
  for (let i = 0; i < HEAT.DRILL_R.length; i++) {
    const row = Math.floor((HEAT.DRILL_R[i] - HEAT.R_IN) / (HEAT.R_OUT - HEAT.R_IN) * nR);
    if (row >= 0 && row < nR) hMul[row] = HEAT.DRILL_K;
  }

  let texture = null;
  if (THREE) {
    texture = new THREE.DataTexture(data, nA, nR, THREE.RedFormat, THREE.UnsignedByteType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;      // ângulo dá a volta
    texture.wrapT = THREE.ClampToEdgeWrapping; // raio não
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
  }

  // estado da pastilha no referencial do disco (atualizado em step). Float64Array e não let:
  // double em variável de closure vira HeapNumber novo a cada escrita (lixo por subpasso).
  const pad = new Float64Array(3); // lo, hi, direção (+1/-1)
  pad[2] = 1;
  // passes de difusão "devidos": a spec fixa 2 por frame, lido como 2 por 1/60 s; senão a 30 fps
  // o calor espalha metade e a 120 Hz o dobro (pico e tempo de brilho mudariam com a tela).
  const diffAcc = new Float64Array(1);

  const h = {
    nA, nR, Kq, texture, data, T,
    maxT: HEAT.T_AMB,
    trailingT: HEAT.T_AMB,
    trailingCol: 0,       // coluna da borda de saída (para quem quiser a posição)
    tint: 0,              // 0..1 para hub.setHeatTint
    deposited: 0,         // J·Kq acumulados (só para o balanço de energia nos testes)
    padRows: [r0, r1],

    step(dt, inp) {
      const ps = inp.padSector;
      const width = ps && ps.width > 0 ? ps.width : HEAT.PAD_WIDTH;
      let rel = ((ps ? ps.angle : 0) - inp.angle) % TWO_PI;
      if (rel !== rel) rel = 0; // ângulo NaN/indefinido: sem isto trailingT vira NaN e contamina as faíscas
      if (rel < 0) rel += TWO_PI;
      const c = rel * nA / TWO_PI;
      const hw = width * nA / TWO_PI * 0.5;
      const padLo = c - hw, padHi = c + hw;
      pad[0] = padLo; pad[1] = padHi;
      pad[2] = inp.omega < 0 ? -1 : 1;

      const P = inp.brakePower;
      if (P > 0 && P < 1e12 && dt > 0 && dt < 1e3) { // Infinity aqui viraria NaN na grade inteira
        // cobertura fracionária por coluna: a mancha anda suave mesmo com o disco quase parado
        const dq = Kq * P * dt / (2 * hw * nPadR);
        for (let k = Math.floor(padLo); k < padHi; k++) {
          const ov = (k + 1 < padHi ? k + 1 : padHi) - (k > padLo ? k : padLo);
          if (ov <= 0) continue;
          let j = k % nA; if (j < 0) j += nA;
          const q = dq * ov;
          for (let r = r0; r <= r1; r++) T[r * nA + j] += q;
        }
        h.deposited += Kq * P * dt;
      }
      sampleTrailing();
    },

    // Gancho por frame do contrato (seção 7): a spec 4b põe difusão, resfriamento e upload "per
    // frame", e o contrato só expõe step e cool. Então cool faz o frame inteiro; frame é o mesmo.
    // Chamar UM dos dois por frame, com o dt simulado do frame.
    cool(dt, omega) { h.frame(dt, omega); },

    // Uma vez por frame renderizado: difusão (2 passes por 1/60 s), resfriamento, upload.
    // Sem dt: 2 passes e upload, sem resfriar (útil em teste).
    frame(dt, omega) {
      let n = 2;
      if (dt !== undefined) {
        n = 0;
        if (dt > 0 && dt < 1e3) {
          diffAcc[0] += dt * 120;
          n = Math.floor(diffAcc[0] + 1e-6);
          diffAcc[0] -= n;
          // engasgo longo: no máximo 8 passes, o resto se perde (o laço de 240 Hz também descarta)
          if (n > 8) { n = 8; diffAcc[0] = 0; }
        }
      }
      for (let k = 0; k < n; k++) {
        if (k & 1) diffuse(tmp, T); else diffuse(T, tmp);
      }
      if (n & 1) T.set(tmp); // número ímpar de passes: o resultado ficou em tmp
      if (dt > 0) coolOnly(dt, omega || 0);
      let m = HEAT.T_AMB;
      const s = 255 / HEAT.T_SCALE;
      for (let i = 0; i < N; i++) {
        const t = T[i];
        if (t > m) m = t;
        const v = t * s;
        data[i] = v >= 255 ? 255 : (v + 0.5) | 0;
      }
      h.maxT = m;
      sampleTrailing();
      if (texture) texture.needsUpdate = true;
    },

    reset() {
      T.fill(HEAT.T_AMB); data.fill(0);
      h.maxT = h.trailingT = HEAT.T_AMB; h.tint = 0; h.deposited = 0; diffAcc[0] = 0;
      if (texture) texture.needsUpdate = true;
    },
  };

  // dT = -h (T - 25) dt, resolvido exato (exp): estável para qualquer dt e nunca cruza 25
  function coolOnly(dt, omega) {
    const hb = h0 + HEAT.H1 * (omega < 0 ? -omega : omega);
    for (let r = 0; r < nR; r++) {
      const f = Math.exp(-hb * hMul[r] * dt);
      const row = r * nA;
      for (let a = 0; a < nA; a++) {
        const i = row + a;
        T[i] = HEAT.T_AMB + (T[i] - HEAT.T_AMB) * f;
      }
    }
    // tint do cubo: integral de maxT na sessão, com teto
    const ex = h.maxT - HEAT.T_AMB;
    if (ex > 0 && h.tint < 1) { h.tint += ex * dt / HEAT.TINT_CAP; if (h.tint > 1) h.tint = 1; }
  }

  // 4 vizinhos, embrulha no ângulo, espelha no raio (fluxo zero na borda): conserva o calor total
  function diffuse(src, dst) {
    const al = HEAT.ALPHA;
    for (let r = 0; r < nR; r++) {
      const row = r * nA;
      const up = (r < nR - 1 ? r + 1 : r) * nA;
      const dn = (r > 0 ? r - 1 : r) * nA;
      for (let a = 0; a < nA; a++) {
        const l = a === 0 ? nA - 1 : a - 1;
        const rr = a === nA - 1 ? 0 : a + 1;
        const t = src[row + a];
        dst[row + a] = t + al * (src[row + l] + src[row + rr] + src[up + a] + src[dn + a] - 4 * t);
      }
    }
  }

  // Borda de saída: por onde o ferro deixa a pastilha (padHi girando para frente).
  // Meia célula para dentro, para pegar a coluna que passou a pastilha inteira.
  // Média das linhas da pastilha, não o máximo: a linha externa (longe do sumidouro das linhas 0-1)
  // fica ~13% acima do resto e a difusão apaga esse pico em ~1 s; a média segue o volume do anel,
  // que é o que de fato esfria em ~7 s (e dá às faíscas um sinal sem serrilhado).
  function sampleTrailing() {
    const e = pad[2] > 0 ? pad[1] - 0.5 : pad[0] + 0.5;
    let j = Math.floor(e) % nA; if (j < 0) j += nA;
    let s = 0;
    for (let r = r0; r <= r1; r++) s += T[r * nA + j];
    h.trailingCol = j;
    h.trailingT = s / nPadR;
  }

  return h;
}
