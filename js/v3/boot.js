/* v3: boot. Monta a quina (peças já prontas em parts/), liga as simulações, a câmera guiada pelo scroll,
   o loader e a camada de UI. Montagem e coreografia ficam neste arquivo só, de propósito: um lugar para ajustar.
   Depuração: ?p=0.4 trava o progresso, ?nointro=1 pula a queda, window.__yk expõe o estado. */
import * as THREE from "three";
import { LAYOUT, CAMERA, COPY, SIM } from "./spec.js";
import { createStudio } from "./studio.js";
import { createTextures } from "./textures.js";
import { createMaterials } from "./materials.js";
import { createLoader, createGauge, buildPorthole } from "./emblem.js";
import { createUI } from "./ui.js";
import { mountFallback } from "./fallback.js";
import { buildTitle } from "./title.js";
import { buildOrbit } from "./orbit.js";
import { createInput } from "./input.js";
import { createSpin } from "./sim/spin.js";
import { createHeat } from "./sim/heat.js";
import { createSparks } from "./sim/sparks.js";
import { createQuarterCar } from "./sim/quartercar.js";
import { createDebris } from "./hardware.js";
import { buildTyre } from "./parts/tyre.js";
import { buildWheel } from "./parts/wheel.js";
import { buildRotor } from "./parts/rotor.js";
import { buildCaliper } from "./parts/caliper.js";
import { buildHub } from "./parts/hub.js";
import { buildCoilover } from "./parts/coilover.js";
import { buildArm } from "./parts/arm.js";
import { buildFender } from "./parts/fender.js";
import { buildSlab } from "./parts/slab.js";

const Q = new URLSearchParams(location.search);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const seg = (p, a, b) => { const t = clamp((p - a) / (b - a)); return t * t * (3 - 2 * t); };   // 0..1 suave entre a e b
const lin = (p, a, b) => clamp((p - a) / (b - a));
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

/* ---------------- câmera: chaves em p, Hermite com tangente zero em quem encosta num "hold" ---------------- */
const CAL = LAYOUT.caliper.center, SPR = LAYOUT.coilover.springCenter, PORT = LAYOUT.porthole.center;
const KEYS = [
  { p: 0.00, pos: [1.60, 0.38, 1.50], tgt: [0, 0.12, 0], fov: 26 },
  { p: 0.04, pos: [1.60, 0.38, 1.50], tgt: [0, 0.12, 0], fov: 26 },
  { p: 0.14, pos: [1.75, 0.30, 1.10], tgt: [0, 0.12, 0], fov: 26 },
  { p: 0.20, pos: [0.00, 0.10, 3.30], tgt: [0, 0.02, 0], fov: 14 },
  { p: 0.25, pos: [0.00, 0.10, 3.30], tgt: [0, 0.02, 0], fov: 14 },
  { p: 0.28, pos: [2.20, 0.10, 0.35], tgt: [0, 0.10, 0.10], fov: 28 },
  { p: 0.36, pos: [0.56, 0.27, 0.16], tgt: CAL, fov: 40 },
  { p: 0.50, pos: [0.56, 0.27, 0.16], tgt: CAL, fov: 40 },
  { p: 0.56, pos: [0.50, 0.64, 0.72], tgt: SPR, fov: 30 },
  { p: 0.64, pos: [0.50, 0.64, 0.72], tgt: SPR, fov: 30 },
  { p: 0.71, pos: [2.30, 0.80, 2.55], tgt: [-0.10, -0.12, 0], fov: 46 },
  { p: 0.74, pos: [2.30, 0.80, 2.55], tgt: [-0.10, -0.12, 0], fov: 46 },
  { p: 0.80, pos: [1.60, 0.38, 1.50], tgt: [0, 0.12, 0], fov: 26 },
  { p: 0.855, pos: [1.90, 0.32, 0.90], tgt: PORT, fov: 30 },
  { p: 0.88, pos: [1.90, 0.32, 0.90], tgt: PORT, fov: 30 },
  { p: 0.94, pos: [1.55, -0.35, 0.00], tgt: [0, -0.35, 0], fov: 28 },
  { p: 1.00, pos: [1.55, -0.35, 0.00], tgt: [0, -0.35, 0], fov: 28 },
];
const same = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-6;
for (const f of ["pos", "tgt"]) {
  KEYS.forEach((k, i) => {
    const a = KEYS[i - 1], b = KEYS[i + 1], m = [0, 0, 0];
    if (a && b && !same(a[f], k[f]) && !same(b[f], k[f])) for (let j = 0; j < 3; j++) m[j] = (b[f][j] - a[f][j]) / (b.p - a.p);
    k["m" + f] = m;
  });
}
const _cp = [0, 0, 0], _ct = [0, 0, 0];
function camAt(p, out) {
  let i = 0; while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1], h = b.p - a.p, t = clamp((p - a.p) / h), t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  for (let j = 0; j < 3; j++) {
    _cp[j] = h00 * a.pos[j] + h10 * h * a.mpos[j] + h01 * b.pos[j] + h11 * h * b.mpos[j];
    _ct[j] = h00 * a.tgt[j] + h10 * h * a.mtgt[j] + h01 * b.tgt[j] + h11 * h * b.mtgt[j];
  }
  out.pos.set(_cp[0], _cp[1], _cp[2]); out.tgt.set(_ct[0], _ct[1], _ct[2]);
  out.fov = a.fov + (b.fov - a.fov) * (t2 * (3 - 2 * t));
  return out;
}
const beatKey = (p) => (p < 0.14 ? "hero" : p < 0.28 ? "fitment" : p < 0.50 ? "brake" : p < 0.64 ? "suspension" : p < 0.74 ? "orbit" : p < 0.80 ? "reassembly" : p < 0.88 ? "carlinhos" : "contact");

/* título gigante: um pouso por beat, atrás do alvo e de frente para a câmera daquele beat */
const TITLE_POSE = {
  hero: { cam: [1.60, 0.38, 1.50], tgt: [0, 0.12, 0], back: 1.5, y: 0.16 },
  fitment: { cam: [0, 0.10, 3.3], tgt: [0, 0.02, 0], back: 1.2, y: 0.50 },
  brake: { cam: [0.56, 0.27, 0.16], tgt: CAL, back: 1.3, y: 0.30 },
  suspension: { cam: [0.50, 0.64, 0.72], tgt: SPR, back: 1.3, y: 0.62 },
  reassembly: { cam: [1.60, 0.38, 1.50], tgt: [0, 0.12, 0], back: 1.5, y: 0.16 },
  contact: { cam: [1.55, -0.35, 0], tgt: [0, -0.35, 0], back: 1.3, y: 0.52 },
};

function hasWebGL2() {
  try { const c = document.createElement("canvas"); return !!c.getContext("webgl2"); } catch { return false; }
}

async function main() {
  const canvas = document.getElementById("v3-canvas");
  const uiRoot = document.getElementById("v3-ui");
  const loader = createLoader(document.getElementById("v3-loader"), { reducedMotion: REDUCED });
  const fail = (reason, err) => {
    if (err) console.error(err);
    try { loader.destroy && loader.destroy(); } catch {}
    document.documentElement.classList.remove("v3-loading");
    mountFallback(document.body, reason);
  };
  if (!hasWebGL2()) return fail("nowebgl");

  const tStart = performance.now();
  loader.setProgress(0.1);                                   // módulos chegaram
  const tier = Q.get("tier") || (Math.min(innerWidth, innerHeight) < 760 ? "base" : "high");
  let studio;
  try { studio = createStudio(canvas, { tier }); } catch (e) { return fail("nowebgl", e); }
  const { renderer, scene, camera } = studio;
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); running = false; fail("contextlost"); });
  studio.autoResize();
  loader.setProgress(0.25);                                  // PMREM pronto
  await nextFrame();

  const tex = createTextures(renderer, { envTex: studio.envTex });
  const mats = createMaterials({ envTex: studio.envTex, tex, tier, heatTex: null });
  const ctx = { THREE, mats, tex, tier };
  await Promise.race([tex.fontsReady(), new Promise((r) => setTimeout(r, 2000))]);

  /* ---------------- peças (uma por quadro para o anel do loader andar) ---------------- */
  const P = {};
  const order = [["slab", buildSlab], ["tyre", buildTyre], ["wheel", buildWheel], ["rotor", buildRotor], ["caliper", buildCaliper],
    ["hub", buildHub], ["coilover", buildCoilover], ["arm", buildArm], ["fender", buildFender]];
  for (let i = 0; i < order.length; i++) {
    P[order[i][0]] = await order[i][1](ctx);
    loader.setProgress(0.3 + 0.4 * ((i + 1) / order.length));
    await nextFrame();
  }
  const { slab, tyre, wheel, rotor, caliper, hub, coilover, arm, fender } = P;

  /* ---------------- montagem: massa suspensa, não suspensa, pivô de cambagem, conjunto roda+pneu ---------------- */
  const world = new THREE.Group(); world.name = "corner"; scene.add(world);
  const sprung = new THREE.Group(), unsprung = new THREE.Group(), camberG = new THREE.Group(), camberIn = new THREE.Group(), wheelAssy = new THREE.Group();
  const BJ = (arm.anchors && arm.anchors.ballJoint) ? arm.anchors.ballJoint.clone() : V(LAYOUT.arm.ballJoint);
  camberG.position.copy(BJ); camberIn.position.copy(BJ).negate(); camberG.add(camberIn);
  wheelAssy.add(wheel.root, tyre.root);
  camberIn.add(hub.root, rotor.root, caliper.root, wheelAssy);
  unsprung.add(camberG, coilover.root);
  sprung.add(arm.root, fender.root);
  world.add(slab.root, sprung, unsprung);

  const title = buildTitle(ctx); scene.add(title.root);
  const orbit = buildOrbit(ctx); scene.add(orbit.root); orbit.setPhase(0);
  let porthole = null; try { porthole = buildPorthole(ctx); scene.add(porthole.root); } catch (e) { console.warn("porthole", e); }
  let debris = null;
  if (!REDUCED) try { debris = createDebris({ mats, tex: null, tier, count: tier === "high" ? 24 : 14 }); scene.add(debris.root); } catch (e) { console.warn("debris", e); }
  loader.setProgress(0.75);

  /* ---------------- simulações ---------------- */
  const spin = createSpin({ omega: 0 });
  const heat = createHeat({ THREE });
  const sparks = createSparks({ max: SIM.sparks.max, THREE });
  const qc = createQuarterCar();
  if (heat.texture) mats.setHeatTexture(heat.texture);
  if (sparks.mesh) { sparks.mesh.frustumCulled = false; scene.add(sparks.mesh); }
  if (tier === "low" && sparks.setCap) sparks.setCap(96);
  const FLOOR = slab.topY != null ? slab.topY : LAYOUT.slab.topY;
  const spinIn = { brake: 0, motorTarget: 0, scrub: 0 };
  const heatIn = { omega: 0, angle: 0, brakePower: 0, padSector: caliper.padSector };
  const qcIn = { F_load: 0, F_dive: 0, airMode: 0, airP: 1 };
  const padEdge = new THREE.Vector3(), tangent = new THREE.Vector3();
  const sparkIn = { T: 25, omega: 0, brake: 0, padEdgeWorld: padEdge, tangent };
  const PAD0 = (caliper.anchors.padTrailing || V(CAL)).clone();

  /* ---------------- UI, gesto ---------------- */
  const ui = createUI(uiRoot);
  const gauge = createGauge(document.getElementById("v3-gauge"));
  const input = createInput(canvas, {});
  const G = { hold: false, x: 0, y: 0, scrub: 0, heldOnce: false };
  input.on("hold", (e) => { G.hold = true; G.x = e.x; G.y = e.y; });
  input.on("release", () => { G.hold = false; gauge.hide(); });
  input.on("scrub", (e) => { G.scrub = e.vx || 0; });
  input.on("doubletap", () => { if (pS < 0.14 && !REDUCED) startIntro(); });
  input.on("tap", (e) => {
    if (pS > 0.66 && pS < 0.74) { const s = orbit.hit(e.x, e.y, camera, { width: canvas.clientWidth, height: canvas.clientHeight }); if (s) ui.setSmsContext(s); }
  });
  let modeTarget = 0, modeT = 0;
  ui.onMode((m) => { modeTarget = m === "air" ? 1 : 0; ui.setMode(m); });

  /* ---------------- compila tudo com tudo à mostra, depois volta ao estado do herói ---------------- */
  fender.setReveal(1); rotor.setLabel(1); caliper.setPistons(1); coilover.setMode(1); orbit.setPhase(1); hub.setSpacer(1);
  try { await renderer.compileAsync(scene, camera); } catch (e) { console.warn("compileAsync", e); }
  fender.setReveal(0); rotor.setLabel(0); caliper.setPistons(0); coilover.setMode(0); orbit.setPhase(0); hub.setSpacer(0);
  loader.setProgress(0.95);

  /* ---------------- estado da coreografia ---------------- */
  const track = document.getElementById("v3-track");
  const forcedP = Q.has("p") ? clamp(+Q.get("p")) : null;
  let pT = 0, pS = forcedP != null ? forcedP : 0, running = true;
  const readP = () => {
    if (forcedP != null) return forcedP;
    if (yk.forceP != null) return yk.forceP;
    const max = Math.max(1, track.offsetHeight - innerHeight);
    return clamp((scrollY - track.offsetTop) / max);
  };
  const intro = { on: false, t: 0, hit: -1, stopped: -1, x: 0.9 };
  function startIntro() {
    intro.on = true; intro.t = 0; intro.hit = -1; intro.stopped = -1;
    spin.omega = SIM.spin.omegaHero; qc.drop(SIM.quarterCar.drop);
  }
  let brake = 0, load = 0, wheelAngle = 0, wheelOff = 0, mounted = true, orbitDrag = 0, orbitVel = 0, curBeat = null, acc = 0, simT = 0;
  const cam = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 26 };
  const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Vector3();
  const STEP72 = TAU / 5;
  const ASIDE = new THREE.Vector3(0.35, 0, -0.62);            // roda tirada: sai em +X e encosta em -Z (direita do quadro no freio)
  const CENTER = {                                             // centro de cada peça em repouso, para levar à órbita
    wheel: new THREE.Vector3(-0.0355, 0, 0), hub: new THREE.Vector3(0.0, 0, 0), rotor: new THREE.Vector3(-0.065, 0, 0),
    caliper: V(CAL), coilover: new THREE.Vector3(-0.195, 0.50, 0), arm: new THREE.Vector3(-0.28, -0.16, 0),
  };
  const SLOT = { wheel: 0, hub: 1, rotor: 2, caliper: 3, coilover: 4, arm: 5 };
  const toSlot = (root, name, e, groupY) => {
    if (e <= 0.0001) { root.position.set(0, 0, 0); return; }
    orbit.slot(SLOT[name], _s); _c.copy(CENTER[name]);
    root.position.set((_s.x - _c.x) * e, (_s.y - _c.y - groupY) * e, (_s.z - _c.z) * e);
  };

  function placeTitle(key) {
    const tp = TITLE_POSE[key]; if (!tp) return;
    const c = V(tp.cam), t = V(tp.tgt), d = t.clone().sub(c); d.y = 0; d.normalize();
    title.root.position.set(t.x + d.x * tp.back, tp.y, t.z + d.z * tp.back);
    title.root.lookAt(c.x, tp.y, c.z);
  }

  /* ---------------- um quadro ---------------- */
  function frame(dt, now) {
    pT = readP();
    pS += (pT - pS) * (REDUCED ? 1 : 1 - Math.exp(-dt * CAMERA.smoothK));
    const p = pS, key = beatKey(p);

    // --- comandos de freio, motor e carga ---
    let brakeT = 0, motor = 0, dive = 0, loadT = 0;
    const inHero = p < 0.14, inBrake = p >= 0.355 && p < 0.46, inSusp = p >= 0.50 && p < 0.56;
    if (intro.on) {
      intro.t += dt;
      motor = intro.hit < 0 ? SIM.spin.omegaHero : SIM.spin.omegaIdle;
      if (intro.hit < 0 && qc.state.landedAt >= 0) intro.hit = intro.t;
      if (intro.hit >= 0) {
        brakeT = 1;
        if (spin.omega < 0.6 && intro.stopped < 0) intro.stopped = intro.t;
        if (intro.stopped >= 0 && intro.t - intro.stopped > 0.45) { brakeT = 0; if (intro.t - intro.hit > 2.6) intro.on = false; }
      }
    } else {
      if (inHero) { motor = SIM.spin.omegaIdle; if (G.hold) brakeT = 1; }
      else if (p >= 0.33 && p < 0.50) { motor = p < 0.46 ? SIM.spin.omegaBrakeBeat : 6; if (inBrake && G.hold) brakeT = 1; }
      else if (p >= 0.50 && p < 0.64) motor = SIM.spin.omegaIdle;
      else { motor = 0; if (spin.omega > 0.02) brakeT = 0.1; }
      if (inSusp && G.hold) loadT = 1;
    }
    brake += clamp(brakeT - brake, -dt / 0.12, dt / 0.25);
    load = loadT > 0 ? Math.min(1, load + dt / SIM.quarterCar.FloadRampS) : 0;
    dive = (inHero || intro.on) ? brake : 0;
    if (G.hold && (brakeT > 0 || loadT > 0)) {
      gauge.show(G.x, G.y); gauge.set(loadT > 0 ? load : brake);
      if (inBrake && !G.heldOnce) { G.heldOnce = true; ui.setHint(""); }
    }
    modeT += clamp(modeTarget - modeT, -dt / 0.4, dt / 0.4);

    // --- passo fixo a 240 Hz ---
    const H = 1 / SIM.hz; acc = Math.min(acc + dt, H * SIM.maxSubsteps);
    const fall = !intro.on || intro.t >= 0.3;
    spinIn.brake = brake; spinIn.motorTarget = motor; spinIn.scrub = (inHero || inBrake) && !intro.on ? G.scrub : 0;
    qcIn.F_load = load * SIM.quarterCar.Fload; qcIn.F_dive = dive * SIM.quarterCar.Fdive; qcIn.airMode = modeT; qcIn.airP = 1;
    let stepped = 0;
    while (acc >= H) {
      acc -= H; stepped += H;
      spin.step(H, spinIn);
      heatIn.omega = spin.omega; heatIn.angle = spin.angle; heatIn.brakePower = spin.brakePower;
      heat.step(H, heatIn);
      if (fall) qc.step(H, qcIn);
      if (!REDUCED && sparks.mesh) {
        const yu = qc.state.yu;
        padEdge.set(PAD0.x, PAD0.y + yu, PAD0.z);
        tangent.set(0.95 * Math.hypot(PAD0.y, PAD0.z), -PAD0.z, PAD0.y);   // tangente do disco + viés para fora: a chuva sai pelas janelas da roda, na direção da câmera
        sparkIn.T = heat.trailingT; sparkIn.omega = spin.omega; sparkIn.brake = brake;
        sparks.emit(H, sparkIn);
      }
    }
    G.scrub = 0;
    if (stepped > 0) { heat.frame(stepped, spin.omega); if (sparks.mesh) sparks.update(stepped, FLOOR); }
    if (sparks.mesh && sparks.mesh.material.uniforms && sparks.mesh.material.uniforms.uPxAngle) {   // largura mínima em pixels: 1.2 mm some no celular
      const u = sparks.mesh.material.uniforms; u.uPxAngle.value = 2 * Math.tan(camera.fov * DEG / 2) / Math.max(1, canvas.clientHeight); if (u.uMinPx) u.uMinPx.value = 1.6;
    }
    simT += stepped;

    // --- beats: estados das peças em função de p ---
    const lugFit = seg(p, 0.15, 0.17) * (1 - seg(p, 0.205, 0.225));
    const outFit = 0.26 * seg(p, 0.16, 0.18) * (1 - seg(p, 0.19, 0.205));
    const spacerT = seg(p, 0.175, 0.20);
    const lugOff = seg(p, 0.285, 0.305) * (1 - seg(p, 0.775, 0.80));
    const off = seg(p, 0.30, 0.345) * (1 - seg(p, 0.745, 0.785));           // roda fora do cubo (freio, suspensão, órbita)
    const e = seg(p, 0.64, 0.70) * (1 - seg(p, 0.74, 0.79));                // explosão para a órbita
    const camber = 2.5 * DEG * seg(p, 0.20, 0.225) * (1 - seg(p, 0.25, 0.28));
    const split = seg(p, 0.46, 0.478) * (1 - seg(p, 0.488, 0.50));
    const open = seg(p, 0.56, 0.60) * (1 - seg(p, 0.60, 0.64));
    wheelOff = off;

    const s = qc.state, yu = s.yu, ys = s.ys;
    unsprung.position.y = yu; sprung.position.y = ys;
    camberG.rotation.z = camber;                                             // +z: o topo deita para dentro (cambagem negativa)
    coilover.setLength(qc.L()); coilover.setMode(modeT);
    coilover.setCollarTurns(2 * open); coilover.setTopLift(0.14 * open);
    if (arm.setTravel) arm.setTravel(yu - ys); else arm.setAngle(Math.asin(clamp((yu - ys) / 0.38, -0.9, 0.9)));
    fender.setReveal(seg(p, 0.14, 0.19) * (1 - seg(p, 0.25, 0.28)));
    hub.setSpacer(spacerT);
    caliper.setSplit(0.04 * split); caliper.setPistons(split); caliper.setPads(split); rotor.setHatLift(0.03 * split);
    rotor.setLabel(seg(p, 0.36, 0.385) * (1 - seg(p, 0.45, 0.462)));

    // roda: ângulo próprio (solta do cubo ela para), porcas, posição
    if (off < 0.02) {
      if (!mounted) { mounted = true; }
      const k = Math.round((wheelAngle - spin.angle) / STEP72) * STEP72;      // mantém porca alinhada com prisioneiro
      wheelAngle = spin.angle + k;
      if (p > 0.88) {                                                        // contato: para em 0 para o endereço ficar em pé
        const stop = seg(p, 0.88, 0.93);
        if (stop > 0.5 && spin.omega < 0.05) { const tgtA = Math.round(spin.angle / TAU) * TAU; spin.angle += (tgtA - spin.angle) * (1 - Math.exp(-dt * 5)); }
      }
    } else {
      mounted = false;
      if (Math.abs(spin.omega) < 1.5) { const tgtA = spin.angle + Math.round((wheelAngle - spin.angle) / STEP72) * STEP72; wheelAngle += (tgtA - wheelAngle) * (1 - Math.exp(-dt * 6)); }
    }
    wheel.spin.rotation.x = wheelAngle; tyre.spin.rotation.x = wheelAngle;
    rotor.setAngle(spin.angle); hub.setAngle(spin.angle);
    const lug = Math.max(lugFit, lugOff);
    for (let i = 0; i < 5; i++) { const li = clamp(lug * 1.6 - i * 0.15); wheel.setLug(i, 4 * li, 0.07 * li); }
    wheel.setBlur(mounted ? spin.omega : 0);
    wheel.setSwirl(1 - seg(p, 0.68, 0.71));
    const ox = seg(off, 0, 0.5), oz = seg(off, 0.35, 1);
    const baseX = outFit + 0.015 * seg(p, 0.19, 0.205) * (1 - seg(p, 0.64, 0.66)) * (1 - 0) + 0;
    wheelAssy.position.set(baseX * (1 - e) + ASIDE.x * ox * (1 - e), 0, ASIDE.z * oz * (1 - e));
    wheelAssy.rotation.y = -0.45 * oz * (1 - e);
    if (e > 0.0001) { orbit.slot(SLOT.wheel, _s); wheelAssy.position.x += (_s.x - CENTER.wheel.x) * e; wheelAssy.position.y = (_s.y - yu) * e; wheelAssy.position.z += (_s.z) * e; }
    else wheelAssy.position.y = 0;
    const penRaw = qc.pen();
    tyre.setSquash(off > 0.02 ? (e > 0.05 ? 0 : SIM.quarterCar ? LAYOUT.tyre.staticDeflection * (1 - e) : 0) : Math.min(penRaw, 0.085));
    tyre.setLetter(seg(p, 0.88, 0.92));

    // órbita
    orbitVel = orbitVel * Math.pow(LAYOUT.orbit.friction, dt * 60);
    orbitDrag += orbitVel * dt;
    orbit.setPhase(seg(p, 0.655, 0.71) * (1 - seg(p, 0.735, 0.76)));
    orbit.setAngle(60 * DEG * lin(p, 0.64, 0.74) + orbitDrag);
    toSlot(hub.root, "hub", e, yu); toSlot(rotor.root, "rotor", e, yu); toSlot(caliper.root, "caliper", e, yu);
    toSlot(coilover.root, "coilover", e, yu); toSlot(arm.root, "arm", e, ys);

    // laje e sombra
    slab.setShadow(qc.gap(), wheelAssy.position.x, 1 - e);

    // calor
    mats.setHeatUniforms(heat.maxT);
    hub.setHeatTint(heat.tint || 0);

    // título
    if (key !== curBeat) {
      curBeat = key;
      const w = COPY.titles[key] || (key === "reassembly" ? COPY.titles.hero : null);
      title.setWord(w); if (w) placeTitle(key);
    }
    if (intro.on || (p < 0.001 && intro.x > 0.001)) intro.x += (0 - intro.x) * (1 - Math.exp(-dt * 1.6));
    let tx = 0;
    if (key === "hero") tx = intro.x - 0.9 * seg(p, 0.02, 0.14);
    else if (key === "fitment") tx = 0.5 - 1.0 * lin(p, 0.14, 0.28);
    else if (key === "brake") tx = 0.6 - 1.2 * lin(p, 0.28, 0.50);
    else if (key === "suspension") tx = 0.6 - 1.2 * lin(p, 0.50, 0.64);
    else if (key === "reassembly") tx = 0.9 * (1 - seg(p, 0.74, 0.80));
    else if (key === "contact") tx = 0.5 - 0.8 * lin(p, 0.88, 1);
    title.setX(tx); title.setGlow(heat.maxT); title.dip(clamp(-s.vs * 4, -6, 6));

    // porthole e detritos
    if (porthole) { porthole.root.visible = p > 0.76 && p < 0.95; if (porthole.root.visible) porthole.breathe(now / 1000); }
    if (debris) debris.update(dt, camera, null);

    // câmera
    camAt(p, cam);
    if (p > 0.36 && p < 0.50) {                                            // órbita lenta de +/-6 graus em volta da pinça
      const a = 6 * DEG * Math.sin((p - 0.36) / 0.14 * Math.PI * 2) * seg(p, 0.36, 0.38) * (1 - seg(p, 0.48, 0.50));
      _v.copy(cam.pos).sub(cam.tgt); const cs = Math.cos(a), sn = Math.sin(a), x = _v.x * cs - _v.z * sn, z = _v.x * sn + _v.z * cs;
      cam.pos.set(cam.tgt.x + x, cam.pos.y, cam.tgt.z + z);
    }
    if (p > 0.64 && p < 0.80) {                                            // retrato: a elipse de 1.7 m não cabe na largura, recua; paisagem: sobra tela, chega perto
      const k = 1 + (camera.aspect < 0.8 ? 0.42 : -0.42) * seg(p, 0.64, 0.71) * (1 - seg(p, 0.74, 0.80));
      cam.pos.sub(cam.tgt).multiplyScalar(k).add(cam.tgt);
    }
    camera.position.copy(cam.pos); camera.lookAt(cam.tgt);
    // os fovH da spec são de retrato; em paisagem o vertical seria minúsculo e cortaria a quina: abre pelo vertical
    const asp = camera.aspect;
    studio.setFovH(asp <= 1 ? cam.fov : 2 * Math.atan(Math.tan(clamp(cam.fov * 1.2, 20, 56) * DEG / 2) * asp) / DEG);

    // UI
    ui.setBeat(key, p);
    ui.showContact(lin(p, 0.88, 1));
    if (key === "suspension") { _v.set(SPR[0], SPR[1] + ys, SPR[2]).project(camera); ui.setTogglePos((1 - (_v.y * 0.5 + 0.5)) * canvas.clientHeight, true); }
    else ui.setTogglePos(0, false);

    studio.render();
  }

  /* ---------------- depuração ---------------- */
  const yk = (window.__yk = { studio, parts: P, spin, heat, qc, sparks, orbit, title, ui, forceP: null, frames: 0, ms: 0, errors: [],
    get p() { return pS; }, get beat() { return curBeat; }, info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, textures: renderer.info.memory.textures, geos: renderer.info.memory.geometries, omega: spin.omega, maxT: heat.maxT, yu: qc.state.yu, L: qc.L(), sparks: sparks.count }) });

  yk.replay = startIntro;
  yk.advance = (sec) => { for (let t = 0; t < sec; t += 1 / 60) frame(1 / 60, performance.now()); };   // conferência: o Chrome ocluído roda a 1 fps

  /* ---------------- primeira pose, loader, laço ---------------- */
  if (REDUCED || Q.has("nointro")) { qc.settle(null); spin.omega = SIM.spin.omegaIdle; intro.x = 0; }
  else { spin.omega = SIM.spin.omegaHero; qc.drop(SIM.quarterCar.drop); }
  placeTitle("hero");
  frame(1 / 240, performance.now());                          // um quadro para a câmera e as peças estarem no lugar sob a cortina
  const wait = Math.max(0, 1600 - (performance.now() - tStart));
  await new Promise((r) => setTimeout(r, Q.has("nointro") ? 0 : wait));
  loader.setProgress(1);

  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    if (!running || document.hidden) { last = now; return; }
    const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000)); last = now;
    const t0 = performance.now();
    try { frame(dt, now); } catch (err) { if (yk.errors.length < 5) { yk.errors.push(String(err && err.stack || err)); console.error(err); } }
    yk.frames++; yk.ms += (performance.now() - t0 - yk.ms) * 0.05;
  });

  const calTarget = () => {
    _v.set(CAL[0], CAL[1] + qc.state.yu, CAL[2]).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (_v.x * 0.5 + 0.5) * r.width, y: r.top + (1 - (_v.y * 0.5 + 0.5)) * r.height };
  };
  const opened = loader.openIris(calTarget);
  ui.reveal();
  if (!REDUCED && !Q.has("nointro")) startIntro();
  await opened;
}

main().catch((e) => {
  console.error(e);
  (window.__yk = window.__yk || {}).fatal = String(e && e.stack || e);
  try { document.documentElement.classList.remove("v3-loading"); mountFallback(document.body, "nowebgl"); } catch {}
});
