/* Kit de freio grande, modelado em código. Escala real (metros). Eixo do disco: Z; a face de fora olha para +Z.
   Disco ventilado de duas peças, 380 x 34 mm, furado; chapéu de alumínio anodizado; pinça monobloco de 6 pistões.
   Sem nenhuma marca escrita. Exemplo de referência para as outras peças: mesmo contrato, mesmo kit. */
import { materials, ringWithHoles, chamferCyl, hexPrism, ringOf, lathe } from "./kit.js";

export function build(THREE, opts = {}) {
  const M = materials(THREE), g = new THREE.Group(); g.name = "brake";
  const R = 0.190, RI = 0.122, PLATE = 0.008, GAP = 0.018;                 // raio externo, raio interno da pista, espessura de cada prato, vão das aletas
  const zP = GAP / 2 + PLATE / 2;                                           // centro de cada prato em Z

  /* ---- disco: dois pratos furados + aletas ---- */
  const rotor = new THREE.Group(); rotor.name = "rotor"; g.add(rotor);
  const holes = [];
  for (let k = 0; k < 12; k++) for (let j = 0; j < 4; j++) {               // 12 fileiras curvas de 4 furos
    holes.push({ r: 0.134 + j * 0.0145, a: (k / 12) * Math.PI * 2 + j * 0.115, d: 0.0062 });
  }
  const plateGeo = ringWithHoles(THREE, { rOuter: R, rInner: RI, depth: PLATE, holes, bevel: 0.0007 });
  const outer = new THREE.Mesh(plateGeo, M.steelTurned); outer.position.z = zP; rotor.add(outer);
  const inner = new THREE.Mesh(plateGeo, M.steelTurned); inner.position.z = -zP; rotor.add(inner);
  // aletas curvas entre os pratos (48), ferro fundido
  const vane = new THREE.BoxGeometry(R - RI - 0.006, 0.0042, GAP);
  rotor.add(ringOf(THREE, vane, M.castIron, 48, (R + RI) / 2, { orient: (m, a) => { m.rotation.z = a + 0.32; } }));
  // anel interno que fecha a garganta das aletas
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(RI + 0.001, RI + 0.001, GAP + 2 * PLATE, 96, 1, true), M.castIron);
  throat.rotation.x = Math.PI / 2; throat.material = M.castIron.clone(); throat.material.side = THREE.DoubleSide; rotor.add(throat);

  /* ---- chapéu (sino) de alumínio anodizado, parafusado na pista ---- */
  const hat = new THREE.Group(); hat.name = "hat"; rotor.add(hat);
  const t = 0.006;                                                          // espessura da chapa do sino
  const bell = lathe(THREE, [
    [0.142, 0.000], [0.142, t], [0.116, t], [0.092, 0.040], [0.092, 0.046], [0.0365, 0.046],          // por fora, subindo até o furo central
    [0.0365, 0.046 - t], [0.086, 0.046 - t], [0.086, 0.040 - 0.001], [0.110, 0.000], [0.142, 0.000],  // por dentro, voltando
  ], 120);
  const bellMesh = new THREE.Mesh(bell, M.anodBlack); bellMesh.rotation.x = Math.PI / 2; bellMesh.position.z = zP + PLATE / 2 - 0.001; hat.add(bellMesh);
  const zFlange = zP + PLATE / 2 + t, zFace = zP + PLATE / 2 + 0.046;
  const bolt = hexPrism(THREE, 0.011, 0.0055); bolt.rotateX(Math.PI / 2);
  hat.add(ringOf(THREE, bolt, M.steel, 10, 0.129, { z: zFlange + 0.0022, start: 0.2 }));
  // 5 furos de roda (5x115) e rebaixo central: discos pretos rentes à face, sem luz
  const dark = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const lug = new THREE.CircleGeometry(0.0078, 32);
  hat.add(ringOf(THREE, lug, dark, 5, 0.0575, { z: zFace + 0.0003, start: Math.PI / 2 }));
  const hubRing = new THREE.Mesh(chamferCyl(THREE, 0.047, 0.004, 0.001), M.steel); hubRing.rotation.x = Math.PI / 2; hubRing.position.z = zFace - 0.001; hat.add(hubRing);
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.0355, 48), dark); bore.position.z = zFace + 0.0012; hat.add(bore);

  /* ---- pinça monobloco: duas metades em setor de coroa + ponte ---- */
  const cal = new THREE.Group(); cal.name = "caliper"; g.add(cal);
  const HALF = 0.58, r1 = 0.112, r2 = 0.198;                                // meia abertura (rad), raios do corpo
  const sector = (ra, rb, half) => { const s = new THREE.Shape(); s.absarc(0, 0, rb, -half, half, false); s.absarc(0, 0, ra, half, -half, true); s.closePath(); return s; };
  const bodyOpt = { depth: 0.030, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 4, curveSegments: 48 };
  const halfGeo = new THREE.ExtrudeGeometry(sector(r1, r2, HALF), bodyOpt);
  const zIn = GAP / 2 + PLATE + 0.006;                                      // face interna da metade, logo depois da pastilha
  const out = new THREE.Mesh(halfGeo, M.redPaint); out.position.z = zIn + 0.004; cal.add(out);
  const inn = new THREE.Mesh(halfGeo, M.redPaint); inn.position.z = -(zIn + 0.004) - 0.030; cal.add(inn);
  // ponte por cima da borda do disco, com janela central (dois braços)
  const bridgeLen = 2 * (zIn + 0.004 + 0.030);
  for (const [a0, a1] of [[-HALF, -0.20], [0.20, HALF]]) {
    const s = new THREE.Shape(); s.absarc(0, 0, r2 + 0.016, a0, a1, false); s.absarc(0, 0, r2 - 0.012, a1, a0, true); s.closePath();
    const b = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: bridgeLen - 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 3, curveSegments: 24 }), M.redPaint);
    b.position.z = -(bridgeLen - 0.008) / 2; cal.add(b);
  }
  // tampas dos pistões (3 por lado, diâmetros escalonados) e nervura central
  const zOut = zIn + 0.004 + 0.030 + 0.004;
  [[-0.36, 0.0185], [0, 0.0165], [0.36, 0.0145]].forEach(([a, r]) => {
    for (const side of [1, -1]) {
      const cap = new THREE.Mesh(chamferCyl(THREE, r, 0.007, 0.0018, 40), M.redPaint);
      cap.rotation.x = Math.PI / 2; cap.position.set(Math.cos(a) * 0.156, Math.sin(a) * 0.156, side * (zOut + 0.002)); cal.add(cap);
    }
  });
  // pastilhas: a borda escura aparece entre a pinça e o disco
  const padGeo = new THREE.ExtrudeGeometry(sector(0.126, 0.188, 0.44), { depth: 0.005, bevelEnabled: false, curveSegments: 32 });
  for (const side of [1, -1]) { const p = new THREE.Mesh(padGeo, M.pad); p.position.z = side > 0 ? GAP / 2 + PLATE + 0.0008 : -(GAP / 2 + PLATE + 0.0008) - 0.005; cal.add(p); }
  // sangradores e parafusos da ponte
  const nip = chamferCyl(THREE, 0.0032, 0.014, 0.0008, 16);
  for (const side of [1, -1]) {
    const n = new THREE.Mesh(nip, M.steel); n.position.set(Math.cos(HALF - 0.05) * (r2 + 0.004), Math.sin(HALF - 0.05) * (r2 + 0.004), side * (zIn + 0.02)); n.rotation.z = HALF - 0.05 - Math.PI / 2; cal.add(n);
  }
  const pin = chamferCyl(THREE, 0.0045, bridgeLen + 0.006, 0.001, 20);
  for (const a of [-0.12, 0.12]) { const p = new THREE.Mesh(pin, M.steel); p.rotation.x = Math.PI / 2; p.position.set(Math.cos(a) * (r2 - 0.022), Math.sin(a) * (r2 - 0.022), 0); cal.add(p); }
  cal.rotation.z = opts.caliperAngle != null ? +opts.caliperAngle : 0.35;   // posição da pinça no disco

  g.userData.parts = { rotor, hat, caliper: cal };
  /** t 0..1: o disco gira (a pinça fica) */
  g.userData.update = (t, dt = 0.016) => { rotor.rotation.z -= dt * 1.2; };
  return g;
}
