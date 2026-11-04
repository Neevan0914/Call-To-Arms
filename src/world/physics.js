import * as THREE from 'three';

// Lightweight collision + raycasting world: terrain heightfield, vertical
// cylinders (tree trunks, rocks) in a spatial hash, and axis-aligned boxes.
export class CollisionWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.cellSize = 8;
    this.grid = new Map();
    this.boxes = [];
    this._hit = { dist: Infinity, point: new THREE.Vector3(), normal: new THREE.Vector3(), type: 'none', obj: null };
  }

  _key(gx, gz) { return gx * 8192 + gz; }

  addCircle(x, z, r, height, type = 'wood') {
    const c = { x, z, r, y0: this.terrain.getHeight(x, z) - 0.5, y1: this.terrain.getHeight(x, z) + height, type };
    const gx0 = Math.floor((x - r) / this.cellSize), gx1 = Math.floor((x + r) / this.cellSize);
    const gz0 = Math.floor((z - r) / this.cellSize), gz1 = Math.floor((z + r) / this.cellSize);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const k = this._key(gx, gz);
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(c);
    }
    return c;
  }

  addBox(min, max, type = 'wood', tag = null) {
    const b = { min: min.clone(), max: max.clone(), type, tag, enabled: true };
    this.boxes.push(b);
    return b;
  }

  removeBoxesByTag(tag) {
    for (const b of this.boxes) if (b.tag === tag) b.enabled = false;
  }

  circlesNear(x, z, r, out) {
    out.length = 0;
    const gx0 = Math.floor((x - r) / this.cellSize), gx1 = Math.floor((x + r) / this.cellSize);
    const gz0 = Math.floor((z - r) / this.cellSize), gz1 = Math.floor((z + r) / this.cellSize);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const a = this.grid.get(this._key(gx, gz));
      if (a) for (const c of a) if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  isFree(x, z, r) {
    const near = this.circlesNear(x, z, r + 1, []);
    for (const c of near) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false;
    for (const b of this.boxes) {
      if (!b.enabled) continue;
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return false;
    }
    return true;
  }

  // Push a circle (character) out of obstacles. pos.y = feet height.
  resolve(pos, radius, height = 1.75) {
    const near = this.circlesNear(pos.x, pos.z, radius + 1, this._tmpArr || (this._tmpArr = []));
    for (const c of near) {
      if (pos.y > c.y1 || pos.y + height < c.y0) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d = Math.hypot(dx, dz), m = c.r + radius;
      if (d < m && d > 1e-5) {
        pos.x = c.x + (dx / d) * m;
        pos.z = c.z + (dz / d) * m;
      }
    }
    for (const b of this.boxes) {
      if (!b.enabled) continue;
      if (pos.y + 0.35 > b.max.y || pos.y + height < b.min.y) continue;
      const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        } else {
          // inside: push along smallest axis
          const ex = [pos.x - b.min.x, b.max.x - pos.x, pos.z - b.min.z, b.max.z - pos.z];
          const m = Math.min(...ex);
          if (m === ex[0]) pos.x = b.min.x - radius;
          else if (m === ex[1]) pos.x = b.max.x + radius;
          else if (m === ex[2]) pos.z = b.min.z - radius;
          else pos.z = b.max.z + radius;
        }
      }
    }
  }

  // Returns the shared hit object (copy if you need to keep it) or null.
  raycast(origin, dir, maxDist, { trees = true, boxes = true, terrain = true } = {}) {
    const hit = this._hit;
    hit.dist = maxDist; hit.type = 'none'; hit.obj = null;
    let found = false;

    if (boxes) {
      for (const b of this.boxes) {
        if (!b.enabled) continue;
        let tmin = 0, tmax = hit.dist, nAxis = -1, nSign = 0;
        let ok = true;
        for (let a = 0; a < 3; a++) {
          const o = a === 0 ? origin.x : a === 1 ? origin.y : origin.z;
          const d = a === 0 ? dir.x : a === 1 ? dir.y : dir.z;
          const mn = a === 0 ? b.min.x : a === 1 ? b.min.y : b.min.z;
          const mx = a === 0 ? b.max.x : a === 1 ? b.max.y : b.max.z;
          if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { ok = false; break; } continue; }
          let t1 = (mn - o) / d, t2 = (mx - o) / d, s = -1;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
          if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { ok = false; break; }
        }
        if (ok && nAxis >= 0 && tmin < hit.dist) {
          hit.dist = tmin; hit.type = b.type; hit.obj = b; found = true;
          hit.normal.set(0, 0, 0).setComponent(nAxis, nSign);
        }
      }
    }

    if (trees) {
      const step = this.cellSize * 0.5;
      const seen = this._seen || (this._seen = new Set());
      seen.clear();
      for (let t = 0; t <= hit.dist + step; t += step) {
        const px = origin.x + dir.x * t, pz = origin.z + dir.z * t;
        const a = this.grid.get(this._key(Math.floor(px / this.cellSize), Math.floor(pz / this.cellSize)));
        if (!a) continue;
        for (const c of a) {
          if (seen.has(c)) continue;
          seen.add(c);
          // 2D ray-circle
          const ox = origin.x - c.x, oz = origin.z - c.z;
          const A = dir.x * dir.x + dir.z * dir.z;
          if (A < 1e-9) continue;
          const B = 2 * (ox * dir.x + oz * dir.z);
          const C = ox * ox + oz * oz - c.r * c.r;
          const disc = B * B - 4 * A * C;
          if (disc < 0) continue;
          const tt = (-B - Math.sqrt(disc)) / (2 * A);
          if (tt < 0 || tt >= hit.dist) continue;
          const y = origin.y + dir.y * tt;
          if (y < c.y0 || y > c.y1) continue;
          hit.dist = tt; hit.type = c.type; hit.obj = c; found = true;
          hit.normal.set(ox + dir.x * tt, 0, oz + dir.z * tt).normalize();
        }
      }
    }

    if (terrain) {
      const T = this.terrain;
      const step = 0.75;
      let prevT = 0;
      let prevAbove = origin.y - T.getHeight(origin.x, origin.z);
      if (prevAbove > 0) {
        for (let t = step; t <= hit.dist; t += step) {
          const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
          const above = y - T.getHeight(x, z);
          if (above <= 0) {
            // refine
            let lo = prevT, hi = t;
            for (let k = 0; k < 8; k++) {
              const m = (lo + hi) / 2;
              const a2 = origin.y + dir.y * m - T.getHeight(origin.x + dir.x * m, origin.z + dir.z * m);
              if (a2 > 0) lo = m; else hi = m;
            }
            hit.dist = hi; hit.type = 'dirt'; hit.obj = null; found = true;
            T.getNormal(origin.x + dir.x * hi, origin.z + dir.z * hi, hit.normal);
            break;
          }
          prevT = t; prevAbove = above;
        }
      }
    }

    if (!found) return null;
    hit.point.copy(origin).addScaledVector(dir, hit.dist);
    return hit;
  }

  lineOfSight(a, b) {
    const d = this._los || (this._los = new THREE.Vector3());
    d.subVectors(b, a);
    const len = d.length();
    d.divideScalar(len);
    const h = this.raycast(a, d, len - 0.3);
    return !h;
  }
}
