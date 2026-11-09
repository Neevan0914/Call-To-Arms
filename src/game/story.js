import * as THREE from 'three';
import { FORT, SPAWN } from '../world/terrain.js';
import { buildRifle, buildLMG, WEAPONS } from '../chars/weapons.js';
import { rand, lerp, clamp, easeInOut, easeOut } from '../core/utils.js';
import { ChapterTwo } from './chapter2.js';
import { ChapterThree } from './chapter3.js';

const COL = { you: '#e8d9a8', ally: '#9fc7a8', officer: '#e2c06e', enemy: '#e08a7a', qm: '#b7c9e0' };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Story {
  constructor(game) {
    this.g = game;
    this.timers = [];
    this.tweens = [];
    this.waiters = [];
    this.skipping = false;
    this.inCutscene = false;
    this.interactables = [];
    this.phase = 'title';
    this.skipHold = 0;
    this.checkpoint = null;
    this.respawning = false;
    this.ambushers = [];
    this.scouts = [];
    this.allies = [];
    this.attackers = [];
  }

  // ---------------- time helpers ----------------
  wait(sec) {
    if (this.skipping || sec <= 0) return Promise.resolve();
    return new Promise((resolve) => this.timers.push({ t: sec, resolve }));
  }
  until(pred) {
    if (pred()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ pred, resolve }));
  }
  tween(obj, key, to, dur, ease = easeInOut) {
    this.tweens = this.tweens.filter((t) => !(t.obj === obj && t.key === key));
    if (this.skipping || dur <= 0) { obj[key] = to; return; }
    this.tweens.push({ obj, key, from: obj[key], to, dur, t: 0, ease });
  }
  shot(fn, dur) {
    this.g.rig.play(fn, dur);
    if (this.skipping) this.g.rig.finishTrack();
    return this.wait(dur);
  }

  // Speak a line: plays its recorded voice clip if one exists (timing follows the clip),
  // otherwise falls back to the browser's speech synthesis with the character's voice.
  async say(speaker, text, dur, { color = COL.ally, voice = 'soldier', actor = null, italic = false, speak = true } = {}) {
    if (this.skipping) return;
    const g = this.g;
    g.hud.subtitle(speaker, text, color, italic);
    const pos = actor && actor !== g.player ? actor.position.clone().setY(actor.position.y + 1.6) : null;
    const clipDur = g.audio.playLine(voice, text, { pos, fallback: speak });
    if (actor) actor.h.a.talk = 1;
    await this.wait(clipDur > 0 ? Math.max(clipDur + 0.35, Math.min(dur, clipDur + 1.2)) : dur);
    if (actor) actor.h.a.talk = 0;
    g.hud.subtitle(null);
  }


  update(dt, realDt) {
    const g = this.g;
    // timers (real time so slow-motion doesn't stretch dialogue)
    if (this.timers.length) {
      const done = [];
      for (const t of this.timers) { t.t -= realDt; if (t.t <= 0) done.push(t); }
      if (done.length) { this.timers = this.timers.filter((t) => t.t > 0); done.forEach((t) => t.resolve()); }
    }
    for (const tw of this.tweens) {
      tw.t = Math.min(tw.dur, tw.t + realDt);
      tw.obj[tw.key] = lerp(tw.from, tw.to, tw.ease(tw.t / tw.dur));
    }
    this.tweens = this.tweens.filter((t) => t.t < t.dur);
    if (this.waiters.length) {
      const ready = this.waiters.filter((w) => w.pred());
      if (ready.length) { this.waiters = this.waiters.filter((w) => !ready.includes(w)); ready.forEach((w) => w.resolve()); }
    }
    // skip
    if (this.inCutscene && this.canSkip) {
      if (g.input.down('Space')) {
        this.skipHold += realDt;
        g.hud.skipHint(true, Math.min(1, this.skipHold / 0.8));
        if (this.skipHold >= 0.8) this.skip();
      } else {
        this.skipHold = Math.max(0, this.skipHold - realDt * 2);
        g.hud.skipHint(this.inCutscene, this.skipHold / 0.8);
      }
    }
    if (this.phaseUpdate) this.phaseUpdate(dt);
    // ally idle life: patrols
    for (const a of this.allies) {
      if (a.alive && a.patrol && a.role === 'idle' && !a.route.length) {
        a.patrolIdx = (a.patrolIdx + 1) % a.patrol.length;
        a.goTo(a.patrol[a.patrolIdx], 1.4);
      }
    }
  }

  skip() {
    this.skipping = true;
    this.skipHold = 0;
    this.g.audio.stopSpeech();
    this.g.hud.subtitle(null);
    const ts = this.timers; this.timers = [];
    ts.forEach((t) => t.resolve());
    for (const tw of this.tweens) tw.obj[tw.key] = tw.to;
    this.tweens = [];
    this.g.rig.finishTrack();
  }

  async cutscene(fn, { letterbox = true, canSkip = true } = {}) {
    const g = this.g;
    this.inCutscene = true;
    this.canSkip = canSkip;
    this.skipping = false;
    g.controlsEnabled = false;
    g.player.invulnerable = true;
    g.player.hiddenFromAI = true;
    g.player.aiming = false;
    g.hud.show(false);
    g.hud.letterbox(letterbox);
    g.hud.prompt(null);
    clearTimeout(this._barkT);
    g.hud.subtitle(null);
    try { await fn(); } catch (e) { console.error(e); }
    this.skipping = false;
    this.inCutscene = false;
    g.hud.skipHint(false);
    g.hud.subtitle(null);
    g.hud.letterbox(false);
  }

  endCutscene({ yaw = null, pitch = -0.08 } = {}) {
    const g = this.g;
    if (yaw != null) g.rig.yaw = yaw;
    g.rig.pitch = pitch;
    g.rig.setThird(0.9);
    g.controlsEnabled = true;
    g.player.invulnerable = false;
    g.player.hiddenFromAI = false;
    g.hud.show(true);
    if (!g.input.locked && !g.paused) g.input.lock();
  }

  // ---------------- interactables ----------------
  addInteract(pos, label, action, radius = 2.2) {
    const it = { pos, label, action, radius, enabled: true };
    this.interactables.push(it);
    return it;
  }

  checkInteract(player, pressed) {
    let best = null, bd = Infinity;
    for (const it of this.interactables) {
      if (!it.enabled) continue;
      const d = player.position.distanceTo(it.pos);
      if (d < it.radius && d < bd) { bd = d; best = it; }
    }
    this.g.hud.prompt(best && this.g.controlsEnabled ? best.label : null);
    if (best && pressed) { best.enabled = false; best.action(); }
  }

  // ---------------- helpers ----------------
  // camera position in front of an actor's face (relative to their facing)
  faceCam(actor, out, dist = 1.3, side = 0.35, up = 0.0) {
    const hp = new THREE.Vector3();
    actor.h.head.getWorldPosition(hp);
    const yaw = actor.h.root.rotation.y;
    const f = V(Math.sin(yaw), 0, Math.cos(yaw)), r = V(-Math.cos(yaw), 0, Math.sin(yaw));
    out.copy(hp).addScaledVector(f, dist).addScaledVector(r, side);
    out.y += up;
    return hp;
  }

  ground(x, z) { return V(x, this.g.terrain.getHeight(x, z), z); }

  freeSpot(x, z, r = 0.6) {
    const P = this.g.physics;
    for (let k = 0; k < 40; k++) {
      const a = k * 2.4, d = k * 0.6;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (P.isFree(px, pz, r)) return this.ground(px, pz);
    }
    return this.ground(x, z);
  }

  spawnEnemy(pos, o = {}) {
    const s = this.g.spawnSoldier({
      faction: 'kharzan', uniform: o.coat ? 'kharzanCoat' : 'kharzan', weapon: o.weapon || 'rifle', pos, yaw: o.yaw ?? 0,
      role: o.role || 'assault', accuracy: o.accuracy ?? 0.3, damage: o.damage ?? 13, hp: o.hp ?? 100, name: o.name || 'Kharzan Soldier',
      holdFire: o.holdFire ?? false, helmet: o.helmet,
    });
    s.allyDamageScale = o.allyDamageScale ?? 1;
    return s;
  }

  spawnAlly(pos, o = {}) {
    const s = this.g.spawnSoldier({
      faction: 'velmora', uniform: o.uniform || 'velmora', weapon: o.weapon ?? 'rifle', pos, yaw: o.yaw ?? 0, role: o.role || 'idle',
      accuracy: 0.24, damage: 34, hp: o.hp ?? 100, name: o.name || 'Velmoran Soldier', platformY: o.platformY ?? null, skin: o.skin, helmet: o.helmet,
    });
    this.allies.push(s);
    return s;
  }

  onActorDeath(actor) {
    if (this.phase === 'ambush') this.g.hud.setEnemyCount(this.ambushers.filter((a) => a.alive).length);
    if (this.phase === 'scouts') this.g.hud.setEnemyCount(this.scouts.filter((a) => a.alive).length);
    if (this.phase === 'defend' && actor === this.captain && !this.captainLine) {
      this.captainLine = true;
      this.bark('Sergeant Brannoc', "The Captain's down! Hold them — hold them!", COL.ally, 2.6, 'sergeant', 'panic');
    }
  }

  bark(speaker, text, color = COL.ally, dur = 2.6, voice = 'soldier') {
    const g = this.g;
    g.hud.subtitle(speaker, text, color);
    const clipDur = g.audio.playLine(voice, text);
    if (clipDur > 0) dur = Math.max(dur, clipDur + 0.4);
    clearTimeout(this._barkT);
    this._barkText = text;
    this._barkT = setTimeout(() => { if (!this.inCutscene && this._barkText === text) g.hud.subtitle(null); }, dur * 1000);
  }


  onPlayerDeath() {
    const g = this.g;
    if (this.phase === 'defend' || this.phase === 'ending') { this.playerFell = true; return; }
    if (this.respawning || !this.checkpoint) return;
    this.respawning = true;
    g.controlsEnabled = false;
    const ds = document.getElementById('deathScreen');
    setTimeout(() => ds.classList.remove('hidden'), 1200);
    setTimeout(async () => {
      try { await this.checkpoint(); } catch (e) { console.error(e); }
      ds.classList.add('hidden');
      g.controlsEnabled = true;
      this.respawning = false;
    }, 3800);
  }

  // ---------------- world setup (runs at load) ----------------
  prepareWorld() {
    const g = this.g, f = g.fort, T = g.T;
    const p = g.player;
    // player lying in the clearing
    this.spawnYaw = 2.3;
    p.position.copy(this.ground(SPAWN.x, SPAWN.z));
    p.yaw = this.spawnYaw;
    p.h.root.rotation.y = p.yaw;
    p.h.a.getup = 0;
    p.h.update(0.016);
    // rifle lying in the grass beside the player
    const right = V(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
    const fwd = V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const rp = p.position.clone().addScaledVector(right, 0.95).addScaledVector(fwd, 0.25);
    rp.y = g.terrain.getHeight(rp.x, rp.z) + 0.04;
    this.rifleProp = buildRifle(T);
    this.rifleProp.position.copy(rp);
    this.rifleProp.rotation.set(0, p.yaw + 0.3, Math.PI / 2);
    g.scene.add(this.rifleProp);
    this.riflePos = rp;

    // ---- Fort garrison ----
    const S = f.spots;
    this.captain = this.spawnAlly(S.captain.clone(), { uniform: 'velmoraOfficer', weapon: 'none', name: 'Captain Halvek', yaw: 0, skin: 0xd9a888 });
    this.captain.lookAt = S.gateInside;
    this.qm = this.spawnAlly(S.quartermaster.clone(), { uniform: 'velmoraQM', weapon: 'none', name: 'Quartermaster Dell', yaw: 0, skin: 0xb88660 });
    this.qm.lookAt = S.welcome;
    this.sergeant = this.spawnAlly(this.ground(S.captain.x - 2.5, S.captain.z - 1.5), { name: 'Sergeant Brannoc', yaw: 0.3, skin: 0xc8946c, helmet: 'deep' });
    this.sergeant.lookAt = S.gateInside;
    // sentries on the gate & south towers
    this.sentries = [];
    for (const sx of [-2.4, 2.4]) {
      const pos = V(f.gateTop.x + sx, f.gateTop.y, f.gateTop.z + 0.3);
      const s = this.spawnAlly(pos, { name: 'Sentry', helmet: 'brodie', platformY: f.gateTop.y - 0.02, yaw: 0, role: 'idle' });
      s.faceYaw = 0;
      this.sentries.push(s);
    }
    for (const i of [1, 3]) {
      const t = f.towerTops[i];
      const s = this.spawnAlly(V(t.x, t.y, t.z + 1.2), { name: 'Sentry', helmet: 'brodie', platformY: t.y - 0.1, yaw: 0, role: 'idle' });
      s.faceYaw = 0.2 * (i === 1 ? -1 : 1);
      this.sentries.push(s);
    }
    // campfire
    this.fireSitters = S.campfireSeats.map((pos, i) => {
      const s = this.spawnAlly(pos.clone(), { name: 'Velmoran Soldier' });
      s.forceCrouch = 0.85;
      s.lookAt = f.campfire;
      s.h.a.crouch = 0.85;
      return s;
    });
    // patrols
    const P1 = [this.ground(FORT.x - 12, FORT.z - 14), this.ground(FORT.x + 12, FORT.z - 14), this.ground(FORT.x + 12, FORT.z + 10), this.ground(FORT.x - 12, FORT.z + 10)];
    const pa = this.spawnAlly(P1[0].clone(), { name: 'Velmoran Soldier' });
    pa.patrol = P1; pa.patrolIdx = 0;
    const pb = this.spawnAlly(P1[2].clone(), { name: 'Velmoran Soldier' });
    pb.patrol = [P1[2], P1[3], P1[0], P1[1]]; pb.patrolIdx = 0;
    const rack = this.spawnAlly(this.ground(f.rackPos.x + 1.0, f.rackPos.z + 0.5), { name: 'Velmoran Soldier', yaw: -Math.PI / 2 });
    rack.lookAt = f.rackPos;
    this.garrison = [this.sergeant, ...this.fireSitters, pa, pb, rack];

    // LMG on the quartermaster's table
    this.lmgProp = buildLMG(T);
    this.lmgProp.position.copy(f.qmTable).add(V(0.4, 0.06, -0.05));
    this.lmgProp.rotation.set(0, Math.PI / 2 + 0.15, Math.PI / 2);
    g.scene.add(this.lmgProp);
  }

  // ---------------- main flow ----------------
  async run(from = 'intro') {
    this.g.player.stats.start = performance.now();
    if (from === 'keep') { await this.chapterTwo(); return; }
    if (from === 'road') { await this.chapterThree(); return; }
    const order = ['intro', 'ambush', 'path', 'fort', 'welcome', 'defend'];
    let i = Math.max(0, order.indexOf(from));
    if (i > 0) this.jumpTo(order[i]);
    if (i <= 0) await this.intro();
    if (i <= 1) await this.ambush();
    if (i <= 2) await this.path();
    if (i <= 3) await this.fortArrival();
    if (i <= 4) await this.welcome();
    await this.defend();
    await this.ending();
    await this.chapterTwo();
  }

  // Debug / dev: set the world state as it would be at the start of a phase.
  jumpTo(phase) {
    const g = this.g, p = g.player, f = g.fort;
    p.h.a.getup = -1;
    if (this.rifleProp) { g.scene.remove(this.rifleProp); this.rifleProp = null; }
    p.weapons.rifle.has = true; p.weapons.rifle.mag = 0; p.weapons.rifle.reserve = 0;
    if (phase === 'ambush') {
      p.weapons.rifle.has = false;
      this.rifleProp = buildRifle(g.T); this.rifleProp.position.copy(this.riflePos); this.rifleProp.rotation.set(0, 2.6, Math.PI / 2); g.scene.add(this.rifleProp);
      p.position.copy(this.ground(0, 0));
      this.spawnAmbushers(true);
      this.endCutscene({ yaw: Math.PI / 2 });
    } else if (phase === 'path') {
      p.position.copy(this.ground(-2, -40));
      p.equip('sword');
      this.endCutscene({ yaw: 0 });
    } else if (phase === 'fort') {
      const pt = g.terrain.pointAtS(g.terrain.pathLength - 110);
      p.position.copy(this.ground(pt.x, pt.z));
      p.equip('sword');
      this.endCutscene({ yaw: 0 });
    } else if (phase === 'welcome') {
      f.openGate();
      p.position.copy(f.spots.gateInside);
      p.equip('sword');
      this.endCutscene({ yaw: 0 });
    } else if (phase === 'defend') {
      f.openGate();
      p.position.copy(f.spots.welcome);
      p.weapons.lmg.has = true; p.weapons.lmg.mag = 20; p.weapons.lmg.reserve = 120;
      g.scene.remove(this.lmgProp);
      p.equip('lmg');
      this.endCutscene({ yaw: Math.PI });
    }
    p.yaw = g.rig.yaw + Math.PI;
    g.hud.updateWeapon(p);
  }

  // ===== 1. Wake up =====
  async intro() {
    const g = this.g, p = g.player, u = g.post.u, rig = g.rig, A = g.audio;
    this.phase = 'intro';
    this.spawnAmbushers(false);
    u.uFade.value = 1; u.uEyelid.value = 1; u.uBlur.value = 1; u.uDesat.value = 0.35;
    A.setMood('silent');
    A.muffle = 0.6;
    await this.cutscene(async () => {
      const head = new THREE.Vector3();
      p.h.root.updateMatrixWorld(true);
      p.h.head.getWorldPosition(head);
      const fwd = V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      const right = V(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
      const canopy = head.clone().add(V(0, 6, 0)).addScaledVector(fwd, 1.4).addScaledVector(right, 0.6);
      const rifleLook = this.riflePos.clone();
      const pov = head.clone().add(V(0, 0.08, 0));
      p.h.root.visible = false;
      this.shot((t, o) => { o.pos.copy(pov); o.look.copy(canopy).add(V(Math.sin(t * 3) * 0.3, 0, Math.cos(t * 2) * 0.2)); o.fov = 62; }, 9);
      for (let i = 0; i < 4; i++) A.heartbeat(i * 1.1, 0.5);
      await this.wait(1.2);
      this.tween(u.uFade, 'value', 0, 2.2);
      this.tween(u.uEyelid, 'value', 0.6, 1.6);
      await this.wait(1.8);
      this.tween(u.uEyelid, 'value', 1, 0.25);
      await this.wait(0.35);
      this.tween(u.uEyelid, 'value', 0.35, 1.2);
      this.tween(u.uBlur, 'value', 0.7, 2);
      this.tween(A, 'muffle', 0.25, 4);
      await this.say('You', 'Ahh… ugh. My head…', 3.0, { color: COL.you, voice: 'you', delivery: 'groggy', pitch: 0.9, rate: 0.85 });
      // look toward the rifle
      this.shot((t, o) => {
        const k = easeInOut(t);
        o.pos.copy(pov).add(V(0, k * 0.15, 0));
        o.look.copy(canopy).lerp(rifleLook, k);
        o.fov = 62 - k * 8;
      }, 3.2);
      this.tween(u.uEyelid, 'value', 0.15, 2.4);
      this.tween(u.uBlur, 'value', 0.35, 2.4);
      await this.say('You', 'What… what happened…?', 3.0, { color: COL.you, voice: 'you', delivery: 'groggy', pitch: 0.9, rate: 0.9 });
      this.tween(u.uEyelid, 'value', 1, 0.2);
      await this.wait(0.25);
      this.tween(u.uEyelid, 'value', 0, 0.6);
      this.tween(u.uBlur, 'value', 0.08, 2.5);
      this.tween(u.uDesat, 'value', 0, 4);
      this.tween(A, 'muffle', 0, 3);
      A.setMood('calm');
      // get up, third person
      p.h.root.visible = true;
      const base = p.position.clone();
      this.tween(p.h.a, 'getup', 1, 4.6, (x) => x);
      this.shot((t, o) => {
        const ang = p.yaw + Math.PI * 0.62 - t * 0.9;
        const r = 2.9 - t * 0.4;
        o.pos.set(base.x + Math.sin(ang) * r, base.y + 0.55 + t * 1.0, base.z + Math.cos(ang) * r);
        p.h.chest.getWorldPosition(o.look);
        o.look.y -= 0.1;
        o.fov = 50;
      }, 5.2);
      await this.wait(1.2);
      await this.say('You', 'Hello…? Anyone? …Where the hell is my unit?', 3.4, { color: COL.you, voice: 'you', delivery: 'uneasy', pitch: 0.9 });
      await this.wait(0.7);
      p.h.a.getup = -1;
      u.uBlur.value = 0;
      // distant shout + first shot
      const lead = this.ambushers[0];
      const behind = p.position.clone().addScaledVector(fwd, -2.5).add(V(0, 1.7, 0)).addScaledVector(right, 0.7);
      this.shot((t, o) => { o.pos.copy(behind); o.look.copy(lead.position).add(V(0, 1.2, 0)); o.fov = 52; }, 2.5);
      for (const e of this.ambushers) { e.lookAt = p.position; }
      await this.say('Kharzan soldier (distant)', 'Hesk! Varo tan — varo!', 2.2, { color: COL.enemy, voice: 'kharzanFar', delivery: 'shout', pitch: 0.6, rate: 1.1 });
      // a bullet slams into a tree beside the player
      const hitPt = p.position.clone().addScaledVector(right, 1.3).add(V(0, 1.4, 0)).addScaledVector(fwd, 0.6);
      A.shot('rifle', lead.position.clone().add(V(0, 1.5, 0)));
      g.effects.impact(hitPt, V(-1, 0.2, 0).normalize(), 'wood');
      A.whiz(hitPt);
      A.impact('wood', hitPt);
      rig.addTrauma(0.3);
      A.setMood('tension');
      // reveal the patrol
      for (const e of this.ambushers) e.goTo(e.position.clone().add(V(-5, 0, rand(-1, 1))), 1.4);
      const mid = this.ambushers.reduce((m, e) => m.add(e.position), V(0, 0, 0)).divideScalar(this.ambushers.length);
      const camP = mid.clone().lerp(p.position, 0.35).add(V(0, 1.6, 4));
      this.shot((t, o) => { o.pos.copy(camP).add(V(-t * 1.5, 0, 0)); o.look.copy(mid).add(V(0, 1.3, 0)); o.fov = 45 - t * 6; }, 3.2);
      await this.say('Kharzan soldier', 'Velmori dosk! Tarak!', 2.4, { color: COL.enemy, voice: 'kharzan', delivery: 'shout', pitch: 0.5, rate: 1.05 });
      this.shot((t, o) => {
        o.pos.copy(p.position).addScaledVector(right, 0.7).add(V(0, 1.5, 0)).addScaledVector(fwd, -2.2);
        o.look.copy(this.riflePos).add(V(0, 0.2, 0));
        o.fov = 55;
      }, 2.6);
      await this.say('You', "Greycoats! My rifle — where's my rifle?!", 2.6, { color: COL.you, voice: 'you', delivery: 'panic', rate: 1.15 });
    });
    p.h.a.getup = -1;
    p.h.root.visible = true;
    u.uFade.value = 0; u.uEyelid.value = 0; u.uBlur.value = 0; u.uDesat.value = 0;
    g.audio.muffle = 0;
    const toRifle = Math.atan2(-(this.riflePos.x - p.position.x), -(this.riflePos.z - p.position.z));
    this.endCutscene({ yaw: toRifle, pitch: -0.35 });
    g.hud.el.hud.classList.add('tutorial');
    setTimeout(() => g.hud.el.hud.classList.remove('tutorial'), 14000);
  }

  spawnAmbushers(active) {
    for (const a of this.ambushers) this.g.removeSoldier(a);
    const pts = [[46, -6], [51, 5], [44, 15], [55, -16], [49, 24]];
    this.ambushers = pts.map(([x, z], i) => {
      const pos = this.freeSpot(x, z);
      const s = this.spawnEnemy(pos, { role: active ? 'assault' : 'hold', yaw: -Math.PI / 2, holdFire: !active, accuracy: 0.26, damage: 12, name: 'Kharzan Raider' });
      s.engageMax = rand(20, 30);
      return s;
    });
  }

  // ===== 2. Ambush in the clearing =====
  async ambush() {
    const g = this.g, p = g.player;
    this.phase = 'ambush';
    g.hud.setObjective('Grab your rifle');
    g.hud.setMarker(this.riflePos.clone().add(V(0, 0.4, 0)));
    let picked = p.weapons.rifle.has;
    const release = () => {
      for (const e of this.ambushers) { e.role = 'assault'; e.lookAt = null; }
      setTimeout(() => { for (const e of this.ambushers) e.holdFire = false; }, picked ? 2500 : 0);
    };
    const takeRifle = () => {
      if (this.rifleProp) { g.scene.remove(this.rifleProp); this.rifleProp = null; }
      p.give('rifle', 5, 15);
      g.hud.notify('Varn M.09 Rifle acquired');
      g.hud.setObjective('Survive the ambush');
      g.hud.setMarker(null);
      g.hud.setEnemyCount(this.ambushers.filter((a) => a.alive).length);
      g.audio.setMood('combat');
      picked = true;
      release();
    };
    if (!picked) this.addInteract(this.riflePos, 'Pick up rifle', takeRifle, 2.0);
    else takeRifle();
    // enemies start moving & shooting even if the player dawdles
    setTimeout(() => { if (!picked) { for (const e of this.ambushers) { e.role = 'assault'; e.lookAt = null; } } }, 2500);
    setTimeout(() => { if (!picked) for (const e of this.ambushers) e.holdFire = false; }, 9000);

    this.checkpoint = async () => {
      g.post.u.uFade.value = 1;
      this.spawnAmbushers(true);
      for (const e of this.ambushers) e.holdFire = true;
      setTimeout(() => this.ambushers.forEach((e) => (e.holdFire = false)), 3000);
      p.revive(this.ground(0, 0), Math.PI / 2);
      if (this.rifleProp) { g.scene.remove(this.rifleProp); this.rifleProp = null; }
      p.weapons.rifle.has = true; p.weapons.rifle.mag = 5; p.weapons.rifle.reserve = 15;
      p.equip('rifle', true);
      picked = true;
      g.hud.setObjective('Survive the ambush'); g.hud.setMarker(null);
      g.hud.setEnemyCount(5);
      g.rig.yaw = -Math.PI / 2; g.rig.setThird(0);
      this.tween(g.post.u.uFade, 'value', 0, 1.2);
    };
    await this.until(() => this.ambushers.every((a) => !a.alive) && p.alive && !this.respawning);
    this.checkpoint = null;
    g.hud.setEnemyCount(null);
    g.audio.setMood('calm');
    await this.wait(1.4);
    this.bark('You', "…That's the last of them.", COL.you, 2.4, 'you', 'breathless');
    await this.wait(2.6);
    p.weapons.rifle.mag = 0; p.weapons.rifle.reserve = 0;
    g.hud.updateWeapon(p);
    g.audio.dryFire();
    g.hud.notify('Varn M.09 Rifle — out of ammunition');
    this.bark('You', 'And that was my last round. Great. Just the sabre, then.', COL.you, 3.2, 'you', 'dry');
    await this.wait(1.2);
    p.equip('sword');
    g.hud.notify('Sabre drawn — LMB to slash');
    await this.wait(2.4);
  }

  // ===== 3. Find the path, scouts =====
  async path() {
    const g = this.g, p = g.player, T = g.terrain;
    this.phase = 'findPath';
    g.hud.setObjective('Find a way out of the forest');
    const tStart = g.time;
    this.phaseUpdate = () => {
      if (g.time - tStart > 18) {
        const cp = T.closestPathPoint(p.position.x, p.position.z);
        g.hud.setMarker(this.ground(cp.x, cp.z).add(V(0, 1, 0)));
      }
    };
    await this.until(() => T.pathQuery(p.position.x, p.position.z).d < 4.5);
    this.phaseUpdate = null;
    g.hud.setMarker(null);
    this.bark('You', "A road. Finally… it's got to lead somewhere.", COL.you, 3, 'you', 'relieved');
    g.hud.setObjective('Follow the dirt path');
    this.phase = 'path';
    // compute s of the scout ambush point (on the bend south of the clearing)
    const sp = T.pathQuery(36, -150);
    const sScout = sp.s;
    this.phaseUpdate = () => {
      const q = T.pathQuery(p.position.x, p.position.z);
      const s = q.d < 40 ? q.s : T.closestPathPoint(p.position.x, p.position.z).s;
      const pt = T.pointAtS(s + 30);
      g.hud.setMarker(this.ground(pt.x, pt.z).add(V(0, 1.2, 0)));
      this._pathS = s;
    };
    await this.until(() => (this._pathS || 0) > sScout - 30);
    // --- scouts ---
    this.phase = 'scouts';
    const spawnScouts = () => {
      for (const s of this.scouts) g.removeSoldier(s);
      const s0 = this._pathS + 24;
      const c = T.pointAtS(s0), c2 = T.pointAtS(s0 + 2);
      const dx = c2.x - c.x, dz = c2.z - c.z, L = Math.hypot(dx, dz);
      const nx = -dz / L, nz = dx / L;
      this.scouts = [1, -1].map((side, i) => {
        const pos = this.freeSpot(c.x + nx * side * 9 + (dx / L) * i * 4, c.z + nz * side * 9 + (dz / L) * i * 4);
        const s = this.spawnEnemy(pos, { weapon: 'bayonet', role: 'melee', damage: 16, hp: 100, name: 'Kharzan Scout' });
        s.yaw = Math.atan2(p.position.x - pos.x, p.position.z - pos.z);
        return s;
      });
    };
    spawnScouts();
    const cpS = this._pathS;
    g.audio.setMood('combat');
    this.bark('Kharzan scout', 'Velmori! Krask tan!', COL.enemy, 2, 'scout', 'shout');
    g.hud.setObjective('Kharzan scouts — cut them down');
    g.hud.setEnemyCount(2);
    this.phaseUpdate = null;
    g.hud.setMarker(null);
    this.checkpoint = async () => {
      g.post.u.uFade.value = 1;
      const pt = T.pointAtS(cpS - 6);
      p.revive(this.ground(pt.x, pt.z), 0);
      p.equip('sword', true);
      this._pathS = cpS;
      spawnScouts();
      g.hud.setEnemyCount(2);
      const ahead = T.pointAtS(cpS + 10);
      g.rig.faceYawTowards(ahead, p.position); g.rig.setThird(0);
      this.tween(g.post.u.uFade, 'value', 0, 1.2);
    };
    await this.until(() => this.scouts.every((s) => !s.alive) && p.alive && !this.respawning);
    this.checkpoint = null;
    g.hud.setEnemyCount(null);
    g.audio.setMood('calm');
    await this.wait(1.2);
    this.bark('You', "Scouts. The Dominion's crawling all over these woods…", COL.you, 3.2, 'you', 'uneasy');
    g.hud.setObjective('Follow the dirt path');
    this.phase = 'path2';
    this.phaseUpdate = () => {
      const q = T.pathQuery(p.position.x, p.position.z);
      const s = q.d < 40 ? q.s : T.closestPathPoint(p.position.x, p.position.z).s;
      const pt = T.pointAtS(Math.min(s + 30, T.pathLength - 30));
      g.hud.setMarker(this.ground(pt.x, pt.z).add(V(0, 1.2, 0)));
    };
    const gate = g.fort.spots.gateOutside;
    await this.until(() => p.position.distanceTo(gate) < 78 && p.alive);
    this.phaseUpdate = null;
  }

  // ===== 4. Fort reveal =====
  async fortArrival() {
    const g = this.g, p = g.player, f = g.fort, A = g.audio;
    this.phase = 'fort';
    p.vel.set(0, 0, 0);
    await this.cutscene(async () => {
      A.setMood('hope');
      const start = p.position.clone();
      const toFort = f.spots.gateFront.clone().sub(start).setY(0).normalize();
      p.yaw = Math.atan2(toFort.x, toFort.z); p.h.root.rotation.y = p.yaw;
      p.h.a.speed = 0;
      this.shot((t, o) => {
        const k = easeInOut(t);
        o.pos.copy(start).addScaledVector(toFort, -3.2 + k * 1.5).add(V(0.9 - k * 0.4, 1.6 + k * 7.5, 0));
        o.look.copy(start).add(V(0, 1.4, 0)).lerp(f.flagPos, k);
        o.fov = 52 - k * 12;
      }, 7);
      await this.wait(2.6);
      g.hud.titleCard('FORT VELMAR', 'Velmoran Free Army · Thornwood Frontier', 4.5);
      await this.wait(4.6);
      const s0 = this.sentries[0];
      const gt = f.gateTop.clone();
      this.shot((t, o) => { o.pos.copy(gt).add(V(-3 + t * 1.2, -1.2, 9)); o.look.copy(s0.position).add(V(0, 1.4, 0)); o.fov = 40; }, 3);
      s0.lookAt = p.position;
      s0.h.a.aim = 1;
      await this.say('Sentry', 'Halt! Who goes there? Show your face!', 2.8, { color: COL.ally, voice: 'sentry1', delivery: 'shout', actor: s0, rate: 1.1 });
      const over = p.position.clone().addScaledVector(toFort, -2.0).add(V(0.6, 1.5, 0));
      this.shot((t, o) => { o.pos.copy(over).add(V(0, t * 0.2, 0)); o.look.copy(gt).add(V(0, 1.4, 0)); o.fov = 48; }, 3.2);
      await this.say('You', "Easy! Easy — don't shoot! I'm… I think I'm one of you!", 2.8, { color: COL.you, voice: 'you', delivery: 'urgent' });
      const s1 = this.sentries[1];
      s1.lookAt = p.position;
      this.shot((t, o) => { o.pos.copy(gt).add(V(3 - t, -1.0, 8)); o.look.copy(s1.position).add(V(0, 1.4, 0)); o.fov = 38; }, 3.2);
      await this.say('Sentry', "Wait — burgundy tabs on his collar… He's one of ours! Open the gate!", 3.2, { color: COL.ally, voice: 'sentry2', delivery: 'shout', actor: s1 });
      f.openGate();
      A._noiseBurst && A.enabled && A._noiseBurst(A.sfx, { dur: 2.2, type: 'bandpass', f0: 300, f1: 180, q: 4, gain: 0.25, buffer: A.brown });
      this.shot((t, o) => { o.pos.copy(f.spots.gateOutside).add(V(-4, 2.2, 6)); o.look.copy(f.spots.gateFront).add(V(0, 2.5, -4)); o.fov = 50; }, 3);
      await this.wait(3);
      s0.h.a.aim = 0;
    });
    f.openGate();
    this.endCutscene({ yaw: Math.atan2(-(f.spots.gateFront.x - p.position.x), -(f.spots.gateFront.z - p.position.z)) });
    g.hud.setObjective('Enter Fort Velmar');
    g.hud.setMarker(f.spots.gateInside.clone().add(V(0, 1.5, 0)));
    for (const s of this.sentries) s.lookAt = null;
    // a few garrison soldiers come to see the newcomer
    this.sergeant.goTo(this.ground(FORT.x - 2, FORT.z + 10), 1.6);
    await this.until(() => f.inside(p.position, 1) && p.position.z < FORT.z + FORT.half - 4 && p.alive);
    g.hud.setMarker(null);
  }

  // ===== 5. Welcome & the Rkm M28 =====
  async welcome() {
    const g = this.g, p = g.player, f = g.fort, S = f.spots, A = g.audio;
    this.phase = 'welcome';
    const cap = this.captain, sgt = this.sergeant, qm = this.qm;
    await this.cutscene(async () => {
      A.setMood('hope');
      // place everyone
      p.position.copy(S.welcome); p.vel.set(0, 0, 0);
      p.yaw = Math.PI; p.h.root.rotation.y = p.yaw;
      if (p.current !== 'sword' && p.weapons.sword.has) p.equip('sword', true);
      cap.route = []; cap.position.copy(S.captain); cap.yaw = 0; cap.lookAt = p.position;
      sgt.route = []; sgt.position.copy(this.ground(S.captain.x - 2.6, S.captain.z + 2.4)); sgt.lookAt = p.position;
      const extras = this.garrison.filter((s) => s !== sgt);
      extras.forEach((s, i) => {
        const spot = S.gather[(i + 1) % S.gather.length];
        s.patrol = null; s.forceCrouch = 0; s.route = [];
        s.goTo(spot, 1.8);
        s.lookAt = p.position;
      });
      const head = (a, out = new THREE.Vector3()) => { a.h.head.getWorldPosition(out); return out; };
      // 1. wide
      this.shot((t, o) => {
        o.pos.copy(S.welcome).add(V(-3.5 + t * 1.5, 3.2 - t * 0.6, 4.5));
        o.look.copy(S.captain).add(V(0, 1.4, 0)).lerp(S.welcome, 0.35);
        o.fov = 50;
      }, 4.2);
      await this.wait(0.8);
      await this.say('Captain Halvek', "Easy, soldier. Easy. Lower the blade… you're among friends now.", 3.6, { color: COL.officer, voice: 'captain', delivery: 'warm', actor: cap, pitch: 0.8, rate: 0.95 });
      // 2. over player's shoulder toward captain
      this.shot((t, o) => {
        o.pos.copy(p.position).add(V(0.85, 1.72, 1.55 + t * 0.15));
        head(cap, o.look);
        o.fov = 40;
      }, 5);
      await this.say('You', 'Friends? I… I woke up in the Thornwood. No memory. No unit. Just greycoats, waiting for me.', 4.8, { color: COL.you, voice: 'you', delivery: 'shaken', actor: p });
      // 3. captain close up
      this.shot((t, o) => {
        o.look.copy(this.faceCam(cap, o.pos, 1.35 - t * 0.1, 0.45, -0.05));
        o.fov = 34;
      }, 5.4);
      await this.say('Captain Halvek', 'Kharzan raiders. They hit our patrol two nights ago… We thought nobody walked out of those woods.', 5.2, { color: COL.officer, voice: 'captain', delivery: 'grave', actor: cap, pitch: 0.8, rate: 0.95 });
      // 4. sergeant
      this.shot((t, o) => {
        o.look.copy(this.faceCam(sgt, o.pos, 1.4, -0.6, 0.0));
        o.fov = 36;
      }, 4.4);
      await this.say('Sergeant Brannoc', "Captain — look at his collar. Burgundy tabs. Seventh Company… he's one of ours, sir.", 4.2, { color: COL.ally, voice: 'sergeant', delivery: 'urgent', actor: sgt });
      // 5. captain
      this.shot((t, o) => {
        o.look.copy(this.faceCam(cap, o.pos, 1.45 - t * 0.2, -0.35, 0.05));
        o.fov = 34;
      }, 4.4);
      await this.say('Captain Halvek', "Then welcome home, soldier. Whatever you lost out there… we'll help you find it.", 4.2, { color: COL.officer, voice: 'captain', delivery: 'warm', actor: cap, pitch: 0.8, rate: 0.95 });
      // 6. player's face — inner thought
      this.shot((t, o) => {
        o.look.copy(this.faceCam(p, o.pos, 1.2 - t * 0.15, 0.25, 0.02));
        o.fov = 32;
      }, 4.2);
      await this.say('You', "(They know this uniform. They're on my side… I think.)", 4.0, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
      // 7. captain orders the quartermaster
      cap.lookAt = qm.position;
      this.shot((t, o) => {
        o.pos.copy(S.captain).add(V(2.5, 1.7, 3.5));
        o.look.copy(qm.position).add(V(0, 1.2, 0)).lerp(S.captain.clone().add(V(0, 1.5, 0)), 0.5 - t * 0.4);
        o.fov = 44;
      }, 4.4);
      await this.say('Captain Halvek', "Dell! Get this man a proper weapon — that sabre won't hold back the Dominion.", 4.2, { color: COL.officer, voice: 'captain', delivery: 'command', actor: cap, pitch: 0.8 });
      qm.lookAt = p.position;
      qm.h.a.wave = 1;
      this.shot((t, o) => { o.look.copy(this.faceCam(qm, o.pos, 2.2, -1.0, 0.1)); o.fov = 38; }, 3.4);
      await this.say('Quartermaster Dell', "Aye, sir! Over here, friend — I've got just the thing for you.", 3.2, { color: COL.qm, voice: 'quartermaster', delivery: 'cheerful', actor: qm });
      qm.h.a.wave = 0;
    });
    qm.h.a.wave = 0;
    cap.lookAt = p.position;
    this.endCutscene({ yaw: Math.atan2(-(qm.position.x - p.position.x), -(qm.position.z - p.position.z)) });
    g.hud.setObjective('Collect a weapon from the Quartermaster');
    g.hud.setMarker(qm.position.clone().add(V(0, 2.1, 0)));
    let got = false;
    this.addInteract(f.qmTable.clone().add(V(0, -0.8, 1.0)), 'Take the Rkm M28 from the Quartermaster', () => { got = true; }, 2.6);
    await this.until(() => got);
    g.hud.setMarker(null);

    await this.cutscene(async () => {
      const head = (a, out = new THREE.Vector3()) => { a.h.head.getWorldPosition(out); return out; };
      const table = f.qmTable;
      p.position.copy(this.freeSpot(table.x, table.z + 1.3, 0.4));
      p.yaw = Math.PI; p.h.root.rotation.y = p.yaw;
      qm.lookAt = p.position;
      g.scene.remove(this.lmgProp);
      qm.setWeapon('lmg');
      qm.h.a.aim = 0.35;
      this.shot((t, o) => {
        o.pos.copy(table).add(V(-2.2 + t * 0.4, 0.85, 2.4));
        head(qm, o.look); o.look.y -= 0.3;
        o.fov = 42;
      }, 5.4);
      await this.say('Quartermaster Dell', "There she is. Rkm Model 28. Twenty rounds a box, and she'll chew through 'em fast — so short bursts, yeah?", 5.4, { color: COL.qm, voice: 'quartermaster', delivery: 'cheerful', actor: qm });
      qm.setWeapon('none');
      p.give('lmg', 20, 120);
      A.pickup();
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.5, -0.6, -0.1)); o.look.y -= 0.3; o.fov = 38; }, 3.2);
      await this.say('You', 'Huh. This feels… familiar. Thanks.', 3.0, { color: COL.you, voice: 'you', delivery: 'thoughtful', actor: p });
      // trouble
      A.whistle();
      await this.wait(1.0);
      const s1 = this.sentries[1];
      this.shot((t, o) => { o.pos.copy(f.gateTop).add(V(2, -2.2, -7)); o.look.copy(s1.position).add(V(0, 1.4, 0)); o.fov = 42; }, 3.6);
      s1.faceYaw = 0; s1.h.a.aim = 1;
      await this.say('Sentry', 'Captain! Movement in the treeline — greycoats, dozens of them!', 3.4, { color: COL.ally, voice: 'sentry2', delivery: 'panic', actor: s1, rate: 1.2 });
      A.setMood('tension');
      A.horn();
      // spawn the attackers now so they're visible
      this.spawnWave(true);
      // breach explosion
      const camB = this.ground(FORT.x - 25.5, FORT.z + 13).add(V(0, 3.2, 0));
      const breachLook = V(FORT.x - FORT.half, f.y0 + 1.8, FORT.z);
      this.shot((t, o) => { o.pos.copy(camB).add(V(-t * 0.6, 0, 0)); o.look.copy(breachLook); o.fov = 55; }, 3.4);
      await this.wait(0.8);
      const bp = V(FORT.x - FORT.half, g.fort.y0 + 0.5, FORT.z);
      g.effects.explosion(bp, 1.4);
      A.explosion(bp);
      g.rig.addTrauma(0.9);
      f.blowBreach();
      A.setMood('combat');
      await this.wait(2.6);
      // the charge across the field
      const gateOut = f.spots.gateOutside;
      this.shot((t, o) => { o.pos.copy(f.gateTop).add(V(-1, 2.6, 2.6)); o.look.copy(gateOut).add(V(0, 0, 22)); o.fov = 50 - t * 6; }, 3.4);
      await this.wait(1.2);
      this.captain.lookAt = S.gateInside;
      this.captain.faceYaw = 0;
      this.shot((t, o) => { o.look.copy(this.faceCam(this.captain, o.pos, 1.7, 0.6, 0.1)); o.fov = 40; }, 3.4);
      await this.say('Captain Halvek', 'KHARZANS! Everyone to the walls — hold this fort!', 3.0, { color: COL.officer, voice: 'captain', delivery: 'shout', actor: this.captain, pitch: 0.75, rate: 1.15 });
    });
    if (!f.debris.visible) { f.blowBreach(); }
    if (!this.attackers.length) this.spawnWave(true);
    if (p.current !== 'lmg') p.equip('lmg', true);
    this.endCutscene({ yaw: Math.atan2(-(S.gateInside.x - p.position.x), -(S.gateInside.z - p.position.z)) });
  }

  spawnWave(initial = false) {
    const f = this.g.fort, S = f.spots;
    const make = (pos, route, coat) => {
      const e = this.spawnEnemy(this.freeSpot(pos.x + rand(-2, 2), pos.z + rand(-2, 2)), { coat, accuracy: 0.3, damage: 14, allyDamageScale: 1.35, name: 'Kharzan Trooper' });
      e.goTo(route.map((r) => r.clone().add(V(rand(-2.5, 2.5), 0, rand(-1.5, 1.5)))), rand(3.6, 4.6));
      e.engageMax = rand(16, 28);
      this.attackers.push(e);
      return e;
    };
    if (initial) {
      S.enemyGateSpawn.forEach((p, i) => make(p, [S.gateFront, S.gateInside], i % 2 === 0));
      S.enemyBreachSpawn.forEach((p, i) => make(p, [S.breachOutside, S.breachInside], i % 2 === 1));
    } else {
      const gate = Math.random() < 0.55;
      const list = gate ? S.enemyGateSpawn : S.enemyBreachSpawn;
      for (let i = 0; i < 3; i++) make(list[Math.floor(Math.random() * list.length)], gate ? [S.gateFront, S.gateInside] : [S.breachOutside, S.breachInside], Math.random() < 0.5);
    }
  }

  // ===== 6. Defend the fort (scripted defeat) =====
  async defend() {
    const g = this.g, p = g.player, f = g.fort, A = g.audio;
    this.phase = 'defend';
    if (!this.attackers.length) this.spawnWave(true);
    if (!f.debris.visible) f.blowBreach();
    A.setMood('combat');
    g.hud.setObjective('Defend Fort Velmar');
    // garrison takes up positions
    const spots = f.coverSpots.map((s) => ({ ...s, taken: false }));
    const defenders = [this.captain, this.sergeant, this.qm, ...this.garrison].filter((a, i, arr) => a.alive && arr.indexOf(a) === i);
    for (const a of defenders) {
      a.patrol = null; a.forceCrouch = 0; a.faceYaw = null; a.lookAt = null;
      if (a.weaponType === 'none') a.setWeapon('rifle');
      let best = null, bd = Infinity;
      for (const s of spots) { if (s.taken) continue; const d = s.pos.distanceTo(a.position); if (d < bd) { bd = d; best = s; } }
      if (best) { best.taken = true; a.coverSpot = best; }
      a.role = 'defender';
      a.route = [];
      a.hp = 100;
    }
    for (const s of this.sentries) { s.role = 'sentry'; s.faceYaw = null; }
    const t0 = g.time;
    let nextWave = 6, nextShell = 5;
    this.phaseUpdate = (dt) => {
      const el = g.time - t0;
      const alive = this.attackers.filter((a) => a.alive).length;
      g.hud.setEnemyCount(alive);
      nextWave -= dt;
      if (nextWave <= 0) { nextWave = rand(5, 8); if (alive < 17) this.spawnWave(false); }
      nextShell -= dt;
      if (nextShell <= 0) {
        nextShell = rand(5, 9);
        this.artillery();
      }
      if (el > 45 && !this.warned) { this.warned = true; this.bark('Sergeant Brannoc', "There's too many of them! They're through the wall!", COL.ally, 3, 'sergeant', 'panic'); }
      if (el > 75 && !this.warned2) { this.warned2 = true; this.bark('Velmoran Soldier', "We can't hold them! We can't—", COL.ally, 2.6, 'soldier', 'panic'); }
    };
    await this.until(() => {
      const el = g.time - t0;
      const allies = this.allies.filter((a) => a.alive && !this.sentries.includes(a)).length;
      return this.playerFell || el > 105 || (el > 40 && allies <= 1);
    });
    this.phaseUpdate = null;
  }

  artillery(target = null) {
    const g = this.g, p = g.player, f = g.fort, A = g.audio;
    let pos = target;
    if (!pos) {
      for (let k = 0; k < 10; k++) {
        const c = V(FORT.x + rand(-26, 26), 0, FORT.z + rand(-26, 26));
        if (c.distanceTo(p.position.clone().setY(0)) > 10) { pos = c; break; }
      }
      if (!pos) return;
    }
    pos.y = g.terrain.getHeight(pos.x, pos.z);
    A.shellWhistle(1.2);
    setTimeout(() => {
      g.effects.explosion(pos, 1);
      A.explosion(pos);
      const d = pos.distanceTo(p.position);
      g.rig.addTrauma(Math.max(0, 1 - d / 30));
      for (const a of g.actors) {
        if (!a.alive || a.isPlayer) continue;
        const dd = a.position.distanceTo(pos);
        if (dd < 4) a.takeDamage(200, null, a.aimPoint(new THREE.Vector3()), a.position.clone().sub(pos).normalize());
      }
    }, 1200);
  }

  // ===== 7. Ending =====
  async ending() {
    const g = this.g, p = g.player, A = g.audio, u = g.post.u;
    this.phase = 'ending';
    g.hud.setEnemyCount(null);
    await this.cutscene(async () => {
      if (p.alive) {
        const camPos = g.camera.position.clone(), camQ = g.camera.quaternion.clone();
        const look = camPos.clone().add(V(0, 0, -10).applyQuaternion(camQ));
        this.shot((t, o) => { o.pos.copy(camPos); o.look.copy(look); o.fov = g.camera.fov; }, 1.6);
        A.shellWhistle(1.3);
        await this.wait(1.3);
        const fwd = V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const bp = p.position.clone().addScaledVector(fwd, 3.2);
        bp.y = g.terrain.getHeight(bp.x, bp.z);
        g.effects.explosion(bp, 1.2);
        A.explosion(bp);
        p.alive = false;
        p.h.a.dead = true; p.h.a.deathT = 0; p.h.a.deathDir = -1;
      }
      g.timeScale = 0.3;
      g.rig.addTrauma(1);
      A.tinnitus(9, 0.05);
      this.tween(A, 'muffle', 0.9, 1.0);
      this.tween(u.uBlur, 'value', 0.55, 1.5);
      this.tween(u.uDesat, 'value', 0.65, 2);
      this.tween(u.uRedTint, 'value', 0.25, 2);
      A.setMood('sad');
      // POV from the ground
      await this.wait(0.4);
      p.h.root.updateMatrixWorld(true);
      const head = new THREE.Vector3();
      p.h.head.getWorldPosition(head);
      const pov = head.clone().add(V(0, 0.15, 0));
      const sky = pov.clone().add(V(0.5, 8, 2));
      p.h.root.visible = false;
      this.shot((t, o) => { o.pos.copy(pov); o.look.copy(sky).add(V(Math.sin(t * 4) * 0.6, 0, Math.cos(t * 3) * 0.4)); o.fov = 64; }, 4.5);
      this.tween(u.uEyelid, 'value', 0.55, 2);
      await this.wait(2.2);
      this.tween(u.uEyelid, 'value', 0.25, 1.5);
      g.timeScale = 1;
      // a Kharzan officer stands over the player
      const fwd = V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      const side = V(-fwd.z, 0, fwd.x);
      const officerTarget = head.clone().addScaledVector(side, 1.7).addScaledVector(fwd, 0.6);
      const start = officerTarget.clone().addScaledVector(side, 5).addScaledVector(fwd, 3);
      const officer = this.spawnEnemy(this.ground(start.x, start.z), { coat: true, role: 'idle', weapon: 'sword', name: 'Kharzan Officer' });
      officer.goTo(this.ground(officerTarget.x, officerTarget.z), 1.3);
      officer.lookAt = pov;
      this.shot((t, o) => {
        o.pos.copy(pov);
        const oh = new THREE.Vector3(); officer.h.head.getWorldPosition(oh);
        o.look.copy(sky).lerp(oh, easeInOut(Math.min(1, t * 1.6)));
        o.fov = 58;
      }, 9);
      await this.wait(3.2);
      await this.say('Kharzan Officer', "Hm. This one's still breathing… Velmoran. Seventh Company.", 3.8, { color: COL.enemy, voice: 'kharzanOfficer', delivery: 'menace', pitch: 0.5, rate: 0.85, actor: officer });
      await this.say('Kharzan Officer', 'Take him alive. The Marshal will want to question him.', 4.2, { color: COL.enemy, voice: 'kharzanOfficer', delivery: 'menace', pitch: 0.5, rate: 0.85, actor: officer });
      this.tween(u.uEyelid, 'value', 1, 3);
      this.tween(u.uFade, 'value', 1, 3.5);
      await this.wait(3.8);
    }, { canSkip: true });
    g.timeScale = 1;
    u.uFade.value = 1;
    A.setMood('silent');
    A.muffle = 0.5;
    u.uBlur.value = 0; u.uDesat.value = 0; u.uRedTint.value = 0;
    p.h.root.visible = true;
  }

  showEnd({ chapter = null, title = null, sub = null } = {}) {
    const g = this.g, p = g.player;
    const box = document.getElementById('endScreen');
    if (chapter) box.querySelector('.chapter').textContent = chapter;
    if (title) box.querySelector('.game-title').textContent = title;
    if (sub) box.querySelector('.end-sub').textContent = sub;
    g.ended = true;
    g.controlsEnabled = false;
    g.input.unlock();
    g.hud.show(false);
    g.hud.subtitle(null);
    g.audio.stopSpeech();
    const st = p.stats;
    const secs = Math.round((performance.now() - st.start) / 1000);
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    document.getElementById('endStats').innerHTML =
      `<div><b>${st.kills}</b>ENEMIES DOWN</div><div><b>${acc}%</b>ACCURACY</div><div><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b>TIME</div>`;
    document.getElementById('endScreen').classList.remove('hidden');
  }
}

Object.assign(Story.prototype, ChapterTwo, ChapterThree);
