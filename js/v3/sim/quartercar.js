// Quarter-car de duas massas (SPEC-3D 4d). Núcleo numérico puro: sem import de
// "three", sem DOM, sem lixo por passo (estado mutado no lugar).
//
// Convenções: metros, newtons, segundos, y para cima. y = 0 é a altura do cubo
// em repouso. ys e yu são deslocamentos das massas suspensa e não suspensa
// a partir dessa referência; L = L_rest + (ys - yu).
//
// Consistência estática (conferida): com g = 9.81,
//   mola: k (L_free - L_rest) = 78000 x 0.0566 = 4414.8 N  vs  ms g = 4414.5 N
//   pneu: kt x 0.0187 = 4862 N                           vs  (ms+mu) g = 4856 N
// Os números do spec fecham com g = 9.81 dentro do arredondamento deles; o
// equilíbrio exato fica 0.023 mm acima de y 0 (pen 18.68 mm, L 146.404 mm).
// Nada foi alterado; settle() resolve o equilíbrio exato em vez de assumir 0.

const DEFAULTS = {
  ms: 450,            // kg, suspensa
  mu: 45,             // kg, não suspensa
  k: 78000,           // N/m (78 N/mm)
  L_free: 0.203,      // m
  L_rest: 0.1464,     // m
  c: 3790,            // N s/m (zeta 0.32 sobre k e ms)
  bumpRatio: 0.7,     // compressão
  reboundRatio: 1.3,  // extensão
  bsK: 2e9,           // N/m^3, batente cúbico
  bsL: 0.112,         // m, batente começa aqui
  L_bind: 0.099,      // m, espira encostada (9 x fio de 11 mm)
  kt: 260000,         // N/m, pneu
  ct: 400,            // N s/m, pneu, só em contato
  r0: 0.3305,         // m, raio livre do pneu
  y_f: -0.3118,       // m, topo da laje
  g: 9.81,            // fecha L_rest = 146.4 mm com ms e k (ver acima)
  airGamma: 1.3,      // expoente politrópico da bolsa
  zetaOverride: 0,    // > 0: amortecimento simétrico com esse zeta (movimento reduzido)
  // Até o primeiro toque do pneu após drop(), a quina cai como peça única: o
  // top-out do amortecedor segura a pré-carga no L de equilíbrio. Sem isso a mola
  // pré-carregada não tem nada que a segure, a roda despenca 50 mm a 11 g ao
  // soltar e pousa em 0.19 s em vez da queda livre do vão (0.217 s) que o
  // storyboard do B1 cronometra. false = equações literais desde o soltar.
  rigidFall: true,
};

export function createQuarterCar(params) {
  const P = {};
  for (const key in DEFAULTS) P[key] = DEFAULTS[key];
  if (params) for (const key in params) if (params[key] !== undefined) P[key] = params[key];

  // Força estática da mola no repouso: a bolsa de ar parte dela para não dar
  // salto ao trocar coil/air.
  const F_static = P.k * (P.L_free - P.L_rest);

  // Coeficientes do amortecedor; zetaOverride usa c simétrico porque a
  // assimetria bump/rebound quebraria o "criticamente amortecido".
  let cBump = 0, cReb = 0;
  function setZeta(z) {
    P.zetaOverride = z || 0;
    if (P.zetaOverride > 0) {
      const cz = P.zetaOverride * 2 * Math.sqrt(P.k * P.ms);
      cBump = cz; cReb = cz;
    } else {
      cBump = P.c * P.bumpRatio; cReb = P.c * P.reboundRatio;
    }
  }
  setZeta(P.zetaOverride);

  // Estado único, mutado no lugar. Saídas derivadas ficam aqui também para a
  // montagem ler sem recalcular.
  const state = {
    ys: 0, yu: 0, vs: 0, vu: 0,
    L: P.L_rest, dL: 0,
    pen: 0, Fs: 0, Fd: 0, Fb: 0, Ft: 0,
    contact: false,
    t: 0,          // tempo simulado desde o último drop/settle
    landedAt: -1,  // tempo do primeiro contato após drop(); -1 = ainda no ar
    airborne: false, // true se o pneu saiu da laje depois de pousar
    liftoffs: 0,   // quantas vezes o pneu deixou a laje desde o drop
    minL: P.L_rest,
  };

  // Mola (coil, ar ou mistura) em função de L. a = 0 coil .. 1 ar.
  function springForce(L, a, p) {
    let F = 0;
    if (a < 1) F += (1 - a) * P.k * (P.L_free - L);
    if (a > 0) F += a * F_static * p * Math.pow(P.L_rest / L, P.airGamma);
    return F;
  }
  function bumpForce(L) {
    const x = P.bsL - L;
    return x > 0 ? P.bsK * x * x * x : 0;
  }

  // Entradas lidas uma vez por chamada para estas variáveis (sem objeto novo).
  // Limites: cargas do spec são só para baixo (hold 4.5 kN, dive 1.8 kN x
  // brake); 2x o máximo cobre brake > 1 sem deixar o pneu afundar além do raio
  // e catapultar a quina. NaN/Infinity viram 0 ou o teto: nunca envenenam o estado.
  const F_LOAD_MAX = 9000, F_DIVE_MAX = 3600, AIRP_MAX = 2;
  // Float64Array e não "let" capturado: variável de closure com double aloca
  // um HeapNumber a cada escrita (medido: 13 B/passo); o array grava sem caixa.
  // IN[4] = dt do subpasso: passar double como argumento a uma função não
  // inlinada também encaixota.
  const IN = new Float64Array(5); // F_load, F_dive, a (0 coil..1 ar), airP, h
  IN[3] = 1;
  function readInputs(inp) {
    let fl = inp ? +inp.F_load : 0, fd = inp ? +inp.F_dive : 0;
    if (!(fl > 0)) fl = 0; else if (fl > F_LOAD_MAX) fl = F_LOAD_MAX;
    if (!(fd > 0)) fd = 0; else if (fd > F_DIVE_MAX) fd = F_DIVE_MAX;
    // airMode: bool, 0..1 (tween do toggle) ou 'air'; NaN/negativo = coil.
    const m = inp ? inp.airMode : 0;
    let a = m === 'air' ? 1 : +m;
    if (!(a > 0)) a = 0; else if (a > 1) a = 1;
    let p = inp ? +inp.airP : 1;
    if (!(p > 0)) p = 1; else if (p > AIRP_MAX) p = AIRP_MAX;
    IN[0] = fl; IN[1] = fd; IN[2] = a; IN[3] = p;
  }

  // Passo máximo integrado de uma vez. A página chama com 1/240; um dt maior
  // (quadro cru, aba que volta) é fatiado, e acima de 50 ms o excesso é
  // descartado: um passo de 1 s na queda enterrava o cubo 9 m na laje e o pneu
  // lançava a quina a 1.5 km.
  const H_MAX = 1 / 200, H_SUB = 1 / 240, DT_CAP = 0.05;

  function step(dt, inp) {
    if (!(dt > 0)) return;
    if (dt > DT_CAP) dt = DT_CAP;
    readInputs(inp);
    if (dt <= H_MAX) { IN[4] = dt; substep(); return; }
    const n = Math.ceil(dt / H_SUB);
    IN[4] = dt / n;
    for (let i = 0; i < n; i++) substep();
  }

  function substep() {
    const F_load = IN[0], F_dive = IN[1], a = IN[2], p = IN[3], dt = IN[4];
    const s = state;

    // Queda rígida (ver rigidFall): as duas massas juntas, L congelado no valor do drop().
    if (P.rigidFall && s.landedAt < 0 && P.r0 - (s.yu - P.y_f) <= 0) {
      const ag = -P.g - (F_load + F_dive) / (P.ms + P.mu);
      s.vs += ag * dt; s.vu = s.vs;
      s.ys += s.vs * dt; s.yu += s.vu * dt; // mesmo deslocamento: L não muda
      s.t += dt;
      finish(springForce(P.L_rest + s.ys - s.yu, a, p), 0, 0, 0);
      return;
    }

    const L = P.L_rest + s.ys - s.yu;
    const dL = s.vs - s.vu;
    const Fs = springForce(L, a, p);
    const Fb = bumpForce(L);
    const Fd = -(dL < 0 ? cBump : cReb) * dL;

    // Pneu só empurra (nunca puxa): sem contato, força zero, então ele sai da laje.
    const pen = P.r0 - (s.yu - P.y_f);
    let Ft = 0;
    if (pen > 0) {
      Ft = P.kt * pen - P.ct * s.vu; // dpen/dt = -vu
      if (Ft < 0) Ft = 0;
    }

    const Fsus = Fs + Fd + Fb;
    const as = (Fsus - P.ms * P.g - F_load - F_dive) / P.ms;
    const au = (-Fsus + Ft - P.mu * P.g) / P.mu;

    // Euler semi-implícito: velocidade antes, posição com a velocidade nova.
    s.vs += as * dt; s.vu += au * dt;
    s.ys += s.vs * dt; s.yu += s.vu * dt;

    // Espira encostada: corrige posição e velocidade relativa conservando o
    // momento (choque inelástico entre as massas).
    const Ln = P.L_rest + s.ys - s.yu;
    if (Ln < P.L_bind) {
      const d = P.L_bind - Ln, M = P.ms + P.mu;
      s.ys += d * P.mu / M; s.yu -= d * P.ms / M;
      if (s.vs - s.vu < 0) { const vcm = (P.ms * s.vs + P.mu * s.vu) / M; s.vs = vcm; s.vu = vcm; }
    }

    s.t += dt;
    finish(Fs, Fd, Fb, Ft);
  }

  // Atualiza saídas derivadas e eventos de contato.
  function finish(Fs, Fd, Fb, Ft) {
    const s = state;
    s.L = P.L_rest + s.ys - s.yu;
    s.dL = s.vs - s.vu;
    s.pen = P.r0 - (s.yu - P.y_f);
    s.Fs = Fs; s.Fd = Fd; s.Fb = Fb; s.Ft = Ft;
    const c = s.pen > 0;
    if (c && s.landedAt < 0) s.landedAt = s.t;
    if (!c && s.contact && s.landedAt >= 0) { s.liftoffs++; }
    s.airborne = !c && s.landedAt >= 0;
    s.contact = c;
    if (s.L < s.minL) s.minL = s.L;
  }

  // L de equilíbrio estático para as entradas lidas por último.
  // Fs(L) + Fb(L) decresce com L; bisseção fixa entre L_bind e um teto folgado.
  function equilibriumL() {
    const need = P.ms * P.g + IN[0] + IN[1];
    let lo = P.L_bind, hi = P.L_free * 4;
    for (let i = 0; i < 80; i++) {
      const mid = 0.5 * (lo + hi);
      if (springForce(mid, IN[2], IN[3]) + bumpForce(mid) > need) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // Solta as duas massas de +h com velocidade zero (spec 4d, "the drop").
  // A mola parte do equilíbrio das cargas atuais, não de L_rest: com o freio
  // segurado (dive) ou o ar a 1.2, resetar para L_rest pulava L 23 mm no mesmo
  // quadro; copiar o L do momento congelaria a mola em coil bind se o
  // double-tap cair no meio do impacto. h inválido = 0.25 do spec; limitado a
  // 0..1 m (negativo enterra o pneu e catapulta a quina).
  function drop(h) {
    h = +h;
    if (!(h === h) || h === Infinity || h === -Infinity) h = 0.25;
    else if (h < 0) h = 0; else if (h > 1) h = 1;
    const L = equilibriumL();
    const s = state;
    s.yu = h; s.ys = h + L - P.L_rest; s.vs = 0; s.vu = 0;
    s.t = 0; s.landedAt = -1; s.liftoffs = 0; s.airborne = false; s.contact = false;
    s.minL = L;
    finish(springForce(L, IN[2], IN[3]), 0, bumpForce(L), 0);
  }

  // Salta direto para o equilíbrio estático com as cargas dadas (movimento
  // reduzido e o lab). Bisseção fixa: sem alocação, sempre converge.
  function settle(inp) {
    readInputs(inp);
    const F_load = IN[0], F_dive = IN[1], a = IN[2], p = IN[3];

    const W = (P.ms + P.mu) * P.g + F_load + F_dive;
    const pen = W > 0 ? W / P.kt : 0;
    const yu = P.y_f + P.r0 - pen;
    const L = equilibriumL();

    const s = state;
    s.yu = yu; s.ys = yu + L - P.L_rest; s.vs = 0; s.vu = 0;
    s.t = 0; s.landedAt = 0; s.liftoffs = 0; s.airborne = false; s.contact = pen > 0;
    s.minL = L;
    finish(springForce(L, a, p), 0, bumpForce(L), P.kt * pen);
  }

  settle(null);

  return {
    state,
    params: P,
    F_static,
    step,
    drop,
    settle,
    setZeta,
    L() { return state.L; },
    pen() { return state.pen; },
    // Folga pneu-laje (>= 0), para a sombra.
    gap() { return state.pen < 0 ? -state.pen : 0; },
  };
}
