import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';

// Chapter III night: a deep-blue starfield panorama (with a faint galactic band and a
// glowing horizon haze) plus billboarded sky bodies — a huge ringed gas giant, a
// smaller banded planet and two crescent moons — all painted procedurally.

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mix = (a, b, t) => a + (b - a) * t;

// direction from (azimuth, elevation) in degrees, same convention as the sun
export function skyDir(az, el) {
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - el), THREE.MathUtils.degToRad(az));
}

export function makeNightPanorama(W = 4096) {
  const H = W / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(31337);
  // sky gradient by elevation (row 0 = zenith, H/2 = horizon)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  const stop = (el, col) => g.addColorStop(clamp01((90 - el) / 180), col);
  stop(90, '#02040c'); stop(50, '#040a1d'); stop(25, '#081633'); stop(12, '#0f2550');
  stop(4, '#1d3c78'); stop(0.5, '#2c5294'); stop(-3, '#1a3166'); stop(-20, '#0a1430'); stop(-90, '#03060f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const rowOf = (el) => ((90 - el) / 180) * H;
  // galactic band: soft blue-violet clouds along a tilted great circle
  ctx.globalCompositeOperation = 'lighter';
  const band = (u) => 34 + 26 * Math.sin(u * Math.PI * 2 + 0.8); // elevation of the band centre
  for (let i = 0; i < 900; i++) {
    const u = rnd();
    const el = band(u) + (rnd() - 0.5) * 16 * (0.4 + rnd());
    const x = u * W, y = rowOf(el);
    const r = (18 + rnd() * 60) * (W / 4096);
    const a = 0.018 + rnd() * 0.03;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    const hue = rnd() < 0.7 ? '120,150,230' : '170,140,230';
    gr.addColorStop(0, `rgba(${hue},${a})`); gr.addColorStop(1, `rgba(${hue},0)`);
    ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // stars (uniform over the upper sphere, denser inside the band)
  const star = (u, el, mag, tint) => {
    const x = u * W, y = rowOf(el);
    const stretch = 1 / Math.max(0.2, Math.cos(THREE.MathUtils.degToRad(el)));
    const haze = clamp01((el + 1) / 10); // stars fade into the horizon glow
    const b = mag * haze * 0.85;
    if (b < 0.03) return;
    const s = (0.7 + mag * 1.6) * (W / 4096);
    ctx.fillStyle = `rgba(${tint},${Math.min(1, b)})`;
    ctx.fillRect(x - (s * stretch) / 2, y - s / 2, s * stretch, s);
    if (mag > 0.8) {
      const r = (2.5 + mag * 5) * (W / 4096);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${tint},${0.22 * b})`); gr.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = gr; ctx.fillRect(x - r * stretch, y - r, r * 2 * stretch, r * 2);
    }
  };
  const tints = ['235,240,255', '200,215,255', '255,240,220', '180,200,255', '255,225,200'];
  for (let i = 0; i < 16000; i++) {
    const u = rnd();
    const el = THREE.MathUtils.radToDeg(Math.asin(rnd() * 1.08 - 0.08));
    const mag = Math.pow(rnd(), 5.5);
    star(u, el, 0.12 + mag * 0.95, tints[Math.floor(rnd() * tints.length)]);
  }
  for (let i = 0; i < 9000; i++) {
    const u = rnd();
    const el = band(u) + (rnd() - 0.5) * 12 * rnd();
    star(u, el, 0.08 + Math.pow(rnd(), 6) * 0.6, tints[1]);
  }
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// ---- painted bodies (per-pixel lit spheres) ----
function paintPlanet(size, { r, rings = null, light, bands, tilt = 0, glow = '150,185,255', seed = 1 }) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  // atmospheric halo
  const gr = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.35);
  gr.addColorStop(0, `rgba(${glow},0.35)`); gr.addColorStop(1, `rgba(${glow},0)`);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const L = new THREE.Vector3(...light).normalize();
  const rnd = mulberry32(seed);
  const wob = Array.from({ length: 6 }, () => [rnd() * 6.28, 2 + rnd() * 5, 0.004 + rnd() * 0.01]);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const blend = (i, R, G, B, A) => {
    const a0 = d[i + 3] / 255, a = A + a0 * (1 - A);
    if (a <= 0) return;
    d[i] = (R * A + d[i] * a0 * (1 - A)) / a; d[i + 1] = (G * A + d[i + 1] * a0 * (1 - A)) / a; d[i + 2] = (B * A + d[i + 2] * a0 * (1 - A)) / a;
    d[i + 3] = a * 255;
  };
  const ringAt = (px, py) => {
    if (!rings) return null;
    // ring plane: rotate into the ring frame, unsquash the minor axis
    const x = (px * ct + py * st), y = (-px * st + py * ct) / rings.ratio;
    const rho = Math.hypot(x, y) / r;
    if (rho < rings.inner || rho > rings.outer) return null;
    const k = (rho - rings.inner) / (rings.outer - rings.inner);
    let a = 0.55 + 0.35 * Math.sin(k * 60) * Math.sin(k * 23 + 1);
    if (k > 0.58 && k < 0.64) a *= 0.12; // the big gap
    if (k > 0.86 && k < 0.88) a *= 0.3;
    a *= Math.min(1, k * 8) * Math.min(1, (1 - k) * 10);
    // the planet's shadow falls across the far side of the rings
    const lit = clamp01(0.25 + 0.75 * clamp01((x * L.x - y * L.y) / r + 0.6));
    return { a: clamp01(a), front: y > 0 ? 1 : 0, lit, k };
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const x = px - cx, y = py - cy;
      const ring = ringAt(x, y);
      const behind = ring && !ring.front;
      if (behind) { const v = 205 * ring.lit; blend(i, v * 0.9, v * 0.96, v * 1.08, ring.a); }
      const nx = x / r, ny = y / r, rr = nx * nx + ny * ny;
      if (rr <= 1) {
        const nz = Math.sqrt(1 - rr);
        const lam = nx * L.x - ny * L.y + nz * L.z;
        const shade = Math.pow(clamp01(lam * 1.15 + 0.08), 0.8);
        // latitude bands with wobbly edges
        let lat = ny;
        for (const [ph, f, amp] of wob) lat += Math.sin(nx * f * 3.1 + ph) * amp;
        let bi = (lat * 0.5 + 0.5) * bands.length;
        const b0 = bands[Math.max(0, Math.min(bands.length - 1, Math.floor(bi)))];
        const b1 = bands[Math.max(0, Math.min(bands.length - 1, Math.floor(bi) + 1))];
        const t = bi - Math.floor(bi);
        const col = [mix(b0[0], b1[0], t * t), mix(b0[1], b1[1], t * t), mix(b0[2], b1[2], t * t)];
        const limb = Math.pow(nz, 0.35);
        const rim = Math.pow(1 - nz, 3) * clamp01(lam + 0.4) * 90;
        const nightGlow = 6 + 10 * (1 - shade);
        const R = col[0] * (0.035 + shade * limb) + rim * 0.6 + nightGlow * 0.4;
        const G = col[1] * (0.035 + shade * limb) + rim * 0.75 + nightGlow * 0.5;
        const B = col[2] * (0.035 + shade * limb) + rim + nightGlow;
        // anti-aliased edge
        const edge = clamp01((1 - Math.sqrt(rr)) * r);
        blend(i, Math.min(255, R), Math.min(255, G), Math.min(255, B), edge);
      }
      if (ring && ring.front) { const v = 215 * ring.lit; blend(i, v * 0.92, v * 0.97, v * 1.08, ring.a); }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintMoon(size, { light, seed = 3, col = [190, 205, 230] }) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, size, size), d = img.data;
  const r = size * 0.42, cx = size / 2, cy = size / 2;
  const L = new THREE.Vector3(...light).normalize();
  const rnd = mulberry32(seed);
  const craters = Array.from({ length: 22 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, 0.04 + rnd() * 0.16, 0.12 + rnd() * 0.2]);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const nx = (px - cx) / r, ny = (py - cy) / r, rr = nx * nx + ny * ny;
    const i = (py * size + px) * 4;
    if (rr > 1) { d[i + 3] = 0; continue; }
    const nz = Math.sqrt(1 - rr);
    const lam = nx * L.x - ny * L.y + nz * L.z;
    let tone = 1;
    for (const [qx, qy, qr, depth] of craters) { const dd = Math.hypot(nx - qx, ny - qy); if (dd < qr) tone -= depth * (1 - dd / qr); }
    const shade = clamp01(lam * 1.3 + 0.02);
    const edge = clamp01((1 - Math.sqrt(rr)) * r);
    d[i] = col[0] * shade * tone + 4; d[i + 1] = col[1] * shade * tone + 6; d[i + 2] = col[2] * shade * tone + 12;
    d[i + 3] = 255 * edge * (0.25 + 0.75 * clamp01(shade * 3));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SkyBodies {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.D = 1150;
    this.items = [];
  }

  // painting takes a moment, so it happens when night first falls
  build() {
    if (this.built) return;
    this.built = true;
    const pale = [[150, 170, 205], [205, 222, 245], [235, 242, 252], [175, 195, 226], [220, 232, 250], [160, 182, 218], [232, 240, 252], [190, 208, 238]];
    this.add(paintPlanet(1024, { r: 205, rings: { inner: 1.3, outer: 2.3, ratio: 0.23 }, tilt: -0.24, light: [0.85, 0.32, 0.42], bands: pale, seed: 7 }),
      { az: 146, el: 27, diam: 19, discFrac: 410 / 1024, tint: 1.25 });
    this.add(paintPlanet(512, { r: 150, light: [-0.6, 0.4, 0.5], bands: [[120, 170, 190], [160, 210, 220], [110, 150, 185], [175, 220, 230], [130, 175, 200]], glow: '140,210,230', seed: 11 }),
      { az: 72, el: 44, diam: 6.5, discFrac: 300 / 512, tint: 1.1 });
    this.add(paintMoon(256, { light: [0.95, 0.15, -0.15], seed: 5 }), { az: 104, el: 41, diam: 2.6, discFrac: 0.84, tint: 1.4 });
    this.add(paintMoon(256, { light: [0.9, -0.1, -0.35], seed: 9, col: [200, 210, 225] }), { az: 96, el: 15, diam: 1.7, discFrac: 0.84, tint: 1.4 });
    this.add(paintMoon(256, { light: [-0.3, 0.6, 0.6], seed: 13, col: [215, 200, 190] }), { az: 205, el: 33, diam: 1.2, discFrac: 0.84, tint: 1.2 });
  }

  add(tex, { az, el, diam, discFrac, tint = 1 }) {
    const mat = new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true, color: new THREE.Color(tint, tint, tint * 1.04) });
    const s = new THREE.Sprite(mat);
    const disc = 2 * this.D * Math.tan(THREE.MathUtils.degToRad(diam / 2));
    s.scale.setScalar(disc / discFrac);
    s.renderOrder = -10;
    s.frustumCulled = false;
    this.group.add(s);
    this.items.push({ s, dir: skyDir(az, el) });
  }

  update(camera) {
    if (!this.group.visible) return;
    for (const it of this.items) it.s.position.copy(camera.position).addScaledVector(it.dir, this.D);
  }
}
