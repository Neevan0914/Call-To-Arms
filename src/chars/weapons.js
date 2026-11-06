import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'Varn M.09 Rifle', short: 'RIFLE', mag: 5, fireInterval: 1.15, damage: 100, auto: false,
    reload: 2.8, spreadHip: 0.03, spreadAim: 0.0015, recoil: 0.045, sound: 'rifle',
  },
  lmg: {
    id: 'lmg', name: 'Rkm M28 Automatic Rifle', short: 'RKM M28', mag: 20, fireInterval: 0.105, damage: 46, auto: true,
    reload: 3.3, spreadHip: 0.045, spreadAim: 0.008, recoil: 0.014, sound: 'lmg',
  },
  sword: { id: 'sword', name: 'Cavalry Sabre', short: 'SABRE', melee: true, damage: 55, range: 2.5, swing: 0.6 },
};

let MATS = null;
export function weaponMaterials(T) {
  if (MATS) return MATS;
  const wood = T.wood.clone(); wood.needsUpdate = true; wood.repeat.set(3, 1);
  MATS = {
    wood: new THREE.MeshStandardMaterial({ map: wood, color: 0x8a5a36, roughness: 0.5, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.38, metalness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.16, metalness: 1 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb48c4c, roughness: 0.3, metalness: 1 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.7, metalness: 0 }),
  };
  return MATS;
}

class Parts {
  constructor() { this.map = new Map(); }
  add(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
  }
  build() {
    const g = new THREE.Group();
    for (const [mat, list] of this.map) {
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }
}

// Shape (in X=length, Y=height) extruded across X-thickness, then oriented so length runs along +Z.
function profile(points, thickness, bevel = 0.005) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else s.lineTo(p[0], p[1]);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(-Math.PI / 2);
  // uv: along length
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) * 2, p.getY(i) * 4 + p.getX(i) * 3);
  return g;
}

const cylZ = (r1, r2, len, seg = 10) => { const g = new THREE.CylinderGeometry(r1, r2, len, seg); g.rotateX(Math.PI / 2); return g; };
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

// Optional glTF weapon models (stock at origin, barrel along +X). When present they
// replace the procedural rifles; grip points were measured on the models.
const ASSETS = { rifle: null, lmg: null, sabre: null, scabbard: null };
export function setWeaponAssets(a) { for (const k of Object.keys(ASSETS)) ASSETS[k] = a[k] || null; }

function fromAsset(src) {
  const g = new THREE.Group();
  const m = src.clone(true);
  m.rotation.y = -Math.PI / 2; // +X (barrel) -> +Z (forward)
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.add(m);
  return g;
}

export function buildRifle(T, { bayonet = false } = {}) {
  if (ASSETS.rifle) {
    const g = fromAsset(ASSETS.rifle);
    if (bayonet) {
      const M = weaponMaterials(T);
      const P = new Parts();
      P.add(M.steel, box(0.004, 0.022, 0.38), 0, -0.012, 1.27);
      P.add(M.metal, box(0.02, 0.035, 0.05), 0, -0.006, 1.09);
      g.add(P.build());
    }
    g.userData = {
      gripR: new THREE.Vector3(0, -0.045, 0.33), gripL: new THREE.Vector3(0, -0.018, 0.66),
      muzzle: new THREE.Vector3(0, 0.007, 1.1), type: 'rifle',
    };
    return g;
  }
  const M = weaponMaterials(T);
  const P = new Parts();
  P.add(M.wood, profile([
    [0, -0.075], [0, 0.04], [0.08, 0.045], [0.2, 0.03, 0.27, 0.012], [0.34, 0.015], [0.95, 0.008], [0.97, -0.004],
    [0.95, -0.03], [0.42, -0.034], [0.34, -0.048], [0.29, -0.06, 0.25, -0.044], [0.12, -0.05, 0, -0.075],
  ], 0.042));
  P.add(M.wood, box(0.036, 0.022, 0.42), 0, 0.034, 0.66); // upper handguard
  P.add(M.metal, box(0.046, 0.15, 0.012), 0, -0.016, 0.004); // butt plate
  P.add(M.metal, cylZ(0.011, 0.012, 0.9), 0, 0.022, 0.78); // barrel
  P.add(M.metal, cylZ(0.019, 0.019, 0.2), 0, 0.022, 0.38); // receiver
  P.add(M.metal, cylZ(0.009, 0.009, 0.12), -0.014, 0.034, 0.36); // bolt body
  P.add(M.metal, new THREE.CylinderGeometry(0.005, 0.005, 0.07, 6), -0.045, 0.02, 0.33, 0, 0, 1.2); // bolt handle
  P.add(M.metal, new THREE.SphereGeometry(0.011, 8, 6), -0.075, 0.006, 0.33); // knob
  P.add(M.metal, new THREE.TorusGeometry(0.022, 0.004, 6, 12, Math.PI), 0, -0.035, 0.31, 0, Math.PI / 2, Math.PI); // trigger guard
  P.add(M.metal, box(0.006, 0.025, 0.008), 0, -0.04, 0.31);
  P.add(M.metal, box(0.03, 0.012, 0.09), 0, -0.04, 0.37); // floorplate
  for (const z of [0.6, 0.9]) P.add(M.metal, cylZ(0.024, 0.024, 0.014), 0, 0.012, z);
  P.add(M.metal, box(0.008, 0.02, 0.012), 0, 0.044, 1.2); // front sight
  P.add(M.metal, box(0.03, 0.014, 0.05), 0, 0.045, 0.49); // rear sight
  P.add(M.metal, new THREE.TorusGeometry(0.012, 0.003, 4, 8), 0, -0.04, 0.12, 0, Math.PI / 2, 0); // sling swivel
  if (bayonet) {
    P.add(M.steel, box(0.004, 0.022, 0.4), 0, -0.005, 1.4);
    P.add(M.metal, box(0.02, 0.04, 0.04), 0, 0.0, 1.2);
  }
  const g = P.build();
  g.userData = {
    gripR: new THREE.Vector3(0, -0.035, 0.27), gripL: new THREE.Vector3(0, -0.02, 0.56),
    muzzle: new THREE.Vector3(0, 0.022, bayonet ? 1.24 : 1.235), type: 'rifle',
  };
  return g;
}

// Automatic rifle styled after the interwar Rkm wz.28 / BAR family.
export function buildLMG(T) {
  if (ASSETS.lmg) {
    const g = fromAsset(ASSETS.lmg);
    g.userData = {
      gripR: new THREE.Vector3(0, -0.1, 0.37), gripL: new THREE.Vector3(0, -0.035, 0.72),
      muzzle: new THREE.Vector3(0, 0.0, 1.1), type: 'lmg',
    };
    return g;
  }
  const M = weaponMaterials(T);
  const P = new Parts();
  // butt stock
  P.add(M.wood, profile([[0, -0.085], [0, 0.04], [0.06, 0.042], [0.31, 0.022], [0.31, -0.03], [0.18, -0.045, 0, -0.085]], 0.045));
  P.add(M.metal, box(0.05, 0.13, 0.012), 0, -0.022, 0.004); // butt plate
  // receiver
  P.add(M.metal, box(0.052, 0.07, 0.36), 0, 0.0, 0.48);
  P.add(M.metal, box(0.04, 0.02, 0.3), 0, 0.044, 0.47); // top rail
  P.add(M.metal, box(0.004, 0.026, 0.07), -0.027, 0.006, 0.5); // ejection port cover
  P.add(M.metal, cylZ(0.006, 0.006, 0.05), 0.034, -0.005, 0.6); // cocking handle
  P.add(M.metal, box(0.034, 0.03, 0.045), 0, 0.064, 0.34); // rear sight base
  P.add(M.metal, box(0.006, 0.03, 0.012), 0, 0.09, 0.34);
  // pistol grip
  P.add(M.wood, profile([[0, 0], [0.055, 0], [0.025, -0.115], [-0.022, -0.105]], 0.034, 0.004), 0, -0.035, 0.33, 0, 0, 0);
  P.add(M.metal, new THREE.TorusGeometry(0.026, 0.0045, 6, 12, Math.PI), 0, -0.035, 0.405, 0, Math.PI / 2, Math.PI); // trigger guard
  P.add(M.metal, box(0.006, 0.025, 0.008), 0, -0.045, 0.405);
  // magazine (box, from below)
  P.add(M.metal, box(0.032, 0.16, 0.078), 0, -0.11, 0.53, 0.06, 0, 0);
  P.add(M.metal, box(0.036, 0.012, 0.084), 0, -0.19, 0.535, 0.06, 0, 0);
  // forend / handguard
  P.add(M.wood, profile([[0, -0.03], [0, 0.025], [0.27, 0.02], [0.28, -0.0], [0.26, -0.035]], 0.05), 0, 0.0, 0.66);
  // gas cylinder + barrel
  P.add(M.metal, cylZ(0.012, 0.012, 0.36), 0, -0.032, 0.86);
  P.add(M.metal, cylZ(0.015, 0.016, 0.62), 0, 0.012, 0.97);
  P.add(M.metal, box(0.034, 0.05, 0.03), 0, -0.012, 1.06); // gas block
  // flash hider
  P.add(M.metal, cylZ(0.022, 0.02, 0.08), 0, 0.012, 1.31);
  P.add(M.metal, box(0.006, 0.03, 0.012), 0, 0.04, 1.2); // front sight
  // bipod (folded forward, legs splayed slightly)
  P.add(M.metal, cylZ(0.02, 0.02, 0.03), 0, 0.012, 1.14);
  for (const s of [-1, 1]) {
    P.add(M.metal, new THREE.CylinderGeometry(0.0055, 0.0055, 0.32, 6), s * 0.022, -0.035, 0.99, 1.45, 0, s * 0.06);
    P.add(M.metal, new THREE.ConeGeometry(0.012, 0.03, 6), s * 0.028, -0.05, 0.83, -1.6, 0, 0);
  }
  // sling swivels
  P.add(M.metal, new THREE.TorusGeometry(0.012, 0.003, 4, 8), 0, -0.065, 0.14, 0, Math.PI / 2, 0);
  P.add(M.metal, new THREE.TorusGeometry(0.012, 0.003, 4, 8), 0, -0.055, 0.9, 0, Math.PI / 2, 0);
  const g = P.build();
  g.userData = {
    gripR: new THREE.Vector3(0, -0.075, 0.355), gripL: new THREE.Vector3(0, -0.025, 0.72),
    muzzle: new THREE.Vector3(0, 0.012, 1.35), type: 'lmg',
  };
  return g;
}

export function buildSword(T) {
  if (ASSETS.sabre) {
    // asset frame: blade along +X, edge down (-Y), guard at the origin, grip along -X
    const g = fromAsset(ASSETS.sabre);
    g.userData = { gripR: new THREE.Vector3(0, -0.005, -0.075), tip: new THREE.Vector3(0, 0.03, 0.83), type: 'sword' };
    return g;
  }
  const M = weaponMaterials(T);
  const P = new Parts();
  // curved blade: X = length, Y = width; back on +y, edge on -y
  const L = 0.84, pts = [];
  const curve = (x) => 0.06 * Math.pow(x / L, 2);
  for (let i = 0; i <= 12; i++) { const x = (i / 12) * L; pts.push([x, 0.013 + curve(x)]); }
  pts.push([L + 0.035, curve(L) + 0.01]);
  for (let i = 12; i >= 0; i--) { const x = (i / 12) * L; const w = 0.032 * (1 - (x / L) * 0.35); pts.push([x, 0.013 + curve(x) - w]); }
  P.add(M.steel, profile(pts, 0.0045, 0.0015), 0, 0, 0.0);
  // guard + knuckle bow
  P.add(M.brass, box(0.012, 0.075, 0.012), 0, -0.012, 0.0);
  P.add(M.brass, new THREE.TorusGeometry(0.06, 0.005, 6, 16, Math.PI * 0.95), 0, -0.04, -0.055, 0, Math.PI / 2, Math.PI * 0.5);
  // grip
  P.add(M.leather, cylZ(0.016, 0.014, 0.11, 8), 0, 0, -0.06);
  for (let i = 0; i < 6; i++) P.add(M.brass, cylZ(0.0168, 0.0168, 0.004, 8), 0, 0, -0.012 - i * 0.018);
  P.add(M.brass, new THREE.SphereGeometry(0.019, 8, 6), 0, 0, -0.122, 0, 0, 0, 1, 1, 1.3); // pommel
  const g = P.build();
  g.userData = { gripR: new THREE.Vector3(0, 0, -0.06), tip: new THREE.Vector3(0, 0.07, 0.86), type: 'sword' };
  return g;
}

export function buildScabbard(T) {
  if (ASSETS.scabbard) return fromAsset(ASSETS.scabbard); // same frame as the sabre: it slides straight in
  const M = weaponMaterials(T);
  const P = new Parts();
  const L = 0.86, pts = [];
  const curve = (x) => 0.06 * Math.pow(x / L, 2);
  for (let i = 0; i <= 12; i++) { const x = (i / 12) * L; pts.push([x, 0.02 + curve(x)]); }
  for (let i = 12; i >= 0; i--) { const x = (i / 12) * L; pts.push([x, 0.02 + curve(x) - 0.048]); }
  P.add(M.metal, profile(pts, 0.016, 0.004));
  P.add(M.brass, box(0.022, 0.06, 0.02), 0, 0.0, 0.02);
  P.add(M.brass, box(0.022, 0.05, 0.03), 0, 0.03, 0.84);
  return P.build();
}
