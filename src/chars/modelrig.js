import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakedMeshes } from '../core/assets.js';
import { BONE_NAMES } from './humanoid.js';

// Runtime auto-rigging for the static soldier models.
// The models arrive without a skeleton, so each vertex is skinned to the game's procedural
// skeleton (the one the animation code already drives) in the models' bind pose:
//  - primary bone = nearest bone capsule among the bones allowed for that material
//    (so e.g. sleeves never stick to the torso and puttees never follow a hand)
//  - smooth blending only with bones adjacent to the primary (elbows, knees, shoulders)
// The result is shared geometry; every soldier gets SkinnedMeshes bound to its own bones.

const TORSO = ['hips', 'spine', 'chest'];
const LEGS = ['thL', 'knL', 'ftL', 'thR', 'knR', 'ftR'];
const ALLOW = {
  tunic: ['hips', 'spine', 'chest', 'neck', 'shL', 'elL', 'shR', 'elR'],
  trousers: ['hips', 'spine', 'thL', 'knL', 'thR', 'knR'],
  puttee: LEGS, boot: LEGS, sole: LEGS,
  skin: ['head', 'neck', 'chest', 'elL', 'handL', 'elR', 'handR'],
  hair: ['head', 'neck'], eye: ['head'], iris: ['head'], helmet: ['head'],
  leather: [...TORSO, 'neck', 'head'], steel: [...TORSO, 'neck', 'head'], brass: [...TORSO, 'neck', 'head'],
  canvas: TORSO, blanket: TORSO, wood: TORSO,
};
const ADJ = {
  hips: ['spine', 'thL', 'thR'], spine: ['hips', 'chest'], chest: ['spine', 'neck', 'shL', 'shR'], neck: ['chest', 'head'], head: ['neck'],
  shL: ['chest', 'elL'], elL: ['shL', 'handL'], handL: ['elL'], shR: ['chest', 'elR'], elR: ['shR', 'handR'], handR: ['elR'],
  thL: ['hips', 'knL'], knL: ['thL', 'ftL'], ftL: ['knL'], thR: ['hips', 'knR'], knR: ['thR', 'ftR'], ftR: ['knR'],
};
const RADIUS = { neck: 0.06, head: 0.1, shL: 0.06, elL: 0.05, handL: 0.04, shR: 0.06, elR: 0.05, handR: 0.04, thL: 0.085, knL: 0.06, ftL: 0.05, thR: 0.085, knR: 0.06, ftR: 0.05 };
const SIGMA = 0.028;

const PLAIN_METAL = /steel|brass/i;
const HELMET = /helmet/i;

function segDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  return { d: Math.hypot(p.x - cx, p.y - cy, p.z - cz), cx, cy, cz };
}

// Split an indexed geometry into triangles below / above a height (any vertex above -> high).
function splitByHeight(g, y) {
  if (!g.index) return [g, null];
  const I = g.index.array, P = g.attributes.position;
  const lo = [], hi = [];
  for (let t = 0; t < I.length; t += 3) {
    const up = P.getY(I[t]) > y && P.getY(I[t + 1]) > y && P.getY(I[t + 2]) > y;
    (up ? hi : lo).push(I[t], I[t + 1], I[t + 2]);
  }
  const mk = (list) => { if (!list.length) return null; const c = g.clone(); c.setIndex(list); return c; };
  return [mk(lo), mk(hi)];
}

// Build the shared skinned geometry for one soldier model (+ its LOD).
// `H` is a Humanoid instance used only for its bind-pose bones.
export function buildSoldierTemplate(lodScenes, H) {
  H.root.position.set(0, 0, 0);
  H.root.rotation.set(0, 0, 0);
  H.setBindPose();
  H.root.updateMatrixWorld(true);
  const bones = BONE_NAMES.map((n) => H[n]);
  const boneInverses = bones.map((b) => b.matrixWorld.clone().invert());
  const wp = (b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  const P = {}; BONE_NAMES.forEach((n) => { P[n] = wp(H[n]); });
  const handTip = (n) => { const d = new THREE.Vector3(0, -1, 0).transformDirection(H[n].matrixWorld); return P[n].clone().addScaledVector(d, 0.12); };
  const SEG = {
    hips: [P.hips.clone().add(new THREE.Vector3(0, -0.06, 0)), P.spine],
    spine: [P.spine, P.chest],
    chest: [P.chest, P.neck],
    neck: [P.neck, P.head.clone().add(new THREE.Vector3(0, -0.07, 0.02))],
    head: [P.head.clone().add(new THREE.Vector3(0, -0.07, 0.02)), P.head.clone().add(new THREE.Vector3(0, 0.1, 0))],
    shL: [P.shL, P.elL], elL: [P.elL, P.handL], handL: [P.handL, handTip('handL')],
    shR: [P.shR, P.elR], elR: [P.elR, P.handR], handR: [P.handR, handTip('handR')],
    thL: [P.thL, P.knL], knL: [P.knL, P.ftL], ftL: [P.ftL, P.ftL.clone().add(new THREE.Vector3(0, -0.05, 0.16))],
    thR: [P.thR, P.knR], knR: [P.knR, P.ftR], ftR: [P.ftR, P.ftR.clone().add(new THREE.Vector3(0, -0.05, 0.16))],
  };
  const boneIndex = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
  const tmp = new THREE.Vector3();

  // signed distance to a bone "capsule"; the torso is elliptical (wide, shallow)
  const score = (name, p) => {
    const [a, b] = SEG[name];
    const r = segDist(p, a, b);
    if (name === 'hips' || name === 'spine' || name === 'chest') {
      const dx = (p.x - r.cx) / 0.19, dz = (p.z - r.cz - 0.005) / 0.115, dy = (p.y - r.cy) / 0.115;
      return (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) * 0.115;
    }
    return r.d - RADIUS[name];
  };

  const lods = lodScenes.map((sceneRoot) => {
    const meshes = bakedMeshes(sceneRoot);
    const groups = { plain: [], metal: [], helmet: [] };
    const textured = [];
    for (const m of meshes) {
      const matName = (m.material.name || m.name).toLowerCase();
      const key = Object.keys(ALLOW).find((k) => matName.includes(k));
      const allowed = key ? ALLOW[key] : BONE_NAMES;
      const g = m.geometry;
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const pos = g.attributes.position;
      const n = pos.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        tmp.fromBufferAttribute(pos, i);
        let best = allowed[0], bd = Infinity;
        for (const b of allowed) { const d = score(b, tmp); if (d < bd) { bd = d; best = b; } }
        const cand = [[best, 1]];
        for (const nb of ADJ[best]) {
          if (!allowed.includes(nb)) continue;
          const w = Math.exp(-(score(nb, tmp) - bd) / SIGMA);
          if (w > 0.04) cand.push([nb, w]);
        }
        cand.sort((x, y) => y[1] - x[1]);
        const c4 = cand.slice(0, 4);
        const tot = c4.reduce((s, x) => s + x[1], 0);
        c4.forEach(([b, w], k) => { si[i * 4 + k] = boneIndex[b]; sw[i * 4 + k] = w / tot; });
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      const mat = m.material;
      if (mat.map) { textured.push({ geometry: g, material: mat, key: key || 'other' }); continue; }
      // untextured: bake the material color into vertex colors so they can be merged
      const col = mat.color || new THREE.Color(1, 1, 1);
      const ca = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
      if (HELMET.test(matName)) { groups.helmet.push(g); continue; }
      // the helmet's chin strap/fittings live in leather/steel: move anything around the
      // head into the helmet part so it hides together with the helmet
      const [low, high] = /leather|steel|brass/.test(matName) ? splitByHeight(g, 1.5) : [g, null];
      if (high) groups.helmet.push(high);
      if (low) (PLAIN_METAL.test(matName) ? groups.metal : groups.plain).push(low);
    }
    const parts = textured.map((t) => ({ geometry: t.geometry, material: t.material, key: t.key }));
    const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
    const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.75 });
    const helmetMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
    if (groups.plain.length) parts.push({ geometry: mergeGeometries(groups.plain), material: plainMat, key: 'plain' });
    if (groups.metal.length) parts.push({ geometry: mergeGeometries(groups.metal), material: metalMat, key: 'metal' });
    if (groups.helmet.length) parts.push({ geometry: mergeGeometries(groups.helmet), material: helmetMat, key: 'helmet' });
    return parts;
  });
  H.root.updateMatrixWorld(true);
  return { lods, boneInverses, materialCache: new Map() };
}

// Faction tints applied to the uniform's textured cloth.
const TINTS = {
  velmora: null,
  officer: new THREE.Color(0.86, 0.86, 0.8),
  kharzan: new THREE.Color(0.8, 0.92, 1.55),
  kharzanCoat: new THREE.Color(0.72, 0.82, 1.4),
};
const CLOTH = /tunic|trousers/;

export function materialFor(template, part, tintKey) {
  const tint = TINTS[tintKey];
  if (!tint || !CLOTH.test(part.key)) return part.material;
  const k = part.key + '|' + tintKey;
  let m = template.materialCache.get(k);
  if (!m) {
    m = part.material.clone();
    m.color.multiply(tint);
    template.materialCache.set(k, m);
  }
  return m;
}
