import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { boxUV, Batcher, M } from './fort.js';

// Chapter III set dressing along the long road (Kharsk Keep -> Hollin Ridge): a signpost,
// a looted wagon, an abandoned campsite, a Kharzan checkpoint and a rocky narrows.
// Positions are expressed as (distance along the road, sideways offset).
export const SITES = {
  sign: 10, wagon: 104, camp: 226, checkpoint: 338, narrows: 432,
};

export class Roadside {
  constructor(game, mats) {
    const { scene, terrain, physics } = game;
    this.game = game;
    this.terrain = terrain;
    this.group = new THREE.Group();
    scene.add(this.group);
    const rnd = mulberry32(2203);
    const B = new Batcher();
    const T = terrain;
    // (s, off) -> world point + local frame
    const frame = (s, off = 0) => {
      const a = T.road2PointAtS(s - 1), b = T.road2PointAtS(s + 1);
      const fx = b.x - a.x, fz = b.z - a.z, l = Math.hypot(fx, fz) || 1;
      const f = new THREE.Vector3(fx / l, 0, fz / l);
      const r = new THREE.Vector3(f.z, 0, -f.x); // right of travel
      const c = T.road2PointAtS(s);
      const p = new THREE.Vector3(c.x + r.x * off, 0, c.z + r.z * off);
      p.y = T.getHeight(p.x, p.z);
      return { p, f, r, yaw: Math.atan2(f.x, f.z) };
    };
    this.frame = frame;
    const box = (geo, mat, p, ry = 0, rx = 0, rz = 0, dy = 0) => B.add(geo, mat, M(p.x, p.y + dy, p.z, rx, ry, rz));
    const solid = (p, hx, hz, h, type = 'wood') => physics.addBox(new THREE.Vector3(p.x - hx, p.y - 0.5, p.z - hz), new THREE.Vector3(p.x + hx, p.y + h, p.z + hz), type);

    // ---------- signpost at the keep gate ----------
    {
      const F = frame(SITES.sign, 3.4);
      box(boxUV(0.14, 2.6, 0.14), mats.plank, F.p, 0, 0, 0, 1.3);
      const arm = boxUV(1.3, 0.24, 0.05);
      B.add(arm, mats.plank, M(F.p.x + F.f.x * 0.5, F.p.y + 2.2, F.p.z + F.f.z * 0.5, 0, F.yaw - Math.PI / 2, 0.06));
      B.add(arm, mats.plank, M(F.p.x - F.f.x * 0.4, F.p.y + 1.85, F.p.z - F.f.z * 0.4, 0, F.yaw - Math.PI / 2, -0.08));
      physics.addCircle(F.p.x, F.p.z, 0.15, 2.6, 'wood');
      this.sign = F.p.clone();
    }

    // ---------- looted wagon ----------
    {
      const F = frame(SITES.wagon, -4.2);
      box(boxUV(1.7, 0.55, 3.0), mats.plank, F.p, F.yaw + 0.5, 0, 0.32, 0.75);
      const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 14); wheel.rotateZ(Math.PI / 2);
      B.add(wheel, mats.plank, M(F.p.x + F.r.x * 0.9, F.p.y + 0.42, F.p.z + F.r.z * 0.9, 0, F.yaw + 0.5, 0.3));
      const lying = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 14);
      B.add(lying, mats.plank, M(F.p.x - F.f.x * 2.6 + F.r.x * 1.4, F.p.y + 0.06, F.p.z - F.f.z * 2.6 + F.r.z * 1.4, 0, 0, 0));
      solid(F.p, 1.6, 1.6, 1.4);
      const crate = boxUV(1, 1, 1, 0.9);
      for (let i = 0; i < 5; i++) {
        const s = 0.5 + rnd() * 0.4;
        const q = F.p.clone().addScaledVector(F.r, 1.6 + rnd() * 2.5).addScaledVector(F.f, (rnd() - 0.5) * 4);
        q.y = T.getHeight(q.x, q.z);
        B.add(crate, mats.plank, M(q.x, q.y + s / 2 - 0.05, q.z, rnd() * 0.3, rnd() * 6, rnd() * 0.3, s, s, s));
      }
      this.wagon = F;
      // the bandits' fire beside it
      const fire = frame(SITES.wagon + 6, -8.5);
      this._firePit(B, mats, fire.p, rnd);
      this.wagonFire = fire.p.clone();
    }

    // ---------- the abandoned camp (rest + read) ----------
    {
      const F = frame(SITES.camp, 6.5);
      this._firePit(B, mats, F.p, rnd);
      this.campFire = F.p.clone();
      // sitting log (on the road side of the fire)
      const logP = F.p.clone().addScaledVector(F.r, -1.5);
      logP.y = T.getHeight(logP.x, logP.z);
      B.add(new THREE.CylinderGeometry(0.24, 0.26, 2.2, 9), mats.bark, M(logP.x, logP.y + 0.2, logP.z, 0, F.yaw, Math.PI / 2));
      physics.addCircle(logP.x, logP.z, 0.35, 0.45, 'wood');
      this.campSeat = F.p.clone().addScaledVector(F.r, -1.15);
      this.campSeat.y = T.getHeight(this.campSeat.x, this.campSeat.z);
      this.campSeatYaw = Math.atan2(F.r.x, F.r.z); // facing the fire
      // bedroll + pot + pack
      const bed = F.p.clone().addScaledVector(F.r, 1.8).addScaledVector(F.f, 1.2);
      bed.y = T.getHeight(bed.x, bed.z);
      B.add(new THREE.CapsuleGeometry(0.28, 1.4, 4, 10).rotateZ(Math.PI / 2).scale(1, 0.45, 1), mats.canvas, M(bed.x, bed.y + 0.1, bed.z, 0, F.yaw + 0.3, 0));
      B.add(new THREE.CylinderGeometry(0.16, 0.13, 0.2, 10, 1, true), mats.metal, M(F.p.x + F.f.x * 0.75, F.p.y + 0.12, F.p.z + F.f.z * 0.75));
    }

    // ---------- Kharzan checkpoint ----------
    {
      const F = frame(SITES.checkpoint, 0);
      this.checkpoint = F;
      const bag = new THREE.CapsuleGeometry(0.15, 0.42, 3, 8);
      bag.rotateZ(Math.PI / 2); bag.scale(1, 0.75, 1.45);
      const sandWall = (center, len, yaw, rows = 4) => {
        const n = Math.max(1, Math.round(len / 0.68));
        const ax = Math.cos(yaw), az = -Math.sin(yaw);
        for (let r = 0; r < rows; r++) for (let i = 0; i < n - (r % 2); i++) {
          const t = (i + (r % 2) * 0.5 - (n - 1) / 2) * 0.68;
          const x = center.x + ax * t, z = center.z + az * t;
          B.add(bag, mats.sack, M(x, T.getHeight(x, z) + 0.12 + r * 0.24, z, (rnd() - 0.5) * 0.08, yaw + (rnd() - 0.5) * 0.12, 0));
        }
        const hx = Math.abs(ax) * len / 2 + 0.3, hz = Math.abs(az) * len / 2 + 0.3;
        physics.addBox(new THREE.Vector3(center.x - hx, center.y - 0.5, center.z - hz), new THREE.Vector3(center.x + hx, center.y + rows * 0.24, center.z + hz), 'sand');
      };
      // two nests flanking the road, facing the way the player comes from
      for (const side of [-1, 1]) {
        const c = F.p.clone().addScaledVector(F.r, side * 4.2).addScaledVector(F.f, -1.0);
        c.y = T.getHeight(c.x, c.z);
        sandWall(c, 3.4, F.yaw);
      }
      // barrier pole across the road
      for (const side of [-1, 1]) {
        const q = F.p.clone().addScaledVector(F.r, side * 2.4).addScaledVector(F.f, 1.5);
        q.y = T.getHeight(q.x, q.z);
        B.add(boxUV(0.18, 1.1, 0.18), mats.plank, M(q.x, q.y + 0.55, q.z));
      }
      const mid = F.p.clone().addScaledVector(F.f, 1.5);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.0, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb4532a, roughness: 0.7 }));
      pole.position.set(mid.x, mid.y + 1.05, mid.z);
      pole.rotation.set(0, F.yaw, 0);
      pole.castShadow = true;
      this.group.add(pole);
      // lantern post + tent
      const lp = F.p.clone().addScaledVector(F.r, 5.6).addScaledVector(F.f, 1.8);
      lp.y = T.getHeight(lp.x, lp.z);
      B.add(boxUV(0.12, 2.4, 0.12), mats.plank, M(lp.x, lp.y + 1.2, lp.z));
      this.lanternPos = lp.clone().add(new THREE.Vector3(0, 2.15, 0));
      const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.18), mats.glow);
      lantern.position.copy(this.lanternPos);
      this.group.add(lantern);
      const tp = F.p.clone().addScaledVector(F.r, -8).addScaledVector(F.f, 4);
      tp.y = T.getHeight(tp.x, tp.z);
      const sh = new THREE.Shape(); sh.moveTo(-1.4, 0); sh.lineTo(1.4, 0); sh.lineTo(0, 1.8); sh.closePath();
      const tg = new THREE.ExtrudeGeometry(sh, { depth: 3.2, bevelEnabled: false }); tg.translate(0, 0, -1.6);
      B.add(tg, mats.canvas, M(tp.x, tp.y, tp.z, 0, F.yaw, 0));
      physics.addBox(new THREE.Vector3(tp.x - 1.8, tp.y - 0.5, tp.z - 1.8), new THREE.Vector3(tp.x + 1.8, tp.y + 1.8, tp.z + 1.8), 'cloth');
    }

    // ---------- rocky narrows ----------
    {
      this.narrows = frame(SITES.narrows, 0);
      for (let i = 0; i < 26; i++) {
        const side = i % 2 ? 1 : -1;
        const F = frame(SITES.narrows - 22 + rnd() * 44, side * (6 + rnd() * 9));
        const s = 0.8 + rnd() * rnd() * 3.2;
        const g = new THREE.DodecahedronGeometry(1, 1);
        const gp = g.attributes.position;
        for (let k = 0; k < gp.count; k++) { const f = 0.8 + rnd() * 0.35; gp.setXYZ(k, gp.getX(k) * f, gp.getY(k) * f * 0.8, gp.getZ(k) * f); }
        g.computeVertexNormals();
        B.add(g, mats.stone, M(F.p.x, F.p.y + s * 0.35, F.p.z, rnd(), rnd() * 6, rnd(), s * (1 + rnd() * 0.6), s, s * (1 + rnd() * 0.5)));
        if (s > 0.9) physics.addCircle(F.p.x, F.p.z, s * 0.95, s * 1.1, 'stone');
      }
    }

    // ---------- mile posts ----------
    for (let s = 60; s < T.road2.length - 40; s += 95) {
      const F = frame(s, 3.1);
      box(boxUV(0.16, 0.9, 0.16), mats.plank, F.p, F.yaw, 0, 0.05, 0.45);
    }

    B.build(this.group);
  }

  _firePit(B, mats, p, rnd) {
    const T = this.terrain;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = p.x + Math.cos(a) * 0.6, z = p.z + Math.sin(a) * 0.6;
      B.add(new THREE.DodecahedronGeometry(0.17, 0), mats.stone, M(x, T.getHeight(x, z) + 0.07, z, rnd(), rnd(), rnd()));
    }
    for (let i = 0; i < 4; i++) B.add(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 6), mats.bark, M(p.x, p.y + 0.18, p.z, 1.1, (i / 4) * Math.PI * 2, 0));
  }

  // road position helper for the story: point on the road at s, offset sideways
  at(s, off = 0) { return this.frame(s, off).p; }
}
