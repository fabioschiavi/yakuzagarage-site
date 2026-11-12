import * as THREE from "three";
import { createStudio } from "../v3/studio.js";
import { createMaterials } from "../v3/materials.js";
import { createTextures } from "../v3/textures.js";
import { buildWheel } from "../v3/parts/wheel.js";
import { buildTyre } from "../v3/parts/tyre.js";
import { buildHub } from "../v3/parts/hub.js";
import { buildRotor } from "../v3/parts/rotor.js";
import { buildCaliper } from "../v3/parts/caliper.js";
import { buildCoilover } from "../v3/parts/coilover.js";

const LUGS = 5;
const FRAMING = {
  fitment: { angle: .27, distance: 2.18 },
  brakes: { angle: -.2, distance: 2.08 },
  suspension: { angle: .42, distance: 2.40 },
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function buildAssembly(name, context) {
  const root = new THREE.Group();
  let separate;
  let ready;
  let center;
  let size;

  if (name === "fitment") {
    const wheel = buildWheel(context);
    const tyre = buildTyre(context);
    const hub = buildHub(context);
    root.add(tyre.root, wheel.root, hub.root);
    center = tyre.anchors.center;
    size = tyre.anchors.top.y * 2;
    wheel.setSwirl(0);
    ready = wheel.ready;
    separate = (spread) => {
      tyre.root.position.x = -.19 * spread;
      wheel.root.position.x = .06 * spread;
      hub.root.position.x = -.36 * spread;
      hub.setSpacer(spread);
      for (let index = 0; index < LUGS; index++) wheel.setLug(index, 1.4 * spread, .09 * spread);
    };
  } else if (name === "brakes") {
    const rotor = buildRotor(context);
    const caliper = buildCaliper(context);
    root.add(rotor.root, caliper.root);
    separate = (spread) => {
      rotor.setHatLift(.08 * spread);
      caliper.root.position.copy(caliper.explodeAxis).multiplyScalar(.12 * spread);
      caliper.setSplit(.036 * spread);
      caliper.setPistons(spread);
      caliper.setPads(spread);
    };
  } else {
    const coilover = buildCoilover(context);
    root.add(coilover.root);
    separate = (spread) => {
      coilover.setTopLift(.15 * spread);
      coilover.setCollarTurns(2.25 * spread);
    };
  }

  if (!center) {
    const bounds = new THREE.Box3().setFromObject(root);
    center = bounds.getCenter(new THREE.Vector3());
    const dimensions = bounds.getSize(new THREE.Vector3());
    size = Math.max(dimensions.x, dimensions.y, dimensions.z);
  }
  root.position.copy(center).negate();
  return { root, separate, ready, size };
}

export function createWorkbench(canvas, { reduced, onLost }) {
  const studio = createStudio(canvas, { tier: "low", transparent: true });
  const { renderer, scene, camera, envTex } = studio;
  renderer.toneMappingExposure *= 1.18;
  const rim = new THREE.DirectionalLight(0xff4f35, 1.6);
  rim.position.set(-.8, .2, -.6);
  scene.add(rim);

  const materials = { envTex, tex: createTextures(null, { envTex }), tier: "low" };
  const context = { ...materials, mats: createMaterials(materials), THREE };
  const pivot = new THREE.Group();
  scene.add(pivot);
  const cache = new Map();
  let current;
  let partName;
  let raf = 0;
  let enabled = false;
  let alive = true;
  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let spread = 0;
  let targetSpread = 0;
  let lastTime = 0;
  let drag = null;

  function invalidate() {
    if (enabled && alive && current && !raf) raf = requestAnimationFrame(draw);
  }

  function draw(now) {
    raf = 0;
    if (!enabled || !alive || !current) return;
    const dt = lastTime ? Math.min(now - lastTime, 50) : 16;
    lastTime = now;
    const damping = reduced.matches ? 1 : 1 - Math.exp(-dt / 65);
    yaw += (targetYaw - yaw) * damping;
    pitch += (targetPitch - pitch) * damping;
    spread += (targetSpread - spread) * damping;
    current.separate(spread);

    const framing = FRAMING[partName];
    pivot.rotation.set(pitch, yaw + framing.angle + spread * .42, 0);
    const distance = current.size * (framing.distance + .52 * spread) * Math.max(1, 1.12 / camera.aspect);
    camera.position.set(distance * .94, distance * .17, distance * .34);
    camera.lookAt(0, .04 * spread, 0);
    studio.render();
    if (Math.abs(targetYaw - yaw) + Math.abs(targetPitch - pitch) + Math.abs(targetSpread - spread) > .002) invalidate();
  }

  function select(name) {
    if (!alive || partName === name) return;
    if (!cache.has(name)) {
      const assembly = buildAssembly(name, context);
      cache.set(name, assembly);
      assembly.ready?.then(invalidate);
    }
    const entering = Boolean(current) && enabled && !reduced.matches;
    if (current) pivot.remove(current.root);
    partName = name;
    current = cache.get(name);
    pivot.add(current.root);
    spread = targetSpread = 0;
    yaw = entering ? -.38 : 0;
    targetYaw = 0;
    pitch = targetPitch = 0;
    invalidate();
  }

  function resize() {
    if (!alive) return;
    studio.setDPR(Math.min(devicePixelRatio || 1, 1.5));
    camera.fov = 32;
    camera.updateProjectionMatrix();
    invalidate();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== drag?.id) return;
    targetYaw += (event.clientX - drag.x) * .012;
    targetPitch = clamp(targetPitch + (event.clientY - drag.y) * .007, -.55, .55);
    drag.x = event.clientX;
    drag.y = event.clientY;
    invalidate();
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(event, (pointer) => { if (drag?.id === pointer.pointerId) drag = null; });
  }

  const observer = new ResizeObserver(() => {
    studio.resize();
    resize();
  });
  observer.observe(canvas);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    alive = false;
    cancelAnimationFrame(raf);
    observer.disconnect();
    onLost();
  }, { once: true });

  resize();
  return {
    select,
    turn(direction) { targetYaw += direction * Math.PI / 6; invalidate(); },
    explode(open) { targetSpread = open ? 1 : 0; invalidate(); },
    setVisible(visible) { enabled = visible; invalidate(); },
  };
}
