import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { HQ } from './terrain.js';
import { boxUV, Batcher, M } from './fort.js';

// Chapter IV: Hollin Ridge's west approach, dug in during the two days the warning bought.
// From the fort outward (west): a sandbag fire trench, a flooded moat between earth banks,
// sharpened stakes, barbed wire, and a minefield behind skull-and-board warning signs.
export const DEF = {
  trenchX: HQ.x - HQ.half - 11, // 197
  moatX0: HQ.x - HQ.half - 22, moatX1: HQ.x - HQ.half - 17, // 186..191
  stakesX: HQ.x - HQ.half - 25,
  wireX: HQ.x - HQ.half - 33,
  mineX0: HQ.x - HQ.half - 70, mineX1: HQ.x - HQ.half - 38, // 138..170
  z0: HQ.z - 34, z1: HQ.z + 36,
};

export class Defenses {
  constructor(game, mats) {
    const { scene, terrain, physics, T } = game;
    this.game = game;
    this.group = new THREE.Group();
    this.group.visible = false; // dug while you were on the road
    scene.add(this.group);
    const rnd = mulberry32(777);
    const B = new Batcher();
    const H = (x, z) => terrain.getHeight(x, z);
    const dirt = new THREE.MeshStandardMaterial({ map: T.dirt || null, color: 0x6a5238, roughness: 1 });
    const water = new THREE.MeshStandardMaterial({ color: 0x15242a, roughness: 0.06, metalness: 0.55 });
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.6, metalness: 0.7 });
    this.colliderBoxes = [];
    const solid = (min, max, type) => { this.colliderBoxes.push([min, max, type]); };

    // ---- fire trench: four rows of sandbags along the whole west face ----
    const bag = new THREE.CapsuleGeometry(0.15, 0.42, 3, 8);
    bag.rotateZ(Math.PI / 2); bag.scale(1, 0.75, 1.45);
    const tx = DEF.trenchX;
    const n = Math.round((DEF.z1 - DEF.z0) / 0.68);
    for (let r = 0; r < 4; r++) for (let i = 0; i < n - (r % 2); i++) {
      const z = DEF.z0 + (i + (r % 2) * 0.5) * 0.68;
      B.add(bag, mats.sack, M(tx, H(tx, z) + 0.12 + r * 0.24, z, (rnd() - 0.5) * 0.08, Math.PI / 2 + (rnd() - 0.5) * 0.12, 0));
    }
    solid(new THREE.Vector3(tx - 0.35, -50, DEF.z0 - 0.3), new THREE.Vector3(tx + 0.35, H(tx, HQ.z) + 1.0, DEF.z1 + 0.3), 'sand');
    // firing spots behind the bags (east side), facing west
    this.spots = [];
    for (let z = DEF.z0 + 3; z < DEF.z1 - 2; z += 5.5) {
      const p = new THREE.Vector3(tx + 0.85, 0, z); p.y = H(p.x, p.z);
      this.spots.push({ pos: p, face: new THREE.Vector3(DEF.mineX0, p.y, z), taken: false });
    }
    // ammunition crates in the trench
    this.ammo = [];
    for (const z of [HQ.z - 8, HQ.z + 14]) {
      const p = new THREE.Vector3(tx + 2.2, 0, z); p.y = H(p.x, p.z);
      B.add(boxUV(1.0, 0.5, 0.6, 0.9), mats.plank, M(p.x, p.y + 0.25, p.z, 0, 0.2, 0));
      B.add(boxUV(1.04, 0.06, 0.64), mats.metal, M(p.x, p.y + 0.52, p.z, 0, 0.2, 0));
      solid(new THREE.Vector3(p.x - 0.55, -50, p.z - 0.4), new THREE.Vector3(p.x + 0.55, p.y + 0.55, p.z + 0.4), 'wood');
      this.ammo.push(p);
    }

    // ---- moat: water between two earth banks ----
    const mx = (DEF.moatX0 + DEF.moatX1) / 2, mw = DEF.moatX1 - DEF.moatX0, len = DEF.z1 - DEF.z0 + 8;
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const z = DEF.z0 - 4 + (i + 0.5) * (len / segs);
      const y = H(mx, z);
      B.add(new THREE.PlaneGeometry(mw, len / segs + 0.05).rotateX(-Math.PI / 2), water, M(mx, y + 0.06, z));
      for (const side of [-1, 1]) {
        const bx = mx + side * (mw / 2 + 0.55);
        B.add(new THREE.CylinderGeometry(0.75, 0.75, len / segs + 0.3, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.55, 1), dirt, M(bx, H(bx, z) - 0.05, z, 0, side > 0 ? 0 : Math.PI, 0));
      }
    }
    solid(new THREE.Vector3(DEF.moatX0 - 0.6, -50, DEF.z0 - 4), new THREE.Vector3(DEF.moatX1 + 0.6, H(mx, HQ.z) + 0.9, DEF.z1 + 4), 'dirt');

    // ---- stakes leaning toward the enemy ----
    const stake = new THREE.ConeGeometry(0.09, 1.9, 6); stake.translate(0, 0.95, 0);
    for (let z = DEF.z0 - 2; z < DEF.z1 + 2; z += 1.1) {
      const x = DEF.stakesX + (rnd() - 0.5) * 0.6;
      B.add(stake, mats.bark, M(x, H(x, z) - 0.2, z, 0, 0, 0.75 + (rnd() - 0.5) * 0.2));
    }

    // ---- barbed wire on X-posts ----
    for (let z = DEF.z0 - 4; z < DEF.z1 + 4; z += 3.2) {
      const x = DEF.wireX, y = H(x, z);
      for (const s of [-1, 1]) B.add(boxUV(0.07, 1.3, 0.07), mats.plank, M(x, y + 0.55, z, s * 0.45, 0, 0));
      const coil = new THREE.TorusGeometry(0.42, 0.012, 4, 14);
      for (let k = 0; k < 5; k++) B.add(coil, wireMat, M(x, y + 0.45, z + k * 0.64 - 1.3, 0, Math.PI / 2 + (rnd() - 0.5) * 0.3, rnd() * 0.3));
    }

    // ---- minefield: buried mines + warning boards ----
    this.mines = [];
    const mineGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.06, 10);
    for (let i = 0; i < 46; i++) {
      const x = DEF.mineX0 + rnd() * (DEF.mineX1 - DEF.mineX0), z = DEF.z0 + rnd() * (DEF.z1 - DEF.z0);
      const y = H(x, z);
      B.add(mineGeo, mats.metal, M(x, y + 0.01, z));
      this.mines.push({ p: new THREE.Vector3(x, y, z), live: true });
    }
    const sign = this._signTexture();
    const signMat = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.9 });
    for (let z = DEF.z0; z <= DEF.z1; z += 14) {
      const x = DEF.mineX0 - 4, y = H(x, z);
      B.add(boxUV(0.08, 1.4, 0.08), mats.plank, M(x, y + 0.7, z));
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), signMat);
      board.position.set(x - 0.05, y + 1.25, z); board.rotation.y = -Math.PI / 2 + (rnd() - 0.5) * 0.3;
      board.castShadow = true;
      this.group.add(board);
    }

    B.build(this.group);
  }

  _signTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const x = c.getContext('2d');
    x.fillStyle = '#b9a47c'; x.fillRect(0, 0, 256, 160);
    x.strokeStyle = '#6a1c14'; x.lineWidth = 10; x.strokeRect(6, 6, 244, 148);
    x.fillStyle = '#6a1c14'; x.font = 'bold 54px Georgia, serif'; x.textAlign = 'center'; x.fillText('MINES', 128, 136);
    // a crude skull
    x.beginPath(); x.arc(128, 52, 30, 0, Math.PI * 2); x.fill();
    x.fillRect(110, 70, 36, 20);
    x.fillStyle = '#b9a47c';
    x.beginPath(); x.arc(116, 50, 8, 0, Math.PI * 2); x.arc(140, 50, 8, 0, Math.PI * 2); x.fill();
    x.fillRect(118, 80, 4, 10); x.fillRect(126, 80, 4, 10); x.fillRect(134, 80, 4, 10);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // the works appear (and become solid) when Chapter IV begins
  show() {
    if (this.group.visible) return;
    this.group.visible = true;
    this.game.atmo.setupScene(this.group);
    for (const [min, max, type] of this.colliderBoxes) this.game.physics.addBox(min, max, type, 'hq-works');
  }
}
