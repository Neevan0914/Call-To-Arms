import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { KFORT } from './terrain.js';
import { boxUV, Batcher, M } from './fort.js';

// Chapter II: Kharsk Keep, a Kharzan stone stronghold. Thick stone curtain walls with
// crenellations, corner towers, a command house, barracks, and a small stone cell block
// where the player is interrogated. Supports bomb craters, burning and a swinging lamp.
export class KharzanFort {
  constructor(game, velmar) {
    const { scene, terrain, physics, T } = game;
    this.game = game;
    this.group = new THREE.Group();
    scene.add(this.group);
    const cx = KFORT.x, cz = KFORT.z, H = KFORT.half;
    const y0 = terrain.kfortH;
    this.y0 = y0;
    this.center = new THREE.Vector3(cx, y0, cz);
    const rnd = mulberry32(9137);
    const base = velmar.mats;
    // own material copies so charring the keep doesn't darken Fort Velmar
    const mats = {
      stone: base.stone.clone(), stoneDark: base.stone.clone(), plank: base.plank.clone(), logs: base.logs.clone(),
      roof: base.roof.clone(), metal: base.metal, dark: base.dark, sack: base.sack, bark: base.bark,
    };
    mats.stone.color.set(0x9d978d);
    mats.stoneDark.color.set(0x6f6a63);
    mats.roof.color.set(0x6e6a68);
    this.mats = mats;
    this.charrable = [mats.plank, mats.logs, mats.roof, mats.stone];
    this.charBase = this.charrable.map((m) => m.color.clone());
    const B = new Batcher();
    const W = (lx, lz) => [cx + lx, cz + lz];
    const wbox = (x0, z0, x1, z1, h, type = 'stone', yb = y0 - 1) => {
      const [ax, az] = W(Math.min(x0, x1), Math.min(z0, z1));
      const [bx, bz] = W(Math.max(x0, x1), Math.max(z0, z1));
      physics.addBox(new THREE.Vector3(ax, yb, az), new THREE.Vector3(bx, y0 + h, bz), type);
    };
    // a box in local coords (centre lx, ly above y0, lz)
    const L = (geo, mat, lx, ly, lz, rx = 0, ry = 0, rz = 0) => { const [x, z] = W(lx, lz); B.add(geo, mat, M(x, y0 + ly, z, rx, ry, rz)); };

    // ---------------- Curtain walls ----------------
    const t = 1.4, wh = 6.2;
    const wall = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      L(boxUV(alongX ? len : t, wh + 1, alongX ? t : len, 2.2), mats.stone, mx, wh / 2 - 0.5, mz);
      // plinth
      L(boxUV(alongX ? len : t + 0.5, 1.0, alongX ? t + 0.5 : len, 2.2), mats.stoneDark, mx, 0.2, mz);
      // merlons along the outer edge
      const n = Math.floor(len / 1.8);
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        const px = ax + (bx - ax) * k, pz = az + (bz - az) * k;
        const ox = alongX ? 0 : Math.sign(px) * t * 0.3, oz = alongX ? Math.sign(pz) * t * 0.3 : 0;
        L(boxUV(alongX ? 0.95 : t * 0.4, 0.9, alongX ? t * 0.4 : 0.95, 1.2), mats.stone, px + ox, wh + 0.45, pz + oz);
      }
      wbox(alongX ? Math.min(ax, bx) : mx - t / 2, alongX ? mz - t / 2 : Math.min(az, bz), alongX ? Math.max(ax, bx) : mx + t / 2, alongX ? mz + t / 2 : Math.max(az, bz), wh + 1);
    };
    const e = H - t / 2;
    wall(-H, e, H, e); // back
    wall(-H, -e, -3.4, -e); wall(3.4, -e, H, -e); // front with gate
    wall(-e, -H + t, -e, H - t); wall(e, -H + t, e, H - t);

    // gatehouse
    for (const sx of [-1, 1]) {
      L(boxUV(1.8, wh + 3, t + 0.8, 2.2), mats.stoneDark, sx * 4.2, (wh + 3) / 2 - 0.5, -e);
      wbox(sx * 4.2 - 0.9, -e - t / 2 - 0.4, sx * 4.2 + 0.9, -e + t / 2 + 0.4, wh + 3);
    }
    L(boxUV(10.2, 1.8, t + 0.8, 2.2), mats.stoneDark, 0, wh - 0.4, -e);
    for (let i = 0; i < 5; i++) L(boxUV(0.95, 0.9, 0.5, 1.2), mats.stone, -4 + i * 2, wh + 0.95, -e - t / 2 - 0.1);
    // heavy doors, thrown open
    for (const sx of [-1, 1]) {
      const [px, pz] = W(sx * 3.3, -e + 0.6);
      const g = new THREE.Group();
      g.position.set(px, y0, pz);
      g.rotation.y = sx * -1.9;
      for (let i = 0; i < 7; i++) {
        const m = new THREE.Mesh(boxUV(0.47, 4.8, 0.2), mats.plank);
        m.position.set(-sx * (0.25 + i * 0.47), 2.4, 0);
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      }
      for (const yy of [0.8, 2.4, 4.0]) {
        const m = new THREE.Mesh(boxUV(3.3, 0.16, 0.08), mats.metal);
        m.position.set(-sx * 1.65, yy, 0.13); g.add(m);
      }
      this.group.add(g);
    }

    // ---------------- Corner towers ----------------
    this.towerTops = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const tx = sx * (H - 2.6), tz = sz * (H - 2.6), s = 7, th = 10.5;
      L(boxUV(s, th + 1, s, 2.2), mats.stone, tx, th / 2 - 0.5, tz);
      L(boxUV(s + 0.6, 1.2, s + 0.6, 2.2), mats.stoneDark, tx, 0.1, tz);
      L(boxUV(s + 0.5, 0.5, s + 0.5, 2.2), mats.stoneDark, tx, th + 0.1, tz);
      for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
        const k = -s / 2 + 0.55 + i * ((s - 1.1) / 3);
        L(boxUV(0.95, 1.0, 0.5, 1.2), mats.stone, tx + k, th + 0.85, tz + side * (s / 2));
        L(boxUV(0.5, 1.0, 0.95, 1.2), mats.stone, tx + side * (s / 2), th + 0.85, tz + k);
      }
      // arrow-slit windows
      for (const yy of [3.5, 7]) {
        L(boxUV(0.25, 1.1, 0.06), mats.dark, tx, yy, tz + sz * (s / 2 + 0.02));
        L(boxUV(0.06, 1.1, 0.25), mats.dark, tx + sx * (s / 2 + 0.02), yy, tz);
      }
      wbox(tx - s / 2, tz - s / 2, tx + s / 2, tz + s / 2, th + 1.5);
      const [wx, wz] = W(tx, tz);
      this.towerTops.push(new THREE.Vector3(wx, y0 + th + 0.4, wz));
    }

    // ---------------- Buildings ----------------
    // generic house: walls (stone or logs), gable roof along x, door on one side (local dir)
    const house = (lx, lz, w, d, h, ry, wallMat, opts = {}) => {
      const [x, z] = W(lx, lz);
      const parts = [];
      const add = (geo, mat, m) => parts.push([geo, mat, m]);
      add(boxUV(w, h, d, 1.6), wallMat, M(0, h / 2, 0));
      add(boxUV(w + 0.3, 0.6, d + 0.3, 2.0), mats.stoneDark, M(0, 0.2, 0));
      const roofH = opts.roofH || 1.9;
      const slope = Math.hypot(d / 2 + 0.6, roofH), ang = Math.atan2(roofH, d / 2 + 0.6);
      add(boxUV(w + 1.0, 0.16, slope, 1.4), mats.roof, M(0, h + roofH / 2, -(d / 2 + 0.6) / 2, -ang, 0, 0));
      add(boxUV(w + 1.0, 0.16, slope, 1.4), mats.roof, M(0, h + roofH / 2, (d / 2 + 0.6) / 2, ang, 0, 0));
      const tri = new THREE.Shape();
      tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(0, roofH); tri.closePath();
      const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false });
      const tuv = tg.attributes.uv, tpp = tg.attributes.position;
      for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tpp.getX(i) / 1.6, tpp.getY(i) / 1.6);
      tg.rotateY(Math.PI / 2);
      add(tg, wallMat, M(w / 2 - 0.1, h, 0));
      add(tg, wallMat, M(-w / 2 - 0.1, h, 0));
      add(boxUV(1.3, 2.2, 0.1), mats.plank, M(0, 1.1, d / 2 + 0.04));
      add(boxUV(1.6, 0.2, 0.2), mats.stoneDark, M(0, 2.3, d / 2 + 0.06));
      for (const wx of opts.windows || [-w / 3, w / 3]) {
        add(boxUV(0.9, 0.8, 0.06), mats.dark, M(wx, 1.8, d / 2 + 0.02));
        add(boxUV(0.9, 0.8, 0.06), mats.dark, M(wx, 1.8, -d / 2 - 0.02));
        for (const bx of [-0.25, 0, 0.25]) add(boxUV(0.03, 0.8, 0.03), mats.metal, M(wx + bx, 1.8, d / 2 + 0.06));
      }
      const m0 = M(x, y0 - 0.2, z, 0, ry, 0);
      for (const [geo, mat, m] of parts) B.add(geo, mat, m0.clone().multiply(m));
      const ex = Math.abs(Math.cos(ry)) > 0.5 ? w / 2 : d / 2, ez = Math.abs(Math.cos(ry)) > 0.5 ? d / 2 : w / 2;
      physics.addBox(new THREE.Vector3(x - ex - 0.15, y0 - 1, z - ez - 0.15), new THREE.Vector3(x + ex + 0.15, y0 + h + roofH, z + ez + 0.15), wallMat === mats.logs ? 'wood' : 'stone');
    };
    house(13, 13, 11, 8, 4.2, -Math.PI / 2, mats.stone, { windows: [-3.2, 3.2], roofH: 2.3 }); // command house (door faces -x)
    house(13, -11, 14, 6.5, 3.0, -Math.PI / 2, mats.logs, { windows: [-4.5, -1.5, 1.5, 4.5] }); // barracks
    house(-15, -11, 9, 7, 3.2, Math.PI / 2, mats.logs, { windows: [-2.5, 2.5] }); // storehouse (door faces +x)
    // radio mast on the command house
    {
      const [x, z] = W(14.5, 14);
      B.add(new THREE.CylinderGeometry(0.05, 0.08, 9, 6), mats.metal, M(x, y0 + 10, z));
      for (const yy of [7.5, 10, 12.5]) B.add(boxUV(1.4, 0.04, 0.04), mats.metal, M(x, y0 + yy, z));
    }

    // ---------------- The cell block (interrogation room) ----------------
    // outer box x: [-17.6, -10.4], z: [8.9, 15.1]; door in the east wall, high window in the west
    {
      const x0 = -17.6, x1 = -10.4, z0 = 8.9, z1 = 15.1, h = 3.4, tw = 0.3;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const S = mats.stone;
      L(boxUV(x1 - x0, h, tw, 1.6), S, mx, h / 2, z0 + tw / 2);
      L(boxUV(x1 - x0, h, tw, 1.6), S, mx, h / 2, z1 - tw / 2);
      // west wall around a small barred window (z 11.5..12.5, y 2.1..2.7)
      const wx = x0 + tw / 2;
      L(boxUV(tw, 2.1, z1 - z0, 1.6), S, wx, 1.05, mz);
      L(boxUV(tw, h - 2.7, z1 - z0, 1.6), S, wx, (2.7 + h) / 2, mz);
      L(boxUV(tw, 0.6, 11.5 - z0, 1.6), S, wx, 2.4, (z0 + 11.5) / 2);
      L(boxUV(tw, 0.6, z1 - 12.5, 1.6), S, wx, 2.4, (12.5 + z1) / 2);
      for (const bz of [11.75, 12, 12.25]) L(new THREE.CylinderGeometry(0.018, 0.018, 0.6, 5), mats.metal, wx, 2.4, bz);
      // east wall with the doorway (z 11.4..12.6, height 2.2)
      const ex = x1 - tw / 2;
      L(boxUV(tw, h, 11.4 - z0, 1.6), S, ex, h / 2, (z0 + 11.4) / 2);
      L(boxUV(tw, h, z1 - 12.6, 1.6), S, ex, h / 2, (12.6 + z1) / 2);
      L(boxUV(tw, h - 2.2, 1.2, 1.6), S, ex, (2.2 + h) / 2, 12);
      // roof slab + floor
      L(boxUV(x1 - x0 + 0.5, 0.3, z1 - z0 + 0.5, 2.0), mats.stoneDark, mx, h + 0.15, mz);
      L(boxUV(x1 - x0 - 0.1, 0.05, z1 - z0 - 0.1, 1.2), mats.plank, mx, 0.0, mz);
      // colliders: thin walls
      wbox(x0, z0, x1, z0 + tw, h); wbox(x0, z1 - tw, x1, z1, h);
      wbox(x0, z0, x0 + tw, z1, h);
      wbox(x1 - tw, z0, x1, 11.4, h); wbox(x1 - tw, 12.6, x1, z1, h);
      // interior: prisoner's chair (facing +x), the Marshal's table and chair
      const chair = (lx, lz, ry) => {
        const [x, z] = W(lx, lz);
        const mm = M(x, y0, z, 0, ry, 0);
        const put = (geo, m) => B.add(geo, mats.plank, mm.clone().multiply(m));
        put(boxUV(0.46, 0.05, 0.44), M(0, 0.45, 0));
        for (const sx of [-0.2, 0.2]) for (const sz of [-0.19, 0.19]) put(boxUV(0.045, 0.45, 0.045), M(sx, 0.225, sz));
        put(boxUV(0.44, 0.5, 0.04), M(0, 0.75, -0.21));
        for (const sx of [-0.2, 0.2]) put(boxUV(0.045, 0.55, 0.045), M(sx, 0.72, -0.21));
      };
      chair(-15.05, 12, Math.PI / 2);
      chair(-11.6, 13.9, -Math.PI / 2 - 0.4);
      {
        const [x, z] = W(-13.2, 12);
        B.add(boxUV(0.95, 0.06, 1.7), mats.plank, M(x, y0 + 0.78, z));
        for (const sx of [-0.4, 0.4]) for (const sz of [-0.75, 0.75]) B.add(boxUV(0.06, 0.78, 0.06), mats.plank, M(x + sx, y0 + 0.39, z + sz));
        const paper = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.95 });
        B.add(boxUV(0.3, 0.004, 0.42), paper, M(x - 0.1, y0 + 0.813, z + 0.3, 0, 0.2, 0));
        B.add(boxUV(0.3, 0.004, 0.42), paper, M(x + 0.12, y0 + 0.815, z - 0.25, 0, -0.35, 0));
        B.add(new THREE.CylinderGeometry(0.035, 0.03, 0.1, 8), mats.metal, M(x + 0.25, y0 + 0.86, z + 0.55));
        physics.addBox(new THREE.Vector3(x - 0.5, y0 - 0.5, z - 0.85), new THREE.Vector3(x + 0.5, y0 + 0.85, z + 0.85), 'wood');
        this.table = new THREE.Vector3(x, y0 + 0.81, z);
      }
      // bucket + shelf
      L(new THREE.CylinderGeometry(0.17, 0.14, 0.32, 10, 1, true), mats.metal, -17.0, 0.16, 14.5);
      L(boxUV(1.6, 0.05, 0.32), mats.plank, -14.2, 1.7, 14.75);
      L(boxUV(0.3, 0.25, 0.2), mats.plank, -14.6, 1.85, 14.75);
      // the Dominion's banner on the north wall
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.06), new THREE.MeshStandardMaterial({ map: T.flagKharzan, roughness: 0.9, side: THREE.DoubleSide }));
      const [bx, bz] = W(-14.0, z1 - tw - 0.02);
      ban.position.set(bx, y0 + 2.2, bz); ban.rotation.y = Math.PI;
      this.group.add(ban);
      // hanging lamp (pendulum)
      const [lx, lz] = W(-14.0, 12);
      this.lamp = new THREE.Group();
      this.lamp.position.set(lx, y0 + h, lz);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4), mats.metal);
      cord.position.y = -0.35; this.lamp.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.16, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c3028, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }));
      shade.position.y = -0.74; this.lamp.add(shade);
      this.bulbMat = new THREE.MeshStandardMaterial({ color: 0x302010, emissive: 0xffc070, emissiveIntensity: 0 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), this.bulbMat);
      bulb.position.y = -0.8; this.lamp.add(bulb);
      this.lampLight = new THREE.PointLight(0xffc27a, 0, 9, 1.6);
      this.lampLight.position.y = -0.88; this.lamp.add(this.lampLight);
      this.group.add(this.lamp);
      this.lampSwing = 0; this.lampPhase = 0; this.lampFlicker = 0;
      // hinged cell door (closed until the raid)
      const [dx, dz] = W(x1 - 0.02, 11.42);
      this.cellDoor = new THREE.Group();
      this.cellDoor.position.set(dx, y0, dz);
      const dm = new THREE.Mesh(boxUV(0.08, 2.15, 1.16), mats.plank);
      dm.position.set(0, 1.08, 0.58); dm.castShadow = dm.receiveShadow = true;
      this.cellDoor.add(dm);
      for (const yy of [0.5, 1.7]) { const s = new THREE.Mesh(boxUV(0.1, 0.1, 1.1), mats.metal); s.position.set(0.03, yy, 0.58); this.cellDoor.add(s); }
      this.group.add(this.cellDoor);
      this.doorOpen = 0; this.doorTarget = 0;
    }

    // ---------------- Flagpole ----------------
    {
      const [fx, fz] = W(-2, 2);
      B.add(new THREE.CylinderGeometry(0.07, 0.13, 14, 10), mats.metal, M(fx, y0 + 7, fz));
      B.add(boxUV(1.6, 0.5, 1.6), mats.stoneDark, M(fx, y0 + 0.2, fz));
      physics.addCircle(fx, fz, 0.9, 14, 'metal');
      this.flag = velmar._makeFlag(T.flagKharzan, 4.4, 2.75);
      this.flag.position.set(fx + 0.08, y0 + 12.4, fz);
      this.group.add(this.flag);
      for (const tt of this.towerTops) {
        const f = velmar._makeFlag(T.flagKharzan, 1.6, 1.0);
        B.add(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 6), mats.plank, M(tt.x, tt.y + 1.6, tt.z));
        f.position.set(tt.x + 0.05, tt.y + 2.6, tt.z);
        f.rotation.y = rnd() * 0.5;
        this.group.add(f);
      }
    }

    // ---------------- Props ----------------
    const crate = boxUV(1, 1, 1, 0.9);
    const addCrate = (lx, lz, s, ry, stack = 1) => {
      const [x, z] = W(lx, lz);
      for (let k = 0; k < stack; k++) B.add(crate, mats.plank, M(x, y0 + s / 2 + k * s, z, 0, ry + k * 0.3, 0, s, s, s));
      physics.addBox(new THREE.Vector3(x - s * 0.6, y0 - 0.5, z - s * 0.6), new THREE.Vector3(x + s * 0.6, y0 + s * stack, z + s * 0.6));
    };
    const barrel = new THREE.CylinderGeometry(0.33, 0.33, 0.95, 12);
    const addBarrel = (lx, lz) => {
      const [x, z] = W(lx, lz);
      B.add(barrel, mats.plank, M(x, y0 + 0.47, z));
      physics.addCircle(x, z, 0.38, 1, 'wood');
    };
    addCrate(-6, -18, 1.0, 0.2, 2); addCrate(-7.4, -16.6, 0.9, -0.3); addCrate(6.5, -19, 1.1, 0.1, 2); addCrate(-21, 2, 1.0, 0.4);
    addCrate(-20, 4.2, 0.9, 0.1); addCrate(22, 2, 1.0, 0.3, 2); addCrate(4, 20, 1.0, 0.2);
    for (const [bx, bz] of [[-8.6, -18.4], [8, -17], [-21.5, -1.2], [21, 4.5], [5.4, 21.4], [-4, 22]]) addBarrel(bx, bz);
    // sandbag nests inside the gate
    const bag = new THREE.CapsuleGeometry(0.15, 0.42, 3, 8);
    bag.rotateZ(Math.PI / 2); bag.scale(1, 0.75, 1.45);
    const sandWall = (lx, lz, len, ry, rows = 3) => {
      const [x, z] = W(lx, lz);
      const n = Math.max(1, Math.round(len / 0.68));
      for (let r = 0; r < rows; r++) for (let i = 0; i < n - (r % 2); i++) {
        const tt = (i + (r % 2) * 0.5 - (n - 1) / 2) * 0.68;
        B.add(bag, mats.sack, M(x + Math.cos(ry) * tt, y0 + 0.12 + r * 0.24, z - Math.sin(ry) * tt, (rnd() - 0.5) * 0.08, ry + (rnd() - 0.5) * 0.12, 0));
      }
      const hx = Math.abs(Math.cos(ry)) * len / 2 + Math.abs(Math.sin(ry)) * 0.25;
      const hz = Math.abs(Math.sin(ry)) * len / 2 + Math.abs(Math.cos(ry)) * 0.25;
      physics.addBox(new THREE.Vector3(x - hx, y0 - 0.5, z - hz), new THREE.Vector3(x + hx, y0 + rows * 0.24 + 0.05, z + hz), 'sand');
    };
    sandWall(-7, -22, 4, 0, 4); sandWall(7, -22, 4, 0, 4);

    B.build(this.group);

    // craters (decals) left by the bombs
    {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0, 'rgba(12,10,8,0.95)'); g.addColorStop(0.45, 'rgba(30,24,18,0.85)'); g.addColorStop(0.75, 'rgba(60,48,36,0.4)'); g.addColorStop(1, 'rgba(60,48,36,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      this.craterMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
      this.craterGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    }
    // the glow of the burning keep borrows Fort Velmar's campfire light in Chapter II
    // (lights are never added at runtime: that would recompile every shader)
    this.velmar = velmar;
    this.fireLight = null;
    this.burning = 0;
    this.char = 0;

    const P = (lx, lz) => { const [x, z] = W(lx, lz); return new THREE.Vector3(x, terrain.getHeight(x, z), z); };
    this.spots = {
      chair: P(-15.05, 12), chairYaw: Math.PI / 2,
      marshal: P(-12.45, 12.35), marshalNear: P(-14.15, 12.75), marshalFall: P(-13.0, 13.5),
      guard: P(-11.2, 14.1),
      doorIn: P(-11.1, 12), doorOut: P(-9.0, 12), cellCam: P(-11.0, 10.0),
      courtyard: P(0, 0), gateInside: P(0, -H + 4), gateOutside: P(0, -H - 8),
      general: P(2.8, -H - 7), aide: P(4.6, -H - 7.6),
      kneel: [P(-4.5, 4), P(-2.6, 5.2), P(4, -4.5), P(5.6, -3.6), P(8, 1.5)],
      raidSpawn: [P(-2, -H - 18), P(1.5, -H - 20), P(-4.5, -H - 22), P(4, -H - 23), P(0, -H - 26), P(-6, -H - 27)],
      kharzanIdle: [P(-6, -14), P(6, -8), P(3, 8), P(-8, 4), P(10, 0), P(-4, -24), P(4, -24), P(18, -2)],
      fires: [
        { p: P(9, -11), y: 3.6, s: 2.4 }, { p: P(15, -11), y: 3.6, s: 2.6 }, { p: P(12, -11), y: 4.4, s: 2.0 },
        { p: P(10, 13), y: 4.8, s: 2.2 }, { p: P(16, 13), y: 4.6, s: 2.4 },
        { p: P(-15, -9), y: 3.6, s: 2.2 }, { p: P(-15, -13), y: 3.4, s: 2.0 },
        { p: P(-6, -18), y: 1.6, s: 1.5 }, { p: P(6.5, -19), y: 1.8, s: 1.4 }, { p: P(-13, 12), y: 3.8, s: 1.6 },
        { p: P(-20.5, 3), y: 1.2, s: 1.2 }, { p: P(22, 2.4), y: 1.6, s: 1.4 },
      ],
      bombs: [P(-6, -10), P(8, -4), P(14, -6), P(-2, 10), P(10, 18), P(-18, -6), P(2, -16), P(-10, 18), P(20, 14), P(-22, 10), P(16, -18), P(-12, -2), P(6, 6), P(-20, -20)],
    };
    this.inside = (p, margin = 0) => Math.abs(p.x - cx) < H - margin && Math.abs(p.z - cz) < H - margin;
    this.inCell = (p) => p.x > cx - 17.6 && p.x < cx - 10.4 && p.z > cz + 8.9 && p.z < cz + 15.1;
  }

  // Chapter II begins: take over Fort Velmar's campfire light for the fires here
  activate() {
    if (this.fireLight || !this.velmar.fireLight) return;
    const L = this.velmar.fireLight;
    this.velmar.fireLight = null;
    L.removeFromParent();
    L.color.set(0xff7a30); L.distance = 70; L.decay = 1.3; L.intensity = 0;
    L.position.set(this.center.x + 4, this.y0 + 7, this.center.z);
    this.group.add(L);
    this.fireLight = L;
  }

  setLamp(on) {
    this.lampOn = on;
    this.lampLight.intensity = on ? 5.5 : 0;
    this.bulbMat.emissiveIntensity = on ? 3 : 0;
  }

  // jolt the hanging lamp (bomb nearby)
  shake(k = 1) { this.lampSwing = Math.min(0.6, this.lampSwing + 0.25 * k); this.lampFlicker = Math.max(this.lampFlicker, 0.6 * k); }

  addCrater(p, r = 3) {
    const m = new THREE.Mesh(this.craterGeo, this.craterMat);
    m.position.set(p.x, this.game.terrain.getHeight(p.x, p.z) + 0.04, p.z);
    m.rotation.y = Math.random() * 6.28;
    m.scale.set(r * 2, 1, r * 2);
    m.receiveShadow = true;
    m.renderOrder = 1;
    this.group.add(m);
  }

  // set the keep ablaze: fire emitters on roofs / stores, a warm glow, charring materials
  ignite(effects, count = Infinity) {
    const F = this.spots.fires;
    this._lit = this._lit || 0;
    const n = Math.min(F.length, this._lit + count);
    for (; this._lit < n; this._lit++) {
      const f = F[this._lit];
      effects.addFire(f.p.clone().setY(f.p.y + f.y), f.s);
    }
  }

  // the orange glow over the burning keep (point lights ignore walls, so it is kept
  // off while the camera is inside the cell)
  glow(on = true) { this.burning = on ? 1 : 0; if (!on && this.fireLight) this.fireLight.intensity = 0; }

  openCellDoor(fast = true) { this.doorTarget = 1; this.doorFast = fast; }

  update(dt, t) {
    // lamp pendulum
    if (this.lamp) {
      this.lampPhase += dt * 2.6;
      this.lampSwing *= Math.exp(-0.35 * dt);
      this.lamp.rotation.z = Math.sin(this.lampPhase) * this.lampSwing;
      this.lamp.rotation.x = Math.cos(this.lampPhase * 0.8) * this.lampSwing * 0.5;
      if (this.lampOn) {
        this.lampFlicker = Math.max(0, this.lampFlicker - dt * 1.5);
        const off = this.lampFlicker > 0 && Math.random() < this.lampFlicker * 0.5;
        const v = off ? 0.15 : 1 - Math.random() * 0.06;
        this.lampLight.intensity = 5.5 * v;
        this.bulbMat.emissiveIntensity = 3 * v;
      }
    }
    // cell door
    if (this.cellDoor) {
      this.doorOpen += (this.doorTarget - this.doorOpen) * Math.min(1, dt * (this.doorFast ? 14 : 2.5));
      this.cellDoor.rotation.y = this.doorOpen * 1.9;
    }
    if (this.burning && this.fireLight) {
      this.fireLight.intensity = 260 + Math.sin(t * 9) * 40 + Math.sin(t * 5.3) * 50 + Math.random() * 40;
      if (this.char < 1) {
        this.char = Math.min(1, this.char + dt / 25);
        const k = 1 - this.char * 0.72;
        this.charrable.forEach((m, i) => m.color.copy(this.charBase[i]).multiplyScalar(i === 3 ? 1 - this.char * 0.35 : k));
      }
    }
  }
}
