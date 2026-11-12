// Faíscas do freio (SPEC-3D 4c). Núcleo numérico puro; Three.js só entra por parâmetro
// para o mesmo arquivo rodar nos testes em node sem import map.

const G = 9.8;            // gravidade
const DRAG = 1.8;         // arrasto linear, 1/s
const REST = 0.35;        // restituição do único quique na laje
const LIFE_MIN = 0.35, LIFE_MAX = 0.9;
const V_MIN = 4, V_MAX = 9;           // m/s ao longo da tangente
const SPREAD = 25 * Math.PI / 180;    // cone de +/-25 graus
const RATE_K = 400;                   // faíscas/s com brake 1 a 62.8 rad/s
const OMEGA_REF = 62.8;
const T_MIN = 650, OMEGA_MIN = 3;     // abaixo disso o disco não arranca faísca
const LEN_K = 0.012;                  // comprimento do traço = |v| x 0.012 m
const HALF_W = 0.0006;                // largura 1.2 mm
const JITTER = 0.004;                 // espalha a origem no bordo da pastilha (m)
const DT_MAX = 0.05;                  // engasgo de frame não teleporta faísca

// Rampa de corpo negro igual à do disco (4b), em linear para o shader.
// Inline de propósito: heat.js é escrito em paralelo e não pode ser dependência.
function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function hexLin(h) {
  const r = srgbToLinear(((h >> 16) & 255) / 255), g = srgbToLinear(((h >> 8) & 255) / 255), b = srgbToLinear((h & 255) / 255);
  return 'vec3(' + r.toFixed(5) + ',' + g.toFixed(5) + ',' + b.toFixed(5) + ')';
}

// Temperatura da faísca pela idade: nasce acima do disco e cai abaixo de 480 no fim da vida,
// então a rampa a apaga sozinha antes de morrer (sem estalo de sumiço).
const SPARK_T0 = 1050, SPARK_DROP = 620;

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec2 iAgeLife;
uniform float uLenK;
uniform float uHalfW;
uniform float uMinLen;
uniform float uMinPx;
uniform float uPxAngle;
varying vec2 vUv;
varying float vT;
void main() {
  vUv = position.xy;
  // morta: joga fora do clip, sem branch na CPU
  if (iAgeLife.x >= iAgeLife.y) { vT = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // clamp: pow de base negativa é indefinido no GLSL
  float a = clamp(iAgeLife.x / iAgeLife.y, 0.0, 1.0);
  vT = ${SPARK_T0.toFixed(1)} - ${SPARK_DROP.toFixed(1)} * pow(a, 0.8);
  vec3 head = (modelViewMatrix * vec4(iPos, 1.0)).xyz;
  vec3 vv = mat3(modelViewMatrix) * iVel;
  float sp = length(vv);
  vec3 dir = sp > 1e-5 ? vv / sp : vec3(0.0, 1.0, 0.0);
  // esticado pela velocidade: cauda atrás da cabeça
  vec3 tail = head - dir * max(sp * uLenK, uMinLen);
  // lado perpendicular ao traço e ao raio de visão: o quad sempre encara a câmera
  vec3 side = cross(head - tail, head);
  float sl = length(side);
  side = sl > 1e-9 ? side / sl : vec3(1.0, 0.0, 0.0);
  // largura mínima em pixels opcional (uPxAngle = 0 desliga) contra sumiço sub-pixel
  float hw = max(uHalfW, 0.5 * uMinPx * uPxAngle * max(-head.z, 0.0));
  vec3 p = mix(tail, head, position.x) + side * (position.y * hw);
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */`
varying vec2 vUv;
varying float vT;
vec3 ramp(float T) {
  vec3 c0 = vec3(0.0);
  vec3 c1 = ${hexLin(0x3a0000)};
  vec3 c2 = ${hexLin(0xb81d08)};
  vec3 c3 = ${hexLin(0xff7a1a)};
  if (T < 550.0) return mix(c0, c1, clamp((T - 480.0) / 70.0, 0.0, 1.0));
  if (T < 700.0) return mix(c1, c2, (T - 550.0) / 150.0);
  if (T < 900.0) return mix(c2, c3, (T - 700.0) / 200.0);
  return c3;
}
void main() {
  float I = smoothstep(480.0, 950.0, vT) * 3.0;
  float across = 1.0 - vUv.y * vUv.y;      // borda macia sem textura
  float along = mix(0.2, 1.0, vUv.x);      // cabeça mais quente que a cauda
  gl_FragColor = vec4(ramp(vT) * (I * across * along), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSparks({ max = 192, THREE = null, seed = 0x9e3779b9 } = {}) {
  max = Math.max(1, max | 0);

  // Armazenamento único: os mesmos arrays são os atributos de instância (zero cópia no upload).
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const ageLife = new Float32Array(max * 2);   // (idade, vida); idade >= vida = morta
  const bounces = new Uint8Array(max);
  const alive = new Uint8Array(max);
  // relógio de emissão desde o último update: a recém-nascida já está no estado do fim da
  // sua chamada de emit, então o update só a avança pelo resto da janela (sem faixas a 60/30 fps)
  const skip = new Float32Array(max);
  for (let i = 0; i < max; i++) { ageLife[i * 2] = 1; ageLife[i * 2 + 1] = 0; }

  let cap = max;      // teto atual (governor pode baixar sem realocar)
  let head = 0;       // próximo slot do anel; sobrescreve a mais velha quando cheio
  let hw = 0;         // marca d'água: só desenha slots já usados
  // escalares mutáveis em typed arrays: double capturado em closure vira HeapNumber novo a cada escrita
  const sc = new Float64Array(2);   // [0] fração de faísca acumulada, [1] tempo emitido desde o último update
  const rs = new Uint32Array(1);    // estado do LCG (passa de 2^31, não cabe em Smi)
  rs[0] = seed >>> 0;

  // LCG Numerical Recipes: determinístico para os testes, sem alocar.
  function rand() {
    rs[0] = Math.imul(rs[0], 1664525) + 1013904223;
    return rs[0] / 4294967296;
  }

  let mesh = null, aPos = null, aVel = null, aAge = null;
  if (THREE) {
    const geo = new THREE.BufferGeometry();
    // quad: x 0 (cauda) .. 1 (cabeça), y -1..1 através do traço
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    aPos = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    aVel = new THREE.InstancedBufferAttribute(vel, 3).setUsage(THREE.DynamicDrawUsage);
    aAge = new THREE.InstancedBufferAttribute(ageLife, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', aPos);
    geo.setAttribute('iVel', aVel);
    geo.setAttribute('iAgeLife', aAge);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uLenK: { value: LEN_K },
        uHalfW: { value: HALF_W },
        uMinLen: { value: 0.003 },
        uMinPx: { value: 1.0 },
        uPxAngle: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.count = 0;
    mesh.frustumCulled = false;   // posições vivem no shader; bounding da geometria não vale
    mesh.renderOrder = 10;        // aditivo depois dos opacos
    mesh.name = 'sparks';
  }

  const api = {
    mesh,
    count: 0,
    cap,
    // expostos para testes e depuração; não realocar
    arrays: { pos, vel, ageLife, bounces, alive },
    emit,
    update,
    setCap,
  };

  function kill(i) {
    if (alive[i]) { alive[i] = 0; api.count--; }
    ageLife[i * 2] = 1; ageLife[i * 2 + 1] = 0;
  }

  // Integra a taxa 400 x brake x omega/62.8 com acumulador fracionário:
  // funciona igual chamado a 240 Hz no passo fixo ou uma vez por frame.
  function emit(dt, p) {
    // dt 0 não zera o acumulador: só não passa tempo
    if (!(dt > 0)) return 0;
    if (dt > DT_MAX) dt = DT_MAX;   // mesma dilatação do update num engasgo
    sc[1] += dt;
    const T = p.T, omega = p.omega;
    let brake = p.brake;
    if (!(T > T_MIN) || !(omega > OMEGA_MIN) || !(brake > 0)) { sc[0] = 0; return 0; }
    if (brake > 1) brake = 1;
    // taxa escala com o teto: 400/s x vida média 0.625 s = 250 vivas já passa de 192; com o anel
    // em 96 e taxa cheia, 92 de 232 faíscas da parada do herói eram sobrescritas ainda acesas
    // (até 69% do brilho de nascimento: estalo visível). Em 192 o comportamento é o da spec.
    let add = RATE_K * (cap / max) * brake * (omega / OMEGA_REF) * dt;
    if (!(add < cap)) add = cap;     // omega infinito viraria NaN no acumulador para sempre
    const acc = sc[0] + add;
    // |0 e não Math.floor: int32 volta como Smi; double retornado vira HeapNumber (acc < cap + 1)
    let n = acc | 0;
    sc[0] = acc - n;
    if (n <= 0) return 0;
    if (n > cap) n = cap;   // mais que o anel só sobrescreveria o próprio lote

    const e = p.padEdgeWorld, t = p.tangent;
    let tx = +t.x, ty = +t.y, tz = +t.z;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    // tangente nula ou NaN geraria base NaN; cai para -Y (rumo à laje)
    if (tl > 1e-9) { tx /= tl; ty /= tl; tz /= tl; } else { tx = 0; ty = -1; tz = 0; }
    // base ortonormal (u, w) em volta da tangente para o cone, só escalares
    let ux, uy, uz;
    if (Math.abs(ty) < 0.9) { ux = -tz; uy = 0; uz = tx; }      // t x up
    else { ux = 0; uy = tz; uz = -ty; }                          // t x X
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= ul; uy /= ul; uz /= ul;
    const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;

    for (let k = 0; k < n; k++) {
      const i = head;
      head++; if (head >= cap) head = 0;
      if (i >= hw) hw = i + 1;
      if (!alive[i]) { alive[i] = 1; api.count++; }

      // direção dentro do cone: sqrt dá densidade uniforme na área do cone
      const d = SPREAD * Math.sqrt(rand());
      const phi = 6.283185307179586 * rand();
      const sd = Math.sin(d), cd = Math.cos(d), cp = Math.cos(phi), spp = Math.sin(phi);
      const s = V_MIN + (V_MAX - V_MIN) * rand();
      const vx = s * (tx * cd + (ux * cp + wx * spp) * sd);
      const vy = s * (ty * cd + (uy * cp + wy * spp) * sd);
      const vz = s * (tz * cd + (uz * cp + wz * spp) * sd);
      const life = LIFE_MIN + (LIFE_MAX - LIFE_MIN) * rand();
      // nascimento espalhado dentro do dt: sem lote em degrau a 60 Hz
      const age0 = dt * rand();

      const j = i * 3;
      vel[j] = vx; vel[j + 1] = vy; vel[j + 2] = vz;
      pos[j] = e.x + (rand() - 0.5) * JITTER + vx * age0;
      pos[j + 1] = e.y + (rand() - 0.5) * JITTER + vy * age0;
      pos[j + 2] = e.z + (rand() - 0.5) * JITTER + vz * age0;
      ageLife[i * 2] = age0;
      ageLife[i * 2 + 1] = life;
      bounces[i] = 0;
      skip[i] = sc[1];
    }
    if (mesh) mesh.count = hw < cap ? hw : cap;
    return n;
  }

  const GK = G / DRAG;   // velocidade terminal de queda

  // Único quique, fora do laço: raro, e recebe só o índice; os doubles vão por bx
  // (double como argumento de função não inlinada aloca HeapNumber a cada chamada).
  const bx = new Float64Array(4);   // y0, vy0, h, fy do passo
  function bounce(i) {
    const y0 = bx[0], vy0 = bx[1], h = bx[2], fy = bx[3];
    // instante do toque por Newton na curva exata, reflexão ali com 0.35:
    // a altura do pulo não depende do tamanho do passo
    let s = 0;
    const f0 = y0 - fy;
    if (f0 > 0) {
      const eh = Math.exp(-DRAG * h);
      const yh = y0 + (vy0 + GK) * (1 - eh) / DRAG - GK * h;
      s = h * f0 / (f0 - (yh - fy));
      for (let it = 0; it < 4; it++) {
        const es = Math.exp(-DRAG * s);
        const df = (vy0 + GK) * es - GK;
        if (!(df < 0)) break;
        s -= (y0 + (vy0 + GK) * (1 - es) / DRAG - GK * s - fy) / df;
        if (s < 0) s = 0; else if (s > h) s = h;
      }
    }
    const vyUp = -((vy0 + GK) * Math.exp(-DRAG * s) - GK) * REST;
    const r = h - s, er = Math.exp(-DRAG * r);
    let py = fy + (vyUp + GK) * (1 - er) / DRAG - GK * r;
    let vy = (vyUp + GK) * er - GK;
    if (py < fy) { py = fy; if (vy < 0) vy = 0; }
    bounces[i] = 1;
    pos[i * 3 + 1] = py; vel[i * 3 + 1] = vy;
  }

  // Solução fechada de arrasto linear + gravidade: exata em qualquer h, então 30, 60 e 240 Hz
  // dão a mesma trajetória (Euler semi-implícito errava ~1 cm a 240 Hz e ~9 cm a 30 fps).
  // Caminho comum inline no laço: passar double a função não inlinada aloca HeapNumber (~9 KB/frame medido).
  function update(dt, floorY) {
    if (!(dt > 0)) return;
    if (dt > DT_MAX) dt = DT_MAX;
    const e = Math.exp(-DRAG * dt);
    // 1 µm acima: o Float32 arredonda -0.05 para baixo e furaria o piso
    const fy = floorY + 1e-6;
    const n = hw < cap ? hw : cap;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const a2 = i * 2;
      // recém-nascida: avança só o que sobra da janela depois do seu nascimento
      let h = dt, ei = e;
      if (skip[i] > 0) {
        h = dt - skip[i];
        skip[i] = 0;
        if (h <= 0) continue;
        ei = Math.exp(-DRAG * h);
      }
      const age = ageLife[a2] + h;
      if (age >= ageLife[a2 + 1]) { kill(i); continue; }
      ageLife[a2] = age;

      const j = i * 3;
      const c1 = (1 - ei) / DRAG;
      const y0 = pos[j + 1], vy0 = vel[j + 1];
      pos[j] += vel[j] * c1; vel[j] *= ei;
      pos[j + 2] += vel[j + 2] * c1; vel[j + 2] *= ei;
      let py = y0 + (vy0 + GK) * c1 - GK * h;
      let vy = (vy0 + GK) * ei - GK;
      if (py < fy) {
        if (bounces[i] === 0 && vy < 0) {
          bx[0] = y0; bx[1] = vy0; bx[2] = h; bx[3] = fy;
          bounce(i);
          continue;
        }
        // segundo contato (ou nasceu abaixo e sobe): desliza na laje, nunca atravessa
        py = fy;
        if (vy < 0) vy = 0;
      }
      pos[j + 1] = py; vel[j + 1] = vy;
    }
    sc[1] = 0;
    if (mesh) {
      mesh.count = n;
      aPos.needsUpdate = true;
      aVel.needsUpdate = true;
      aAge.needsUpdate = true;
    }
  }

  // Governor baixa o teto (192 -> 96) sem shader novo nem realocação.
  function setCap(c) {
    c = c | 0;
    if (c < 1) c = 1;
    if (c > max) c = max;
    if (c < cap) {
      for (let i = c; i < cap; i++) kill(i);
      if (hw > c) hw = c;
    }
    cap = c;
    api.cap = c;
    if (head >= cap) head = 0;
    if (mesh) { mesh.count = hw < cap ? hw : cap; aAge.needsUpdate = true; }
  }

  return api;
}
