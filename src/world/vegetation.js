import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, Simplex2 } from '../core/noise.js';
import { WORLD_SIZE, SEG, FORT, SPAWN, BOUND } from './terrain.js';

const TILE = 100;

function colorize(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function prep(g) {
  let x = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) x.deleteAttribute(k);
  if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
  return x;
}

function merge(list) { return mergeGeometries(list.map(prep), false); }

// ------- tree geometry builders -------
function pineGeometry(seed) {
  const rnd = mulberry32(seed);
  const noise = new Simplex2(seed);
  const trunk = new THREE.CylinderGeometry(0.16, 0.34, 12, 8, 6, true);
  trunk.translate(0, 6, 0);
  // root flare
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    const f = 1 + Math.max(0, 1 - y / 1.2) * 0.45;
    tp.setX(i, tp.getX(i) * f); tp.setZ(i, tp.getZ(i) * f);
  }
  trunk.computeVertexNormals();

  const parts = [];
  const layers = 9;
  for (let l = 0; l < layers; l++) {
    const t = l / (layers - 1);
    const r = 3.2 * Math.pow(1 - t, 1.1) + 0.55;
    const h = 2.7 - t * 0.9;
    const y = 3.2 + t * 10.2;
    const radial = 22;
    const cone = new THREE.ConeGeometry(r, h, radial, 5, true);
    const p = cone.attributes.position;
    const col = new Float32Array(p.count * 3);
    const twist = rnd() * 6.28;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
      const ang = Math.atan2(z, x) + twist;
      const rim = (0.5 - yy / h); // 1 at bottom rim
      // branch tips: spiky lobes around the rim + irregular noise
      const lobes = Math.pow(Math.abs(Math.sin(ang * 4.5 + l)), 3) * 0.32 * rim;
      const wob = 1 + noise.noise(Math.cos(ang) * 2.2 + l * 3, Math.sin(ang) * 2.2) * 0.22 + lobes - 0.1 * rim;
      x *= wob; z *= wob;
      yy -= rim * rim * (0.7 + lobes * 1.8) * (0.6 + rnd() * 0.5); // drooping tips
      p.setXYZ(i, x, yy + y, z);
      const n = noise.noise(x * 1.7 + l, z * 1.7 + yy);
      const shade = 0.5 + (1 - rim) * 0.08 + rim * 0.38 + lobes * 0.6 + n * 0.12;
      const warm = rnd() * 0.15;
      col[i * 3] = (0.06 + warm * 0.05) * shade; col[i * 3 + 1] = 0.15 * shade; col[i * 3 + 2] = 0.075 * shade;
    }
    cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cone.computeVertexNormals();
    const nn = cone.attributes.normal;
    for (let i = 0; i < nn.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const v = new THREE.Vector3(x, 0.9, z).normalize();
      const n0 = new THREE.Vector3(nn.getX(i), nn.getY(i), nn.getZ(i)).lerp(v, 0.55).normalize();
      nn.setXYZ(i, n0.x, n0.y, n0.z);
    }
    parts.push(cone);
  }
  return { trunk: prep(colorize(trunk, 0xffffff)), foliage: merge(parts), height: 14, trunkR: 0.34 };
}

function broadleafGeometry(seed) {
  const rnd = mulberry32(seed);
  const noise = new Simplex2(seed + 3);
  const tparts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 7, 8, 4, true);
  trunk.translate(0, 3.5, 0);
  tparts.push(colorize(trunk, 0xffffff));
  const branches = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.07, 0.15, 3.6, 6, 1, true);
    b.translate(0, 1.8, 0);
    const a = (i / 4) * Math.PI * 2 + rnd();
    b.rotateZ(0.7 + rnd() * 0.3);
    b.rotateY(a);
    b.translate(0, 4.8 + rnd() * 1.6, 0);
    branches.push(colorize(b, 0xffffff));
    tparts.push(branches[branches.length - 1]);
  }
  const leaves = [];
  const blobs = 9;
  for (let i = 0; i < blobs; i++) {
    const r = 1.7 + rnd() * 1.4;
    let s = new THREE.IcosahedronGeometry(r, 2);
    s.deleteAttribute('uv'); s.deleteAttribute('normal'); s = mergeVertices(s);
    const p = s.attributes.position;
    const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : 1.5 + rnd() * 1.8;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 8.0 + rnd() * 2.8 - d * 0.3;
    const col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = 1 + noise.noise(x * 0.9 + i * 7, y * 0.9 + z * 0.7) * 0.25;
      p.setXYZ(k, x * n + cx, y * n * 0.82 + cy, z * n + cz);
      const shade = 0.6 + (y / r) * 0.25 + (rnd() - 0.5) * 0.14;
      col[k * 3] = 0.12 * shade; col[k * 3 + 1] = 0.2 * shade; col[k * 3 + 2] = 0.06 * shade;
    }
    s.setAttribute('color', new THREE.BufferAttribute(col, 3));
    s.computeVertexNormals();
    const nn = s.attributes.normal;
    for (let k = 0; k < nn.count; k++) {
      const v = new THREE.Vector3(p.getX(k) - 0, p.getY(k) - 8.5, p.getZ(k)).normalize();
      const n0 = new THREE.Vector3(nn.getX(k), nn.getY(k), nn.getZ(k)).lerp(v, 0.55).normalize();
      nn.setXYZ(k, n0.x, n0.y, n0.z);
    }
    leaves.push(s);
  }
  return { trunk: merge(tparts), foliage: merge(leaves), height: 11, trunkR: 0.42 };
}

function bushGeometry(seed) {
  const rnd = mulberry32(seed);
  const noise = new Simplex2(seed);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const r = 0.45 + rnd() * 0.35;
    let s = new THREE.IcosahedronGeometry(r, 1);
    s.deleteAttribute('uv'); s.deleteAttribute('normal'); s = mergeVertices(s);
    const p = s.attributes.position;
    const cx = (rnd() - 0.5) * 0.9, cz = (rnd() - 0.5) * 0.9, cy = r * 0.7;
    const col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = 1 + noise.noise(x * 3 + i, z * 3 + y) * 0.25;
      p.setXYZ(k, x * n + cx, y * n * 0.8 + cy, z * n + cz);
      const shade = 0.55 + (y / r) * 0.3;
      col[k * 3] = 0.11 * shade; col[k * 3 + 1] = 0.19 * shade; col[k * 3 + 2] = 0.06 * shade;
    }
    s.setAttribute('color', new THREE.BufferAttribute(col, 3));
    s.computeVertexNormals();
    parts.push(s);
  }
  return merge(parts);
}

function fernGeometry(seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  const fronds = 9;
  for (let f = 0; f < fronds; f++) {
    const len = 0.7 + rnd() * 0.5;
    const segs = 6;
    const pos = [], col = [], idx = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const w = Math.sin(t * Math.PI) * 0.16 * len;
      const y = Math.sin(t * Math.PI * 0.75) * 0.55 * len;
      const z = t * len;
      pos.push(-w, y, z, w, y, z, 0, y + 0.03, z);
      const sh = 0.6 + t * 0.4;
      for (let k = 0; k < 3; k++) col.push(0.09 * sh, 0.2 * sh, 0.05 * sh);
      if (s < segs) {
        const b = s * 3;
        idx.push(b, b + 3, b + 2, b + 2, b + 3, b + 5, b + 2, b + 5, b + 1, b + 1, b + 5, b + 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.rotateY((f / fronds) * Math.PI * 2 + rnd() * 0.4);
    g.computeVertexNormals();
    parts.push(g);
  }
  const m = merge(parts);
  // up-facing normals to avoid harsh lighting on thin fronds
  const n = m.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 0.95, n.getZ(i) * 0.3);
  return m;
}

function rockGeometry(seed) {
  const noise = new Simplex2(seed);
  let g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + noise.noise(x * 1.3, y * 1.3 + z) * 0.28 + noise.noise(x * 4, z * 4 + y * 3) * 0.06;
    p.setXYZ(i, x * n, Math.max(-0.4, y * n * 0.62), z * n);
    uv[i * 2] = (x + z * 0.7) * 0.6; uv[i * 2 + 1] = y * 0.6;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Adds wind sway to an instanced foliage material.
function windify(mat, uniforms, strength = 0.12, heightRef = 12) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 ip = vec2(0.0);
        #endif
        float hh = max(0.0, transformed.y) / ${heightRef.toFixed(1)};
        float sw = sin(uTime * 1.1 + ip.x * 0.07 + ip.y * 0.05) * 0.6 + sin(uTime * 2.3 + ip.x * 0.31 + transformed.y * 0.4) * 0.25;
        transformed.x += sw * ${strength.toFixed(3)} * hh * hh * ${heightRef.toFixed(1)};
        transformed.z += cos(uTime * 1.3 + ip.y * 0.06) * ${(strength * 0.5).toFixed(3)} * hh * hh * ${heightRef.toFixed(1)};
      `);
  };
}

export class Vegetation {
  constructor(scene, terrain, physics, T, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.uniforms = { uTime: { value: 0 } };
    this.tiles = [];
    const rnd = mulberry32(1234);

    const barkMat = new THREE.MeshStandardMaterial({ map: T.bark, normalMap: T.barkN, roughness: 0.95, color: 0xb8a690 });
    barkMat.map.repeat.set(2, 3); barkMat.normalMap.repeat.set(2, 3);
    const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const bushMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const fernMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    windify(pineMat, this.uniforms, 0.012, 14);
    windify(leafMat, this.uniforms, 0.016, 11);
    windify(fernMat, this.uniforms, 0.06, 0.8);
    const rockMat = new THREE.MeshStandardMaterial({ map: T.rock, normalMap: T.rockN, roughness: 0.92, color: 0xc8c4bc });

    const pine = pineGeometry(11);
    const oak = broadleafGeometry(21);
    const bush = bushGeometry(31);
    const fern = fernGeometry(41);
    const rock = rockGeometry(51);
    const logGeo = new THREE.CylinderGeometry(0.32, 0.38, 1, 9, 1);
    logGeo.rotateZ(Math.PI / 2);
    const stumpGeo = new THREE.CylinderGeometry(0.35, 0.48, 0.7, 9);
    stumpGeo.translate(0, 0.3, 0);

    const density = quality === 'low' ? 0.6 : quality === 'medium' ? 0.8 : 1;
    // Placement on a jittered grid; dense in the playable corridor.
    const buckets = new Map(); // tileKey -> {pine:[], oak:[], bush:[], fern:[], rock:[], log:[], stump:[]}
    const tileOf = (x, z) => {
      const tx = Math.floor((x + WORLD_SIZE / 2) / TILE), tz = Math.floor((z + WORLD_SIZE / 2) / TILE);
      const k = tx * 100 + tz;
      let b = buckets.get(k);
      if (!b) { b = { tx, tz, pine: [], oak: [], bush: [], fern: [], rock: [], log: [], stump: [] }; buckets.set(k, b); }
      return b;
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const mat = (x, y, z, ry, sc, sx = sc, sz = sc, rx = 0, rz = 0) => {
      e.set(rx, ry, rz); q.setFromEuler(e); s.set(sx, sc, sz); p.set(x, y, z);
      return m4.compose(p, q, s).clone();
    };
    const half = WORLD_SIZE / 2 - 4;
    const step = 5.2;
    const inCorridor = (x, z) => {
      const pq = terrain.pathQuery(x, z);
      return Math.hypot(x - SPAWN.x, z - SPAWN.z) < 150 || pq.d < 90 || terrain.fortDist(x, z) < 130;
    };
    for (let gx = -half; gx < half; gx += step) {
      for (let gz = -half; gz < half; gz += step) {
        const corridor = inCorridor(gx, gz);
        if (!corridor && rnd() > 0.55) continue;
        const x = gx + rnd() * step, z = gz + rnd() * step;
        const pq = terrain.pathQuery(x, z);
        const f = terrain.forestDensity(x, z, pq.d);
        const r = rnd();
        const b = tileOf(x, z);
        const y = terrain.getHeight(x, z);
        if (r < f * 0.82 * density) {
          const isPine = rnd() < 0.68;
          const sc = isPine ? 0.7 + rnd() * 0.75 : 0.75 + rnd() * 0.55;
          const geo = isPine ? pine : oak;
          b[isPine ? 'pine' : 'oak'].push({ m: mat(x, y - 0.15, z, rnd() * 6.28, sc, sc, sc, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06), c: 0.8 + rnd() * 0.4 });
          physics.addCircle(x, z, geo.trunkR * sc * 0.95, geo.height * sc, 'wood');
        } else if (r < f * 0.82 * density + 0.05 && pq.d > 3.5 && terrain.fortDist(x, z) > FORT.half + 3) {
          // undergrowth near forest
          if (rnd() < 0.55) b.bush.push({ m: mat(x, y - 0.1, z, rnd() * 6.28, 0.8 + rnd() * 0.9), c: 0.8 + rnd() * 0.4 });
          else b.stump.push({ m: mat(x, y - 0.05, z, rnd() * 6.28, 0.7 + rnd() * 0.6), c: 1 });
        }
        // ferns / bushes in the forest understory
        if (corridor && f > 0.25 && pq.d > 3 && rnd() < 0.75 * density) {
          for (let k = 0; k < 2; k++) {
            const fx = x + (rnd() - 0.5) * step, fz = z + (rnd() - 0.5) * step;
            b.fern.push({ m: mat(fx, terrain.getHeight(fx, fz) - 0.05, fz, rnd() * 6.28, 0.7 + rnd() * 0.8), c: 0.75 + rnd() * 0.5 });
          }
        }
        if (rnd() < 0.035 && pq.d > 4 && terrain.fortDist(x, z) > FORT.half + 4 && Math.hypot(x, z) > 8) {
          const sc = 0.35 + rnd() * rnd() * 2.4;
          b.rock.push({ m: mat(x, y - sc * 0.15, z, rnd() * 6.28, sc, sc * (0.8 + rnd() * 0.6), sc * (0.8 + rnd() * 0.5)), c: 0.85 + rnd() * 0.3 });
          if (sc > 0.7) physics.addCircle(x, z, sc * 0.85, sc * 0.6, 'stone');
        }
        if (corridor && f > 0.5 && rnd() < 0.02 && pq.d > 6) {
          const len = 4 + rnd() * 5, ry = rnd() * 6.28;
          b.log.push({ m: mat(x, y + 0.2, z, ry, 1, len, 1), c: 1 });
          for (let k = -1; k <= 1; k++) {
            const lx = x + Math.cos(ry) * k * len * 0.35, lz = z - Math.sin(ry) * k * len * 0.35;
            physics.addCircle(lx, lz, 0.45, 0.7, 'wood');
          }
        }
      }
    }

    const make = (geo, material, list, cast, recv = true) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, material, list.length);
      const col = new THREE.Color();
      list.forEach((it, i) => { im.setMatrixAt(i, it.m); col.setScalar(it.c); im.setColorAt(i, col); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = cast; im.receiveShadow = recv;
      im.computeBoundingSphere();
      return im;
    };

    for (const b of buckets.values()) {
      const group = new THREE.Group();
      const meshes = [
        make(pine.trunk, barkMat, b.pine, true), make(pine.foliage, pineMat, b.pine, true),
        make(oak.trunk, barkMat, b.oak, true), make(oak.foliage, leafMat, b.oak, true),
        make(bush, bushMat, b.bush, true), make(fern, fernMat, b.fern, false),
        make(rock, rockMat, b.rock, true), make(logGeo, barkMat, b.log, true), make(stumpGeo, barkMat, b.stump, true),
      ].filter(Boolean);
      meshes.forEach((m) => group.add(m));
      const cx = -WORLD_SIZE / 2 + (b.tx + 0.5) * TILE, cz = -WORLD_SIZE / 2 + (b.tz + 0.5) * TILE;
      group.userData.center = new THREE.Vector3(cx, terrain.getHeight(cx, cz), cz);
      // small detail (ferns) gets culled earlier
      group.userData.ferns = meshes.find((m) => m.material === fernMat) || null;
      scene.add(group);
      this.tiles.push(group);
    }

    this._addLightShafts(T);
  }

  _addLightShafts(T) {
    // Soft volumetric-looking light shafts drifting through the canopy near the start.
    const mat = new THREE.MeshBasicMaterial({
      map: T.shaft, color: new THREE.Color(1.0, 0.85, 0.6).multiplyScalar(0.11), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    this.shafts = [];
    const geo = new THREE.PlaneGeometry(3.5, 34);
    geo.translate(0, 17, 0);
    const rnd = mulberry32(77);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 17), THREE.MathUtils.degToRad(128));
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, d = 6 + rnd() * 40;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, this.terrain.getHeight(x, z) - 1, z);
      // tilt toward the sun
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir.clone().setY(Math.max(sunDir.y, 0.75)).normalize());
      m.scale.x = 0.6 + rnd() * 1.4;
      m.renderOrder = 2;
      this.scene.add(m);
      this.shafts.push(m);
    }
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    const cp = camera.position;
    for (const t of this.tiles) {
      const d = Math.hypot(t.userData.center.x - cp.x, t.userData.center.z - cp.z);
      t.visible = d < 360;
      if (t.userData.ferns) t.userData.ferns.visible = d < 150;
    }
    for (const s of this.shafts) {
      // billboard around the shaft's own axis
      const dx = cp.x - s.position.x, dz = cp.z - s.position.z;
      s.rotation.y = Math.atan2(dx, dz);
    }
  }
}

// GPU grass that wraps around the camera. Heights/density come from a data texture.
export class Grass {
  constructor(scene, terrain, count) {
    this.area = 64;
    const bladeH = 1, segs = 3;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = 0.032 * (1 - t * 0.9);
      pos.push(-w, t * bladeH, 0, w, t * bladeH, 0);
      uv.push(0, t, 1, t);
      if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    base.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    base.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    base.setIndex(idx);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.attributes.position = base.attributes.position;
    g.attributes.uv = base.attributes.uv;
    g.attributes.normal = base.attributes.normal;
    this.maxCount = 160000;
    const off = new Float32Array(this.maxCount * 4);
    const rnd = mulberry32(99);
    for (let i = 0; i < this.maxCount; i++) {
      off[i * 4] = rnd() * this.area; off[i * 4 + 1] = rnd() * this.area;
      off[i * 4 + 2] = rnd(); off[i * 4 + 3] = rnd();
    }
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = Math.min(count, this.maxCount);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geometry = g;

    this.uniforms = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3(0, -999, 0) },
      uHeightTex: { value: terrain.dataTexture }, uTerrainSize: { value: WORLD_SIZE }, uGridRes: { value: SEG },
      uArea: { value: this.area },
    };
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, color: 0xffffff });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uTerrainSize, uGridRes, uArea;
          uniform vec3 uCenter, uPlayer;
          uniform sampler2D uHeightTex;
          attribute vec4 aOffset;
          varying float vT;
          varying vec3 vTint;
          vec4 sampleTerrain(vec2 wp) {
            vec2 g = (wp + uTerrainSize * 0.5) / uTerrainSize * uGridRes;
            g = clamp(g, vec2(0.0), vec2(uGridRes - 0.001));
            ivec2 i0 = ivec2(floor(g));
            vec2 f = fract(g);
            vec4 a = texelFetch(uHeightTex, i0, 0);
            vec4 b = texelFetch(uHeightTex, i0 + ivec2(1, 0), 0);
            vec4 c = texelFetch(uHeightTex, i0 + ivec2(0, 1), 0);
            vec4 d = texelFetch(uHeightTex, i0 + ivec2(1, 1), 0);
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
          vec2 wp = uCenter.xz + mod(aOffset.xy - uCenter.xz + uArea * 0.5, uArea) - uArea * 0.5;
          vec4 td = sampleTerrain(wp);
          float dist = length(wp - uCenter.xz);
          float fade = 1.0 - smoothstep(uArea * 0.32, uArea * 0.5, dist);
          float keep = step(aOffset.z, td.g * 1.05);
          float s = (0.22 + aOffset.w * 0.42) * fade * keep * mix(1.0, 0.7, td.b);
          float ang = fract(aOffset.z * 13.7 + aOffset.w * 7.1) * 6.2831;
          vec3 p = position;
          float t = p.y;
          p.y *= s;
          p.x *= (0.7 + aOffset.w * 0.8) * step(0.001, s);
          float c = cos(ang), sn = sin(ang);
          vec3 rp = vec3(p.x * c, p.y, p.x * sn);
          float wind = sin(uTime * 1.8 + wp.x * 0.13 + wp.y * 0.09) * 0.55 + sin(uTime * 3.3 + wp.x * 0.5 + wp.y * 0.3) * 0.2 + 0.25;
          vec2 bend = vec2(wind * 0.3, wind * 0.12);
          vec2 away = wp - uPlayer.xz;
          float pd = length(away);
          bend += (pd < 1.1 && abs(uPlayer.y - td.r) < 2.0) ? normalize(away + 1e-4) * (1.1 - pd) * 0.9 : vec2(0.0);
          rp.xz += bend * t * t * s;
          rp.y -= length(bend) * t * t * s * 0.35;
          vec3 transformed = vec3(wp.x, td.r - 0.02, wp.y) + rp;
          vT = t;
          float hue = fract(aOffset.z * 31.7);
          vTint = mix(vec3(0.85, 1.0, 0.8), vec3(1.12, 1.05, 0.75), hue * hue) * mix(1.0, 0.8, td.b);
        `);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vT;\nvarying vec3 vTint;')
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
          vec3 gBase = vec3(0.05, 0.085, 0.022);
          vec3 gTip = vec3(0.17, 0.25, 0.065);
          vec4 diffuseColor = vec4(mix(gBase, gTip, vT) * vTint * 1.1, opacity);
        `);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }

  setCount(n) { this.geometry.instanceCount = Math.min(n, this.maxCount); }

  update(dt, camera, player) {
    this.uniforms.uTime.value += dt;
    // center slightly ahead of the camera
    const c = this.uniforms.uCenter.value;
    c.copy(camera.position);
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    f.y = 0; f.normalize();
    c.addScaledVector(f, this.area * 0.18);
    if (player) this.uniforms.uPlayer.value.copy(player);
  }
}
