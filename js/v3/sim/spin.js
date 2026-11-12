// Giro do disco/roda (SPEC-3D 4a). Núcleo numérico puro, sem Three.js:
// roda igual no browser e nos testes em node.

export const SPIN = {
  I: 60,          // kg m^2, valor artístico (fatia do canto na energia do carro, ~118 kJ a 62.8 rad/s)
  MU: 0.45,       // atrito pastilha/disco
  R_EFF: 0.165,   // m, raio efetivo da pastilha
  F_MAX: 36000,   // N de aperto com brake = 1
  K_MOTOR: 40,    // N m por rad/s de erro
  K_SCRUB: 0.9,   // N m por px/s de dedo
  SCRUB_TAU: 0.6, // s, inércia do arrasto depois que o dedo para
};

const TWO_PI = Math.PI * 2;

// createSpin({I}) -> { omega, angle, step(dt, {brake, motorTarget, scrub}) }
// Campos extras lidos por quem consome: brakeTorque (N m), brakePower (W, o que vira calor),
// scrubTorque (N m, estado com decaimento), energy (J cinéticos).
export function createSpin({ I = SPIN.I, omega = 0, angle = 0 } = {}) {
  const invI = 1 / I;
  const tbMax = SPIN.MU * SPIN.R_EFF * SPIN.F_MAX; // 2673 N m

  const s = {
    I,
    omega,
    angle,
    brakeTorque: 0,
    brakePower: 0,
    scrubTorque: 0,
    energy: 0.5 * I * omega * omega,

    // in.brake 0..1; in.motorTarget rad/s (NaN ou null = motor desacoplado);
    // in.scrub = velocidade horizontal do dedo em px/s neste passo (0 quando parado).
    // O caller reaproveita o mesmo objeto de entrada: zero lixo por passo.
    step(dt, inp) {
      if (!(dt > 0 && dt < 1e3)) return; // dt 0, negativo, NaN ou Infinity: nada a integrar
      let b = inp.brake || 0;
      b = b < 0 ? 0 : b > 1 ? 1 : b;
      const w0 = s.omega;

      // motor: 40 (alvo - omega). Escalado por (1 - brake): a embreagem patina quando o pé entra,
      // senão o motor freia junto e a parada do hero cairia de ~1.4 s para ~1.05 s.
      const mt = inp.motorTarget;
      const tm = (mt == null || mt !== mt) ? 0 : SPIN.K_MOTOR * (1 - b) * (mt - w0);

      // arrasto: o dedo manda direto; solto, decai com tau 0.6 s (inércia)
      const sc = inp.scrub || 0;
      if (sc !== 0) s.scrubTorque = SPIN.K_SCRUB * sc;
      else s.scrubTorque *= Math.exp(-dt / SPIN.SCRUB_TAU);
      if (s.scrubTorque > -1e-6 && s.scrubTorque < 1e-6) s.scrubTorque = 0;

      // Euler semi-implícito: velocidade primeiro com as forças motrizes
      const w1 = w0 + (tm + s.scrubTorque) * invI * dt;

      // freio como atrito de Coulomb: só tira velocidade, nunca inverte o giro (fica preso em 0)
      const tb = tbMax * b;
      const dwb = tb * invI * dt;
      let w2;
      if (w1 > dwb) w2 = w1 - dwb;
      else if (w1 < -dwb) w2 = w1 + dwb;
      else w2 = 0;

      s.brakeTorque = tb;
      // potência exatamente igual à energia cinética removida pelo freio: fecha o balanço com o calor
      s.brakePower = 0.5 * I * (w1 * w1 - w2 * w2) / dt;
      s.omega = w2;
      s.energy = 0.5 * I * w2 * w2;

      // posição com a velocidade nova; embrulha em [0, 2pi) para não perder precisão em float
      let a = s.angle + w2 * dt;
      if (a >= TWO_PI || a < 0) a -= Math.floor(a / TWO_PI) * TWO_PI;
      s.angle = a;
    },
  };
  return s;
}
