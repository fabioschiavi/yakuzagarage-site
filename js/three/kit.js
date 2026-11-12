/* Kit compartilhado das peças: materiais físicos e receitas de geometria.
   Unidades: metros, escala real. Eixo Y para cima. Uma roda/disco "olha" para +Z (o eixo de rotação é Z).
   Nada aqui carrega arquivo: texturas são desenhadas em canvas. */

const cache = new Map();
const memo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

/* ---------------- texturas de canvas ---------------- */
function canvasTex(THREE, size, paint, { repeat = [1, 1], srgb = false } = {}) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  paint(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Anéis concêntricos finos: face torneada (disco de freio, flanges). Mapear com UV planar centrado. */
export const turnedMap = (THREE) => memo("turned", () => canvasTex(THREE, 1024, (g, s) => {
  g.fillStyle = "#808080"; g.fillRect(0, 0, s, s);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let r = 2; r < s * 0.72; r += 0.9 + rnd() * 1.4) {
    const v = Math.round(128 + (rnd() - 0.5) * 120);
    g.strokeStyle = `rgba(${v},${v},${v},${0.35 + rnd() * 0.5})`; g.lineWidth = 0.6 + rnd() * 1.2;
    g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.stroke();
  }
}));
/** Riscos retos finos: alumínio escovado / anodizado. */
export const brushedMap = (THREE) => memo("brushed", () => canvasTex(THREE, 512, (g, s) => {
  g.fillStyle = "#808080"; g.fillRect(0, 0, s, s);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) {
    const v = Math.round(128 + (rnd() - 0.5) * 110), y = rnd() * s;
    g.strokeStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.4})`; g.lineWidth = 0.5 + rnd();
    g.beginPath(); g.moveTo(rnd() * s, y); g.lineTo(rnd() * s, y + (rnd() - 0.5) * 2); g.stroke();
  }
}));
/** Listras horizontais em dente de serra: rosca (usar como bumpMap com repeat em V). */
export const threadMap = (THREE) => memo("thread", () => canvasTex(THREE, 64, (g, s) => {
  const grad = g.createLinearGradient(0, 0, 0, s);
  grad.addColorStop(0, "#202020"); grad.addColorStop(0.5, "#f0f0f0"); grad.addColorStop(1, "#202020");
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
}));
/** Ruído fino: fundido, borracha, pintura texturizada. */
export const grainMap = (THREE) => memo("grain", () => canvasTex(THREE, 256, (g, s) => {
  const d = g.createImageData(s, s); let seed = 23;
  for (let i = 0; i < d.data.length; i += 4) { seed = (seed * 16807) % 2147483647; const v = 96 + (seed % 64); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0);
}));

/* ---------------- materiais ---------------- */
export function materials(THREE) {
  return memo("mats", () => {
    const P = (o) => new THREE.MeshPhysicalMaterial(o);
    return {
      /** aço torneado (face do disco). Requer UV planar para o turnedMap. */
      steelTurned: P({ color: 0xc6c9cd, metalness: 1, roughness: 0.34, roughnessMap: turnedMap(THREE), bumpMap: turnedMap(THREE), bumpScale: 0.35 }),
      /** aço liso usinado (parafusos, cubos, hastes) */
      steel: P({ color: 0xbfc3c8, metalness: 1, roughness: 0.3 }),
      /** haste cromada do amortecedor, porcas */
      chrome: P({ color: 0xe6e8ea, metalness: 1, roughness: 0.06 }),
      /** ferro fundido escuro (aletas do disco, cubo bruto) */
      castIron: P({ color: 0x2b2c2f, metalness: 0.85, roughness: 0.62, bumpMap: grainMap(THREE), bumpScale: 0.25 }),
      /** alumínio escovado (colares, base do coilover) */
      aluminium: P({ color: 0xcfd2d6, metalness: 1, roughness: 0.3, roughnessMap: brushedMap(THREE) }),
      /** preto anodizado (corpo do amortecedor, chapéu do disco) */
      anodBlack: P({ color: 0x0b0b0d, metalness: 0.9, roughness: 0.36, roughnessMap: brushedMap(THREE) }),
      /** vermelho da oficina: tinta/pó com verniz (pinça, mola) */
      redPaint: P({ color: 0xc20e1b, metalness: 0, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.07 }),
      /** preto brilhante (roda) */
      glossBlack: P({ color: 0x050506, metalness: 0.55, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
      /** borracha (pneu, buchas, coifa) */
      rubber: P({ color: 0x0a0a0b, metalness: 0, roughness: 0.92, bumpMap: grainMap(THREE), bumpScale: 0.15 }),
      /** pastilha de freio */
      pad: P({ color: 0x1a1816, metalness: 0.1, roughness: 0.95, bumpMap: grainMap(THREE), bumpScale: 0.4 }),
    };
  });
}

/* ---------------- geometria ---------------- */
/** Sólido de revolução a partir de um perfil [[raio, y], ...] (de baixo para cima). */
export function lathe(THREE, profile, segments = 96) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.00001), y)), segments);
  g.computeVertexNormals();
  return g;
}
/** Coroa circular extrudada em Z com furos passantes reais.
    holes: [{ r: distância do centro, a: ângulo (rad), d: diâmetro }]. Devolve geometria centrada em Z, com UV planar 0..1 no disco. */
export function ringWithHoles(THREE, { rOuter, rInner = 0, depth, holes = [], bevel = 0, segments = 144, holeSegments = 10 }) {
  // contornos como polilinhas (muitos pontos fora, poucos em cada furo): o ExtrudeGeometry usaria o mesmo número em todos os arcos
  const circle = (r, n, cx = 0, cy = 0, cw = false) => Array.from({ length: n }, (_, i) => { const a = ((cw ? -i : i) / n) * Math.PI * 2; return new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r); });
  const shape = new THREE.Shape(circle(rOuter, segments));
  if (rInner > 0) shape.holes.push(new THREE.Path(circle(rInner, Math.round(segments * 0.7), 0, 0, true)));
  for (const { r, a, d } of holes) shape.holes.push(new THREE.Path(circle(d / 2, holeSegments, Math.cos(a) * r, Math.sin(a) * r, true)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  planarUV(THREE, g, rOuter);
  return g;
}
/** UV planar em XY, 0..1 através de um disco de raio r (para o turnedMap). */
export function planarUV(THREE, g, r) {
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / (2 * r) + 0.5; uv[i * 2 + 1] = p.getY(i) / (2 * r) + 0.5; }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}
/** Mola helicoidal de verdade: eixo em Y, pontas fechadas e retificadas (o passo cai a zero nas extremidades).
    length: altura livre · radius: raio médio · wire: diâmetro do arame · turns: espiras ativas + mortas. */
export function helixCurve(THREE, { radius, length, turns, closed = 1.25 }) {
  class Helix extends THREE.Curve {
    getPoint(t, out = new THREE.Vector3()) {
      const ang = t * turns * Math.PI * 2;
      // passo variável: plano nas pontas (espiras mortas), constante no meio
      const e = closed / turns, s = (x) => x * x * (3 - 2 * x);
      const y = t < e ? (s(t / e) * e) / 2 : t > 1 - e ? 1 - (s((1 - t) / e) * e) / 2 : e / 2 + ((t - e) / (1 - 2 * e)) * (1 - e);
      return out.set(Math.cos(ang) * radius, (y - 0.5) * length, Math.sin(ang) * radius);
    }
  }
  return new Helix();
}
export function spring(THREE, { radius, length, turns, wire, closed = 1.25, tubular = 420, radial = 14 }) {
  return new THREE.TubeGeometry(helixCurve(THREE, { radius, length: length - wire, turns, closed }), tubular, wire / 2, radial, false);
}
/** Cilindro com as arestas chanfradas (perfil de torno). Eixo em Y, centrado. */
export function chamferCyl(THREE, r, h, c = 0.0015, segments = 64) {
  return lathe(THREE, [[0, -h / 2], [r - c, -h / 2], [r, -h / 2 + c], [r, h / 2 - c], [r - c, h / 2], [0, h / 2]], segments);
}
/** Prisma hexagonal chanfrado (porca, cabeça de parafuso). af = distância entre faces. Eixo em Y. */
export function hexPrism(THREE, af, h, c = 0.0008) {
  const r = af / Math.sqrt(3), s = new THREE.Shape();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; s[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r); }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2); g.translate(0, -(h - 2 * c) / 2, 0);
  return g;
}
/** Malha instanciada num círculo (parafusos de um flange, furos falsos, etc.). Eixo do círculo: Z. */
export function ringOf(THREE, geometry, material, count, radius, { z = 0, start = 0, orient = (m, a) => {} } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, count), m = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = start + (i / count) * Math.PI * 2;
    m.position.set(Math.cos(a) * radius, Math.sin(a) * radius, z); m.rotation.set(0, 0, 0); orient(m, a); m.updateMatrix();
    mesh.setMatrixAt(i, m.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
