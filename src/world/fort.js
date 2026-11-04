import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/noise.js';
import { FORT } from './terrain.js';

// Box geometry with world-scale box-projected UVs (so textures don't stretch).
function boxUV(w, h, d, scale = 1.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ax > 0.5) uv.setXY(i, z / scale, y / scale);
    else if (ay > 0.5) uv.setXY(i, x / scale, z / scale);
    else uv.setXY(i, x / scale, y / scale);
  }
  return g;
}

class Batcher {
  constructor() { this.lists = new Map(); }
  add(geo, mat, matrix) {
    let l = this.lists.get(mat);
    if (!l) { l = []; this.lists.set(mat, l); }
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    l.push(g);
  }
  build(parent, cast = true) {
    for (const [mat, list] of this.lists) {
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.castShadow = cast; m.receiveShadow = true;
      parent.add(m);
    }
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s).clone();
}

export class Fort {
  constructor(scene, terrain, physics, T) {
    this.scene = scene;
    this.terrain = terrain;
    this.physics = physics;
    this.group = new THREE.Group();
    scene.add(this.group);
    const cx = FORT.x, cz = FORT.z, H = FORT.half;
    this.center = new THREE.Vector3(cx, terrain.fortH, cz);
    const y0 = terrain.fortH;
    this.y0 = y0;
    this.uniforms = { uTime: { value: 0 } };
    const rnd = mulberry32(4242);

    const rep = (t, x, y) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(x, y); return c; };
    const mats = {
      plank: new THREE.MeshStandardMaterial({ map: T.wood, normalMap: T.woodN, roughness: 0.85, color: 0xc9b9a0 }),
      logs: new THREE.MeshStandardMaterial({ map: T.logs, normalMap: T.logsN, roughness: 0.9, color: 0xc0ab90 }),
      bark: new THREE.MeshStandardMaterial({ map: rep(T.bark, 1, 3), normalMap: rep(T.barkN, 1, 3), roughness: 0.95, color: 0xa89275 }),
      roof: new THREE.MeshStandardMaterial({ map: T.shingle, normalMap: T.shingleN, roughness: 0.92, color: 0x9a8f86 }),
      sack: new THREE.MeshStandardMaterial({ map: T.sack, normalMap: T.fabricN, roughness: 0.98, color: 0xd8c8a0 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x2c2b29, roughness: 0.5, metalness: 0.7 }),
      stone: new THREE.MeshStandardMaterial({ map: T.rock, normalMap: T.rockN, roughness: 0.9, color: 0xb0aaa0 }),
      canvas: new THREE.MeshStandardMaterial({ map: T.fabric, normalMap: T.fabricN, roughness: 0.95, color: 0x8a8460, side: THREE.DoubleSide }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x331a05, emissive: 0xffa040, emissiveIntensity: 2.5 }),
    };
    this.mats = mats;
    const B = new Batcher();
    const W = (lx, lz) => [cx + lx, cz + lz]; // local -> world xz

    // ---------------- Palisade ----------------
    const logR = 0.22, spacing = 0.42;
    const logs = [];
    this.breachLogIdx = [];
    const addWall = (ax, az, bx, bz, skip) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / spacing);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const lx = ax + (bx - ax) * t, lz = az + (bz - az) * t;
        const s = skip ? skip(lx, lz) : 0;
        if (s === 1) continue;
        const h = 5.0 + rnd() * 0.7;
        logs.push({ lx, lz, h, tilt: (rnd() - 0.5) * 0.05, breach: s === 2 });
      }
    };
    addWall(-H, -H, H, -H); // north
    addWall(-H, H, H, H, (x) => (Math.abs(x) < 3.6 ? 1 : 0)); // south with gate
    addWall(-H, -H, -H, H, (x, z) => (Math.abs(z) < 3.8 ? 2 : 0)); // west (breach later)
    addWall(H, -H, H, H); // east
    const logGeo = new THREE.CylinderGeometry(logR, logR * 1.08, 1, 8, 1);
    logGeo.translate(0, 0.5, 0);
    const tipGeo = new THREE.ConeGeometry(logR, 0.55, 8);
    tipGeo.translate(0, 0.27, 0);
    this.palisade = new THREE.InstancedMesh(logGeo, mats.bark, logs.length);
    this.palisadeTips = new THREE.InstancedMesh(tipGeo, mats.bark, logs.length);
    logs.forEach((l, i) => {
      const [x, z] = W(l.lx, l.lz);
      const gy = terrain.getHeight(x, z) - 0.4;
      this.palisade.setMatrixAt(i, M(x, gy, z, l.tilt, rnd() * 6, l.tilt * 0.5, 1, l.h + 0.4, 1));
      this.palisadeTips.setMatrixAt(i, M(x + l.tilt * 0, gy + l.h + 0.4, z, l.tilt, rnd() * 6, 0));
      if (l.breach) this.breachLogIdx.push(i);
    });
    for (const im of [this.palisade, this.palisadeTips]) {
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.group.add(im);
    }
    // Wall colliders
    const wallH = 5.6, th = 0.6;
    const addBoxL = (x0, z0, x1, z1, h, type = 'wood', tag = null, ybase = y0 - 1) => {
      const [ax, az] = W(Math.min(x0, x1), Math.min(z0, z1));
      const [bx, bz] = W(Math.max(x0, x1), Math.max(z0, z1));
      return physics.addBox(new THREE.Vector3(ax, ybase, az), new THREE.Vector3(bx, y0 + h, bz), type, tag);
    };
    addBoxL(-H - th, -H - th, H + th, -H + th, wallH);
    addBoxL(-H - th, H - th, -3.6, H + th, wallH);
    addBoxL(3.6, H - th, H + th, H + th, wallH);
    addBoxL(H - th, -H, H + th, H, wallH);
    addBoxL(-H - th, -H, -H + th, -3.8, wallH);
    addBoxL(-H - th, 3.8, -H + th, H, wallH);
    addBoxL(-H - th, -3.8, -H + th, 3.8, wallH, 'wood', 'breach');

    // Horizontal braces + walkway (fire step) inside the walls
    const walkY = y0 + 3.0;
    const segs = [
      [-H, -H + 1.1, H, -H + 1.1, 'x'], [-H, H - 1.1, -3.6, H - 1.1, 'x'], [3.6, H - 1.1, H, H - 1.1, 'x'],
      [-H + 1.1, -H, -H + 1.1, H, 'z'], [H - 1.1, -H, H - 1.1, H, 'z'],
    ];
    for (const [ax, az, bx, bz, axis] of segs) {
      const len = Math.hypot(bx - ax, bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const [wx, wz] = W(mx, mz);
      const ry = axis === 'x' ? 0 : Math.PI / 2;
      B.add(boxUV(len, 0.12, 1.5), mats.plank, M(wx, walkY, wz, 0, ry, 0));
      // braces on the wall
      for (const by of [1.3, 3.9]) {
        const [bwx, bwz] = W(mx + (axis === 'z' ? (ax < 0 ? -0.75 : 0.75) : 0), mz + (axis === 'x' ? (az < 0 ? -0.75 : 0.75) : 0));
        B.add(boxUV(len, 0.18, 0.14), mats.plank, M(bwx, y0 + by, bwz, 0, ry, 0));
      }
      // posts
      const np = Math.floor(len / 3);
      for (let i = 0; i <= np; i++) {
        const t = i / np;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        const off = axis === 'x' ? [0, az < 0 ? 0.6 : -0.6] : [ax < 0 ? 0.6 : -0.6, 0];
        const [pwx, pwz] = W(px + off[0], pz + off[1]);
        B.add(boxUV(0.2, 3.0, 0.2), mats.plank, M(pwx, y0 + 1.5, pwz));
      }
    }
    // ladders up to the walkway near the gate
    for (const sx of [-6, 6]) {
      const [lx, lz] = W(sx, H - 2.6);
      for (const s of [-0.25, 0.25]) B.add(boxUV(0.08, 3.6, 0.08), mats.plank, M(lx + s, y0 + 1.6, lz, -0.35, 0, 0));
      for (let r = 0; r < 9; r++) B.add(boxUV(0.55, 0.05, 0.06), mats.plank, M(lx, y0 + 0.3 + r * 0.36, lz + 0.65 - r * 0.125));
    }

    // ---------------- Gatehouse ----------------
    for (const sx of [-3.9, 3.9]) {
      const [gx, gz] = W(sx, H);
      B.add(boxUV(0.65, 8.4, 0.65), mats.bark, M(gx, y0 + 3.6, gz));
      addBoxL(sx - 0.4, H - 0.4, sx + 0.4, H + 0.4, 8);
    }
    {
      const [gx, gz] = W(0, H);
      B.add(boxUV(9.0, 0.5, 0.6), mats.plank, M(gx, y0 + 6.2, gz));
      B.add(boxUV(8.6, 0.15, 3.2), mats.plank, M(gx, y0 + 6.5, gz - 0.6));
      // parapet
      B.add(boxUV(8.6, 1.1, 0.12), mats.plank, M(gx, y0 + 7.1, gz + 0.9));
      B.add(boxUV(0.12, 1.1, 3.2), mats.plank, M(gx - 4.3, y0 + 7.1, gz - 0.6));
      B.add(boxUV(0.12, 1.1, 3.2), mats.plank, M(gx + 4.3, y0 + 7.1, gz - 0.6));
      // little roof
      B.add(boxUV(9.4, 0.12, 2.3), mats.roof, M(gx, y0 + 9.0, gz - 1.6, -0.45, 0, 0));
      B.add(boxUV(9.4, 0.12, 2.3), mats.roof, M(gx, y0 + 9.0, gz + 0.4, 0.45, 0, 0));
      for (const sx of [-4.1, 4.1]) for (const sz of [-1.9, 0.8]) B.add(boxUV(0.18, 2.2, 0.18), mats.plank, M(gx + sx, y0 + 7.7, gz + sz));
      this.gateTop = new THREE.Vector3(gx, y0 + 6.6, gz - 0.6);
    }
    // Gate doors (hinged)
    this.gateDoors = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const [px, pz] = W(side * 3.55, H);
      pivot.position.set(px, y0, pz);
      const door = new THREE.Group();
      const dw = 3.5;
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(boxUV(0.42, 4.6 + (i % 2) * 0.2, 0.18), mats.plank);
        m.position.set(-side * (0.22 + i * 0.43), 2.3, 0);
        m.castShadow = m.receiveShadow = true;
        door.add(m);
      }
      for (const yy of [0.9, 3.6]) {
        const m = new THREE.Mesh(boxUV(dw, 0.22, 0.1), mats.plank);
        m.position.set(-side * dw / 2, yy, -0.14); m.castShadow = true; door.add(m);
      }
      const diag = new THREE.Mesh(boxUV(0.18, 3.2, 0.08), mats.plank);
      diag.position.set(-side * dw / 2, 2.25, -0.14); diag.rotation.z = side * 0.68; door.add(diag);
      pivot.add(door);
      pivot.userData.side = side;
      this.group.add(pivot);
      this.gateDoors.push(pivot);
    }
    this.gateCollider = addBoxL(-3.6, H - 0.3, 3.6, H + 0.3, 5, 'wood', 'gate');
    this.gateOpen = 0; this.gateTarget = 0;

    // ---------------- Corner towers ----------------
    this.towerTops = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [tx, tz] = W(sx * (H - 1.6), sz * (H - 1.6));
      const s = 2.4;
      for (const ox of [-s, s]) for (const oz of [-s, s]) {
        B.add(boxUV(0.35, 9.6, 0.35), mats.bark, M(tx + ox, y0 + 4.6, tz + oz));
      }
      physics.addBox(new THREE.Vector3(tx - s - 0.3, y0 - 1, tz - s - 0.3), new THREE.Vector3(tx - s + 0.3, y0 + 9, tz - s + 0.3));
      physics.addBox(new THREE.Vector3(tx + s - 0.3, y0 - 1, tz - s - 0.3), new THREE.Vector3(tx + s + 0.3, y0 + 9, tz - s + 0.3));
      physics.addBox(new THREE.Vector3(tx - s - 0.3, y0 - 1, tz + s - 0.3), new THREE.Vector3(tx - s + 0.3, y0 + 9, tz + s + 0.3));
      physics.addBox(new THREE.Vector3(tx + s - 0.3, y0 - 1, tz + s - 0.3), new THREE.Vector3(tx + s + 0.3, y0 + 9, tz + s + 0.3));
      B.add(boxUV(5.6, 0.2, 5.6), mats.plank, M(tx, y0 + 6.6, tz));
      for (const [ox, oz, ry] of [[0, -2.75, 0], [0, 2.75, 0], [-2.75, 0, Math.PI / 2], [2.75, 0, Math.PI / 2]]) {
        B.add(boxUV(5.6, 1.2, 0.12), mats.plank, M(tx + ox, y0 + 7.3, tz + oz, 0, ry, 0));
      }
      // cross braces
      for (const [ox, oz, ry] of [[0, -s, 0], [0, s, 0], [-s, 0, Math.PI / 2], [s, 0, Math.PI / 2]]) {
        B.add(boxUV(0.12, 6.6, 0.12), mats.plank, M(tx + ox, y0 + 3.3, tz + oz, 0, ry, 0.62));
        B.add(boxUV(0.12, 6.6, 0.12), mats.plank, M(tx + ox, y0 + 3.3, tz + oz, 0, ry, -0.62));
      }
      const roof = new THREE.ConeGeometry(4.6, 2.6, 4, 1);
      // fix cone uvs for shingles
      const rp = roof.attributes.position, ruv = roof.attributes.uv;
      for (let i = 0; i < rp.count; i++) ruv.setXY(i, (rp.getX(i) + rp.getZ(i)) * 0.4, rp.getY(i) * 0.5);
      B.add(roof, mats.roof, M(tx, y0 + 10.6, tz, 0, Math.PI / 4, 0));
      this.towerTops.push(new THREE.Vector3(tx, y0 + 6.7, tz));
    }

    // ---------------- Buildings ----------------
    const cabin = (lx, lz, w, d, h, ry, opts = {}) => {
      const [x, z] = W(lx, lz);
      const g = new THREE.Group();
      const local = [];
      const add = (geo, mat, m) => local.push([geo, mat, m]);
      add(boxUV(w, h, d, 1.2), mats.logs, M(0, h / 2, 0));
      // corner posts
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(boxUV(0.34, h + 0.2, 0.34), mats.bark, M(sx * w / 2, h / 2, sz * d / 2));
      // roof (gable along x)
      const roofH = opts.roofH || 1.8;
      const slope = Math.hypot(d / 2 + 0.6, roofH);
      const ang = Math.atan2(roofH, d / 2 + 0.6);
      add(boxUV(w + 1.0, 0.14, slope, 1.4), mats.roof, M(0, h + roofH / 2, -(d / 2 + 0.6) / 2, -ang, 0, 0));
      add(boxUV(w + 1.0, 0.14, slope, 1.4), mats.roof, M(0, h + roofH / 2, (d / 2 + 0.6) / 2, ang, 0, 0));
      // gable triangles
      const tri = new THREE.Shape();
      tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(0, roofH); tri.closePath();
      const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false });
      const tuv = tg.attributes.uv; const tpp = tg.attributes.position;
      for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tpp.getX(i) / 1.2, tpp.getY(i) / 1.2);
      tg.rotateY(Math.PI / 2);
      add(tg, mats.logs, M(w / 2 - 0.1, h, 0));
      add(tg, mats.logs, M(-w / 2 - 0.1, h, 0));
      // door on +z side
      add(boxUV(1.2, 2.1, 0.08), mats.plank, M(opts.doorX || 0, 1.05, d / 2 + 0.03));
      add(boxUV(1.45, 0.16, 0.14), mats.plank, M(opts.doorX || 0, 2.2, d / 2 + 0.05));
      // windows
      for (const wx of opts.windows || [-w / 3, w / 3]) {
        add(boxUV(0.9, 0.7, 0.06), mats.dark, M(wx, 1.7, d / 2 + 0.02));
        add(boxUV(1.1, 0.1, 0.12), mats.plank, M(wx, 1.32, d / 2 + 0.05));
        add(boxUV(0.08, 0.7, 0.08), mats.plank, M(wx, 1.7, d / 2 + 0.05));
        add(boxUV(0.9, 0.7, 0.06), mats.dark, M(wx, 1.7, -d / 2 - 0.02));
      }
      if (opts.porch) {
        add(boxUV(w, 0.12, 2.2), mats.plank, M(0, 0.15, d / 2 + 1.1));
        add(boxUV(w + 0.6, 0.12, 2.6), mats.roof, M(0, h - 0.15, d / 2 + 1.2, -0.22, 0, 0));
        for (const px of [-w / 2 + 0.3, -w / 6, w / 6, w / 2 - 0.3]) add(boxUV(0.16, h - 0.2, 0.16), mats.plank, M(px, (h - 0.2) / 2, d / 2 + 2.2));
      }
      const base = M(x, y0 - 0.25, z, 0, ry, 0);
      for (const [geo, mat, m] of local) B.add(geo, mat, base.clone().multiply(m));
      // collider (axis aligned since ry is 0 or 90deg)
      const ex = Math.abs(Math.cos(ry)) > 0.5 ? w / 2 : d / 2, ez = Math.abs(Math.cos(ry)) > 0.5 ? d / 2 : w / 2;
      physics.addBox(new THREE.Vector3(x - ex - 0.2, y0 - 1, z - ez - 0.2), new THREE.Vector3(x + ex + 0.2, y0 + h + roofH, z + ez + 0.2));
      return g;
    };
    cabin(-21, -4, 18, 7.5, 3.0, Math.PI / 2, { windows: [-5.5, -1.8, 1.8, 5.5], doorX: 0 }); // barracks (door faces +x)
    cabin(0, -23, 14, 8, 3.4, 0, { porch: true, windows: [-4, 4], roofH: 2.2 }); // command house
    cabin(21, -6, 11, 7, 2.8, -Math.PI / 2, { windows: [-3, 3] }); // storehouse (door faces -x)

    // ---------------- Flagpole + flags ----------------
    {
      const [fx, fz] = W(0, -9);
      const fy = terrain.getHeight(fx, fz);
      B.add(new THREE.CylinderGeometry(0.07, 0.13, 15, 10), mats.metal, M(fx, fy + 7.5, fz));
      B.add(new THREE.CylinderGeometry(0.9, 1.1, 0.4, 10), mats.stone, M(fx, fy + 0.15, fz));
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.3 }));
      ball.position.set(fx, fy + 15.1, fz);
      this.group.add(ball);
      physics.addCircle(fx, fz, 1.0, 15, 'metal');
      this.mainFlag = this._makeFlag(T.flagVelmora, 4.6, 2.9);
      this.mainFlag.position.set(fx + 0.08, fy + 13.4, fz);
      this.group.add(this.mainFlag);
      this.flagPos = new THREE.Vector3(fx, fy + 13, fz);
      for (const t of this.towerTops) {
        const f = this._makeFlag(T.flagVelmora, 1.6, 1.0);
        B.add(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 6), mats.plank, M(t.x, t.y + 5.0, t.z));
        f.position.set(t.x + 0.05, t.y + 6.0, t.z);
        f.rotation.y = rnd() * 0.5;
        this.group.add(f);
      }
    }

    // ---------------- Sandbags ----------------
    const bag = new THREE.CapsuleGeometry(0.15, 0.42, 3, 8);
    bag.rotateZ(Math.PI / 2);
    bag.scale(1, 0.75, 1.45);
    const sandWall = (lx, lz, len, ry, rows = 3) => {
      const [x, z] = W(lx, lz);
      const gy = terrain.getHeight(x, z);
      const n = Math.max(1, Math.round(len / 0.68));
      for (let r = 0; r < rows; r++) for (let i = 0; i < n - (r % 2); i++) {
        const t = (i + (r % 2) * 0.5 - (n - 1) / 2) * 0.68;
        const bx = x + Math.cos(ry) * t, bz = z - Math.sin(ry) * t;
        B.add(bag, mats.sack, M(bx, gy + 0.12 + r * 0.24, bz, (rnd() - 0.5) * 0.08, ry + (rnd() - 0.5) * 0.12, 0));
      }
      const hx = Math.abs(Math.cos(ry)) * len / 2 + Math.abs(Math.sin(ry)) * 0.25;
      const hz = Math.abs(Math.sin(ry)) * len / 2 + Math.abs(Math.cos(ry)) * 0.25;
      physics.addBox(new THREE.Vector3(x - hx, gy - 0.5, z - hz), new THREE.Vector3(x + hx, gy + rows * 0.24 + 0.05, z + hz), 'sand');
    };
    this.coverSpots = [];
    const cover = (lx, lz, len, ry, faceLx, faceLz) => {
      sandWall(lx, lz, len, ry, 4);
      // defensive spots behind the wall (side away from face point)
      const nx = Math.sin(ry), nz = Math.cos(ry);
      const toFace = (faceLx - lx) * nx + (faceLz - lz) * nz;
      const sgn = toFace > 0 ? -1 : 1;
      for (const t of [-len / 3, len / 3]) {
        const px = lx + Math.cos(ry) * t + nx * sgn * 0.75, pz = lz - Math.sin(ry) * t + nz * sgn * 0.75;
        const [wx, wz] = W(px, pz);
        const [fx, fz] = W(faceLx, faceLz);
        this.coverSpots.push({ pos: new THREE.Vector3(wx, terrain.getHeight(wx, wz), wz), face: new THREE.Vector3(fx, y0, fz), taken: false });
      }
    };
    cover(-8, 19, 5.5, 0, 0, 34);
    cover(8, 19, 5.5, 0, 0, 34);
    cover(0, 14, 4.5, 0, 0, 34);
    cover(-24, -2, 4.5, Math.PI / 2, -34, 0);
    cover(-24, 7, 3.5, Math.PI / 2, -34, 0);
    cover(14, 12, 4, 0.5, 0, 34);
    sandWall(-14, 26, 3, 0.4, 3);

    // ---------------- Props ----------------
    const crate = boxUV(1, 1, 1, 0.9);
    const addCrate = (lx, lz, s, ry, stack = 1) => {
      const [x, z] = W(lx, lz);
      const gy = terrain.getHeight(x, z);
      for (let k = 0; k < stack; k++) B.add(crate, mats.plank, M(x, gy + s / 2 + k * s, z, 0, ry + k * 0.3, 0, s, s, s));
      physics.addBox(new THREE.Vector3(x - s * 0.6, gy - 0.5, z - s * 0.6), new THREE.Vector3(x + s * 0.6, gy + s * stack, z + s * 0.6));
    };
    const barrel = new THREE.CylinderGeometry(0.33, 0.33, 0.95, 12);
    const bU = barrel.attributes.uv;
    for (let i = 0; i < bU.count; i++) bU.setXY(i, bU.getX(i) * 2.5, bU.getY(i) * 0.9);
    const band = new THREE.CylinderGeometry(0.345, 0.345, 0.05, 12, 1, true);
    const addBarrel = (lx, lz) => {
      const [x, z] = W(lx, lz);
      const gy = terrain.getHeight(x, z);
      B.add(barrel, mats.plank, M(x, gy + 0.47, z));
      B.add(band, mats.metal, M(x, gy + 0.2, z)); B.add(band, mats.metal, M(x, gy + 0.75, z));
      physics.addCircle(x, z, 0.38, 1, 'wood');
    };
    addCrate(14, 3, 1.0, 0.2, 2); addCrate(15.4, 4.4, 0.9, -0.3); addCrate(13.2, 5.0, 0.8, 0.5);
    addCrate(26, 24, 1.1, 0.1, 2); addCrate(27.5, 22.6, 1.0, 0.4); addCrate(-27, 26, 1.0, 0.0);
    addCrate(-27, -26, 1.1, 0.3, 2); addCrate(9, -18, 0.9, 0.2);
    for (const [bx, bz] of [[16.5, 2], [12.4, 3.5], [26, 20.5], [-26, 24], [-9, -18], [25, -26], [24, -24.8]]) addBarrel(bx, bz);
    // quartermaster table
    {
      const [x, z] = W(11, 0.5);
      const gy = terrain.getHeight(x, z);
      B.add(boxUV(2.2, 0.08, 1.0), mats.plank, M(x, gy + 0.85, z));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(boxUV(0.08, 0.85, 0.08), mats.plank, M(x + sx * 1.0, gy + 0.42, z + sz * 0.42));
      physics.addBox(new THREE.Vector3(x - 1.15, gy - 0.5, z - 0.55), new THREE.Vector3(x + 1.15, gy + 0.9, z + 0.55));
      this.qmTable = new THREE.Vector3(x, gy + 0.89, z);
    }
    // weapon rack
    {
      const [x, z] = W(-15.5, -4);
      const gy = terrain.getHeight(x, z);
      B.add(boxUV(0.12, 0.12, 2.6), mats.plank, M(x, gy + 1.1, z));
      B.add(boxUV(0.12, 0.12, 2.6), mats.plank, M(x, gy + 0.25, z));
      for (const sz of [-1.2, 1.2]) B.add(boxUV(0.12, 1.3, 0.12), mats.plank, M(x, gy + 0.65, z + sz));
      this.rackPos = new THREE.Vector3(x, gy, z);
    }
    // tents
    const tent = (lx, lz, ry) => {
      const [x, z] = W(lx, lz);
      const gy = terrain.getHeight(x, z);
      const s = new THREE.Shape(); s.moveTo(-1.4, 0); s.lineTo(1.4, 0); s.lineTo(0, 1.8); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 3.4, bevelEnabled: false });
      g.translate(0, 0, -1.7);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.6, uv.getY(i) * 0.6);
      B.add(g, mats.canvas, M(x, gy, z, 0, ry, 0));
      physics.addBox(new THREE.Vector3(x - 1.8, gy - 0.5, z - 1.8), new THREE.Vector3(x + 1.8, gy + 1.8, z + 1.8), 'cloth');
    };
    tent(22, 15, 0.1); tent(25.5, 9, 0.1); tent(-20, 18, -0.2);
    // cart
    {
      const [x, z] = W(-12, 24);
      const gy = terrain.getHeight(x, z);
      B.add(boxUV(1.6, 0.5, 2.8), mats.plank, M(x, gy + 0.9, z, 0, 0.3, 0));
      const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 14);
      wheel.rotateZ(Math.PI / 2);
      for (const sx of [-0.9, 0.9]) B.add(wheel, mats.plank, M(x + sx * Math.cos(0.3), gy + 0.55, z - sx * Math.sin(0.3)));
      physics.addBox(new THREE.Vector3(x - 1.4, gy - 0.5, z - 1.7), new THREE.Vector3(x + 1.4, gy + 1.2, z + 1.7));
    }
    // campfire
    {
      const [x, z] = W(-8, 6);
      const gy = terrain.getHeight(x, z);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        B.add(new THREE.DodecahedronGeometry(0.18, 0), mats.stone, M(x + Math.cos(a) * 0.65, gy + 0.08, z + Math.sin(a) * 0.65, rnd(), rnd(), rnd()));
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        B.add(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 6), mats.bark, M(x, gy + 0.2, z, 1.1, a, 0));
      }
      // log benches
      for (const [ox, oz, ry] of [[0, 2.2, Math.PI / 2], [2.2, 0, 0], [-2.0, -1.0, 0.5]]) {
        B.add(new THREE.CylinderGeometry(0.22, 0.22, 2.0, 8), mats.bark, M(x + ox, gy + 0.22, z + oz, 0, ry, Math.PI / 2));
      }
      this.campfire = new THREE.Vector3(x, gy + 0.2, z);
      this.fireLight = new THREE.PointLight(0xff8a3a, 12, 16, 1.6);
      this.fireLight.position.set(x, gy + 0.8, z);
      this.group.add(this.fireLight);
    }
    // lanterns
    for (const [lx, lz] of [[-4.5, -18.4], [4.5, -18.4], [-17, -4], [17, -6]]) {
      const [x, z] = W(lx, lz);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.16), mats.glow);
      m.position.set(x, y0 + 2.4, z);
      this.group.add(m);
    }

    // Breach debris (shown after the west wall is blown)
    this.debris = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.5 + rnd() * 2.5, 7), mats.bark);
      const [x, z] = W(-H + (rnd() - 0.3) * 5, (rnd() - 0.5) * 8);
      m.position.set(x, terrain.getHeight(x, z) + 0.2, z);
      m.rotation.set(Math.PI / 2 + (rnd() - 0.5) * 0.4, rnd() * 6, 0);
      m.castShadow = true;
      this.debris.add(m);
    }
    this.debris.visible = false;
    this.group.add(this.debris);

    B.build(this.group);

    // Named positions used by the story/AI (world space)
    const P = (lx, lz) => { const [x, z] = W(lx, lz); return new THREE.Vector3(x, terrain.getHeight(x, z), z); };
    this.spots = {
      gateOutside: P(0, H + 12),
      gateFront: P(0, H + 4),
      gateInside: P(0, H - 5),
      courtyard: P(0, 4),
      welcome: P(0, 8),
      captain: P(0, 1.5),
      quartermaster: P(11, -0.6),
      breachOutside: P(-H - 12, 0),
      breachInside: P(-H + 5, 0),
      gather: [P(-3.2, 2.4), P(3.2, 2.6), P(-5.5, 5.5), P(5.6, 5.2), P(-2, -0.5), P(2.5, -1), P(-7.5, 8.5)],
      campfireSeats: [P(-8, 8.2), P(-5.8, 6), P(-10, 5)],
      enemyGateSpawn: [P(-6, H + 40), P(0, H + 46), P(6, H + 42), P(-12, H + 50), P(12, H + 48), P(-3, H + 56), P(4, H + 60)],
      enemyBreachSpawn: [P(-H - 38, -4), P(-H - 42, 4), P(-H - 46, 0), P(-H - 40, 10), P(-H - 44, -10)],
    };
    this.inside = (p, margin = 0) => Math.abs(p.x - cx) < H - margin && Math.abs(p.z - cz) < H - margin;
  }

  _makeFlag(texture, w, h) {
    const g = new THREE.PlaneGeometry(w, h, 32, 18);
    g.translate(w / 2, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 0.9 });
    const uni = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uni.uTime;
      sh.uniforms.uW = { value: w };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uW;')
        .replace('#include <beginnormal_vertex>', `
          float fx = position.x / uW;
          float ph = position.x * (6.0 / uW) - uTime * 5.2 + position.y * 0.5;
          float amp = 0.11 * uW * fx;
          float wave = sin(ph) * amp + sin(ph * 2.1 + 1.3) * amp * 0.25;
          float dzdx = cos(ph) * (6.0 / uW) * amp + sin(ph) * 0.11 + cos(ph * 2.1 + 1.3) * 2.1 * (6.0 / uW) * amp * 0.25;
          float dzdy = cos(ph) * 0.5 * amp;
          vec3 objectNormal = normalize(vec3(-dzdx, -dzdy, 1.0));
        `)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          transformed.z += wave;
          transformed.y -= fx * fx * 0.12 * uW;
          transformed.x -= abs(wave) * 0.15;
        `);
    };
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    return m;
  }

  openGate() { this.gateTarget = 1; this.physics.removeBoxesByTag('gate'); }

  blowBreach() {
    this.physics.removeBoxesByTag('breach');
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const i of this.breachLogIdx) { this.palisade.setMatrixAt(i, zero); this.palisadeTips.setMatrixAt(i, zero); }
    this.palisade.instanceMatrix.needsUpdate = true;
    this.palisadeTips.instanceMatrix.needsUpdate = true;
    this.debris.visible = true;
  }

  update(dt, t) {
    this.uniforms.uTime.value += dt;
    this.gateOpen += (this.gateTarget - this.gateOpen) * Math.min(1, dt * 0.9);
    for (const d of this.gateDoors) d.rotation.y = d.userData.side * -this.gateOpen * 1.75;
    if (this.fireLight) this.fireLight.intensity = 10 + Math.sin(t * 13) * 1.5 + Math.sin(t * 7.3) * 2 + Math.random() * 1.2;
  }
}
