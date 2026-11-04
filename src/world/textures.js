import * as THREE from 'three';
import { tfbm, hash2, mulberry32 } from '../core/noise.js';
import { clamp } from '../core/utils.js';

// All textures are generated procedurally on canvases at load time.

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// painter(u, v, x, y, out) -> writes out[0..2] (sRGB 0..1) and out[3] height (0..1)
function paint(w, h, painter) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const heights = new Float32Array(w * h);
  const out = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[3] = 0.5;
      painter(x / w, y / h, x, y, out);
      const i = (y * w + x) * 4;
      img.data[i] = clamp(out[0], 0, 1) * 255;
      img.data[i + 1] = clamp(out[1], 0, 1) * 255;
      img.data[i + 2] = clamp(out[2], 0, 1) * 255;
      img.data[i + 3] = 255;
      heights[y * w + x] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, ctx, heights, w, h };
}

function normalFromHeights(heights, w, h, strength = 2) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const H = (x, y) => heights[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(canvas, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const mix = (a, b, t) => a + (b - a) * t;
function mix3(out, a, b, t) {
  out[0] = mix(a[0], b[0], t); out[1] = mix(a[1], b[1], t); out[2] = mix(a[2], b[2], t);
}

export function generateTextures(aniso = 8) {
  const T = {};
  const S = 512;

  // ---------- Grass ground ----------
  {
    const dark = [0.16, 0.24, 0.08], light = [0.33, 0.42, 0.15], dry = [0.43, 0.40, 0.2];
    const p = paint(S, S, (u, v, x, y, o) => {
      const n = tfbm(u, v, 6, 6, 5, 11);
      const n2 = tfbm(u, v, 24, 24, 3, 3);
      const blade = hash2(x, y, 5);
      mix3(o, dark, light, clamp(n * 1.3 - 0.15 + (blade - 0.5) * 0.35, 0, 1));
      const d = clamp((tfbm(u, v, 3, 3, 3, 77) - 0.55) * 3, 0, 1);
      mix3(o, o, dry, d * 0.6);
      const k = 0.85 + n2 * 0.3;
      o[0] *= k; o[1] *= k; o[2] *= k;
      o[3] = n * 0.5 + blade * 0.5;
    });
    T.grass = tex(p.canvas, { aniso });
  }

  // ---------- Forest floor (needles, leaves, moss) ----------
  {
    const a = [0.20, 0.15, 0.09], b = [0.36, 0.27, 0.16], moss = [0.22, 0.29, 0.10];
    const p = paint(S, S, (u, v, x, y, o) => {
      const n = tfbm(u, v, 8, 8, 5, 21);
      const m = clamp((tfbm(u, v, 4, 4, 4, 9) - 0.5) * 3.5, 0, 1);
      const g = hash2(x, y, 13);
      mix3(o, a, b, clamp(n + (g - 0.5) * 0.3, 0, 1));
      mix3(o, o, moss, m * 0.8);
      o[3] = n;
    });
    // needles / twigs
    const ctx = p.ctx, rnd = mulberry32(5);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * S, y = rnd() * S, a2 = rnd() * Math.PI, l = 4 + rnd() * 10;
      const c = 60 + rnd() * 70;
      ctx.strokeStyle = `rgba(${c + 40},${c * 0.75},${c * 0.4},${0.35 + rnd() * 0.4})`;
      ctx.lineWidth = 0.6 + rnd();
      ctx.beginPath();
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + Math.cos(a2) * l, y + oy + Math.sin(a2) * l);
      }
      ctx.stroke();
    }
    // fallen leaves
    for (let i = 0; i < 220; i++) {
      const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 5;
      const hue = rnd();
      ctx.fillStyle = hue < 0.5 ? `rgba(${110 + rnd() * 50},${60 + rnd() * 30},25,0.75)` : `rgba(${80 + rnd() * 30},${70 + rnd() * 30},30,0.7)`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.55, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    T.forest = tex(p.canvas, { aniso });
  }

  // ---------- Dirt path ----------
  {
    const a = [0.30, 0.23, 0.15], b = [0.47, 0.37, 0.25];
    const p = paint(S, S, (u, v, x, y, o) => {
      const n = tfbm(u, v, 5, 5, 6, 41);
      const g = hash2(x, y, 3);
      mix3(o, a, b, clamp(n * 1.2 - 0.1 + (g - 0.5) * 0.25, 0, 1));
      o[3] = n;
    });
    const ctx = p.ctx, rnd = mulberry32(9);
    for (let i = 0; i < 900; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.8 + rnd() * rnd() * 5;
      const c = 70 + rnd() * 90;
      ctx.fillStyle = `rgba(${c},${c * 0.9},${c * 0.78},${0.5 + rnd() * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(20,14,8,0.35)';
      ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.35, r, 0, Math.PI * 2); ctx.fill();
    }
    T.dirt = tex(p.canvas, { aniso });
  }

  // ---------- Rock ----------
  {
    const p = paint(S, S, (u, v, x, y, o) => {
      const n = tfbm(u, v, 4, 4, 6, 61);
      const c = tfbm(u, v, 10, 10, 3, 62);
      const crack = Math.pow(clamp(1 - Math.abs(c - 0.5) * 14, 0, 1), 2);
      const base = 0.30 + n * 0.25 - crack * 0.15;
      o[0] = base; o[1] = base * 0.99; o[2] = base * 0.95;
      const lich = clamp((tfbm(u, v, 6, 6, 3, 63) - 0.62) * 5, 0, 1);
      mix3(o, o, [0.42, 0.45, 0.26], lich * 0.6);
      o[3] = n - crack * 0.4;
    });
    T.rock = tex(p.canvas, { aniso });
    T.rockN = tex(normalFromHeights(p.heights, S, S, 6), { srgb: false, aniso });
  }

  // ---------- Bark ----------
  {
    const p = paint(256, 512, (u, v, x, y, o) => {
      const n = tfbm(u, v, 4, 2, 5, 71);
      const ridges = Math.abs(Math.sin((u * 18 + n * 3.5) * Math.PI));
      const fine = hash2(x, y, 72);
      const h = Math.pow(ridges, 0.6) * 0.8 + fine * 0.2;
      const base = 0.12 + h * 0.18;
      o[0] = base * 1.25; o[1] = base * 0.95; o[2] = base * 0.7;
      o[3] = h;
    });
    T.bark = tex(p.canvas, { aniso });
    T.barkN = tex(normalFromHeights(p.heights, 256, 512, 5), { srgb: false, aniso });
  }

  // ---------- Wood planks / logs ----------
  {
    const p = paint(S, S, (u, v, x, y, o) => {
      const plank = Math.floor(v * 4);
      const pv = v * 4 - plank;
      const n = tfbm(u, v, 2, 8, 4, 81 + plank);
      const grain = Math.sin((pv * 20 + n * 6 + u * 2) * Math.PI) * 0.5 + 0.5;
      const gap = pv < 0.03 || pv > 0.97 ? 0.35 : 1;
      const tint = 0.85 + hash2(plank, 0, 3) * 0.3;
      const base = (0.30 + grain * 0.12 + n * 0.12) * gap * tint;
      o[0] = base * 1.18; o[1] = base * 0.88; o[2] = base * 0.6;
      o[3] = grain * 0.4 * gap + (gap < 1 ? 0 : 0.5);
    });
    T.wood = tex(p.canvas, { aniso });
    T.woodN = tex(normalFromHeights(p.heights, S, S, 3), { srgb: false, aniso });
  }

  // ---------- Log end / stacked logs (horizontal grain) ----------
  {
    const p = paint(S, S, (u, v, x, y, o) => {
      const row = Math.floor(v * 6);
      const rv = v * 6 - row;
      const round = Math.sqrt(Math.max(0, 1 - Math.pow(rv * 2 - 1, 2)));
      const n = tfbm(u, v, 3, 12, 4, 91);
      const grain = Math.abs(Math.sin((u * 30 + n * 8) * Math.PI));
      const base = (0.16 + round * 0.2 + grain * 0.05) * (0.85 + hash2(row, 2, 7) * 0.3);
      o[0] = base * 1.2; o[1] = base * 0.9; o[2] = base * 0.62;
      o[3] = round * 0.8 + grain * 0.2;
    });
    T.logs = tex(p.canvas, { aniso });
    T.logsN = tex(normalFromHeights(p.heights, S, S, 4), { srgb: false, aniso });
  }

  // ---------- Roof shingles ----------
  {
    const p = paint(256, 256, (u, v, x, y, o) => {
      const row = Math.floor(v * 10);
      const off = (row % 2) * 0.5;
      const col = Math.floor(u * 8 + off);
      const rv = v * 10 - row;
      const n = tfbm(u, v, 8, 8, 3, 101);
      const t = 0.8 + hash2(col, row, 1) * 0.35;
      const base = (0.16 + rv * 0.1 + n * 0.08) * t;
      o[0] = base * 1.05; o[1] = base * 0.95; o[2] = base * 0.85;
      o[3] = rv;
    });
    T.shingle = tex(p.canvas, { aniso });
    T.shingleN = tex(normalFromHeights(p.heights, 256, 256, 3), { srgb: false, aniso });
  }

  // ---------- Fabric (uniform detail) ----------
  {
    const p = paint(256, 256, (u, v, x, y, o) => {
      const w = (Math.sin(x * Math.PI * 0.5) * Math.sin(y * Math.PI * 0.5)) * 0.5 + 0.5;
      const n = tfbm(u, v, 4, 4, 3, 111);
      const g = 0.75 + w * 0.15 + n * 0.15;
      o[0] = o[1] = o[2] = g;
      o[3] = w;
    });
    T.fabric = tex(p.canvas, { srgb: true, aniso });
    T.fabricN = tex(normalFromHeights(p.heights, 256, 256, 1.2), { srgb: false, aniso });
  }

  // ---------- Sandbag ----------
  {
    const p = paint(256, 256, (u, v, x, y, o) => {
      const w = (Math.sin(x * Math.PI * 0.7) * Math.sin(y * Math.PI * 0.7)) * 0.5 + 0.5;
      const n = tfbm(u, v, 4, 4, 4, 121);
      const b = 0.42 + n * 0.15 + w * 0.06;
      o[0] = b * 1.05; o[1] = b * 0.95; o[2] = b * 0.72;
      o[3] = w * 0.5 + n * 0.5;
    });
    T.sack = tex(p.canvas, { aniso });
  }

  // ---------- Macro noise (anti-tiling) ----------
  {
    const p = paint(256, 256, (u, v, x, y, o) => {
      o[0] = tfbm(u, v, 3, 3, 5, 131);
      o[1] = tfbm(u, v, 5, 5, 4, 132);
      o[2] = tfbm(u, v, 8, 8, 3, 133);
    });
    T.macro = tex(p.canvas, { srgb: false, aniso: 1 });
  }

  // ---------- Particle sprites ----------
  {
    const c = makeCanvas(64); const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    T.dot = tex(c, { repeat: false, srgb: false, aniso: 1 });
  }
  {
    const p = paint(128, 128, (u, v, x, y, o) => {
      const dx = u - 0.5, dy = v - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = tfbm(u, v, 4, 4, 4, 141);
      const a = clamp((1 - r) * 1.4 - (1 - n) * 0.7, 0, 1);
      o[0] = o[1] = o[2] = 0.75 + n * 0.25;
      o[3] = a;
    });
    // put alpha from height
    const ctx = p.ctx; const img = ctx.getImageData(0, 0, 128, 128);
    for (let i = 0; i < 128 * 128; i++) img.data[i * 4 + 3] = p.heights[i] * 255;
    ctx.putImageData(img, 0, 0);
    T.smoke = tex(p.canvas, { repeat: false, srgb: false, aniso: 1 });
  }
  {
    const c = makeCanvas(128); const ctx = c.getContext('2d');
    ctx.translate(64, 64);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
    g.addColorStop(0, 'rgba(255,250,230,1)');
    g.addColorStop(0.2, 'rgba(255,200,110,0.9)');
    g.addColorStop(0.6, 'rgba(255,120,30,0.25)');
    g.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = g;
    for (let i = 0; i < 7; i++) {
      ctx.rotate((Math.PI * 2) / 7 + i * 0.13);
      ctx.beginPath();
      ctx.moveTo(-6, 0); ctx.lineTo(0, -60 + (i % 2) * 20); ctx.lineTo(6, 0);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
    T.flash = tex(c, { repeat: false, srgb: false, aniso: 1 });
  }

  // ---------- Light shaft gradient ----------
  {
    const c = makeCanvas(64, 256); const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
    const g2 = ctx.createLinearGradient(0, 0, 64, 0);
    g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.5, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = g2; ctx.fillRect(0, 0, 64, 256);
    T.shaft = tex(c, { repeat: false, srgb: false, aniso: 1 });
  }

  T.flagVelmora = makeVelmoranFlag();
  T.flagKharzan = makeKharzanFlag();
  return T;
}

// Fictional nation: The Free Marches of Velmora.
// Field divided diagonally (forest green over deep burgundy) by a gold line, a gold
// border, and a central ivory roundel bearing a golden eight-pointed star ringed
// by oak sprigs.
export function makeVelmoranFlag() {
  const w = 768, h = 480;
  const c = makeCanvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a1b2a'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1f4a2c';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#d6aa4c'; ctx.lineWidth = 14;
  ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(0, h); ctx.stroke();
  // border
  ctx.lineWidth = 22; ctx.strokeRect(11, 11, w - 22, h - 22);
  ctx.strokeStyle = '#1a1a14'; ctx.lineWidth = 2; ctx.strokeRect(23, 23, w - 46, h - 46);
  // roundel
  ctx.save(); ctx.translate(w / 2, h / 2);
  ctx.fillStyle = '#efe6cf';
  ctx.beginPath(); ctx.arc(0, 0, 118, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d6aa4c'; ctx.lineWidth = 9; ctx.stroke();
  // oak sprigs
  ctx.fillStyle = '#2f5a35'; ctx.strokeStyle = '#2f5a35'; ctx.lineWidth = 5;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(0, 8, 86, Math.PI / 2 + sgn * 0.25, Math.PI / 2 + sgn * 2.3, sgn < 0);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + sgn * (0.45 + i * 0.33);
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * 86, 8 + Math.sin(a) * 86, 17, 8, a + Math.PI / 2 + sgn * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  // eight-pointed star
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? 62 : 26;
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#e2b24c'; ctx.fill();
  ctx.strokeStyle = '#7a5a1c'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#7a1b2a';
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // cloth wear
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const n = 0.9 + tfbm(x / w, y / h, 6, 4, 4, 151) * 0.18 + ((x + y) % 3 === 0 ? -0.02 : 0);
    img.data[i] *= n; img.data[i + 1] *= n; img.data[i + 2] *= n;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Fictional enemy: The Kharzan Dominion. Charcoal field, rust-orange bars, black sun.
export function makeKharzanFlag() {
  const w = 512, h = 320;
  const c = makeCanvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a2d31'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#b4532a';
  ctx.fillRect(0, h * 0.1, w, h * 0.08); ctx.fillRect(0, h * 0.82, w, h * 0.08);
  ctx.beginPath(); ctx.arc(w / 2, h / 2, 70, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#16181a';
  ctx.beginPath(); ctx.arc(w / 2, h / 2, 52, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
