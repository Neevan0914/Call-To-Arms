import * as THREE from 'three';
import { Simplex2, fbm } from '../core/noise.js';
import { smoothstep, lerp, clamp } from '../core/utils.js';

export const WORLD_SIZE = 800;
export const SEG = 320;
export const FORT = { x: 35, z: -330, half: 32 };
// Chapter II: the Kharzan stronghold, far north-west of the Thornwood clearing
export const KFORT = { x: -215, z: 205, half: 30 };
export const SPAWN = { x: 0, z: 0 };
export const BOUND = 360;

// The dirt road: comes from the far west, passes ~65 m south of the clearing,
// winds south and ends inside the fort gate.
const PATH_CTRL = [
  [-330, 4], [-250, -14], [-170, -38], [-100, -56], [-45, -64], [-5, -68],
  [26, -92], [40, -130], [24, -174], [14, -212], [27, -250], [35, -276],
  [35, -298], [35, -322],
];

// Terrain shading with the asset pack's PBR ground sets (albedo + normal maps, ~1 m tiles):
// grass / forest floor (+ moss) / rock / dirt road, blended by the splat weights, with
// two-scale anti-tiling and world-aligned normal mapping.
function groundShader(G, T) {
  return (sh) => {
    const u = {
      gA: G.grass.albedo, gN: G.grass.normal, fA: G.forest_floor.albedo, fN: G.forest_floor.normal,
      dA: G.dirt.albedo, dN: G.dirt.normal, rA: G.rock.albedo, rN: G.rock.normal, mA: G.moss.albedo, mN: G.moss.normal,
      tMacro: T.macro,
    };
    for (const k in u) sh.uniforms[k] = { value: u[k] };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSplat;\nvarying vec3 vSplat;\nvarying vec2 vWXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvWXZ = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D gA, gN, fA, fN, dA, dN, rA, rN, mA, mN, tMacro;
        varying vec3 vSplat;
        varying vec2 vWXZ;
        vec3 nrm(sampler2D t, vec2 uv) { return texture2D(t, uv).xyz * 2.0 - 1.0; }`)
      .replace('#include <map_fragment>', `
        vec2 uvA = vWXZ * 0.7;
        vec2 uvB = vWXZ * 0.173 + 0.37;
        const float wB = 0.35;
        vec3 mac = texture2D(tMacro, vWXZ * 0.0035).rgb;
        float mac2 = texture2D(tMacro, vWXZ * 0.027).g;
        vec3 cg = mix(texture2D(gA, uvA).rgb, texture2D(gA, uvB).rgb, wB) * mix(0.82, 1.15, mac2);
        cg = mix(cg, cg * vec3(1.12, 1.04, 0.72), smoothstep(0.58, 0.82, mac.b));
        vec3 cf = mix(texture2D(fA, uvA * 0.8).rgb, texture2D(fA, uvB).rgb, wB);
        cf = mix(cf, vec3(dot(cf, vec3(0.3, 0.59, 0.11))), 0.4) * vec3(0.8, 0.72, 0.6);
        vec3 cm = texture2D(mA, uvA * 0.6).rgb;
        float mossW = smoothstep(0.45, 0.75, mac.g) * 0.65;
        cf = mix(cf, cm, mossW);
        vec3 cd = mix(texture2D(dA, uvA * 0.6).rgb, texture2D(dA, uvB).rgb, wB);
        vec3 cr = mix(texture2D(rA, uvA * 0.3).rgb, cm, 0.3 * smoothstep(0.5, 0.8, mac.b));
        float wf = clamp(vSplat.y + (mac.r - 0.5) * 0.4, 0.0, 1.0);
        float wr = vSplat.z;
        float wd = smoothstep(0.0, 1.0, vSplat.x + (mac2 - 0.5) * 0.25);
        vec3 col = mix(mix(mix(cg, cf, wf), cr, wr), cd, wd);
        col *= mix(0.85, 1.1, mac.r);
        diffuseColor.rgb *= col;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nG = mix(nrm(gN, uvA), nrm(gN, uvB), wB);
          vec3 nF = mix(nrm(fN, uvA * 0.8), nrm(mN, uvA * 0.6), mossW);
          vec3 nT = mix(mix(mix(nG, nF, wf), nrm(rN, uvA * 0.3), wr), nrm(dN, uvA * 0.6), wd);
          nT = normalize(vec3(nT.xy * 0.9, nT.z));
          // world-aligned tangent frame (u = +x, v = +z) in view space
          vec3 Nn = normal;
          vec3 Tv = normalize(mat3(viewMatrix) * vec3(1.0, 0.0, 0.0));
          vec3 Bv = normalize(mat3(viewMatrix) * vec3(0.0, 0.0, 1.0));
          Tv = normalize(Tv - Nn * dot(Nn, Tv));
          Bv = normalize(Bv - Nn * dot(Nn, Bv) - Tv * dot(Tv, Bv));
          normal = normalize(Tv * nT.x + Bv * nT.y + Nn * nT.z);
        }
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.95, 0.85, vSplat.z);');
  };
}

export class Terrain {
  constructor(seed = 7) {
    this.noise = new Simplex2(seed);
    this.n = SEG + 1;
    this.cell = WORLD_SIZE / SEG;
    this.half = WORLD_SIZE / 2;
    this._pq = { d: Infinity, s: 0, h: 0, i: 0 };
    this._buildPath();
    this.fortH = this.raw(FORT.x, FORT.z) + 1.5;
    this.kfortH = this.raw(KFORT.x, KFORT.z) + 0.8;
    this.clearH = this.raw(SPAWN.x, SPAWN.z);
    this._computePathHeights();
    this._computeField();
  }

  raw(x, z) {
    const n = this.noise;
    let h = fbm(n, x * 0.0032, z * 0.0032, 4) * 20;
    h += fbm(n, x * 0.011 + 100, z * 0.011 - 40, 3) * 4.5;
    h += n.noise(x * 0.06, z * 0.06) * 0.35;
    // gentle rise around the outer edge so the world feels enclosed by hills
    const e = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(300, 400, e) * 28;
    return h;
  }

  _buildPath() {
    const curve = new THREE.CatmullRomCurve3(PATH_CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const pts = curve.getSpacedPoints(760);
    this.path = pts.map((p) => ({ x: p.x, z: p.z, s: 0, h: 0 }));
    let s = 0;
    for (let i = 1; i < this.path.length; i++) {
      s += Math.hypot(this.path[i].x - this.path[i - 1].x, this.path[i].z - this.path[i - 1].z);
      this.path[i].s = s;
    }
    this.pathLength = s;
    // bucket grid for fast nearest-segment queries
    this.bucketSize = 16;
    this.buckets = new Map();
    const R = 26;
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i], b = this.path[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - R) / this.bucketSize), x1 = Math.floor((Math.max(a.x, b.x) + R) / this.bucketSize);
      const z0 = Math.floor((Math.min(a.z, b.z) - R) / this.bucketSize), z1 = Math.floor((Math.max(a.z, b.z) + R) / this.bucketSize);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = gx * 4096 + gz;
        let arr = this.buckets.get(k);
        if (!arr) { arr = []; this.buckets.set(k, arr); }
        arr.push(i);
      }
    }
  }

  // nearest point on path; returns shared object {d, s, h, i}
  pathQuery(x, z) {
    const q = this._pq;
    q.d = Infinity; q.s = 0; q.h = 0; q.i = -1;
    const arr = this.buckets.get(Math.floor(x / this.bucketSize) * 4096 + Math.floor(z / this.bucketSize));
    if (!arr) return q;
    for (const i of arr) {
      const a = this.path[i], b = this.path[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const l2 = abx * abx + abz * abz;
      let t = l2 > 0 ? ((x - a.x) * abx + (z - a.z) * abz) / l2 : 0;
      t = clamp(t, 0, 1);
      const px = a.x + abx * t, pz = a.z + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < q.d) { q.d = d; q.i = i; q.s = lerp(a.s, b.s, t); q.h = lerp(a.h, b.h, t); }
    }
    return q;
  }

  // distance to the nearest fort's centre (square), expressed against FORT.half so the
  // same clearance thresholds work for both forts
  fortDist(x, z) {
    const a = Math.max(Math.abs(x - FORT.x), Math.abs(z - FORT.z));
    const b = Math.max(Math.abs(x - KFORT.x), Math.abs(z - KFORT.z)) - (KFORT.half - FORT.half);
    return Math.min(a, b);
  }
  kfortDist(x, z) { return Math.max(Math.abs(x - KFORT.x), Math.abs(z - KFORT.z)); }

  baseHeight(x, z) {
    let h = this.raw(x, z);
    const fm = 1 - smoothstep(FORT.half + 6, FORT.half + 36, this.fortDist(x, z));
    h = lerp(h, this.fortH, fm);
    const km = 1 - smoothstep(KFORT.half + 6, KFORT.half + 34, this.kfortDist(x, z));
    if (km > 0) h = lerp(h, this.kfortH, km);
    const dc = Math.hypot(x - SPAWN.x, z - SPAWN.z);
    h = lerp(h, this.clearH, (1 - smoothstep(8, 28, dc)) * 0.8);
    return h;
  }

  _computePathHeights() {
    const P = this.path;
    const raw = P.map((p) => this.baseHeight(p.x, p.z));
    let a = raw;
    for (let pass = 0; pass < 3; pass++) {
      const b = new Array(a.length);
      const K = 9;
      for (let i = 0; i < a.length; i++) {
        let s = 0, c = 0;
        for (let k = -K; k <= K; k++) { const j = clamp(i + k, 0, a.length - 1); s += a[j]; c++; }
        b[i] = s / c;
      }
      a = b;
    }
    for (let i = 0; i < P.length; i++) P[i].h = a[i];
  }

  forestDensity(x, z, pathD) {
    let f = smoothstep(-0.4, 0.2, fbm(this.noise, x * 0.008 + 40, z * 0.008 - 70, 3));
    f *= smoothstep(15, 30, Math.hypot(x - SPAWN.x, z - SPAWN.z));
    f *= smoothstep(5, 12, pathD);
    f *= smoothstep(FORT.half + 40, FORT.half + 95, this.fortDist(x, z));
    return f;
  }

  _computeField() {
    const n = this.n, N = n * n;
    const H = (this.heights = new Float32Array(N));
    this.splat = new Float32Array(N * 3);
    this.grassDensity = new Float32Array(N);
    this.forest = new Float32Array(N);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -this.half + ix * this.cell, z = -this.half + iz * this.cell;
        const i = iz * n + ix;
        let h = this.baseHeight(x, z);
        const q = this.pathQuery(x, z);
        let pathDirt = 0;
        if (q.d < 14) {
          const pm = 1 - smoothstep(2.5, 11, q.d);
          h = lerp(h, q.h, pm);
          h -= 0.14 * (1 - smoothstep(1.4, 3.0, q.d));
          h -= 0.06 * (1 - smoothstep(0.1, 0.45, Math.abs(q.d - 0.95))); // wheel ruts
          pathDirt = 1 - smoothstep(1.7, 3.6, q.d + this.noise.noise(x * 0.3, z * 0.3) * 0.7);
        }
        H[i] = h;
        const fd = this.fortDist(x, z);
        const fortDirt = (1 - smoothstep(FORT.half - 6, FORT.half + 4, fd)) * clamp(0.55 + this.noise.noise(x * 0.12, z * 0.12) * 0.6, 0, 1);
        const dirt = Math.max(pathDirt, fortDirt);
        const forest = this.forestDensity(x, z, q.d);
        this.forest[i] = forest;
        this.splat[i * 3] = dirt;
        this.splat[i * 3 + 1] = forest * (1 - dirt) * 0.9;
        this.grassDensity[i] = (1 - dirt) * (1 - 0.55 * forest) * (fd < FORT.half - 1 ? 0.25 : 1);
      }
    }
    // rock on steep slopes
    for (let iz = 1; iz < n - 1; iz++) for (let ix = 1; ix < n - 1; ix++) {
      const i = iz * n + ix;
      const dx = (H[i + 1] - H[i - 1]) / (2 * this.cell), dz = (H[i + n] - H[i - n]) / (2 * this.cell);
      const slope = Math.hypot(dx, dz);
      const r = smoothstep(0.55, 0.95, slope);
      this.splat[i * 3 + 2] = r;
      this.grassDensity[i] *= 1 - r;
    }
  }

  getHeight(x, z) {
    let gx = (x + this.half) / this.cell, gz = (z + this.half) / this.cell;
    gx = clamp(gx, 0, SEG - 1e-4); gz = clamp(gz, 0, SEG - 1e-4);
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const u = gx - ix, v = gz - iz;
    const n = this.n, H = this.heights;
    const ha = H[iz * n + ix], hb = H[(iz + 1) * n + ix], hc = H[(iz + 1) * n + ix + 1], hd = H[iz * n + ix + 1];
    if (u + v <= 1) return ha + (hd - ha) * u + (hb - ha) * v;
    return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  }

  sampleField(arr, x, z) {
    const gx = clamp(Math.round((x + this.half) / this.cell), 0, SEG), gz = clamp(Math.round((z + this.half) / this.cell), 0, SEG);
    return arr[gz * this.n + gx];
  }

  dirtAt(x, z) {
    const gx = clamp(Math.round((x + this.half) / this.cell), 0, SEG), gz = clamp(Math.round((z + this.half) / this.cell), 0, SEG);
    return this.splat[(gz * this.n + gx) * 3];
  }

  getNormal(x, z, out = new THREE.Vector3()) {
    const e = 0.5;
    out.set(this.getHeight(x - e, z) - this.getHeight(x + e, z), 2 * e, this.getHeight(x, z - e) - this.getHeight(x, z + e));
    return out.normalize();
  }

  buildMesh(T, ground = null) {
    const n = this.n;
    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      pos[i * 3] = -this.half + ix * this.cell;
      pos[i * 3 + 1] = this.heights[i];
      pos[i * 3 + 2] = -this.half + iz * this.cell;
      uv[i * 2] = ix / SEG; uv[i * 2 + 1] = iz / SEG;
    }
    const idx = new Uint32Array(SEG * SEG * 6);
    let k = 0;
    for (let iz = 0; iz < SEG; iz++) for (let ix = 0; ix < SEG; ix++) {
      const a = iz * n + ix, b = (iz + 1) * n + ix, c = (iz + 1) * n + ix + 1, d = iz * n + ix + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = d;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aSplat', new THREE.BufferAttribute(this.splat, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, {
        tGrass: { value: T.grass }, tForest: { value: T.forest }, tDirt: { value: T.dirt },
        tRock: { value: T.rock }, tMacro: { value: T.macro },
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aSplat;\nvarying vec3 vSplat;\nvarying vec2 vWXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvWXZ = position.xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass, tForest, tDirt, tRock, tMacro;\nvarying vec3 vSplat;\nvarying vec2 vWXZ;')
        .replace('#include <map_fragment>', `
          vec2 tuv = vWXZ * 0.21;
          vec3 mac = texture2D(tMacro, vWXZ * 0.0035).rgb;
          float mac2 = texture2D(tMacro, vWXZ * 0.027).g;
          vec3 cg = mix(texture2D(tGrass, tuv).rgb, texture2D(tGrass, tuv * 0.23 + 0.37).rgb, 0.45);
          cg *= mix(0.8, 1.2, mac2);
          cg = mix(cg, cg * vec3(1.15, 1.05, 0.7), smoothstep(0.55, 0.8, mac.b));
          vec3 cf = mix(texture2D(tForest, tuv * 0.8).rgb, texture2D(tForest, tuv * 0.19 + 0.21).rgb, 0.35);
          vec3 cd = mix(texture2D(tDirt, tuv * 0.7).rgb, texture2D(tDirt, tuv * 0.17).rgb, 0.35);
          vec3 cr = texture2D(tRock, tuv * 0.3).rgb;
          float dirtW = smoothstep(0.0, 1.0, vSplat.x + (mac2 - 0.5) * 0.25);
          vec3 col = mix(cg, cf, clamp(vSplat.y + (mac.r - 0.5) * 0.4, 0.0, 1.0));
          col = mix(col, cr, vSplat.z);
          col = mix(col, cd, dirtW);
          col *= mix(0.82, 1.12, mac.r);
          diffuseColor.rgb *= col;
        `)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.97, 0.88, vSplat.z);');
    };
    if (ground) mat.onBeforeCompile = groundShader(ground, T);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.mesh = mesh;

    // Data texture for GPU grass: r = height, g = grass density, b = forest
    const data = new Float32Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      data[i * 4] = this.heights[i];
      data[i * 4 + 1] = this.grassDensity[i];
      data[i * 4 + 2] = this.forest[i];
      data[i * 4 + 3] = this.splat[i * 3];
    }
    const dt = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
    dt.minFilter = dt.magFilter = THREE.NearestFilter;
    dt.needsUpdate = true;
    this.dataTexture = dt;
    return mesh;
  }

  // closest point on the path (for objectives)
  closestPathPoint(x, z) {
    let best = null, bd = Infinity;
    for (const p of this.path) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  pointAtS(s) {
    const P = this.path;
    s = clamp(s, 0, this.pathLength);
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s < s) lo = m; else hi = m; }
    const a = P[lo], b = P[hi];
    const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
    return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) };
  }
}
