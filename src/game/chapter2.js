import * as THREE from 'three';
import { Raid } from '../world/aircraft.js';
import { rand, clamp, easeInOut } from '../core/utils.js';

// ============================================================================
// Chapter II — Kharsk Keep
// Captured after Fort Velmar falls, the player wakes tied to a chair in a Kharzan
// stronghold. The Marshal questions them (dialogue choice). Velmoran bombers hit
// the keep, a raiding party bursts in and executes everyone, burns the keep, and
// the General reveals what the raid was really for.
// (Every this.say / this.bark line stays on one line: scripts/generate-voices.mjs
// reads them from this file to record the dialogue.)
// ============================================================================

const COL = { you: '#e8d9a8', ally: '#9fc7a8', enemy: '#e08a7a', marshal: '#e0775f', general: '#d6bf7c', lt: '#a9cdb0' };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const FOLDER = () => {
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.7 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xd9cfb4, roughness: 0.95 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.25), leather);
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.235), paper);
  p.position.x = 0.012;
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.26), new THREE.MeshStandardMaterial({ color: 0x8a1c24, roughness: 0.6 }));
  g.add(b, p, strap);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
};

export const ChapterTwo = {
  // ---------------- helpers ----------------
  kp(lx, lz) { const K = this.g.kfort; return this.ground(K.center.x + lx, K.center.z + lz); },

  headOf(actor, out = new THREE.Vector3()) { actor.h.root.updateMatrixWorld(true); actor.h.head.getWorldPosition(out); return out; },

  // scripted shot: shooter raises the weapon at the victim, then fires one killing round
  async execute(shooter, victim, { delay = 0.6, head = true } = {}) {
    const g = this.g;
    if (!shooter.alive || !victim.alive) return;
    const aim = head ? this.headOf(victim) : victim.aimPoint(new THREE.Vector3());
    shooter.lookAt = aim.clone();
    shooter.aimHold = 1;
    if (!this.skipping) await this.wait(delay);
    if (!victim.alive) return;
    const muzzle = shooter.h.muzzleWorld(new THREE.Vector3());
    const at = head ? this.headOf(victim) : victim.aimPoint(new THREE.Vector3());
    const dir = at.clone().sub(muzzle).normalize();
    g.effects.muzzleFlash(muzzle, dir, false);
    g.effects.trail(muzzle, at, 0.6);
    g.audio.shot('rifle', muzzle);
    shooter.h.a.recoil = 1;
    victim.invulnerable = false;
    victim.h.a.handsUp = 0;
    victim.takeDamage(999, shooter, at, dir, head ? 'head' : 'chest');
  },

  // dust and grit shaken loose from the cell ceiling
  ceilingDust(k = 1) {
    const g = this.g, K = g.kfort, c = K.center, y = K.y0 + 3.3;
    for (let i = 0; i < 18 * k; i++) {
      const x = c.x + rand(-17.2, -10.8), z = c.z + rand(9.3, 14.7);
      g.effects.smoke.emit(x, y, z, rand(-0.15, 0.15), rand(-0.6, -0.2), rand(-0.15, 0.15), rand(1.8, 3.2), rand(0.05, 0.12), rand(0.35, 0.8), 0.55, 0.51, 0.46, 0.45, 1.2, 0.5);
    }
    for (let i = 0; i < 10 * k; i++) {
      const x = c.x + rand(-17, -11), z = c.z + rand(9.5, 14.5);
      g.effects.smoke.emit(x, y, z, rand(-0.3, 0.3), 0, rand(-0.3, 0.3), rand(0.6, 1.0), 0.025, 0.02, 0.3, 0.27, 0.24, 1, 0.3, 9.8);
    }
  },

  bombImpact(at) {
    const g = this.g, K = g.kfort, A = g.audio;
    g.effects.explosion(at, 1.35);
    A.explosion(at);
    K.addCrater(at, rand(2.6, 3.6));
    const cell = this.kp(-14, 12);
    const dCell = at.distanceTo(cell);
    const k = clamp(1 - dCell / 45, 0, 1);
    K.shake(k * 1.2);
    if (k > 0.25) this.ceilingDust(k);
    const dCam = at.distanceTo(g.camera.position);
    g.rig.addTrauma(Math.max(k * 0.7, clamp(1 - dCam / 60, 0, 1)));
    for (const a of g.actors) {
      if (!a.alive || a.isPlayer || a.invulnerable) continue;
      const d = a.position.distanceTo(at);
      if (d < 6.5) a.takeDamage(999, null, a.aimPoint(new THREE.Vector3()), a.position.clone().sub(at).normalize());
      else if (d < 12 && a.knockback) a.knockback(a.position.clone().sub(at).setY(0).normalize(), 5);
    }
    // the first hits start fires
    this._impacts = (this._impacts || 0) + 1;
    if (this._impacts % 2 === 1) K.ignite(g.effects, 1);
  },

  // Fort Velmar's cast is gone: clear the world for the keep
  clearChapterOne() {
    const g = this.g;
    for (const s of [...g.soldiers]) g.removeSoldier(s);
    this.allies = []; this.attackers = []; this.ambushers = []; this.scouts = []; this.garrison = []; this.sentries = []; this.fireSitters = [];
    this.interactables = [];
    this.phaseUpdate = null;
    if (this.lmgProp) g.scene.remove(this.lmgProp);
    g.hud.setMarker(null);
    g.hud.setEnemyCount(null);
    g.hud.setObjective(null);
  },

  setupKeep() {
    const g = this.g, p = g.player, K = g.kfort, S = K.spots, A = g.audio;
    this.clearChapterOne();
    K.activate();
    K.setLamp(true);
    A.birdsOn = false;
    g.timeScale = 1;
    // the prisoner
    p.revive(S.chair.clone(), S.chairYaw);
    p.h.root.visible = true;
    for (const k of Object.keys(p.weapons)) p.weapons[k].has = false;
    p.equip('none', true);
    g.hud.updateWeapon(p);
    Object.assign(p.h.a, { sit: 1, bound: 1, slump: 1, getup: -1, dead: false, crouch: 0 });
    p.crouchToggle = false;
    // the Marshal and his guard
    this.marshal = this.spawnEnemy(S.marshal.clone(), { coat: true, role: 'idle', weapon: 'none', name: 'Marshal Dravek', holdFire: true });
    this.marshal.yaw = -Math.PI / 2; this.marshal.invulnerable = true;
    this.guard = this.spawnEnemy(S.guard.clone(), { role: 'idle', weapon: 'rifle', name: 'Kharzan Guard', holdFire: true });
    this.guard.yaw = -Math.PI * 0.75; this.guard.invulnerable = true;
    const pHead = this.headOf(p);
    this.marshal.lookAt = pHead.clone();
    this.guard.lookAt = pHead.clone();
    // the garrison going about its morning
    this.keepGarrison = S.kharzanIdle.map((pos, i) => {
      const s = this.spawnEnemy(pos.clone(), { role: 'idle', holdFire: true, coat: i % 3 === 0, name: 'Kharzan Soldier' });
      s.yaw = rand(0, 6.28);
      if (i % 2 === 0) s.goTo(this.kp(rand(-15, 15), rand(-20, 0)), 1.3);
      return s;
    });
  },

  // ===== Chapter II =====
  async chapterTwo() {
    const g = this.g, p = g.player, K = g.kfort, S = K.spots, A = g.audio, u = g.post.u;
    this.phase = 'keep';
    this.setupKeep();
    u.uFade.value = 1; u.uEyelid.value = 1; u.uBlur.value = 0.8; u.uDesat.value = 0.3; u.uRedTint.value = 0;
    A.muffle = 0.5;
    A.setMood('silent');
    const M = this.marshal, G = this.guard;

    // ---------- 1. Wake up in the cell ----------
    await this.cutscene(async () => {
      g.hud.titleCard('CHAPTER II', 'Kharsk Keep', 4.2);
      await this.wait(4.4);
      const head = this.headOf(p);
      const pov = head.clone().add(V(0.05, 0.06, 0));
      const knees = p.position.clone().add(V(0.55, 0.45, 0));
      p.h.root.visible = false;
      this.shot((t, o) => { o.pos.copy(pov); o.look.copy(knees).add(V(0, Math.sin(t * 5) * 0.03, Math.cos(t * 3) * 0.05)); o.fov = 60; }, 6);
      for (let i = 0; i < 3; i++) A.heartbeat(i * 1.15, 0.45);
      this.tween(u.uFade, 'value', 0, 2.5);
      this.tween(u.uEyelid, 'value', 0.55, 2.2);
      await this.wait(2.0);
      await this.say('Marshal Dravek', "Ah… you're awake. Good. I was beginning to think my men had been too enthusiastic.", 5.2, { color: COL.marshal, voice: 'marshal', delivery: 'dry', actor: M });
      this.tween(u.uEyelid, 'value', 1, 0.2);
      await this.wait(0.3);
      // lift the head: the Marshal across the table
      this.tween(u.uEyelid, 'value', 0.12, 1.4);
      this.tween(u.uBlur, 'value', 0.25, 2);
      this.tween(A, 'muffle', 0.12, 3);
      this.tween(p.h.a, 'slump', 0.25, 1.6);
      const mh = this.headOf(M);
      this.shot((t, o) => { const k = easeInOut(Math.min(1, t * 1.6)); o.pos.copy(pov).add(V(0, k * 0.07, 0)); o.look.copy(knees).lerp(mh, k); o.fov = 58 - k * 6; }, 4);
      await this.wait(2.6);
      // wide: the cell
      p.h.root.visible = true;
      this.tween(u.uEyelid, 'value', 0, 0.8);
      this.tween(u.uBlur, 'value', 0.04, 2);
      this.tween(u.uDesat, 'value', 0.12, 3);
      A.setMood('tension');
      const corner = this.kp(-10.95, 9.45).add(V(0, 2.55, 0));
      this.shot((t, o) => { o.pos.copy(corner).add(V(-t * 0.25, -t * 0.1, t * 0.15)); o.look.copy(S.chair).add(V(0.6, 0.9, 0.3)); o.fov = 62; }, 5);
      g.hud.titleCard('KHARSK KEEP', 'Kharzan Dominion · Northern March', 4.5);
      // the Marshal comes around the table
      M.goTo([this.kp(-12.35, 13.45), this.kp(-14.0, 13.45), S.marshalNear.clone()], 1.0);
      await this.wait(2.2);
      await this.say('Marshal Dravek', 'Fort Velmar is ash. Your captain is dead. And you, my friend, are all that is left of it.', 5.6, { color: COL.marshal, voice: 'marshal', delivery: 'menace', actor: M });
      // over the shoulder
      const behind = S.chair.clone().add(V(-0.95, 1.5, -0.45));
      this.shot((t, o) => { o.pos.copy(behind).add(V(t * 0.15, 0, 0)); this.headOf(M, o.look); o.fov = 42; }, 5);
      M.lookAt = this.headOf(p);
      await this.say('Marshal Dravek', 'So I will ask you one question… and I will ask it only once.', 4.4, { color: COL.marshal, voice: 'marshal', delivery: 'menace', actor: M });
      // close on the Marshal
      this.shot((t, o) => { o.look.copy(this.faceCam(M, o.pos, 1.05 - t * 0.15, 0.25, -0.04)); o.fov = 34; }, 5);
      M.h.a.talk = 1;
      await this.say('Marshal Dravek', 'Where are Velmoran Headquarters? Tell me… or die.', 4.0, { color: COL.marshal, voice: 'marshal', delivery: 'menace', actor: M });
      p.h.a.slump = 0.15;
    });
    // make sure the scene is set even if skipped
    p.h.root.visible = true; p.h.a.slump = 0.15;
    u.uFade.value = 0; u.uEyelid.value = 0; u.uBlur.value = 0.04; A.muffle = 0;
    M.position.copy(S.marshalNear); M.route = []; M.lookAt = this.headOf(p);

    // ---------- 2. The question ----------
    let choice = 3;
    await this.cutscene(async () => {
      const mh = this.headOf(M);
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.15, -0.3, 0.02)); o.look.lerp(mh, 0.15); o.fov = 38; }, 30);
      g.hud.letterbox(true);
      choice = await g.hud.choose('Where are Velmoran Headquarters? Tell me… or die.', [
        "I don't know. I can't even remember my own name.",
        'Corran Mill. East, past the river crossing.',
        'Go to hell.',
        '[Say nothing]',
      ], { timeout: 14, fallback: 3 });
      this.choice = ['unknown', 'lie', 'defiant', 'silent'][choice];
      if (choice === 0) await this.say('You', "I don't know. I can't even remember my own name.", 3.6, { color: COL.you, voice: 'you', delivery: 'shaken', actor: p });
      else if (choice === 1) await this.say('You', 'Corran Mill. East, past the river crossing.', 3.4, { color: COL.you, voice: 'you', delivery: 'uneasy', actor: p });
      else if (choice === 2) await this.say('You', 'Go to hell.', 2.2, { color: COL.you, voice: 'you', delivery: 'dry', actor: p });
      else { await this.wait(1.2); }
      this.shot((t, o) => { o.look.copy(this.faceCam(M, o.pos, 1.1, -0.3, -0.02)); o.fov = 36; }, 6);
      if (choice === 0) await this.say('Marshal Dravek', 'No memory? How convenient. Men remember quickly… when the alternative is a bullet.', 5.2, { color: COL.marshal, voice: 'marshal', delivery: 'menace', actor: M });
      else if (choice === 1) await this.say('Marshal Dravek', 'Corran Mill burned a month ago, boy. By my order. Lie to someone who was not there.', 5.4, { color: COL.marshal, voice: 'marshal', delivery: 'menace', actor: M });
      else if (choice === 2) await this.say('Marshal Dravek', 'Hell? Look around you. You are already there.', 3.8, { color: COL.marshal, voice: 'marshal', delivery: 'dry', actor: M });
      else await this.say('Marshal Dravek', 'Silence. The bravest answer… and the most foolish.', 4.2, { color: COL.marshal, voice: 'marshal', delivery: 'dry', actor: M });
      // the order
      M.lookAt = this.headOf(G);
      this.shot((t, o) => { o.pos.copy(this.kp(-16.6, 10.0)).add(V(0, 1.7, 0)); o.look.copy(this.headOf(G)).lerp(this.headOf(M), 0.45); o.fov = 46; }, 5);
      await this.say('Marshal Dravek', 'Enough. Sergeant — take him outside. Make it quick.', 3.6, { color: COL.marshal, voice: 'marshal', delivery: 'command', actor: M });
      G.lookAt = this.headOf(p); G.aimHold = 1;
      G.goTo(this.kp(-12.6, 13.6), 1.0);
      await this.wait(1.2);
      // sirens
      A.siren(22, 0.08);
      A.setMood('combat');
      this.startRaid();
      await this.wait(1.4);
      G.aimHold = 0.3;
      G.lookAt = this.kp(-17.6, 12).add(V(0, 2.4, 0));
      this.shot((t, o) => { o.look.copy(this.faceCam(G, o.pos, 1.5, 0.4, 0.05)); o.fov = 40; }, 3.4);
      await this.say('Kharzan Guard', 'Marshal! Listen — aircraft, from the south!', 2.8, { color: COL.enemy, voice: 'kharzan', delivery: 'panic', actor: G });
      M.lookAt = this.kp(-17.6, 12).add(V(0, 2.4, 0));
      this.shot((t, o) => { o.look.copy(this.faceCam(M, o.pos, 1.3, 0.35, 0.05)); o.fov = 38; }, 3.6);
      await this.say('Marshal Dravek', "Velmoran bombers? This far north? That's impossible—", 3.2, { color: COL.marshal, voice: 'marshal', delivery: 'urgent', actor: M });

      // ---------- 3. The bombing ----------
      // outside: the garrison scatters as the formation comes in
      for (const s of this.keepGarrison) if (s.alive) { s.goTo(this.kp(rand(-20, 20), rand(-20, 20)), rand(3.5, 5)); }
      const yard = this.kp(5, -8).add(V(0, 1.4, 0));
      this.shot((t, o) => {
        o.pos.copy(yard).add(V(-t * 1.2, 0, 0));
        const lead = g.raid && g.raid.planes[0] ? g.raid.planes[0].m.position : this.kp(0, -200).add(V(0, 70, 0));
        o.look.copy(lead); o.fov = 58 - t * 10;
      }, 4.6);
      await this.wait(4.4);
      const wide = this.kp(-46, -62).add(V(0, 26, 0));
      this.shot((t, o) => { o.pos.copy(wide).add(V(t * 6, -t * 3, t * 4)); o.look.copy(K.center).add(V(0, 4, 8)); o.fov = 52; }, 6);
      await this.until(() => !g.raid || g.raid.bombs.length > 0 || this.skipping);
      await this.wait(4.2);
      // inside: the walls shake
      p.h.root.visible = true;
      M.h.a.hurt = 1; M.h.a.kneel = 0.4;
      this.shot((t, o) => { o.pos.copy(this.kp(-11.1, 14.6)).add(V(0, 2.3, 0)); o.look.copy(S.chair).add(V(1.0, 0.9, 0)); o.fov = 60; }, 5);
      await this.wait(2.6);
      // the close hit
      const close = this.kp(-8.6, 16.6);
      this.bombImpact(close);
      g.effects.flashLight(this.kp(-12, 12).add(V(0, 2, 0)), 220, 0.25, 0xffb070, 18);
      g.rig.addTrauma(1);
      this.ceilingDust(2);
      M.h.a.kneel = 1; M.h.a.slump = 0.6; M.h.a.hurt = 1;
      G.aimHold = 0; G.h.a.kneel = 1; G.h.a.slump = 0.8; G.h.a.hurt = 1;
      A.tinnitus(7, 0.05);
      this.tween(A, 'muffle', 0.92, 0.3);
      this.tween(u.uEyelid, 'value', 1, 0.5);
      this.tween(u.uBlur, 'value', 0.7, 0.6);
      await this.wait(1.2);
    }, { canSkip: true });
    this.forceBombingDone();

    // ---------- 4. The rescue ----------
    await this.cutscene(async () => {
      A.fireLoop(0.55);
      A.setMood('tension');
      // wake again: smoke, ringing, distant gunfire
      const head = this.headOf(p);
      const pov = head.clone().add(V(0.05, 0.05, 0));
      p.h.root.visible = false;
      this.shot((t, o) => { o.pos.copy(pov); o.look.copy(this.kp(-11, 12)).add(V(0, 1.1 + Math.sin(t * 4) * 0.05, 0)); o.fov = 60; }, 8);
      await this.wait(1.0);
      this.tween(u.uEyelid, 'value', 0.4, 1.5);
      this.tween(A, 'muffle', 0.4, 3);
      for (let i = 0; i < 6; i++) setTimeout(() => A.shot('rifle', this.kp(rand(-20, 20), rand(-30, 0))), 600 + i * rand(500, 900));
      await this.wait(2.0);
      this.tween(u.uEyelid, 'value', 0.05, 1.2);
      this.tween(u.uBlur, 'value', 0.15, 2);
      // boots, then the door
      for (let i = 0; i < 6; i++) setTimeout(() => A.footstep('dirt', S.doorOut, 1.2), i * 280);
      await this.wait(1.7);
      K.openCellDoor(true);
      A.slam(S.doorOut);
      A.impact('wood', S.doorOut);
      g.rig.addTrauma(0.35);
      this.tween(A, 'muffle', 0, 1.5);
      const lt = this.raidLt = this.spawnAlly(S.doorOut.clone(), { name: 'Lieutenant Kess', helmet: 'deep', role: 'idle', yaw: -Math.PI / 2 });
      const r1 = this.spawnAlly(this.kp(-8.2, 11.2), { name: 'Velmoran Raider', helmet: 'brodie', role: 'idle', yaw: -Math.PI / 2 });
      for (const s of [lt, r1]) { s.holdFire = true; s.invulnerable = true; }
      lt.goTo([S.doorIn.clone(), this.kp(-12.2, 11.4)], 3.2);
      r1.goTo([S.doorIn.clone(), this.kp(-11.5, 12.9)], 3.0);
      lt.aimHold = 1; r1.aimHold = 1;
      lt.lookAt = this.headOf(G); r1.lookAt = this.headOf(M);
      // third person: the raiders storm in
      p.h.root.visible = true;
      this.tween(u.uEyelid, 'value', 0, 0.4);
      this.shot((t, o) => { o.pos.copy(this.kp(-16.9, 9.5)).add(V(0, 1.9, 0)); o.look.copy(S.doorIn).add(V(0, 1.3, 0)); o.fov = 52; }, 4);
      await this.wait(1.4);
      // the guard is shot where he kneels
      G.h.a.slump = 0.2;
      await this.execute(lt, G, { delay: 0.25, head: false });
      await this.wait(0.8);
      // the Marshal raises his hands
      M.h.a.slump = 0; M.h.a.handsUp = 1; M.lookAt = this.headOf(lt);
      this.shot((t, o) => { o.look.copy(this.faceCam(M, o.pos, 1.6, -0.45, 0.1)); o.fov = 40; }, 4.2);
      await this.say('Marshal Dravek', 'Wait— wait! I surrender! I can give you names, positions—', 3.4, { color: COL.marshal, voice: 'marshal', delivery: 'panic', actor: M });
      lt.lookAt = this.headOf(M);
      this.shot((t, o) => { o.pos.copy(this.kp(-11.0, 10.2)).add(V(0, 1.45, 0)); o.look.copy(this.headOf(M)); o.fov = 44; }, 3);
      await this.execute(lt, M, { delay: 0.7 });
      M.invulnerable = false;
      await this.wait(0.9);
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.25, 0.35, 0.02)); o.fov = 36; }, 3.4);
      await this.say('You', 'He was surrendering!', 2.2, { color: COL.you, voice: 'you', delivery: 'shout', actor: p });
      // the lieutenant cuts the prisoner loose
      lt.aimHold = 0; r1.aimHold = 0;
      lt.lookAt = this.headOf(p);
      lt.goTo([this.kp(-12.3, 10.4), this.kp(-14.25, 10.4), this.kp(-14.25, 11.3)], 1.8);
      this.shot((t, o) => { o.look.copy(this.faceCam(lt, o.pos, 1.4, 0.5, 0.05)); o.fov = 38; }, 6);
      await this.wait(0.9);
      await this.say('Lieutenant Kess', 'Orders. No prisoners.', 2.4, { color: COL.lt, voice: 'lieutenant', delivery: 'dry', actor: lt });
      A.pickup();
      p.h.a.bound = 0;
      await this.say('Lieutenant Kess', 'On your feet, Seventh. The General wants a word with you.', 3.8, { color: COL.lt, voice: 'lieutenant', delivery: 'command', actor: lt });
      // stand
      this.shot((t, o) => { o.pos.copy(this.kp(-12.2, 13.8)).add(V(0, 1.6, 0)); o.look.copy(S.chair).add(V(0, 1.1 + t * 0.4, 0)); o.fov = 50; }, 2.6);
      this.tween(p.h.a, 'sit', 0, 1.3);
      this.tween(p.h.a, 'slump', 0, 1.0);
      await this.wait(1.8);
    });
    this.forceRescueDone();
    this.endCutscene({ yaw: Math.PI / 2 });

    // ---------- 5. Through the burning keep ----------
    await this.walkOut();
    // ---------- 6. The General ----------
    await this.generalReveal();
    this.showEnd();
  },

  startRaid() {
    const g = this.g, K = g.kfort, S = K.spots;
    if (g.raid) return;
    const from = K.center.clone().add(V(-30, 0, -470));
    const to = K.center.clone().add(V(10, 0, 700));
    g.raid = new Raid(g, { from, to, alt: 72, speed: 54, count: 5, targets: S.bombs, onImpact: (at) => this.bombImpact(at) });
    g.audio.drone(22, 0.24, 0.45);
  },

  // skipped or not, the keep is bombed and burning when the rescue starts
  forceBombingDone() {
    const g = this.g, K = g.kfort, M = this.marshal, G = this.guard, u = g.post.u;
    if (!g.raid && !this._impacts) this.startRaid();
    if (g.raid) {
      // anything still falling lands quietly (the player is out cold)
      for (const T of g.raid.targets) if (!T.dropped) { T.dropped = true; K.addCrater(T.p, 3); }
      g.raid.dispose(); g.raid = null;
      g.audio.setMood('tension');
    }
    K.ignite(g.effects, 5);
    for (const s of this.keepGarrison) if (s.alive) s.die(null, null);
    M.position.copy(K.spots.marshalNear); M.route = [];
    Object.assign(M.h.a, { kneel: 1, slump: 0.6 });
    Object.assign(G.h.a, { kneel: 1, slump: 0.8 });
    G.aimHold = 0;
    u.uEyelid.value = 1; u.uBlur.value = 0.7;
  },

  forceRescueDone() {
    const g = this.g, p = g.player, K = g.kfort, u = g.post.u;
    K.openCellDoor(false);
    if (this.guard.alive) { this.guard.invulnerable = false; this.guard.die(null, null); }
    if (this.marshal.alive) { this.marshal.invulnerable = false; this.marshal.h.a.handsUp = 0; this.marshal.die(null, null); }
    if (!this.raidLt) {
      this.raidLt = this.spawnAlly(this.kp(-14.25, 11.3), { name: 'Lieutenant Kess', helmet: 'deep', role: 'idle' });
      this.raidLt.invulnerable = true;
    }
    Object.assign(p.h.a, { sit: 0, bound: 0, slump: 0 });
    p.h.root.visible = true;
    u.uEyelid.value = 0; u.uBlur.value = 0.04; u.uDesat.value = 0.12;
    g.audio.muffle = 0;
    g.audio.fireLoop(0.55);
  },

  // ===== free roam: find the General through the burning keep =====
  async walkOut() {
    const g = this.g, p = g.player, K = g.kfort, S = K.spots, A = g.audio;
    this.phase = 'keepWalk';
    A.setMood('sad');
    g.hud.setObjective('Find the General');
    g.hud.setMarker(S.general.clone().add(V(0, 2.1, 0)));
    // the lieutenant leads out
    const lt = this.raidLt;
    lt.aimHold = 0;
    lt.goTo([this.kp(-14.25, 10.4), this.kp(-12.0, 10.4), S.doorIn.clone(), S.doorOut.clone(), this.kp(-4, 2), S.gateInside.clone(), S.aide.clone().add(V(-2.5, 0, 1.5))], 2.4);
    // raiders in the courtyard: torching, guarding the last survivors
    const raiders = [
      [this.kp(9, -16), this.kp(10.5, -11)], [this.kp(7.5, 8), this.kp(10, 13)], [this.kp(-10, -6), this.kp(-14.5, -11)],
      [this.kp(-1, -14), this.kp(-6, -18)], [this.kp(16, 0), this.kp(18, 6)],
    ].map(([pos, look], i) => {
      const s = this.spawnAlly(pos, { name: 'Velmoran Raider', helmet: i % 2 ? 'brodie' : undefined, role: 'idle' });
      s.holdFire = true; s.invulnerable = true; s.lookAt = look.clone().add(V(0, 1.5, 0));
      return s;
    });
    // survivors on their knees, hands up
    const kneelers = S.kneel.slice(0, 4).map((pos, i) => {
      const k = this.spawnEnemy(pos.clone(), { role: 'idle', weapon: 'none', holdFire: true, name: 'Kharzan Prisoner', coat: i === 1 });
      Object.assign(k.h.a, { kneel: 1, handsUp: 1 });
      k.invulnerable = true;
      return k;
    });
    const groupA = kneelers.slice(0, 2), groupB = kneelers.slice(2);
    const guardA = this.spawnAlly(this.kp(-3.6, 1.0), { name: 'Velmoran Raider', helmet: 'brodie', role: 'idle' });
    const guardB = this.spawnAlly(this.kp(4.8, -7.6), { name: 'Velmoran Raider', role: 'idle' });
    for (const [gd, grp] of [[guardA, groupA], [guardB, groupB]]) {
      gd.holdFire = true; gd.invulnerable = true; gd.aimHold = 1;
      const c = grp[0].position.clone().lerp(grp[1].position, 0.5);
      gd.lookAt = c.clone().add(V(0, 1.0, 0));
      for (const k of grp) { k.faceYaw = Math.atan2(gd.position.x - k.position.x, gd.position.z - k.position.z); k.lookAt = this.headOf(gd); }
    }
    let lit = 5, fireT = 2.5, barkT = 3, doneA = false, doneB = false;
    const t0 = g.time;
    const barks = [
      () => this.bark('Velmoran Raider', 'Burn it! Burn all of it!', COL.ally, 2.6, 'soldier', 'shout'),
      () => this.bark('Lieutenant Kess', 'Torch the barracks — nothing left standing!', COL.lt, 3, 'lieutenant', 'command'),
    ];
    let bi = 0;
    const runExec = async (gd, grp) => {
      this.bark('Kharzan Prisoner', 'Please — please, I have a family—', COL.enemy, 2.6, 'scout', 'panic');
      await new Promise((r) => setTimeout(r, 1800));
      for (const k of grp) { await this.execute(gd, k, { delay: 0.5 }); await new Promise((r) => setTimeout(r, 650)); }
      gd.aimHold = 0;
      await new Promise((r) => setTimeout(r, 1500));
      if (!this._toldExec) { this._toldExec = true; this.bark('You', "They're executing them…", COL.you, 2.6, 'you', 'shaken'); }
    };
    this.phaseUpdate = (dt) => {
      const el = g.time - t0;
      fireT -= dt;
      if (fireT <= 0 && lit < S.fires.length) { fireT = rand(2.5, 4.5); K.ignite(g.effects, 1); lit++; }
      barkT -= dt;
      if (barkT <= 0 && bi < barks.length) { barkT = rand(7, 10); barks[bi++](); }
      const pa = groupA[0].position, pb = groupB[0].position;
      if (!doneA && (p.position.distanceTo(pa) < 15 || el > 40)) { doneA = true; runExec(guardA, groupA); }
      if (!doneB && (p.position.distanceTo(pb) < 13 || el > 55) && doneA) { doneB = true; setTimeout(() => runExec(guardB, groupB), 2600); }
    };
    // the General waits outside the gate with the plans
    this.general = this.spawnAlly(S.general.clone(), { uniform: 'velmoraOfficer', weapon: 'none', name: 'General Morrow', yaw: 0, skin: 0xd2a07f });
    this.aide = this.spawnAlly(S.aide.clone(), { name: 'Aide', helmet: 'brodie', role: 'idle', yaw: -0.3 });
    for (const s of [this.general, this.aide]) { s.holdFire = true; s.invulnerable = true; }
    this.general.lookAt = K.center.clone().add(V(0, 6, 0));
    this.aide.lookAt = K.center.clone().add(V(0, 4, 0));
    this.folder = FOLDER();
    this.folder.position.set(0.02, -0.12, 0.05);
    this.folder.rotation.set(0.2, 0, 0.1);
    this.general.h.handR.add(this.folder);
    await this.until(() => p.position.distanceTo(this.general.position) < 5.5);
    this.phaseUpdate = null;
    // finish any pending executions
    for (const k of kneelers) if (k.alive) { k.invulnerable = false; k.h.a.handsUp = 0; k.die(null, null); }
    while (lit < S.fires.length) { K.ignite(g.effects, 1); lit++; }
    g.hud.setMarker(null);
  },

  // ===== the reveal =====
  async generalReveal() {
    const g = this.g, p = g.player, K = g.kfort, A = g.audio, u = g.post.u;
    const Gn = this.general;
    this.phase = 'general';
    await this.cutscene(async () => {
      A.setMood('sad');
      A.fireLoop(0.35);
      // stage the two of them facing each other, the burning keep behind the player
      const gp = Gn.position.clone();
      const toKeep = K.center.clone().sub(gp).setY(0).normalize();
      p.position.copy(this.ground(gp.x + toKeep.x * 2.2, gp.z + toKeep.z * 2.2));
      p.vel.set(0, 0, 0);
      p.yaw = Math.atan2(gp.x - p.position.x, gp.z - p.position.z); p.h.root.rotation.y = p.yaw;
      p.h.a.speed = 0;
      Gn.lookAt = this.headOf(p); Gn.faceYaw = Math.atan2(p.position.x - gp.x, p.position.z - gp.z);
      const side = V(-toKeep.z, 0, toKeep.x);
      const mid = gp.clone().lerp(p.position, 0.5);
      // 1. two-shot from the side, flames beyond
      this.shot((t, o) => { o.pos.copy(mid).addScaledVector(side, 4.2 - t * 0.5).add(V(0, 1.6, 0)).addScaledVector(toKeep, -0.6); o.look.copy(mid).add(V(0, 1.45, 0)); o.fov = 44; }, 6);
      await this.wait(0.8);
      await this.say('General Morrow', "So. You're the one from Fort Velmar. The only one, from what I hear.", 4.6, { color: COL.general, voice: 'general', delivery: 'dry', actor: Gn });
      // 2. the player
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.3, 0.35, 0.02)); o.fov = 36; }, 4.6);
      await this.say('You', 'You came for me… all of this… for me?', 3.6, { color: COL.you, voice: 'you', delivery: 'shaken', actor: p });
      // 3. the General raises the folder
      Gn.h.a.offer = 0;
      this.tween(Gn.h.a, 'offer', 0.85, 1.0);
      this.shot((t, o) => { o.look.copy(this.faceCam(Gn, o.pos, 1.5 - t * 0.2, -0.4, -0.12)); o.look.y -= 0.25; o.fov = 38; }, 5.4);
      await this.wait(0.5);
      await this.say('General Morrow', 'For you? Son… we came for these.', 3.2, { color: COL.general, voice: 'general', delivery: 'dry', actor: Gn });
      // close on the folder
      const fw = new THREE.Vector3();
      this.shot((t, o) => { this.folder.getWorldPosition(fw); o.pos.copy(fw).addScaledVector(side, -0.9).add(V(0, 0.25, 0)).addScaledVector(toKeep, 0.35); o.look.copy(fw); o.fov = 32; }, 5.4);
      await this.say('General Morrow', 'Kharzan war plans. Every division, every depot, their whole spring offensive… from here to the coast.', 5.4, { color: COL.general, voice: 'general', delivery: 'grave', actor: Gn });
      this.tween(Gn.h.a, 'offer', 0, 1.0);
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.2, -0.3, 0.02)); o.fov = 34; }, 4);
      await this.say('You', 'And the men in there? They surrendered.', 3.0, { color: COL.you, voice: 'you', delivery: 'urgent', actor: p });
      this.shot((t, o) => { o.look.copy(this.faceCam(Gn, o.pos, 1.15, 0.3, 0.0)); o.fov = 34; }, 4);
      await this.say('General Morrow', "Prisoners talk. Ashes don't.", 2.8, { color: COL.general, voice: 'general', delivery: 'menace', actor: Gn });
      // over the General's shoulder: the player, and the keep burning behind
      this.shot((t, o) => { o.pos.copy(gp).addScaledVector(toKeep, -0.7).addScaledVector(side, 0.55).add(V(0, 1.75, 0)); o.look.copy(this.headOf(p)).addScaledVector(toKeep, 6).add(V(0, 1.5, 0)); o.fov = 46; }, 9);
      await this.say('General Morrow', 'You were a convenient excuse, soldier. A rescue gives the men something to believe in.', 5.0, { color: COL.general, voice: 'general', delivery: 'dry', actor: Gn });
      await this.say('General Morrow', 'After all… why risk so many soldiers\' lives for one man?', 4.4, { color: COL.general, voice: 'general', delivery: 'grave', actor: Gn });
      // he walks away
      Gn.faceYaw = null; Gn.lookAt = null;
      Gn.goTo(this.ground(gp.x - toKeep.x * 30, gp.z - toKeep.z * 30), 1.5);
      this.aide.goTo(this.ground(gp.x - toKeep.x * 30 + side.x * 1.5, gp.z - toKeep.z * 30 + side.z * 1.5), 1.6);
      // the player turns to the fire
      p.yaw = Math.atan2(toKeep.x, toKeep.z); p.h.root.rotation.y = p.yaw;
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.4, 0.2, 0.0)); o.fov = 38; }, 4.5);
      await this.wait(0.8);
      await this.say('You', "(…Whose war am I fighting?)", 3.6, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
      // final crane: up and back over the burning keep
      const start = p.position.clone();
      this.shot((t, o) => {
        const k = easeInOut(t);
        o.pos.copy(start).addScaledVector(toKeep, -3 - k * 10).add(V(0, 1.7 + k * 22, 0)).addScaledVector(side, 1.2);
        o.look.copy(start).add(V(0, 1.5, 0)).lerp(K.center.clone().add(V(0, 6, 0)), Math.min(1, k * 1.4));
        o.fov = 48;
      }, 11);
      await this.wait(7.5);
      this.tween(u.uFade, 'value', 1, 3.2);
      this.tween(A, 'muffle', 0.6, 3);
      await this.wait(3.4);
    }, { canSkip: true });
    u.uFade.value = 1;
  },
};
