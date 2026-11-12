/* v3 "KAIBO": fonte única dos números. Sem funções, só dados.
   Mundo em metros, escala real. Centro do cubo = origem, eixo da roda em +X (para fora, lado da câmera), +Y para cima.
   Ângulo no plano YZ (calor, pinça, rotação da roda): theta = atan2(y, -z). 0 = horizontal traseira, 90° = topo.
   Girar o grupo da roda por +a em torno de +X soma +a a theta (rotation.x = a), por isso o calor usa esse mesmo ângulo. */

const D = Math.PI / 180;

/* ---------------- seção 2: geometria e posições ---------------- */
export const LAYOUT = {
  units: "m",
  axle: [1, 0, 0],
  up: [0, 1, 0],

  // tabela de estações em X
  x: {
    hubFace: 0,
    spacer: [0, 0.015],
    wheelFace: 0,              // sem espaçador; +0.015 com ele
    wheelFaceSpaced: 0.015,
    rim: [-0.155, 0.085],      // ET35, antes do espaçador
    tyre: [-0.163, 0.092],
    rotorMid: -0.065,
    fenderOuter: 0.107,
  },

  slab: {
    topY: -0.3118,             // r0 menos 18.7 mm de deflexão estática
    size: [1.0, 0.14, 1.6],    // X, Y, Z
    center: [-0.0355, -0.3818, 0], // centrado sob o pneu em X (meio de -0.163..0.092); Y = topo - 0.07
    radius: 0.008,
    segments: 3,
    color: "#0e0e0e",
    roughness: 0.62,
    fbmSize: 512,
    shadow: { lift: 0.002, opacity: [0.85, 0.2], scale: [1.0, 1.6], gapForMin: 0.25 },
  },

  tyre: {
    size: "255/35R19",
    od: 0.661,
    r0: 0.3305,
    section: 0.255,
    sidewall: 0.089,
    beadR: 0.2413,
    staticDeflection: 0.0187,
    profilePoints: 34,         // meia seção, espelhada
    sidewallBulge: 0.005,
    shoulderRadius: 0.018,
    shoulderArcPoints: 3,
    grooves: { count: 4, width: 0.008, depth: 0.007 },
    segments: { radial: 128, profile: 48, radialLow: 64 },
    tread: { size: [1024, 256], repeatAround: 32 },
    sidewallMap: {
      size: [4096, 256],
      address: "103-15 100TH ST · OZONE PARK NY 11417 · 347-813-2779",
      capHeight: 0.028,
      raised: 0.0008,
      font: "Anton",
      normalStrength: [0.6, 1.2],
    },
    material: { color: "#0b0b0b", roughness: 0.84, sheen: 0.35, sheenColor: "#2a2a2a", sheenRoughness: 0.6, envMapIntensity: 0.5 },
  },

  wheel: {
    diameterIn: 19,
    widthIn: 9.5,
    et: 0.035,
    barrel: { profilePoints: 18, segments: 96, lipStep: 0.022 },
    face: {
      r: 0.215,
      windows: { count: 5, r0: 0.075, r1: 0.205, spokeWidth: 0.038, fillet: 0.006 },
      bore: 0.0726,            // diâmetro
      lugHoleR: 0.007,
      pcd: 0.120,
      depth: 0.028,
      bevel: { size: 0.004, thickness: 0.004, segments: 3 },
      concave: { depth: 0.038, exponent: 1.6 }, // x_off = -0.038 (1 - (r/0.215)^1.6)
    },
    material: {
      face: { color: "#2b2d30", metalness: 1, roughness: 0.30, clearcoat: 0.7, clearcoatRoughness: 0.12, swirlMapSize: 1024 },
      lip: { metalness: 1, roughness: 0.07 },
      barrel: { metalness: 1, roughness: 0.40 },
    },
    blurOmega: 30,             // acima disso o impostor borrado entra
  },

  hub: {
    color: "#6d6e70", roughness: 0.5, metalness: 1,
    studs: { count: 5, r: 0.007, length: 0.045, pcd: 0.120 },
    lugNut: { hexAF: 0.017, chamferDeg: 30, seatDeg: 60, radialSegments: 6, color: "#3a3a3a", roughness: 0.18, metalness: 1 },
    spacer: { thickness: 0.015, rOuter: 0.075, bore: 0.0726, holes: 5, pcd: 0.120, metalness: 1, roughness: 0.55 },
  },

  rotor: {
    size: "380x34",
    R: 0.19,
    r: 0.12,
    thickness: 0.034,
    plate: 0.0095,
    plateBevel: 0.0006,
    ventGap: 0.015,
    holes: { d: 0.007, rows: [0.135, 0.155, 0.175], perRow: 12, rowOffsetDeg: 10 },
    vanes: 48,
    slotsPerFace: 6,
    bobbins: 12,
    iron: { color: "#7d7c79", metalness: 1, roughness: 0.32, anisotropy: 0.7 },
    hat: { color: "#141414", roughness: 0.35, metalness: 1 },
  },

  caliper: {
    center: [-0.065, 0.153, -0.089],
    angle: 60 * D,             // theta = atan2(y, -z)
    radius: 0.177,             // |(y, z)| do centro
    sectorDeg: 92,
    R: [0.135, 0.215],
    depth: 0.038,
    bevel: { size: 0.007, thickness: 0.007, segments: 4 },
    domes: { diameters: [0.030, 0.034, 0.038], raise: 0.004, perSide: 3 },
    bridgeBolts: 2,
    bleedNipples: 2,
    pistons: 6,
    pad: { backing: { roughness: 0.5 }, friction: { color: "#2a2724", roughness: 0.9 } },
    paint: { color: "#D0101F", metalness: 0, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.06 },
    padSectorDeg: 64,
    split: 0.04,
    pistonExtend: 0.018,
    pistonStaggerS: 0.03,
    padSlide: 0.025,
    hatLift: 0.03,
  },

  coilover: {
    lowerPerch: [-0.15, 0.30, 0],
    topMount: [-0.24, 0.78, 0],
    leanDeg: 8,                // aprox., o eixo é a reta entre os dois pontos acima
    body: { r: 0.023, length: 0.26, threadPitch: 0.0015, color: "#8f8f92", metalness: 1, roughness: 0.28 },
    collars: { count: 2, notches: 12 },
    shaft: { metalness: 1, roughness: 0.06 },
    springCenter: [-0.195, 0.52, 0],
    collarUnscrewTurns: 2,
    springLiftOpen: 0.09,
    topHatLiftOpen: 0.14,
    camberPlateTurnDeg: 15,
  },

  spring: {
    Lfree: 0.203,
    id: 0.062,
    R: 0.0365,                 // raio médio
    d: 0.011,
    activeCoils: 6.5,
    closedTurnsPerEnd: 0.75,
    segments: { tubular: 640, radial: 12 },
    solid: 0.099,              // 9 d
    Lrest: 0.1464,
    color: "#D0101F", metalness: 0, roughness: 0.55, clearcoat: 0.25,
  },

  airBag: {
    convolutions: 2,
    r0: 0.058,
    amp: 0.014,                // r(y) = 0.058 + 0.014 sin^2(pi y / h)
    height: 0.146,             // não está na spec: igual a Lrest para o fole ocupar o lugar da mola
    segments: [64, 32],
    overshoot: 0.06,
    color: "#101010", roughness: 0.75, sheen: 0.3,
  },

  arm: {
    depth: 0.024,
    bevel: 0.005,
    color: "#5d5f62", roughness: 0.45, metalness: 1,
    bushings: [[-0.45, -0.15, 0.15], [-0.45, -0.15, -0.15]],
    ballJoint: [-0.08, -0.17, 0],
    lever: 0.38,               // ângulo = asin(curso / 0.38)
    weldBeadR: 0.003,
  },

  fender: {
    archR: 0.36,
    spanDeg: 50,               // +/- sobre o topo
    panelAbove: 0.12,
    sheet: 0.0012,
    curvatureY: 0.08,
    tumblehomeDeg: 3,
    lipTubeR: 0.004,
    outerX: 0.107,
    color: "#ECE9E2", roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03,
    cutColor: "#810015",
  },

  // grade de calor do disco (sim/heat.js e o shader do ferro leem daqui)
  heatGrid: {
    nA: 96, nR: 16,
    rInner: 0.12, rOuter: 0.19, // v = (r - rInner) / (rOuter - rInner)
    padCells: [2, 15],
    tMaxStored: 1100,          // textura R8 guarda T / 1100
    // u = theta / 2pi no referencial do disco, theta = atan2(y, -z) local
  },

  title: { width: 6, z: -1.4, y: 0.12, canvas: [4096, 512], strokePx: 1.5, alpha: 0.3 },
  porthole: { center: [0.9, 0.30, -2.2], diameter: 1.6, breatheHz: 0.25 },
  orbit: { a: 0.85, b: 0.30, tiltDeg: 12, tubeR: 0.0006, opacity: 0.4, ribbonCanvas: [4096, 128], friction: 0.92 },
  labelRing: { inner: 0.193, outer: 0.215, canvas: [4096, 128] },
  camberArc: { tubeR: 0.0003 }, // 0.6 mm de diâmetro

  // âncoras em coordenadas do mundo, para quem só precisa de um ponto
  anchors: {
    hub: [0, 0, 0],
    wheelFace: [0, 0, 0],
    rotorMid: [-0.065, 0, 0],
    caliper: [-0.065, 0.153, -0.089],
    lowerPerch: [-0.15, 0.30, 0],
    topMount: [-0.24, 0.78, 0],
    springCenter: [-0.195, 0.52, 0],
    ballJoint: [-0.08, -0.17, 0],
    bushingFront: [-0.45, -0.15, 0.15],
    bushingRear: [-0.45, -0.15, -0.15],
    contact: [-0.0355, -0.3118, 0],
    porthole: [0.9, 0.30, -2.2],
  },
};

/* ---------------- seção 3: estúdio ---------------- */
export const STUDIO = {
  pmremSize: 256,
  softbox: { size: [2.5, 0.8], intensity: 4 },
  strip: { size: [0.25, 2.2], intensity: 6 },
  redStrip: { color: "#810015", intensity: 1.5 },
  fill: { intensity: 0.3 },
  key: { intensity: 2.0, position: [2, 3, 2] },
  exposure: 1.05,
  vignette: 0.35,
  grain: 0.015,
  dprCap: 1.5,
  dprLow: 1.0,
  fovVClamp: [20, 56],
  near: 0.01,
  far: 40,
  budget: { drawCalls: 35, triangles: 150000, canvasTextures: 14, gpuMB: 40, simMs: 0.4 },
  tiers: { highUnderMs: 11, lowOverMs: 18, probeFrames: 40, governorMs: 19, governorFrames: [30, 120] },
  lowTier: { dpr: 1.0, sparks: 96, debris: 18, tyreRadial: 64, tyreSheen: false, faceClearcoat: false },
  heightJumpIgnorePx: 120,
};

/* ---------------- seção 4: simulações ---------------- */
export const SIM = {
  hz: 240, maxSubsteps: 8,
  spin: { I: 60, mu: 0.45, rEff: 0.165, Fmax: 36000, motorK: 40, omegaHero: 62.8, omegaIdle: 0.42, omegaBrakeBeat: 40, scrubK: 0.9, scrubDecayS: 0.6 },
  heat: { nA: 96, nR: 16, padDeg: 64, padCells: [2, 15], peakC: 820, alpha: 0.12, passes: 2, ambient: 25, h0: 0.08, hOmega: 0.0015, drilledH: 1.15,
    ramp: [[480, "#000000"], [550, "#3a0000"], [700, "#b81d08"], [900, "#ff7a1a"]], glow: [480, 950, 3.0], roughDropAbove: 600, roughDrop: 0.1 },
  sparks: { max: 192, lenPerV: 0.012, width: 0.0012, minT: 650, minOmega: 3, rate: 400, speed: [4, 9], spreadDeg: 25, g: 9.8, drag: 1.8, life: [0.35, 0.9], restitution: 0.35, bounces: 1 },
  quarterCar: { ms: 450, mu: 45, k: 78000, Lrest: 0.1464, Lfree: 0.203, bumpK: 2e9, bumpL: 0.112, Lbind: 0.099, c: 3790, bump: 0.7, rebound: 1.3,
    kt: 260000, ct: 400, g: 9.8, drop: 0.25, Fload: 4500, FloadRampS: 1.2, Fdive: 1800, airExp: 1.3 },
  debris: { nuts: 24, bobbins: 12, depth: [0.15, 4], bokehNearest: 4, bokehPx: 128, drift: 0.02, spin: [0.1, 0.4], homeK: 4, homeC: 2.4, repelR: 0.25, repelK: 1.8 },
};

/* ---------------- cores ---------------- */
export const PALETTE = {
  black: "#000000",
  bone: "#F2EEE6",
  boneSoft: "rgba(242,238,230,0.72)",
  brushRed: "#810015",      // anel de pincel, filete vermelho do estúdio, face de corte
  caliperRed: "#D0101F",    // pinça, mola, sublinhado do "Text the shop"
  ember: "#ff7a1a",
  heat550: "#3a0000",
  heat700: "#b81d08",
  heat900: "#ff7a1a",
  tyre: "#0b0b0b",
  tyreSheen: "#2a2a2a",
  gunmetal: "#2b2d30",
  castGrey: "#6d6e70",
  chromeBlack: "#3a3a3a",
  iron: "#7d7c79",
  anodBlack: "#141414",
  padFriction: "#2a2724",
  titanium: "#8f8f92",
  rubber: "#101010",
  forged: "#5d5f62",
  basalt: "#0e0e0e",
  fenderWhite: "#ECE9E2",
};

/* ---------------- fatos (toda frase do site sai daqui) ---------------- */
export const FACTS = {
  name: "Yakuza Garage",
  city: "NYC",
  addressLine: "103-15 100th St, Ozone Park, NY 11417",
  addressMolded: "103-15 100TH ST · OZONE PARK NY 11417 · 347-813-2779",
  street: "103-15 100th St",
  locality: "Ozone Park",
  region: "NY",
  zip: "11417",
  phone: "347-813-2779",
  phoneE164: "+13478132779",
  hours: "Monday to Friday, 8am to 11pm. Saturday and Sunday by appointment. Walk-ins accepted.",
  rating: 4.9,
  reviews: 58,
  ratingLine: "Rated 4.9 on Google across 58 reviews.",
  mapsQuery: "Yakuza Garage, 103-15 100th St, Ozone Park, NY 11417",
  services: [
    "Rims and tires",
    "Paint correction and ceramic",
    "Big brake kit upgrades",
    "Fitment and camber",
    "Powder-coating",
    "Exhaust and welding",
    "Coilovers",
    "Air bag installs",
    "Suspension",
    "Engine repairs and swaps",
    "Electrical diagnostics",
    "Auto body and collision",
    "Full automotive repairs",
  ],
  jobs: [
    "12 and 15 mm spacers on a BMW M4",
    "S2000, full brake upgrade, fresh red calipers",
    "Coilover install on a Dodge Charger",
    "Air struts on a BMW X7",
  ],
  mascot: "Carlinhos, the monkey mechanic",
};

/* ---------------- textos por beat ---------------- */
export const COPY = {
  hero: { statement: "Cars. Culture. Lifestyle.", small: "Suspension specialist. Full automotive repairs. Auto body and collision." },
  fitment: { statement: "Fitment and camber.", small: "12 and 15 mm spacers on a BMW M4." },
  brake: { statement: "Brake services.", small: "Hold anywhere. That is a brake.", smallAfterHold: "" },
  suspension: { statement: "Coilovers and custom air bag installs.", small: "Coilover install on a Dodge Charger. Air struts on a BMW X7." },
  orbit: { statement: "Also engine repairs and swaps, electrical diagnostics, auto body and collision.", small: "" },
  reassembly: { statement: "", small: "" },
  carlinhos: { statement: "Carlinhos, the monkey mechanic.", small: "" },
  contact: {
    action: "Text the shop",
    address: "103-15 100th St, Ozone Park, NY 11417",
    phone: "347-813-2779",
    hours: "Monday to Friday, 8am to 11pm. Saturday and Sunday by appointment. Walk-ins accepted.",
    rating: "Rated 4.9 on Google across 58 reviews.",
  },
  persistentAction: "Text the shop",
  titles: { hero: "YAKUZA GARAGE", fitment: "FITMENT", brake: "BRAKES", suspension: "SUSPENSION", contact: "OZONE PARK" },
  orbitLabels: [
    { part: "wheel", text: "Rims and tires" },
    { part: "wheelFace", text: "Paint correction and ceramic" },
    { part: "rotor", text: "Big brake kit upgrades" },
    { part: "spacer", text: "Fitment and camber" },
    { part: "spring", text: "Powder-coating" },
    { part: "weld", text: "Exhaust and welding" },
  ],
  ringLabel: "Big brake kit upgrades · S2000, full brake upgrade, fresh red calipers ·",
};

/* ---------------- SMS ---------------- */
export const SMS = {
  number: "+13478132779",
  hrefPrefix: "sms:+13478132779?&body=", // o corpo vai com encodeURIComponent
  base: "Hi, I found Yakuza Garage online. I'd like to ask about ",
  general: "Hi, I found Yakuza Garage online. I'd like to ask about ",
  fitment: "Hi, I found Yakuza Garage online. I'd like to ask about wheel fitment.",
  brake: "Hi, I found Yakuza Garage online. I'd like to ask about brake work.",
  coil: "Hi, I found Yakuza Garage online. I'd like to ask about coilovers.",
  air: "Hi, I found Yakuza Garage online. I'd like to ask about air suspension.",
  serviceTemplate: "Hi, I found Yakuza Garage online. I'd like to ask about {service}.",
  hiddenFromP: 0.88,
};

/* ---------------- seção 5: beats como keyframes ----------------
   p = progresso da trilha de 700vh (0..1). cam = pose no FIM do trecho; fovFrom quando a spec dá o início.
   path: hold | orbit | arc | dolly | crane | pull | return | drift. objects: estados e eventos com janelas em p. */
export const LOADER = {
  minS: 1.6, maxS: 3.0,
  irisFromVw: 22, irisToVmax: 150, irisMs: 700, irisEase: "cubic-bezier(.7,0,.2,1)",
  arcDeg: 92, arcFlyMs: 300,
  ringColor: "#810015",
  readiness: ["module", "textures", "pmrem", "compileAsync", "probe"],
};

export const CAMERA = {
  hero: { pos: [1.60, 0.38, 1.50], target: [0, 0.12, 0], fovH: 26 },
  smoothK: 7,                  // 1 - exp(-dt * 7)
  trackVh: 700,
};

export const BEATS = [
  {
    id: "B1", key: "hero", p: [0.00, 0.04], timedAutoplay: true,
    cam: { path: "hold", pos: [1.60, 0.38, 1.50], target: [0, 0.12, 0], fovH: 26 },
    title: { word: "YAKUZA GARAGE", x: [0.9, 0] },
    copy: "hero", sms: "general",
    timeline: [
      { t: 0, omega: 62.8, drop: 0.25 },
      { t: 0.3, event: "drop" },
      { t: 0.53, event: "impact", brakeTo: 1, brakeRampS: 0.25, sparks: true, dive: true },
      { t: 2.5, event: "settled", motorOmega: 0.42 },
    ],
    objects: { blurDiscAboveOmega: 30 },
  },
  {
    id: "B1", key: "hero", p: [0.04, 0.14],
    cam: { path: "orbit", pos: [1.75, 0.30, 1.10], target: [0, 0.12, 0], fovH: 26 },
    title: { word: "YAKUZA GARAGE", x: [0, -0.9] },
    copy: "hero", sms: "general",
    objects: { idle: true, hold: "brake+dive" },
  },
  {
    id: "B2", key: "fitment", p: [0.14, 0.20],
    cam: { path: "arc", pos: [0.0, 0.10, 3.3], target: [0, 0.02, 0], fovFrom: 30, fovH: 14 },
    title: { word: "FITMENT" },
    copy: "fitment", sms: "fitment",
    objects: {
      fenderReveal: [0, 1],
      lugsOff: { p: [0.15, 0.18], turns: 4, outX: 0.07, staggerS: 0.06, then: "debris" },
      wheelOutX: 0.26,
      spacer: { p: [0.18, 0.20], from: "below", seat: true, wheelBackPlus: 0.015 },
    },
  },
  {
    id: "B2", key: "fitment", p: [0.20, 0.25],
    cam: { path: "drift", driftDeg: 2, pos: [0.0, 0.10, 3.3], target: [0, 0.02, 0], fovH: 14 },
    copy: "fitment", sms: "fitment",
    objects: { camberDeg: -2.5, camberPivot: "ballJoint", camberAxis: "z", contactArc: { tubeR: 0.0003, emissive: "bone", number: false } },
  },
  {
    id: "B2", key: "fitment", p: [0.25, 0.28],
    cam: { path: "arc", pos: [2.2, 0.10, 0.35], target: [0, 0.10, 0.10], fovH: 28 },
    copy: "fitment", sms: "fitment",
    objects: { fenderReveal: [1, 0], camberDeg: [-2.5, 0], lockWheelAngleForWindowAtP: 0.33 },
  },
  {
    id: "B3", key: "brake", p: [0.28, 0.36],
    cam: { path: "dolly", pos: [0.36, 0.22, 0.14], target: [0, 0.10, 0.10], fovFrom: 28, fovH: 50, near: 0.01, spokeClearance: 0.012 },
    title: { word: "BRAKES", z: -1.4 },
    copy: "brake", sms: "brake",
    objects: {
      wheelSlide: { p: [0.31, 0.35], dx: 0.6, yawDeg: 20 },
      lensNut: { p: 0.33, bokeh: true },
      wheelAngleLocked: true,
    },
  },
  {
    id: "B3", key: "brake", p: [0.36, 0.46],
    cam: { path: "orbit", orbitDeg: 6, pos: [0.36, 0.22, 0.14], target: [-0.065, 0.153, -0.089], fovH: 44 },
    copy: "brake", sms: "brake",
    objects: { motorOmega: 40, hold: "brake", labelRing: true, labelText: "ringLabel", smallAfterHold: "" },
  },
  {
    id: "B3", key: "brake", p: [0.46, 0.50],
    cam: { path: "hold", pos: [0.36, 0.22, 0.14], target: [-0.065, 0.153, -0.089], fovH: 44 },
    copy: "brake", sms: "brake",
    objects: { brake: false, caliperSplit: 0.04, pistonsOut: 0.018, pistonStaggerS: 0.03, padsOut: 0.025, hatLift: 0.03, rejoin: [0.49, 0.50] },
  },
  {
    id: "B4", key: "suspension", p: [0.50, 0.56],
    cam: { path: "crane", posFrom: [0.55, 0.20, 0.60], pos: [0.50, 0.64, 0.72], target: [-0.195, 0.52, 0], fovH: 30 },
    title: { word: "SUSPENSION" },
    copy: "suspension", sms: "coil", smsAir: "air",
    objects: { brakeGroup: "back", hold: "load", toggle: true },
  },
  {
    id: "B4", key: "suspension", p: [0.56, 0.60],
    cam: { path: "hold", pos: [0.50, 0.64, 0.72], target: [-0.195, 0.52, 0], fovH: 30 },
    copy: "suspension", sms: "coil",
    objects: { load: 0, collarTurns: 2, springLift: 0.09, topHatLift: 0.14, camberPlateDeg: 15 },
  },
  {
    id: "B4", key: "suspension", p: [0.60, 0.64],
    cam: { path: "hold", pos: [0.50, 0.64, 0.72], target: [-0.195, 0.52, 0], fovH: 30 },
    copy: "suspension", sms: "coil",
    objects: { reverse: true, zeta: 0.55 },
  },
  {
    id: "B5", key: "orbit", p: [0.64, 0.74],
    cam: { path: "pull", pos: [1.9, 0.60, 2.1], target: [-0.10, 0.20, 0], fovH: 36 },
    title: null,
    copy: "orbit", sms: "general",
    objects: {
      parts: ["wheel", "spacer", "rotor", "caliper", "coilover", "arm"],
      ellipse: { a: 0.85, b: 0.30, tiltDeg: 12 },
      orbitTube: { r: 0.0006, opacity: 0.4 },
      turnDeg: [0, 60], dragFriction: 0.92,
      ribbon: true,
      swirlSweep: { p: [0.68, 0.71], uSwirl: [1, 0] },
    },
  },
  {
    id: "B5", key: "reassembly", p: [0.74, 0.80],
    cam: { path: "return", pos: [1.60, 0.38, 1.50], target: [0, 0.12, 0], fovH: 26 },
    title: { word: "YAKUZA GARAGE", from: "right" },
    copy: "reassembly", sms: "general",
    objects: { explode: [1, 0], zeta: 0.55, lugsOn: { order: [1, 3, 5, 2, 4], turns: 4, recoil: 0.002, vibrateMs: 8 }, warmAtP: 0.79, warmC: 560 },
  },
  {
    id: "B6", key: "carlinhos", p: [0.80, 0.88],
    cam: { path: "arc", pos: [1.9, 0.32, 0.9], target: [0.9, 0.30, -2.2], fovH: 30 },
    copy: "carlinhos", sms: "general",
    objects: { cornerExit: "left", porthole: { center: [0.9, 0.30, -2.2], diameter: 1.6, breatheHz: 0.25 } },
  },
  {
    id: "B6", key: "contact", p: [0.88, 1.00],
    cam: { path: "arc", pos: [1.55, -0.35, 0], target: [0, -0.35, 0], fovH: 28 },
    title: { word: "OZONE PARK" },
    copy: "contact", sms: null,
    objects: { wheelAngleTo: 0, stop: true, letter: { p: [0.88, 0.92], v: [0, 1] }, tyreWidthFill: 0.92, rollOff: false },
  },
];
