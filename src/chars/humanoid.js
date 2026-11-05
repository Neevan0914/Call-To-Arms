import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp, smoothstep, easeInOut } from '../core/utils.js';

// Skeleton proportions (fitted to the soldier models: shoulders 1.40 m, wrists 0.89 m, hips 0.87 m).
export const HIP_Y = 0.92, THIGH = 0.40, SHIN = 0.39, UPPER = 0.285, FORE = 0.235;
const SH_L = new THREE.Vector3(0.185, 0.125, -0.01);
const SH_R = new THREE.Vector3(-0.185, 0.125, -0.01);
// Arm direction of the models' relaxed A-pose (bind pose), left side.
const BIND_ARM_L = new THREE.Vector3(0.204, -0.978, 0.04).normalize();
const BIND_ARM_R = new THREE.Vector3(-0.204, -0.978, 0.04).normalize();
export const BONE_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'handL', 'shR', 'elR', 'handR', 'thL', 'knL', 'ftL', 'thR', 'knR', 'ftR'];

export const UNIFORMS = {
  velmora: {
    tunic: 0x6c6747, trousers: 0x5f5b40, puttee: 0x544f37, boots: 0x2e2116, belt: 0x5a3b22,
    helmet: 'velmora', helmetColor: 0x4b5040, tabs: 0x7a1b2a, brass: 0xb08d57, pack: true,
  },
  velmoraOfficer: {
    tunic: 0x625d3f, trousers: 0x57533a, puttee: null, tallBoots: 0x3a2618, boots: 0x3a2618, belt: 0x4a2c18,
    helmet: 'cap', capColor: 0x5d593d, band: 0x7a1b2a, tabs: 0x7a1b2a, brass: 0xc9a050, mustache: true,
  },
  velmoraQM: {
    tunic: 0x6c6747, trousers: 0x5f5b40, puttee: 0x544f37, boots: 0x2e2116, belt: 0x5a3b22,
    helmet: 'sidecap', capColor: 0x625d40, tabs: 0x7a1b2a, brass: 0xb08d57, apron: true,
  },
  player: {
    tunic: 0x6a6546, trousers: 0x5c583e, puttee: 0x504b34, boots: 0x2b1e14, belt: 0x553821,
    helmet: 'none', hair: 0x2a1c12, bandage: true, tabs: 0x7a1b2a, brass: 0xa08050, dirty: true,
  },
  kharzan: {
    tunic: 0x4a5258, trousers: 0x3c4348, puttee: null, tallBoots: 0x171513, boots: 0x171513, belt: 0x1d1a17,
    helmet: 'kharzan', helmetColor: 0x394045, tabs: 0xb4532a, armband: 0xb4532a, brass: 0x7d7d78, pack: false, canteen: true,
  },
  kharzanCoat: {
    tunic: 0x4f575b, trousers: 0x3c4348, puttee: null, tallBoots: 0x171513, boots: 0x171513, belt: 0x1d1a17,
    helmet: 'kharzan', helmetColor: 0x343a3e, tabs: 0xb4532a, armband: 0xb4532a, brass: 0x7d7d78, coat: true, gasmask: true,
  },
};

const SKINS = [0xe2b996, 0xd6a581, 0xc89069, 0xb07b52, 0xeec4a3, 0x9c6a45];

let SHARED = null;
function sharedMaterials(T) {
  if (SHARED) return SHARED;
  SHARED = {
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, normalMap: T.fabricN, normalScale: new THREE.Vector2(0.6, 0.6) }),
    skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide }),
  };
  return SHARED;
}

function shade(hex, k) { return new THREE.Color(hex).multiplyScalar(k); }

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Humanoid {
  constructor(cfg, T, { seed = Math.random(), skin = null, model = null } = {}) {
    this.cfg = cfg;
    this.model = model;
    this.rand = seed;
    const r = (k) => { const x = Math.sin((seed * 9301 + k * 49297) % 233280) * 43758.5453; return x - Math.floor(x); };
    this.skinColor = skin ?? SKINS[Math.floor(r(1) * SKINS.length)];
    this.tint = 0.9 + r(2) * 0.2;
    const mats = sharedMaterials(T);
    this.mats = mats;

    const G = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Bone(); g.position.set(x, y, z); parent.add(g); return g; };
    this.root = new THREE.Group();
    this.body = G(this.root);
    this.hips = G(this.body, 0, HIP_Y, 0);
    this.spine = G(this.hips, 0, 0.12, 0);
    this.chest = G(this.spine, 0, 0.235, 0);
    this.neck = G(this.chest, 0, 0.205, 0);
    this.head = G(this.neck, 0, 0.16, 0.0);
    this.headgear = G(this.head);
    this.shL = G(this.chest, SH_L.x, SH_L.y, SH_L.z); this.elL = G(this.shL, 0, -UPPER, 0); this.handL = G(this.elL, 0, -FORE, 0);
    this.shR = G(this.chest, SH_R.x, SH_R.y, SH_R.z); this.elR = G(this.shR, 0, -UPPER, 0); this.handR = G(this.elR, 0, -FORE, 0);
    this.thL = G(this.hips, 0.095, -0.05, 0); this.knL = G(this.thL, 0, -THIGH, 0); this.ftL = G(this.knL, 0, -SHIN, 0);
    this.thR = G(this.hips, -0.095, -0.05, 0); this.knR = G(this.thR, 0, -THIGH, 0); this.ftR = G(this.knR, 0, -SHIN, 0);
    this.mount = G(this.chest);
    this.backMount = G(this.chest, 0, 0.03, -0.17);
    this.hipMount = G(this.hips, 0.19, -0.02, 0.02);

    this.bones = BONE_NAMES.map((n) => this[n]);
    if (model) {
      // models' heads are a touch larger than the procedural one; fit headgear to them
      this.headgear.position.set(0, 0.0, 0.006);
      this.headgear.scale.set(0.9, 0.92, 0.95);
    }
    this._build();
    if (model) this._attachModel(model);

    this.a = {
      speed: 0, crouch: 0, aim: 0, pitch: 0, weapon: 'none', swing: -1, swingVariant: 0, recoil: 0, reload: -1,
      lookTarget: null, talk: 0, phase: Math.random() * 6, getup: -1, hurt: 0, dead: false, deathT: 0, deathDir: 1,
      thrust: -1, wave: 0, salute: 0, offer: 0,
    };
    this.walk = 0;
    this.t = Math.random() * 10;
    this.weaponModel = null;
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3(); this._v4 = new THREE.Vector3();
    this._gR = new THREE.Vector3(); this._gL = new THREE.Vector3();
    this._lookYaw = 0; this._lookPitch = 0;
    this._hit = [];
    for (let i = 0; i < 8; i++) this._hit.push({ c: new THREE.Vector3(), r: 0.1, part: 'body' });
  }

  _build() {
    const c = this.cfg, tint = this.tint;
    const tunic = shade(c.tunic, tint), trousers = shade(c.trousers, tint), belt = new THREE.Color(c.belt);
    const skin = new THREE.Color(this.skinColor);
    const lists = new Map();
    const add = (bone, geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], bucket = 'cloth') => {
      let g = geo.index ? geo.toNonIndexed() : geo.clone();
      _e.set(rot[0], rot[1], rot[2]); _q.setFromEuler(_e);
      _m.compose(new THREE.Vector3(...pos), _q, new THREE.Vector3(...scl));
      g.applyMatrix4(_m);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      const col = color instanceof THREE.Color ? color : new THREE.Color(color);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      if (!lists.has(bone)) lists.set(bone, { cloth: [], skin: [], metal: [] });
      lists.get(bone)[bucket].push(g);
    };
    const S = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
    const Cap = (r, l, rs = 10) => new THREE.CapsuleGeometry(r, l, 4, rs);
    const Cyl = (a, b, h, s = 12, open = false) => new THREE.CylinderGeometry(a, b, h, s, 1, open);
    const Box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
    const dark = (col, k) => col.clone().multiplyScalar(k);

    const M = this.model;
    const HG = this.headgear;
    // ---- head ----
    if (!M) {
    add(this.head, S(0.104, 18, 14), skin, [0, 0, 0], [0, 0, 0], [0.93, 1.06, 1.0], 'skin');
    add(this.head, S(0.07, 14, 10), skin, [0, -0.058, 0.028], [0, 0, 0], [1.05, 0.82, 1.0], 'skin');
    add(this.head, Box(0.024, 0.045, 0.03), dark(skin, 0.95), [0, -0.008, 0.104], [-0.25, 0, 0], [1, 1, 1], 'skin');
    for (const s of [-1, 1]) {
      add(this.head, S(0.013, 8, 6), 0x15100c, [s * 0.036, 0.017, 0.087], [0, 0, 0], [1, 0.8, 0.6], 'skin');
      add(this.head, Box(0.036, 0.009, 0.012), c.hair ?? 0x2a2018, [s * 0.036, 0.038, 0.094], [0, 0, s * -0.12], [1, 1, 1], 'skin');
      add(this.head, S(0.024, 8, 6), dark(skin, 0.93), [s * 0.097, -0.005, -0.005], [0, 0, 0], [0.5, 1, 0.8], 'skin');
    }
    add(this.head, Box(0.036, 0.007, 0.01), dark(skin, 0.7), [0, -0.052, 0.094], [0, 0, 0], [1, 1, 1], 'skin');
    if (c.mustache) add(this.head, Box(0.055, 0.013, 0.016), 0x2c2016, [0, -0.034, 0.1], [0, 0, 0], [1, 1, 1], 'skin');
    if (c.dirty) {
      add(this.head, S(0.02, 6, 4), dark(skin, 0.6), [0.05, 0.05, 0.07], [0, 0, 0], [1.4, 0.5, 0.3], 'skin');
      add(this.head, S(0.018, 6, 4), dark(skin, 0.55), [-0.06, -0.04, 0.075], [0, 0, 0], [1.2, 0.7, 0.3], 'skin');
    }
    }
    if (!M && (c.helmet === 'none' || c.bandage)) {
      const hair = new THREE.SphereGeometry(0.112, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
      add(this.head, hair, c.hair ?? 0x2a1c12, [0, 0.006, -0.008], [-0.25, 0, 0], [0.97, 1.0, 1.04], 'skin');
    }
    if (c.bandage) {
      add(HG, Cyl(0.113, 0.11, 0.035, 18, true), 0xd8cfb8, [0, 0.045, -0.004], [-0.22, 0, 0.12], [0.97, 1, 1.04]);
      add(HG, S(0.02, 6, 4), 0x7a2a20, [0.045, 0.06, 0.095], [0, 0, 0], [1.3, 0.8, 0.4]);
    }
    if (c.helmet === 'kharzan') {
      const prof = [[0.0, 0.135], [0.05, 0.131], [0.09, 0.112], [0.118, 0.072], [0.129, 0.025], [0.132, -0.01], [0.148, -0.045], [0.163, -0.07], [0.166, -0.077]].map((p) => new THREE.Vector2(p[0], p[1]));
      add(HG, new THREE.LatheGeometry(prof, 20), c.helmetColor, [0, 0.055, -0.012], [0, 0, 0], [1, 1, 1.06], 'metal');
      add(HG, Box(0.012, 0.022, 0.17), dark(new THREE.Color(c.helmetColor), 0.9), [0, 0.19, -0.012], [0, 0, 0], [1, 1, 1], 'metal');
      for (const s of [-1, 1]) add(HG, Cyl(0.009, 0.009, 0.012, 8), 0x22262a, [s * 0.128, 0.09, -0.01], [0, 0, Math.PI / 2], [1, 1, 1], 'metal');
      add(HG, Box(0.01, 0.07, 0.008), 0x1d1a17, [0.07, -0.04, 0.07], [0.0, 0, 0.3], [1, 1, 1]); // chin strap
    } else if (c.helmet === 'velmora' && !M) {
      const prof = [[0.0, 0.128], [0.06, 0.123], [0.1, 0.098], [0.122, 0.055], [0.128, 0.01], [0.15, -0.006], [0.172, -0.016], [0.174, -0.022]].map((p) => new THREE.Vector2(p[0], p[1]));
      add(HG, new THREE.LatheGeometry(prof, 20), c.helmetColor, [0, 0.06, -0.006], [0.06, 0, 0], [1, 1, 1.1], 'metal');
      add(HG, Box(0.022, 0.03, 0.2), dark(new THREE.Color(c.helmetColor), 0.92), [0, 0.18, -0.006], [0.06, 0, 0], [1, 1, 1], 'metal');
      add(HG, Box(0.03, 0.03, 0.006), c.brass, [0, 0.1, 0.118], [0.3, 0, 0], [1, 1, 1], 'metal');
      add(HG, Box(0.01, 0.07, 0.008), 0x3a2618, [0.075, -0.04, 0.065], [0.0, 0, 0.3], [1, 1, 1]);
    } else if (c.helmet === 'cap') {
      add(HG, Cyl(0.132, 0.112, 0.06, 18), c.capColor, [0, 0.105, -0.006], [-0.08, 0, 0], [1.08, 1, 1.15]);
      add(HG, Cyl(0.113, 0.113, 0.035, 18), c.band, [0, 0.07, 0.0], [-0.08, 0, 0], [1, 1, 1.05]);
      add(HG, new THREE.CylinderGeometry(0.115, 0.115, 0.008, 16, 1, false, -Math.PI / 2, Math.PI), 0x111111, [0, 0.055, 0.02], [0.32, 0, 0], [1, 1, 0.75], 'metal');
      add(HG, Box(0.03, 0.034, 0.008), c.brass, [0, 0.105, 0.125], [-0.1, 0, 0], [1, 1, 1], 'metal');
    } else if (c.helmet === 'sidecap') {
      add(HG, Box(0.1, 0.065, 0.23), c.capColor, [0, 0.105, 0], [0, 0, 0.18], [1, 1, 1]);
      add(HG, Box(0.02, 0.02, 0.006), c.brass, [0.03, 0.105, 0.116], [0, 0, 0], [1, 1, 1], 'metal');
    }
    if (!M) {
    // neck
    add(this.neck, Cyl(0.048, 0.054, 0.11, 10), skin, [0, 0.03, 0.0], [0, 0, 0], [1, 1, 1], 'skin');

    // ---- chest ----
    add(this.chest, Cap(0.16, 0.16, 14), tunic, [0, 0.04, 0], [0, 0, 0], [1.12, 1, 0.72]);
    add(this.chest, Cyl(0.068, 0.086, 0.06, 12), tunic, [0, 0.215, 0.0]);
    for (const s of [-1, 1]) {
      add(this.chest, Box(0.024, 0.026, 0.012), c.tabs, [s * 0.052, 0.214, 0.066], [0, s * 0.5, 0]);
      add(this.chest, Box(0.07, 0.075, 0.016), dark(tunic, 0.92), [s * 0.072, 0.09, 0.11], [-0.1, 0, 0]);
      add(this.chest, Box(0.074, 0.025, 0.02), dark(tunic, 0.9), [s * 0.072, 0.13, 0.113], [-0.1, 0, 0]);
      add(this.chest, Box(0.065, 0.014, 0.13), dark(tunic, 0.88), [s * 0.14, 0.2, -0.005], [0, 0, s * -0.25]);
    }
    for (const y of [0.17, 0.1, 0.03, -0.04, -0.11]) add(this.chest, S(0.0075, 6, 4), c.brass, [0, y, 0.118 - Math.max(0, -y) * 0.05], [0, 0, 0], [1, 1, 1], 'metal');
    if (c.tallBoots && c.helmet === 'cap') {
      add(this.chest, Box(0.035, 0.46, 0.012), c.belt, [0.05, 0.0, 0.118], [0.05, 0, 0.42]); // Sam Browne strap
    } else {
      add(this.chest, Box(0.036, 0.44, 0.012), c.belt, [0.06, 0.0, 0.117], [0.06, 0, 0.38]);
      add(this.chest, Box(0.036, 0.44, 0.012), c.belt, [-0.06, 0.0, 0.117], [0.06, 0, -0.38]);
      add(this.chest, Box(0.036, 0.44, 0.012), c.belt, [0.0, 0.0, -0.118], [0, 0, 0.0]);
    }
    if (c.pack) {
      add(this.chest, Box(0.27, 0.28, 0.11), dark(tunic, 0.82), [0, 0.02, -0.165]);
      add(this.chest, Cyl(0.055, 0.055, 0.36, 10), 0x4c4a3c, [0, 0.2, -0.165], [0, 0, Math.PI / 2]);
    }
    if (c.gasmask) add(this.chest, Cyl(0.055, 0.055, 0.24, 12), 0x3c4246, [0.13, -0.2, -0.13], [0.15, 0, 0], [1, 1, 1], 'metal');
    if (c.canteen) add(this.chest, Cyl(0.05, 0.05, 0.14, 10), 0x2e3438, [-0.16, -0.26, -0.09], [0, 0, 0], [1, 1, 0.7], 'metal');

    // ---- spine / abdomen ----
    add(this.spine, Cyl(0.155, 0.162, 0.25, 14), tunic, [0, 0.07, 0], [0, 0, 0], [1, 1, 0.75]);
    add(this.spine, Cyl(0.168, 0.168, 0.052, 16), belt, [0, -0.02, 0], [0, 0, 0], [1, 1, 0.77]);
    add(this.spine, Box(0.05, 0.042, 0.014), c.brass, [0, -0.02, 0.13], [0, 0, 0], [1, 1, 1], 'metal');
    for (const s of [-1, 1]) {
      add(this.spine, Box(0.066, 0.064, 0.042), belt, [s * 0.072, -0.025, 0.128]);
      add(this.spine, Box(0.066, 0.064, 0.042), belt, [s * 0.132, -0.025, 0.085], [0, s * 0.65, 0]);
    }
    if (c.apron) add(this.spine, Box(0.3, 0.5, 0.01), 0x8a7a5a, [0, -0.17, 0.13], [-0.08, 0, 0]);

    // ---- hips ----
    add(this.hips, S(0.155, 14, 10), trousers, [0, 0, 0], [0, 0, 0], [1.05, 0.72, 0.78]);
    if (c.coat) add(this.hips, Cyl(0.17, 0.27, 0.66, 16, true), tunic, [0, -0.3, 0], [0, 0, 0], [1, 1, 0.82]);
    else add(this.hips, Cyl(0.168, 0.19, 0.19, 16, true), tunic, [0, -0.045, 0], [0, 0, 0], [1, 1, 0.8]);

    // ---- arms ----
    for (const side of ['L', 'R']) {
      const sh = this['sh' + side], el = this['el' + side], hand = this['hand' + side];
      const sx = side === 'L' ? 1 : -1;
      add(sh, S(0.068, 12, 8), tunic, [0, -0.01, 0]);
      add(sh, Cap(0.05, 0.18, 10), tunic, [0, -0.145, 0]);
      if (c.armband && side === 'L') add(sh, Cyl(0.055, 0.055, 0.05, 12), c.armband, [0, -0.1, 0]);
      add(el, Cap(0.044, 0.17, 10), tunic, [0, -0.13, 0]);
      add(el, Cyl(0.048, 0.048, 0.045, 10), dark(tunic, 0.88), [0, -0.235, 0]);
      add(hand, S(0.045, 10, 8), skin, [0, -0.045, 0.004], [0, 0, 0], [0.82, 1.15, 0.55], 'skin');
      add(hand, Cap(0.013, 0.03, 6), skin, [sx * -0.028, -0.03, 0.02], [0.5, 0, sx * 0.4], [1, 1, 1], 'skin');
    }
    // ---- legs ----
    for (const side of ['L', 'R']) {
      const th = this['th' + side], kn = this['kn' + side], ft = this['ft' + side];
      add(th, Cap(0.074, 0.26, 12), trousers, [0, -0.2, 0], [0, 0, 0], [1.14, 1, 1.05]);
      if (c.tallBoots) {
        add(kn, Cap(0.056, 0.14, 10), trousers, [0, -0.07, 0]);
        add(kn, Cyl(0.064, 0.058, 0.34, 12), c.tallBoots, [0, -0.25, 0.0], [0, 0, 0], [1, 1, 1], 'metal');
      } else {
        add(kn, Cap(0.055, 0.28, 10), c.puttee, [0, -0.2, 0]);
        add(kn, Cyl(0.06, 0.06, 0.02, 10), dark(new THREE.Color(c.puttee), 0.8), [0, -0.12, 0]);
      }
      add(ft, Box(0.095, 0.075, 0.2), c.boots, [0, -0.03, 0.04], [0, 0, 0], [1, 1, 1], 'metal');
      add(ft, S(0.048, 10, 8), c.boots, [0, -0.036, 0.13], [0, 0, 0], [1, 0.78, 1.15], 'metal');
      add(ft, Box(0.102, 0.02, 0.25), 0x120e0b, [0, -0.07, 0.05], [0, 0, 0], [1, 1, 1]);
    }

    }
    this.meshes = [];
    for (const [bone, b] of lists) {
      for (const k of ['cloth', 'skin', 'metal']) {
        if (!b[k].length) continue;
        const mesh = new THREE.Mesh(mergeGeometries(b[k]), this.mats[k]);
        mesh.castShadow = true; mesh.receiveShadow = true;
        bone.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }

  // Bind pose of the soldier models (relaxed A-pose) used for auto-rigging.
  setBindPose() {
    for (const b of this.bones) b.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.hips.position.y = HIP_Y;
    this.shL.quaternion.setFromUnitVectors(DOWN, BIND_ARM_L);
    this.shR.quaternion.setFromUnitVectors(DOWN, BIND_ARM_R);
  }

  _attachModel(model) {
    const { template, matFor, showHelmet } = model;
    this.skeleton = new THREE.Skeleton(this.bones, template.boneInverses);
    const ident = new THREE.Matrix4();
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
    this.lodMeshes = template.lods.map((parts, li) => parts
      .filter((p) => p.key !== 'helmet' || showHelmet)
      .map((p) => {
        const m = new THREE.SkinnedMesh(p.geometry, matFor(p));
        m.bind(this.skeleton, ident);
        m.boundingSphere = sphere;
        m.castShadow = true; m.receiveShadow = true;
        m.userData.sharedGeometry = true;
        m.visible = li === 0;
        this.root.add(m);
        return m;
      }));
    this.lod = 0;
    this.meshes.push(...this.lodMeshes.flat());
  }

  setLod(i) {
    if (!this.lodMeshes || i === this.lod || !this.lodMeshes[i]) return;
    this.lod = i;
    this.lodMeshes.forEach((list, k) => list.forEach((m) => { m.visible = k === i; }));
  }

  // models' hands extend past the wrist bone: aim the palm (not the wrist) at a grip
  _palm(target, S) {
    if (!this.model) return target;
    const d = this._v4.subVectors(S, target);
    const l = d.length();
    if (l > 1e-4) target.addScaledVector(d, 0.075 / l);
    return target;
  }

  setWeaponModel(model) {
    while (this.mount.children.length) this.mount.remove(this.mount.children[0]);
    this.weaponModel = model;
    if (model) { this.mount.add(model); this.a.weapon = model.userData.type; } else this.a.weapon = 'none';
  }

  setBackModel(model, slot = 0) {
    if (!this.backSlots) this.backSlots = [];
    const old = this.backSlots[slot];
    if (old) this.backMount.remove(old);
    this.backSlots[slot] = null;
    if (!model) return;
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.x = -Math.PI / 2; // muzzle up, sights facing away from the back
    model.position.set(0, 0, -0.6);
    model.rotation.set(0, 0, 0);
    inner.add(model);
    g.add(inner);
    g.position.set(0, 0.02, this.cfg.pack ? -0.08 : -0.02 - slot * 0.03);
    g.rotation.z = slot ? -0.62 : 0.62;
    this.backMount.add(g);
    this.backSlots[slot] = g;
  }

  // two-bone IK in chest space
  _ik(sh, el, S, T, pole) {
    const v = this._v1.subVectors(T, S);
    let d = v.length();
    const maxR = UPPER + FORE - 0.005;
    d = clamp(d, 0.08, maxR);
    const dir = v.normalize();
    const cosA = clamp((UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d), -1, 1);
    const A = Math.acos(cosA);
    const pv = this._v2.subVectors(pole, S);
    pv.addScaledVector(dir, -pv.dot(dir));
    if (pv.lengthSq() < 1e-8) pv.set(0, -1, 0);
    pv.normalize();
    const upperDir = this._v3.copy(dir).multiplyScalar(Math.cos(A)).addScaledVector(pv, Math.sin(A)).normalize();
    sh.quaternion.setFromUnitVectors(DOWN, upperDir);
    // elbow position & forearm dir
    const Tc = this._v4.copy(S).addScaledVector(dir, d);
    const E = this._v2.copy(S).addScaledVector(upperDir, UPPER);
    const f = Tc.sub(E).normalize();
    _q.copy(sh.quaternion).invert();
    f.applyQuaternion(_q);
    el.quaternion.setFromUnitVectors(DOWN, f);
  }

  _freeArm(sh, el, side, swing, out = 0, bend = 0.25) {
    sh.rotation.set(swing, 0, side * (0.1 + out));
    el.rotation.set(-bend - Math.max(0, swing) * 0.4, 0, 0);
  }

  _setMount(px, py, pz, rx, ry, rz) {
    this.mount.position.set(px, py, pz);
    this.mount.rotation.set(rx, ry, rz);
  }

  update(dt) {
    const a = this.a;
    this.t += dt;
    const dead = a.dead;
    const spd = dead ? 0 : a.speed;
    a.phase += dt * (spd > 0.05 ? 3.4 + spd * 1.15 : 0);
    this.walk = damp(this.walk, clamp(spd / 1.2, 0, 1), 8, dt);
    const amp = clamp(spd / 5.5, 0, 1);
    const wk = this.walk;
    const A = (0.24 + 0.46 * amp) * wk, Bk = (0.35 + 0.95 * amp) * wk;
    const ph = a.phase, s = Math.sin(ph), cph = Math.cos(ph);
    let thL = -s * A, thR = s * A;
    let knL = 0.06 + Bk * Math.max(0, cph), knR = 0.06 + Bk * Math.max(0, -cph);
    let hipY = HIP_Y - 0.025 * amp * wk + (Math.abs(cph) - 0.5) * 0.045 * amp * wk;
    const breath = Math.sin(this.t * 1.6) * 0.01;
    let spineX = 0.1 * amp * wk + breath, chestX = breath * 0.5, spineY = -s * 0.1 * amp * wk, hipsRY = s * 0.08 * amp * wk;
    let chestZ = 0, spineZ = 0;
    // crouch
    const cr = a.crouch * (1 - wk * 0.4);
    thL += -1.0 * cr; thR += -0.85 * cr; knL += 1.7 * cr; knR += 1.5 * cr; hipY -= 0.3 * cr; spineX += 0.25 * cr;
    // aim pitch
    const pitch = clamp(a.pitch, -1.1, 1.1);
    spineX -= pitch * 0.45; chestX -= pitch * 0.45;
    // hurt flinch
    if (a.hurt > 0) { a.hurt = Math.max(0, a.hurt - dt * 4); spineX -= a.hurt * 0.2; chestZ += a.hurt * 0.1 * Math.sin(this.t * 30); }

    let footL = -(thL + knL) * 0.75, footR = -(thR + knR) * 0.75;
    let poseArms = null;

    // ---- get-up from lying (wake-up cutscene) ----
    if (a.getup >= 0) {
      const g = a.getup;
      const P = [
        { t: 0.0, hipY: 0.14, spineX: -1.48, chestX: -0.05, th: -1.52, kn: 0.12, ft: 0.5, shX: 0.2, shZ: 0.15, elX: -0.2 },
        { t: 0.3, hipY: 0.17, spineX: -0.15, chestX: 0.1, th: -1.5, kn: 0.25, ft: 0.4, shX: 0.55, shZ: 0.35, elX: -0.1 },
        { t: 0.62, hipY: 0.5, spineX: 0.55, chestX: 0.15, th: -1.75, kn: 2.1, ft: -0.35, shX: -0.55, shZ: 0.15, elX: -0.6 },
        { t: 1.0, hipY: HIP_Y, spineX: 0.0, chestX: 0.0, th: 0.0, kn: 0.05, ft: 0, shX: 0, shZ: 0.08, elX: -0.2 },
      ];
      let i = 0;
      while (i < P.length - 2 && g > P[i + 1].t) i++;
      const p0 = P[i], p1 = P[i + 1];
      const k = easeInOut(clamp((g - p0.t) / (p1.t - p0.t), 0, 1));
      const L = (key) => lerp(p0[key], p1[key], k);
      hipY = L('hipY'); spineX = L('spineX'); chestX = L('chestX');
      thL = L('th'); thR = L('th') + (g > 0.3 && g < 0.62 ? 0.25 * Math.sin(((g - 0.3) / 0.32) * Math.PI) : 0);
      knL = L('kn'); knR = L('kn');
      footL = footR = L('ft');
      spineY = 0; hipsRY = 0;
      poseArms = { shX: L('shX'), shZ: L('shZ'), elX: L('elX') };
      if (g >= 1) a.getup = -1;
    }

    // ---- death fall ----
    if (dead) {
      a.deathT = Math.min(1, a.deathT + dt / 0.9);
      const e = a.deathT * a.deathT;
      this.body.rotation.x = a.deathDir * (Math.PI / 2) * e;
      this.body.position.y = 0.11 * e;
      const buckle = Math.sin(a.deathT * Math.PI);
      knL += buckle * 0.7; knR += buckle * 0.5; thL -= buckle * 0.4; thR -= buckle * 0.2;
      spineX = a.deathDir * -0.2 * e; chestX = 0;
      poseArms = { shX: -a.deathDir * 1.2 * e, shZ: 0.5 + e * 0.6, elX: -0.3 };
    } else {
      this.body.rotation.x = 0;
      this.body.position.y = 0;
    }

    this.hips.position.y = hipY;
    this.hips.rotation.set(0, hipsRY, 0);
    this.spine.rotation.set(spineX, spineY, spineZ);
    this.chest.rotation.set(chestX, 0, chestZ);
    this.thL.rotation.set(thL, 0, -0.03); this.thR.rotation.set(thR, 0, 0.03);
    this.knL.rotation.set(knL, 0, 0); this.knR.rotation.set(knR, 0, 0);
    this.ftL.rotation.set(footL, 0, 0); this.ftR.rotation.set(footR, 0, 0);

    // ---- head look ----
    let ly = 0, lp = 0;
    if (a.lookTarget && !dead && a.getup < 0) {
      this.root.updateMatrixWorld();
      const lt = this._v1.copy(a.lookTarget);
      this.root.worldToLocal(lt);
      ly = clamp(Math.atan2(lt.x, lt.z), -1.1, 1.1);
      lp = clamp(Math.atan2(lt.y - 1.62, Math.hypot(lt.x, lt.z)), -0.5, 0.5);
      if (Math.abs(Math.atan2(lt.x, lt.z)) > 2.2) ly = 0;
    }
    this._lookYaw = damp(this._lookYaw, ly, 6, dt);
    this._lookPitch = damp(this._lookPitch, lp, 6, dt);
    const talkNod = a.talk > 0 ? Math.sin(this.t * 8.5) * 0.045 + Math.sin(this.t * 3.1) * 0.03 : 0;
    this.neck.rotation.set(-this._lookPitch * 0.5 + talkNod + (dead ? 0 : -pitch * 0.1), this._lookYaw * 0.55, 0);
    this.head.rotation.set(-this._lookPitch * 0.5, this._lookYaw * 0.45, a.talk > 0 ? Math.sin(this.t * 2.3) * 0.04 : 0);

    // ---- arms & weapon ----
    const w = a.weapon;
    if (poseArms) {
      this.mount.visible = !dead;
      this._freeArm(this.shL, this.elL, 1, poseArms.shX, poseArms.shZ, -poseArms.elX);
      this._freeArm(this.shR, this.elR, -1, poseArms.shX, poseArms.shZ, -poseArms.elX);
      if (w === 'rifle' || w === 'lmg') this._setMount(-0.15, -0.3, 0.2, 0.9, 0.5, 0);
      return;
    }
    this.mount.visible = true;
    const swingArm = -s * 0.42 * wk * (0.6 + amp);
    if (w === 'rifle' || w === 'lmg') {
      const aim = a.aim;
      const heavy = w === 'lmg';
      // low ready -> shouldered
      let px = lerp(-0.07, -0.1, aim), py = lerp(-0.12, 0.09, aim), pz = lerp(0.12, 0.02, aim);
      let rx = lerp(0.55, 0.0, aim), ry = lerp(0.45, 0.04, aim), rz = lerp(0.15, 0, aim);
      if (heavy) { py -= 0.03 * (1 - aim); px += 0.02; }
      // walking bob
      py += Math.sin(ph * 2) * 0.012 * wk;
      // recoil
      if (a.recoil > 0) {
        pz -= a.recoil * 0.06; rx -= a.recoil * 0.14; py += a.recoil * 0.01;
        a.recoil = Math.max(0, a.recoil - dt * (heavy ? 14 : 7));
      }
      // bayonet thrust
      if (a.thrust >= 0) {
        const k = Math.sin(clamp(a.thrust, 0, 1) * Math.PI);
        pz += k * 0.38; py += k * 0.02; rx = lerp(rx, 0.1, k);
        a.thrust += dt / 0.45;
        if (a.thrust >= 1) a.thrust = -1;
      }
      let reloadK = 0;
      if (a.reload >= 0) {
        reloadK = Math.sin(clamp(a.reload, 0, 1) * Math.PI);
        rx += reloadK * 0.45; ry += reloadK * 0.4; py -= reloadK * 0.05; rz -= reloadK * 0.5;
      }
      this._setMount(px, py, pz, rx, ry, rz);
      this.mount.updateMatrix();
      const ud = this.weaponModel.userData;
      this._gR.copy(ud.gripR).applyMatrix4(this.mount.matrix);
      this._gL.copy(ud.gripL).applyMatrix4(this.mount.matrix);
      if (reloadK > 0) {
        // left hand travels to the magazine / bolt area
        const mag = this._v3.set(0, heavy ? -0.17 : 0.03, heavy ? 0.53 : 0.36).applyMatrix4(this.mount.matrix);
        this._gL.lerp(mag, reloadK);
        this._gL.y -= reloadK * Math.max(0, Math.sin(a.reload * Math.PI * 4)) * 0.06;
      }
      this._palm(this._gR, SH_R); this._palm(this._gL, SH_L);
      this._ik(this.shR, this.elR, SH_R, this._gR, this._v3.set(-0.6, -0.35, -0.2).add(SH_R));
      this._ik(this.shL, this.elL, SH_L, this._gL, this._v3.set(0.3, -0.6, 0.0).add(SH_L));
    } else if (w === 'sword') {
      const K = [
        { t: 0, p: [-0.21, -0.32, 0.25], r: [-0.75, 0.15, 0.0] },
      ];
      let p = K[0].p, r = K[0].r;
      let twist = 0;
      if (a.swing >= 0) {
        const v = a.swingVariant;
        const keys = v === 0 ? [
          { t: 0, p: [-0.21, -0.32, 0.25], r: [-0.75, 0.15, 0.0], tw: 0 },
          { t: 0.3, p: [-0.3, 0.2, 0.02], r: [-2.4, 0.7, 0.4], tw: 0.45 },
          { t: 0.55, p: [0.12, -0.18, 0.4], r: [0.25, -1.2, -0.5], tw: -0.55 },
          { t: 1, p: [-0.21, -0.32, 0.25], r: [-0.75, 0.15, 0.0], tw: 0 },
        ] : [
          { t: 0, p: [-0.21, -0.32, 0.25], r: [-0.75, 0.15, 0.0], tw: 0 },
          { t: 0.3, p: [0.12, 0.16, 0.12], r: [-2.0, -0.9, -0.5], tw: -0.4 },
          { t: 0.55, p: [-0.36, -0.12, 0.34], r: [0.1, 1.15, 0.5], tw: 0.5 },
          { t: 1, p: [-0.21, -0.32, 0.25], r: [-0.75, 0.15, 0.0], tw: 0 },
        ];
        const g = a.swing;
        let i = 0;
        while (i < keys.length - 2 && g > keys[i + 1].t) i++;
        const k0 = keys[i], k1 = keys[i + 1];
        let k = clamp((g - k0.t) / (k1.t - k0.t), 0, 1);
        k = i === 1 ? k * k * (3 - 2 * k) : easeInOut(k);
        p = k0.p.map((x, j) => lerp(x, k1.p[j], k));
        r = k0.r.map((x, j) => lerp(x, k1.r[j], k));
        twist = lerp(k0.tw, k1.tw, k);
      }
      this.spine.rotation.y += twist;
      this._setMount(p[0], p[1] + Math.sin(ph * 2) * 0.01 * wk, p[2], r[0], r[1], r[2]);
      this.mount.updateMatrix();
      this._gR.copy(this.weaponModel.userData.gripR).applyMatrix4(this.mount.matrix);
      this._palm(this._gR, SH_R);
      this._ik(this.shR, this.elR, SH_R, this._gR, this._v3.set(-0.5, -0.5, -0.1).add(SH_R));
      this._freeArm(this.shL, this.elL, 1, -swingArm * 0.6 - 0.25, 0.25, 0.9);
    } else {
      // unarmed
      let lS = -swingArm, rS = swingArm;
      let lOut = 0, rOut = 0, lBend = 0.25, rBend = 0.25;
      if (a.offer > 0) { rS = lerp(rS, -1.1, a.offer); rBend = lerp(rBend, 0.4, a.offer); lS = lerp(lS, -1.0, a.offer); lBend = lerp(lBend, 0.5, a.offer); }
      if (a.wave > 0) { rS = lerp(rS, -2.6, a.wave); rOut = a.wave * 0.3; rBend = lerp(rBend, 0.6 + Math.sin(this.t * 9) * 0.35, a.wave); }
      if (a.talk > 0) { lS += Math.sin(this.t * 2.2) * 0.12 - 0.2; lBend = 0.9 + Math.sin(this.t * 3.1) * 0.25; }
      this._freeArm(this.shL, this.elL, 1, lS, lOut, lBend);
      this._freeArm(this.shR, this.elR, -1, rS, rOut, rBend);
      if (this.cfg.helmet === 'cap' && a.talk <= 0 && a.wave <= 0) {
        // officer: hands behind back
        this._freeArm(this.shL, this.elL, 1, 0.45, -0.05, 1.3);
        this._freeArm(this.shR, this.elR, -1, 0.45, -0.05, 1.3);
      }
    }
  }

  getHitSpheres() {
    const H = this._hit;
    const set = (i, g, x, y, z, r, part) => { H[i].c.set(x, y, z); g.localToWorld(H[i].c); H[i].r = r; H[i].part = part; };
    set(0, this.head, 0, 0.01, 0.0, 0.135, 'head');
    set(1, this.chest, 0, 0.06, 0, 0.21, 'chest');
    set(2, this.spine, 0, 0.06, 0, 0.18, 'body');
    set(3, this.hips, 0, 0, 0, 0.17, 'body');
    set(4, this.thL, 0, -0.22, 0, 0.1, 'leg');
    set(5, this.thR, 0, -0.22, 0, 0.1, 'leg');
    set(6, this.knL, 0, -0.2, 0, 0.08, 'leg');
    set(7, this.knR, 0, -0.2, 0, 0.08, 'leg');
    return H;
  }

  chestWorld(out) { return out.set(0, 0.06, 0.05).applyMatrix4(this.chest.matrixWorld); }
  headWorld(out) { return out.set(0, 0.02, 0.05).applyMatrix4(this.head.matrixWorld); }
  muzzleWorld(out) {
    if (!this.weaponModel) return this.chestWorld(out);
    return out.copy(this.weaponModel.userData.muzzle || this.weaponModel.userData.tip).applyMatrix4(this.weaponModel.matrixWorld);
  }
}
