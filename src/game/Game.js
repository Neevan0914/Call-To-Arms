import * as THREE from 'three';
import { generateTextures } from '../world/textures.js';
import { Terrain, HQ } from '../world/terrain.js';
import { CollisionWorld } from '../world/physics.js';
import { Atmosphere } from '../world/sky.js';
import { Vegetation, Grass, SUN_UNIFORMS } from '../world/vegetation.js';
import { Fort } from '../world/fort.js';
import { KharzanFort } from '../world/kfort.js';
import { makeNightPanorama, SkyBodies } from '../world/nightsky.js';
import { Roadside } from '../world/roadside.js';
import { Effects } from '../world/effects.js';
import { Post } from '../core/post.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { CameraRig } from './camera.js';
import { HUD } from './hud.js';
import { Story } from './story.js';
import { Player } from '../chars/player.js';
import { Soldier } from '../chars/soldier.js';
import { nextFrame, clamp } from '../core/utils.js';
import { loadAssets, loadTextures } from '../core/assets.js';
import { Humanoid, UNIFORMS } from '../chars/humanoid.js';
import { buildSoldierTemplate, materialFor } from '../chars/modelrig.js';
import { setWeaponAssets } from '../chars/weapons.js';

// Which soldier model / tint / headgear each uniform uses.
// Helmet tints per faction (multiplied into the helmet's paint).
const HELMET_TINT = { flared: [0.62, 0.68, 0.74], crested: [0.6, 0.63, 0.46], deep: [0.85, 0.9, 0.75], brodie: [0.85, 0.9, 0.75] };

const MODEL_MAP = {
  player: { model: 'rifleman', tint: 'velmora', helmet: false },
  velmora: { model: 'rifleman', tint: 'velmora', helmet: true },
  velmoraOfficer: { model: 'gunner', tint: 'officer', helmet: false, helmetAsset: 'crested' },
  velmoraQM: { model: 'rifleman', tint: 'velmora', helmet: false },
  kharzan: { model: 'gunner', tint: 'kharzan', helmet: false, helmetAsset: 'flared' },
  kharzanCoat: { model: 'gunner', tint: 'kharzanCoat', helmet: false, helmetAsset: 'flared' },
  bandit: { model: 'rifleman', tint: 'bandit', helmet: false },
};

const QUALITY = {
  high: { pr: 1.5, grass: 140000, shadow: 'high' },
  medium: { pr: 1.0, grass: 80000, shadow: 'medium' },
  low: { pr: 0.75, grass: 30000, shadow: 'low' },
};
const DIFF = {
  easy: { damageScale: 0.55, enemyAccuracy: 0.65 },
  normal: { damageScale: 1, enemyAccuracy: 1 },
  hard: { damageScale: 1.4, enemyAccuracy: 1.25 },
};

function loadSettings() {
  const params = new URLSearchParams(location.search);
  let s = {};
  try { s = JSON.parse(localStorage.getItem('cta-settings') || '{}'); } catch (e) { s = {}; }
  const q = params.get('q') || s.quality || 'high';
  return {
    quality: QUALITY[q] ? q : 'high', sensitivity: s.sensitivity ?? 1, invertY: !!s.invertY,
    voice: s.voice ?? true, difficulty: s.difficulty || 'normal',
  };
}

export class Game {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    Object.assign(this.settings, DIFF[this.settings.difficulty]);
    this.actors = [];
    this.soldiers = [];
    this.time = 0;
    this.timeScale = 1;
    this.controlsEnabled = false;
    this.paused = false;
    this.started = false;
    this._tmp = new THREE.Vector3();
  }

  saveSettings() {
    const s = this.settings;
    try { localStorage.setItem('cta-settings', JSON.stringify({ quality: s.quality, sensitivity: s.sensitivity, invertY: s.invertY, voice: s.voice, difficulty: s.difficulty })); } catch (e) { /* */ }
  }

  async init(progress) {
    const Q = QUALITY[this.settings.quality];
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.08, 1400);
    this.camera.position.set(0, 30, 30);

    progress(0.05, 'Weaving textures…'); await nextFrame();
    const aniso = renderer.capabilities.getMaxAnisotropy();
    this.T = generateTextures(Math.min(8, aniso));

    progress(0.12, 'Loading models…'); await nextFrame();
    const [assets, tex] = await Promise.all([
      loadAssets((p) => progress(0.12 + p * 0.12, 'Loading models…')),
      loadTextures(),
    ]);
    this.assets = assets;
    this.groundTex = tex.ground;
    setWeaponAssets(this.assets);
    const embedded = window.__CTA_ASSETS || {};
    this._voiceLoad = (audio) => audio.loadVoices((path) => embedded[path] || path);

    progress(0.28, 'Shaping the land…'); await nextFrame();
    this.terrain = new Terrain(7);
    this.scene.add(this.terrain.buildMesh(this.T, tex.ground));
    this.physics = new CollisionWorld(this.terrain);

    progress(0.4, 'Lighting the morning…'); await nextFrame();
    this.atmo = new Atmosphere(this.scene, renderer, Q.shadow, this.camera, { sky: tex.sky, hdr: tex.hdr });
    SUN_UNIFORMS.uSunDir.value.copy(this.atmo.sunDir);

    progress(0.5, 'Growing the Thornwood…'); await nextFrame();
    this.vegetation = new Vegetation(this.scene, this.terrain, this.physics, this.T, this.settings.quality, this.assets, renderer, this.atmo.sunDir);
    this.grass = new Grass(this.scene, this.terrain, Q.grass);

    progress(0.62, 'Raising Fort Velmar…'); await nextFrame();
    this.fort = new Fort(this.scene, this.terrain, this.physics, this.T);
    this.kfort = new KharzanFort(this, this.fort);
    progress(0.66, 'Painting the night sky…'); await nextFrame();
    this.nightTex = makeNightPanorama(Q.shadow === 'low' ? 2048 : 4096);
    this.skyBodies = new SkyBodies(this.scene);
    this.skyBodies.build();
    this.hq = new Fort(this.scene, this.terrain, this.physics, this.T, HQ, { y0: this.terrain.hqH, noLight: true, tag: 'hq-' });
    this.roadside = new Roadside(this, this.fort.mats);

    progress(0.72, 'Mustering soldiers…'); await nextFrame();
    this.soldierTemplates = {};
    for (const [k, lodK] of [['rifleman', 'riflemanLod'], ['gunner', 'gunnerLod']]) {
      if (!this.assets[k]) continue;
      try {
        const H = new Humanoid(UNIFORMS.velmora, this.T, { seed: 0.5 });
        const scenes = [this.assets[k], this.assets[lodK] || this.assets[k]];
        this.soldierTemplates[k] = buildSoldierTemplate(scenes, H);
      } catch (e) { console.warn('[assets] soldier rig failed', k, e); }
      await nextFrame();
    }
    this.effects = new Effects(this.scene, this.T, this);
    this.effects.addFire(this.fort.campfire, 1);
    this.input = new Input(renderer.domElement);
    this.input.sensitivity = this.settings.sensitivity;
    this.audio = new AudioEngine();
    this._voiceLoad(this.audio).then((n) => { if (n) console.log(`[voices] ${n} recorded lines`); });
    this.audio.voice = this.settings.voice;
    this.rig = new CameraRig(this.camera, this);
    this.post = new Post(renderer, this.scene, this.camera, this.settings.quality);
    this.post.world.sunDir.copy(this.atmo.sunDir);
    this.hud = new HUD(this);
    this.player = new Player(this);
    this.actors.push(this.player);
    this.story = new Story(this);
    this.story.prepareWorld();

    progress(0.86, 'Compiling shaders…'); await nextFrame();
    this.atmo.setupScene(this.scene);
    this.rig.update(0.016, 0.016);
    try { renderer.compile(this.scene, this.camera); } catch (e) { /* */ }
    this.post.render(0.016);
    this.effects.setScale(renderer, this.camera);

    window.addEventListener('resize', () => this.onResize());
    this.input.onLockChange = (locked) => {
      if (!locked && this.started && !this.ended && !this.paused) this.setPaused(true);
    };
    progress(1, 'Ready');
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  // Chapter III happens at night under the ringed planet
  setNight() {
    if (this.night) return;
    this.night = true;
    this.atmo.setNight(this.renderer, this.nightTex);
    this.skyBodies.group.visible = true;
    SUN_UNIFORMS.uSunCol.value.set(0.32, 0.42, 0.75);
    if (this.vegetation.treeSystem) this.vegetation.treeSystem.setNight();
    this.post.world.sunColor.set(0.35, 0.5, 1.0);
    this.post.world.rayScale = 0.35;
    this.effects.setNight();
    this.audio.setNight();
    this.renderer.toneMappingExposure = 1.45;
  }

  setQuality(q) {
    if (!QUALITY[q]) return;
    this.settings.quality = q;
    const Q = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
    this.atmo.setShadowQuality(Q.shadow);
    this.grass.setCount(Q.grass);
    this.post.setQuality(q);
    this.onResize();
    this.saveSettings();
  }

  setDifficulty(d) {
    if (!DIFF[d]) return;
    this.settings.difficulty = d;
    Object.assign(this.settings, DIFF[d]);
    this.saveSettings();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.effects.setScale(this.renderer, this.camera);
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) { this.input.unlock(); this.audio.ctx && this.audio.ctx.suspend(); window.speechSynthesis && window.speechSynthesis.pause(); }
    else { this.audio.ctx && this.audio.ctx.resume(); window.speechSynthesis && window.speechSynthesis.resume(); this.input.lock(); }
  }

  // Model options for a uniform (null -> procedural soldier).
  modelFor(uniform, { helmet = null } = {}) {
    const m = MODEL_MAP[uniform];
    const tpl = m && this.soldierTemplates && this.soldierTemplates[m.model];
    if (!tpl) return null;
    const hk = helmet || m.helmetAsset;
    const helmetAsset = hk ? this.helmetFor(hk) : null;
    return { template: tpl, showHelmet: m.helmet && !helmetAsset, helmetAsset, matFor: (part) => materialFor(tpl, part, m.tint) };
  }

  // Tinted helmet model (cached per type).
  helmetFor(kind) {
    this._helmets = this._helmets || {};
    if (kind in this._helmets) return this._helmets[kind];
    const src = this.assets && this.assets[`helmet_${kind}`];
    let h = null;
    if (src) {
      h = src.clone(true);
      const t = HELMET_TINT[kind];
      h.traverse((o) => {
        if (!o.isMesh || !/paint/i.test(o.material.name)) return;
        o.material = o.material.clone();
        if (t) o.material.color.multiply(new THREE.Color(t[0], t[1], t[2]));
      });
    }
    this._helmets[kind] = h;
    return h;
  }

  // ---------- actors ----------
  spawnSoldier(opts) {
    const s = new Soldier(this, opts);
    this.atmo.setupScene(s.h.root);
    this.actors.push(s);
    this.soldiers.push(s);
    return s;
  }

  removeSoldier(s) {
    this.scene.remove(s.h.root);
    if (s.droppedWeapon) this.scene.remove(s.droppedWeapon);
    s.h.meshes.forEach((m) => { if (!m.userData.sharedGeometry) m.geometry.dispose(); });
    this.actors = this.actors.filter((a) => a !== s);
    this.soldiers = this.soldiers.filter((a) => a !== s);
  }

  separate(actor, r) {
    for (const a of this.actors) {
      if (a === actor || !a.alive) continue;
      const dx = actor.position.x - a.position.x, dz = actor.position.z - a.position.z;
      const d2 = dx * dx + dz * dz;
      const m = r + (a.radius || 0.33);
      if (d2 < m * m && d2 > 1e-6 && Math.abs(actor.position.y - a.position.y) < 1.5) {
        const d = Math.sqrt(d2);
        const push = (m - d) * (a.isPlayer ? 1 : 0.5);
        actor.position.x += (dx / d) * push;
        actor.position.z += (dz / d) * push;
      }
    }
  }

  alertEnemies(pos, radius) {
    for (const s of this.soldiers) if (s.alive && s.position.distanceTo(pos) < radius) s.alerted = true;
  }

  onActorDeath(actor, from) {
    if (from === this.player) {
      this.player.stats.kills++;
      this.hud.notify(`${actor.name} eliminated`, 'kill');
    }
    this.story.onActorDeath(actor, from);
    // corpse limit
    const dead = this.soldiers.filter((s) => !s.alive);
    if (dead.length > 28) this.removeSoldier(dead[0]);
  }

  // Bullet: world + actor hit test. Returns {point, normal, actor, killed}.
  shootRay(origin, dir, maxDist, shooter, damage = 50) {
    const w = this.physics.raycast(origin, dir, maxDist);
    let best = w ? w.dist : maxDist;
    const res = { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), actor: null, killed: false, type: w ? w.type : 'none' };
    if (w) res.normal.copy(w.normal);
    let hitActor = null, hitPart = 'body';
    const oc = this._tmp;
    for (const a of this.actors) {
      if (a === shooter || !a.alive || a.faction === shooter.faction) continue;
      // coarse reject
      oc.subVectors(a.position, origin);
      const along = oc.dot(dir);
      if (along < 0 || along > best + 2) continue;
      oc.y += 1;
      const perp2 = oc.lengthSq() - along * along;
      if (perp2 > 4) continue;
      for (const s of a.h.getHitSpheres()) {
        const L = this._v2 || (this._v2 = new THREE.Vector3());
        L.subVectors(s.c, origin);
        const tca = L.dot(dir);
        if (tca < 0) continue;
        const d2 = L.lengthSq() - tca * tca;
        if (d2 > s.r * s.r) continue;
        const t = tca - Math.sqrt(s.r * s.r - d2);
        if (t > 0 && t < best) { best = t; hitActor = a; hitPart = s.part; }
      }
    }
    res.point.copy(origin).addScaledVector(dir, best);
    if (hitActor) {
      const mult = hitPart === 'head' ? 2.6 : hitPart === 'chest' ? 1.0 : hitPart === 'body' ? 0.9 : 0.6;
      const dmg = shooter.isPlayer ? (shooter.current === 'lmg' ? 46 : 100) * mult : damage * mult;
      res.actor = hitActor;
      res.killed = hitActor.takeDamage(dmg, shooter, res.point.clone(), dir.clone(), hitPart);
      res.type = 'flesh';
    } else if (w) {
      this.effects.impact(res.point, res.normal, w.type);
      this.audio.impact(w.type, res.point);
    }
    return res;
  }

  // ---------- main loop ----------
  frame() {
    const realDt = Math.min(this.clock.getDelta(), 0.05);
    const dt = this.paused ? 0 : realDt * this.timeScale;
    if (!this.paused) {
      this.time += dt;
      this.story.update(dt, realDt);
      if (this.started) this.player.update(dt);
      for (const s of this.soldiers) s.update(dt);
      const cp = this.camera.position;
      for (const s of this.soldiers) if (s.h.lodMeshes) s.h.setLod(s.position.distanceTo(cp) > 30 ? 1 : 0);
      this.fort.update(dt, this.time);
      this.hq.update(dt, this.time);
      this.kfort.update(dt, this.time);
      if (this.raid) { this.raid.update(dt); if (this.raid.done) { this.raid.dispose(); this.raid = null; } }
      this.effects.update(dt, this.camera);
      this.rig.update(dt, realDt);
      this.hud.update(realDt);
      this.audio.update(realDt, this.camera);
    }
    const focus = this.started ? this.player.position : this.camera.position;
    this.atmo.update(this.camera, this._tmp.copy(focus));
    this.skyBodies.update(this.camera);
    this.vegetation.update(dt, this.camera);
    this.grass.update(dt, this.camera, this.player.position);
    this.input.endFrame();
    this.post.render(realDt);
  }
}
