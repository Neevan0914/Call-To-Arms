import * as THREE from 'three';
import { rand } from '../core/utils.js';

const VS = `
attribute float aSize;
attribute vec4 aColor;
attribute float aRot;
varying vec4 vColor;
varying float vRot;
uniform float uScale;
#include <common>
#include <fog_pars_vertex>
void main() {
  vColor = aColor; vRot = aRot;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = `
uniform sampler2D map;
varying vec4 vColor;
varying float vRot;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  uv = mat2(c, -s, s, c) * uv + 0.5;
  vec4 t = texture2D(map, uv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.003) discard;
  #include <fog_fragment>
}`;

class ParticleSystem {
  constructor(scene, max, texture, blending, fog) {
    this.max = max;
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geometry = g;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: texture }, uScale: { value: 500 } }]);
    this.uniforms.map.value = texture;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending, fog,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 4 : 3;
    scene.add(this.points);
    // simulation state
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.rv = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.alive = 0;
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 1, grav = 0, fadeIn = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    this.base[i * 3] = r; this.base[i * 3 + 1] = g; this.base[i * 3 + 2] = b;
    this.a0[i] = a; this.drag[i] = drag; this.grav[i] = grav;
    this.rot[i] = Math.random() * 6.28; this.rv[i] = (Math.random() - 0.5) * 2;
    this.fadeIn[i] = fadeIn;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; } continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fi = this.fadeIn[i] > 0 ? Math.min(1, t / this.fadeIn[i]) : 1;
      const a = this.a0[i] * (1 - t) * fi;
      this.col[i * 4] = this.base[i * 3]; this.col[i * 4 + 1] = this.base[i * 3 + 1]; this.col[i * 4 + 2] = this.base[i * 3 + 2];
      this.col[i * 4 + 3] = a;
      this.rot[i] += this.rv[i] * dt;
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; }
    }
    const g = this.geometry.attributes;
    g.position.needsUpdate = true; g.aColor.needsUpdate = true; g.aSize.needsUpdate = true; g.aRot.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, T, game) {
    this.scene = scene;
    this.game = game;
    this.add = new ParticleSystem(scene, 2500, T.dot, THREE.AdditiveBlending, false);
    this.smoke = new ParticleSystem(scene, 2200, T.smoke, THREE.NormalBlending, true);
    this.emitters = [];

    // bullet trails: camera-facing ribbons along the bullet path that linger and fade
    this.trails = [];
    {
      const c = document.createElement('canvas'); c.width = 64; c.height = 8;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 8);
      const tex = new THREE.CanvasTexture(c);
      const geo = new THREE.PlaneGeometry(1, 1, 1, 8);
      geo.rotateX(-Math.PI / 2); // lie in XZ, length along Z
      geo.translate(0, 0, 0.5);
      // fade toward the shooter end and the far end
      const uv = geo.attributes.uv, pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); const a = Math.min(1, z * 6) * (1 - Math.pow(z, 3) * 0.6); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = a; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      for (let i = 0; i < 48; i++) {
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xd8dde0, transparent: true, opacity: 0, depthWrite: false, vertexColors: true, side: THREE.DoubleSide, fog: true });
        const m = new THREE.Mesh(geo, mat);
        m.visible = false; m.frustumCulled = false; m.matrixAutoUpdate = false; m.renderOrder = 3;
        scene.add(m);
        this.trails.push({ mesh: m, t: 0, life: 1, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, w: 0.03, a0: 0.3, drift: new THREE.Vector3() });
      }
    }
    // tracers
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true);
    tg.rotateX(Math.PI / 2); tg.translate(0, 0, 0.5);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 1.8), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(tg, tm);
      m.visible = false; m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, active: false, from: new THREE.Vector3(), dir: new THREE.Vector3(), total: 0, head: 0, len: 5, speed: 320 });
    }

    // muzzle flashes
    this.flashes = [];
    const fm = new THREE.SpriteMaterial({ map: T.flash, color: new THREE.Color(5, 3.4, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(fm.clone());
      s.visible = false;
      scene.add(s);
      this.flashes.push({ sprite: s, t: 0 });
    }
    // light pool (fixed count: never add/remove lights at runtime)
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 14, 2);
      scene.add(l);
      this.lights.push({ light: l, t: 0, dur: 0.06, peak: 0 });
    }
    this.lightCursor = 0;

    // ambient dust motes / pollen near the camera
    this.motes = new ParticleSystem(scene, 360, T.dot, THREE.AdditiveBlending, false);
    for (let i = 0; i < 360; i++) {
      this.motes.emit(rand(-14, 14), rand(0, 6), rand(-14, 14), rand(-0.1, 0.1), rand(-0.02, 0.05), rand(-0.1, 0.1), 1e9, 0.035, 0.035, 1.0, 0.85, 0.55, 0.0);
    }
    this.moteT = 0;
    this.motesAlpha = 0.35;
    this._v = new THREE.Vector3();

    // sabre trail: a smooth ribbon swept by the blade. Raw per-frame samples are
    // resampled with a spline (blade root) and a normalised spline of the blade
    // direction, so fast twirls come out as round arcs instead of straight chords.
    {
      const RAW = this.swRaw = 28, SUB = this.swSub = 10;
      const N = this.swN = (RAW - 1) * SUB + 1;
      const geo = new THREE.BufferGeometry();
      this.swPos = new Float32Array(N * 2 * 3);
      this.swAlpha = new Float32Array(N * 2);
      const edge = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) edge[i * 2 + 1] = 1;
      geo.setAttribute('position', new THREE.BufferAttribute(this.swPos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aA', new THREE.BufferAttribute(this.swAlpha, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
      const idx = [];
      for (let i = 0; i < N - 1; i++) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uCol: { value: new THREE.Color(1.25, 1.4, 1.65) } },
        vertexShader: 'attribute float aA; attribute float aEdge; varying float vA; varying float vEdge; void main(){ vA = aA; vEdge = aEdge; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 uCol; varying float vA; varying float vEdge;
          void main(){
            // soft haze toward the hilt, bright but feathered edge at the tip
            float body = smoothstep(0.0, 1.0, vEdge); body *= body;
            float rim = smoothstep(0.55, 0.93, vEdge) * (1.0 - smoothstep(0.93, 1.0, vEdge));
            float a = vA * (body * 0.55 + rim * 0.9);
            gl_FragColor = vec4(uCol * a, 1.0);
          }`,
      });
      this.swMesh = new THREE.Mesh(geo, mat);
      this.swMesh.frustumCulled = false; this.swMesh.renderOrder = 4; this.swMesh.visible = false;
      scene.add(this.swMesh);
      this.swSamples = []; // { b, d (blade vector), age }
      this.swLife = 0.2;
      this._cb = new THREE.Vector3(); this._cd = new THREE.Vector3();
    }
    // ground shock ring for slams
    {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 30, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      const ringGeo = new THREE.PlaneGeometry(1, 1); ringGeo.rotateX(-Math.PI / 2);
      this.rings = [];
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: 0xb8a68a, transparent: true, opacity: 0, depthWrite: false, fog: true }));
        m.visible = false; m.renderOrder = 2; scene.add(m);
        this.rings.push({ mesh: m, t: 1 });
      }
    }
  }

  // Record the blade this frame (called only while a sabre move plays; the trail fades out on its own).
  swordTrail(base, tip) {
    const S = this.swSamples;
    S.push({ b: base.clone(), d: tip.clone().sub(base), age: 0 });
    while (S.length > this.swRaw) S.shift();
  }

  _updateSwordTrail(dt) {
    const S = this.swSamples;
    for (const s of S) s.age += dt;
    while (S.length && S[0].age > this.swLife) S.shift();
    const n = S.length;
    if (n < 2) { this.swMesh.visible = false; return; }
    const P = this.swPos, A = this.swAlpha, SUB = this.swSub;
    const cr = (p0, p1, p2, p3, t, out) => {
      const t2 = t * t, t3 = t2 * t;
      return out.set(
        0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
        0.5 * (2 * p1.z + (p2.z - p0.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (3 * p1.z - p0.z - 3 * p2.z + p3.z) * t3));
    };
    const B = this._cb, D = this._cd;
    const total = (n - 1) * SUB + 1;
    let v = 0;
    for (let i = 0; i < n - 1; i++) {
      const s0 = S[Math.max(0, i - 1)], s1 = S[i], s2 = S[i + 1], s3 = S[Math.min(n - 1, i + 2)];
      const steps = i === n - 2 ? SUB + 1 : SUB;
      const l1 = s1.d.length(), l2 = s2.d.length();
      for (let k = 0; k < steps; k++) {
        const t = k / SUB;
        cr(s0.b, s1.b, s2.b, s3.b, t, B);
        cr(s0.d, s1.d, s2.d, s3.d, t, D);
        D.setLength(l1 + (l2 - l1) * t); // keep the blade length: arcs stay round
        const age = s1.age + (s2.age - s1.age) * t;
        const life = 1 - age / this.swLife;
        const head = Math.min(1, (total - 1 - v) / 6 + 0.6); // soften the newest edge slightly
        const a = Math.max(0, life) ** 1.5 * Math.min(1, v / (SUB * 1.5)) * head;
        // trail hugs the outer 65% of the blade
        P[v * 6] = B.x + D.x * 0.35; P[v * 6 + 1] = B.y + D.y * 0.35; P[v * 6 + 2] = B.z + D.z * 0.35;
        P[v * 6 + 3] = B.x + D.x; P[v * 6 + 4] = B.y + D.y; P[v * 6 + 5] = B.z + D.z;
        A[v * 2] = a; A[v * 2 + 1] = a;
        v++;
      }
    }
    const g = this.swMesh.geometry;
    g.setDrawRange(0, (v - 1) * 6);
    g.attributes.position.needsUpdate = true;
    g.attributes.aA.needsUpdate = true;
    this.swMesh.visible = true;
  }

  // Sabre slam: dust ring, flying clods, a flash and an expanding ground shock ring.
  slam(p) {
    const y = p.y + 0.05;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * 6.28 + rand(-0.1, 0.1), sp = rand(4, 8);
      this.smoke.emit(p.x + Math.cos(a) * 0.4, y + rand(0, 0.2), p.z + Math.sin(a) * 0.4, Math.cos(a) * sp, rand(0.3, 1.2), Math.sin(a) * sp,
        rand(0.9, 1.6), rand(0.25, 0.4), rand(1.4, 2.2), 0.46, 0.4, 0.31, 0.5, 3.2, -0.1);
    }
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.28;
      this.smoke.emit(p.x, y + 0.1, p.z, Math.cos(a) * rand(1.5, 5), rand(3, 7), Math.sin(a) * rand(1.5, 5), rand(0.6, 1.1), 0.06, 0.05, 0.2, 0.15, 0.1, 1, 0.3, 14);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28;
      this.add.emit(p.x, y + 0.2, p.z, Math.cos(a) * rand(3, 8), rand(1, 4), Math.sin(a) * rand(3, 8), rand(0.12, 0.3), 0.05, 0.01, 5, 3.6, 2.2, 1, 0.6, 9.8);
    }
    this.flashLight(this._v.set(p.x, p.y + 0.6, p.z), 14, 0.12, 0xe0e8ff, 7);
    const R = this.rings.find((r) => r.t >= 1) || this.rings[0];
    R.t = 0; R.mesh.position.set(p.x, y + 0.03, p.z); R.mesh.visible = true;
  }

  // night: the pollen motes become blinking fireflies
  setNight() {
    this.fireflies = true;
    this.motesAlpha = 1.4;
    const c = this.motes.col;
    for (let i = 0; i < this.motes.max; i++) { c[i * 4] = 1.6; c[i * 4 + 1] = 2.2; c[i * 4 + 2] = 0.6; }
  }

  setScale(renderer, camera) {
    const h = renderer.domElement.height;
    const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.add.uniforms.uScale.value = s;
    this.smoke.uniforms.uScale.value = s;
    this.motes.uniforms.uScale.value = s;
  }

  flashLight(pos, intensity = 40, dur = 0.06, color = 0xffb060, dist = 14) {
    const L = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    L.light.position.copy(pos);
    L.light.color.set(color);
    L.light.distance = dist;
    L.t = dur; L.dur = dur; L.peak = intensity;
    L.light.intensity = intensity;
  }

  muzzleFlash(pos, dir, big = false) {
    const f = this.flashes.find((x) => x.t <= 0) || this.flashes[0];
    f.t = 0.05;
    f.sprite.visible = true;
    f.sprite.position.copy(pos).addScaledVector(dir, 0.08);
    const s = big ? 0.75 : 0.55;
    f.sprite.scale.setScalar(s * rand(0.8, 1.2));
    f.sprite.material.rotation = Math.random() * 6.28;
    this.flashLight(pos, big ? 30 : 22, 0.06);
    // smoke puff
    for (let i = 0; i < 3; i++) {
      this.smoke.emit(pos.x, pos.y, pos.z, dir.x * rand(1, 3) + rand(-0.3, 0.3), dir.y * 2 + rand(0, 0.6), dir.z * rand(1, 3) + rand(-0.3, 0.3),
        rand(0.8, 1.6), 0.15, 1.1, 0.75, 0.74, 0.72, 0.22, 2.5, -0.15);
    }
    for (let i = 0; i < 4; i++) {
      this.add.emit(pos.x, pos.y, pos.z, dir.x * rand(5, 12) + rand(-1, 1), dir.y * 6 + rand(-1, 1), dir.z * rand(5, 12) + rand(-1, 1), rand(0.05, 0.12), 0.06, 0.02, 4, 2.4, 1, 1, 3, 4);
    }
  }

  // A lingering air/smoke streak along a bullet's path.
  trail(from, to, strength = 1) {
    const t = this.trails.reduce((a, b) => (a.t / a.life > b.t / b.life || !b.mesh.visible ? (b.mesh.visible ? a : b) : a), this.trails[0]);
    const T = this.trails.find((x) => !x.mesh.visible) || t;
    T.from.copy(from);
    T.dir.subVectors(to, from);
    T.len = Math.min(T.dir.length(), 160);
    if (T.len < 0.5) return;
    T.dir.normalize();
    T.t = 0; T.life = 0.7 + Math.random() * 0.5 * strength;
    T.w = 0.025 + 0.01 * strength;
    T.a0 = 0.22 + 0.12 * strength;
    T.drift.set((Math.random() - 0.5) * 0.15, 0.12 + Math.random() * 0.1, (Math.random() - 0.5) * 0.15);
    T.mesh.visible = true;
  }

  tracer(from, to, chance = 1) {
    this.trail(from, to, chance > 0.5 ? 1 : 0.6);
    if (Math.random() > chance) return;
    const t = this.tracers.find((x) => !x.active);
    if (!t) return;
    t.active = true;
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.total = t.dir.length();
    t.dir.normalize();
    t.head = 0;
    t.len = rand(3, 6);
    t.speed = rand(260, 380);
    t.mesh.visible = true;
  }

  impact(p, n, type = 'dirt') {
    if (type === 'flesh') return this.blood(p, n);
    const col = type === 'wood' ? [0.42, 0.32, 0.2] : type === 'stone' || type === 'metal' ? [0.55, 0.55, 0.53] : type === 'sand' ? [0.62, 0.55, 0.4] : [0.42, 0.34, 0.24];
    for (let i = 0; i < 7; i++) {
      this.smoke.emit(p.x, p.y, p.z, n.x * rand(0.5, 2.5) + rand(-0.6, 0.6), n.y * rand(0.5, 2.5) + rand(0.2, 1.4), n.z * rand(0.5, 2.5) + rand(-0.6, 0.6),
        rand(0.6, 1.4), 0.08, rand(0.5, 1.0), col[0], col[1], col[2], 0.55, 2.2, 0.4);
    }
    // chips / debris
    for (let i = 0; i < 6; i++) {
      this.smoke.emit(p.x, p.y, p.z, n.x * rand(2, 5) + rand(-2, 2), rand(2, 5), n.z * rand(2, 5) + rand(-2, 2), rand(0.4, 0.8), 0.04, 0.03, col[0] * 0.6, col[1] * 0.6, col[2] * 0.6, 1, 0.5, 9.8);
    }
    if (type === 'stone' || type === 'metal') {
      for (let i = 0; i < 5; i++) this.add.emit(p.x, p.y, p.z, n.x * rand(3, 8) + rand(-3, 3), rand(1, 5), n.z * rand(3, 8) + rand(-3, 3), rand(0.1, 0.3), 0.04, 0.01, 5, 3, 1, 1, 1, 9.8);
    }
  }

  blood(p, dir) {
    for (let i = 0; i < 10; i++) {
      this.smoke.emit(p.x, p.y, p.z, dir.x * rand(0.5, 2.5) + rand(-0.7, 0.7), rand(-0.2, 1.2), dir.z * rand(0.5, 2.5) + rand(-0.7, 0.7),
        rand(0.25, 0.7), 0.06, rand(0.25, 0.55), 0.32, 0.02, 0.02, 0.85, 3, 1.5);
    }
    for (let i = 0; i < 8; i++) {
      this.smoke.emit(p.x, p.y, p.z, dir.x * rand(1, 4) + rand(-1.5, 1.5), rand(0.5, 3), dir.z * rand(1, 4) + rand(-1.5, 1.5), rand(0.4, 0.8), 0.035, 0.03, 0.25, 0.01, 0.01, 1, 0.3, 9.8);
    }
  }

  sparks(p, n) {
    for (let i = 0; i < 12; i++) this.add.emit(p.x, p.y, p.z, n.x * rand(1, 4) + rand(-3, 3), rand(0, 4), n.z * rand(1, 4) + rand(-3, 3), rand(0.1, 0.35), 0.05, 0.01, 6, 4, 1.5, 1, 0.5, 9.8);
    this.flashLight(p, 6, 0.05, 0xffd090, 5);
  }

  explosion(p, scale = 1) {
    this.flashLight(p.clone().setY(p.y + 1.5), 900 * scale, 0.35, 0xffa050, 45 * scale);
    for (let i = 0; i < 40 * scale; i++) {
      const a = Math.random() * 6.28, u = rand(0.2, 1);
      this.add.emit(p.x + rand(-0.5, 0.5), p.y + rand(0, 1), p.z + rand(-0.5, 0.5), Math.cos(a) * u * 9 * scale, rand(3, 12) * scale, Math.sin(a) * u * 9 * scale,
        rand(0.25, 0.7), rand(1.5, 3) * scale, rand(3, 5) * scale, 3.5, rand(1.2, 1.9), 0.4, 0.9, 4.5, 2);
    }
    for (let i = 0; i < 50 * scale; i++) {
      const a = Math.random() * 6.28, u = rand(0.1, 1);
      const g = rand(0.12, 0.3);
      this.smoke.emit(p.x, p.y + rand(0, 1.5), p.z, Math.cos(a) * u * 6 * scale, rand(2, 9) * scale, Math.sin(a) * u * 6 * scale,
        rand(2.5, 6), rand(1.5, 2.5) * scale, rand(5, 9) * scale, g * 1.1, g, g * 0.9, 0.75, 1.3, -0.25);
    }
    for (let i = 0; i < 40 * scale; i++) {
      const a = Math.random() * 6.28;
      this.smoke.emit(p.x, p.y + 0.3, p.z, Math.cos(a) * rand(4, 14), rand(6, 16), Math.sin(a) * rand(4, 14), rand(0.8, 1.8), 0.12, 0.1, 0.18, 0.14, 0.1, 1, 0.3, 14);
    }
    for (let i = 0; i < 30 * scale; i++) {
      const a = Math.random() * 6.28;
      this.add.emit(p.x, p.y + 0.5, p.z, Math.cos(a) * rand(4, 18), rand(4, 18), Math.sin(a) * rand(4, 18), rand(0.4, 1.4), 0.12, 0.04, 6, 3, 1, 1, 0.3, 9.8);
    }
  }

  // continuous emitter (campfire etc.)
  addFire(pos, scale = 1) {
    this.emitters.push({ pos: pos.clone(), scale, acc: 0 });
  }

  update(dt, camera) {
    const cam = camera.position;
    const toCam = this._tc || (this._tc = new THREE.Vector3());
    const right = this._tr || (this._tr = new THREE.Vector3());
    const nrm = this._tn || (this._tn = new THREE.Vector3());
    const mid = this._tm || (this._tm = new THREE.Vector3());
    for (const T of this.trails) {
      if (!T.mesh.visible) continue;
      T.t += dt;
      const k = T.t / T.life;
      if (k >= 1) { T.mesh.visible = false; continue; }
      T.from.addScaledVector(T.drift, dt);
      mid.copy(T.from).addScaledVector(T.dir, T.len * 0.5);
      toCam.subVectors(cam, mid).normalize();
      right.crossVectors(T.dir, toCam).normalize();
      nrm.crossVectors(right, T.dir).normalize();
      const w = T.w * (1 + k * 5);
      const e = T.mesh.matrix.elements;
      e[0] = right.x * w; e[1] = right.y * w; e[2] = right.z * w; e[3] = 0;
      e[4] = nrm.x; e[5] = nrm.y; e[6] = nrm.z; e[7] = 0;
      e[8] = T.dir.x * T.len; e[9] = T.dir.y * T.len; e[10] = T.dir.z * T.len; e[11] = 0;
      e[12] = T.from.x; e[13] = T.from.y; e[14] = T.from.z; e[15] = 1;
      T.mesh.matrixWorldNeedsUpdate = true;
      T.mesh.material.opacity = T.a0 * (1 - k) * (1 - k);
    }
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.head += t.speed * dt;
      const tail = Math.max(0, t.head - t.len);
      const head = Math.min(t.head, t.total);
      if (tail >= t.total) { t.active = false; t.mesh.visible = false; continue; }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      this._v.copy(t.mesh.position).add(t.dir);
      t.mesh.lookAt(this._v);
      t.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
    }
    for (const f of this.flashes) {
      if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.sprite.visible = false; }
    }
    for (const L of this.lights) {
      if (L.t > 0) {
        L.t -= dt;
        L.light.intensity = Math.max(0, L.peak * (L.t / L.dur));
        if (L.t <= 0) L.light.intensity = 0;
      }
    }
    for (const e of this.emitters) {
      e.acc += dt;
      while (e.acc > 0.03) {
        e.acc -= 0.03;
        const s = e.scale;
        this.add.emit(e.pos.x + rand(-0.25, 0.25) * s, e.pos.y + rand(0, 0.2), e.pos.z + rand(-0.25, 0.25) * s, rand(-0.2, 0.2), rand(0.8, 1.8) * s, rand(-0.2, 0.2),
          rand(0.4, 0.8), rand(0.5, 0.8) * s, 0.1, 2.2, rand(0.7, 1.0), 0.25, 0.75, 0.5, -0.5, 0.15);
        if (Math.random() < 0.35) this.smoke.emit(e.pos.x, e.pos.y + 1.0 * s, e.pos.z, rand(-0.2, 0.2), rand(0.6, 1.2), rand(-0.2, 0.2), rand(3, 5), 0.4, 2.8 * s, 0.25, 0.24, 0.23, 0.28, 0.3, -0.05, 0.2);
        if (Math.random() < 0.08) this.add.emit(e.pos.x, e.pos.y + 0.3, e.pos.z, rand(-0.5, 0.5), rand(1.5, 3), rand(-0.5, 0.5), rand(0.8, 1.6), 0.04, 0.02, 5, 2.5, 0.6, 1, 0.3, -0.2);
      }
    }
    // motes wrap around camera
    const mp = this.motes.pos, cp = camera.position;
    this.moteT += dt;
    this.motes.update(dt);
    for (let i = 0; i < this.motes.max; i++) {
      for (const k of [0, 2]) {
        const c = k === 0 ? cp.x : cp.z;
        let v = mp[i * 3 + k] - c;
        if (v > 14) v -= 28; else if (v < -14) v += 28;
        mp[i * 3 + k] = c + v;
      }
      let vy = mp[i * 3 + 1] - (cp.y - 1.5);
      vy = ((vy % 6) + 6) % 6;
      mp[i * 3 + 1] = cp.y - 1.5 + vy;
      this.motes.col[i * 4 + 3] = this.fireflies
        ? this.motesAlpha * Math.pow(Math.max(0, Math.sin(this.moteT * (0.9 + (i % 7) * 0.13) + i * 1.7)), 4)
        : this.motesAlpha * (0.5 + Math.sin(this.moteT * 1.5 + i) * 0.5);
    }
    this._updateSwordTrail(dt);
    for (const R of this.rings) {
      if (R.t >= 1) continue;
      R.t = Math.min(1, R.t + dt / 0.55);
      const e = 1 - Math.pow(1 - R.t, 3);
      R.mesh.scale.setScalar(0.6 + e * 7.5);
      R.mesh.material.opacity = 0.7 * (1 - R.t);
      if (R.t >= 1) R.mesh.visible = false;
    }
    this.add.update(dt);
    this.smoke.update(dt);
  }
}
