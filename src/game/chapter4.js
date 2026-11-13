import * as THREE from 'three';
import { HQ } from '../world/terrain.js';
import { DEF } from '../world/defenses.js';
import { skyDir } from '../world/nightsky.js';
import { rand, clamp, easeInOut } from '../core/utils.js';
import { buildAxe } from '../chars/weapons.js';

// ============================================================================
// Chapter IV — Iron and Ash (follows the "warn Hollin Ridge" ending)
// Two days of digging pay off: Iron Tide breaks on the moat, the wire and the mines.
// The player is given a double-bladed axe and sent back to the Seventh at Kharsk. On
// the road a Kharzan veteran whose brothers died at Kharsk forces a duel with steel
// alone; he yields, then goes for a hidden dagger. The player stops holding back.
// The walk home is spent arguing with every life taken since the clearing.
// (Keep every this.say / this.bark on one line: the voice script reads them.)
// ============================================================================

const COL = { you: '#e8d9a8', ally: '#9fc7a8', enemy: '#e08a7a', general: '#d6bf7c', colonel: '#cfd6a0', varek: '#e0775f' };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DUEL_S = 292; // where Varek waits on the road

function buildDagger() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc5c9ce, roughness: 0.2, metalness: 1 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.7 });
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.24, 4).rotateX(Math.PI / 2), steel);
  blade.scale.set(1, 0.35, 1); blade.position.z = 0.15;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.1, 8).rotateX(Math.PI / 2), grip);
  handle.position.z = -0.02;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.012), steel);
  guard.position.z = 0.03;
  g.add(blade, handle, guard);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { gripR: new THREE.Vector3(0, 0, -0.02), tip: new THREE.Vector3(0, 0, 0.27), type: 'sword' };
  return g;
}

export const ChapterFour = {
  // ---------- setup: dawn at Hollin Ridge ----------
  setupHollin() {
    const g = this.g, p = g.player, H = g.hq, A = g.audio, u = g.post.u;
    this.clearChapterOne();
    g.setDay();
    g.effects.emitters.length = 0;
    for (const L of [this.campLight, this.cpLamp]) if (L) L.intensity = 0;
    this.campLight = null; this.cpLamp = null;
    g.kfort.glow(false);
    g.effects.addFire(H.campfire, 1);
    A.fireLoop(0);
    g.defenses.show();
    g.scene.fog.density = 0.0026; // a clear morning: you can see them coming
    H.openGate();
    u.uBlur.value = 0; u.uDesat.value = 0; u.uRedTint.value = 0; u.uEyelid.value = 0;
    A.muffle = 0;
    const D = g.defenses;
    this.trenchSpot = V(DEF.trenchX + 1.4, 0, HQ.z + 2); this.trenchSpot.y = g.terrain.getHeight(this.trenchSpot.x, this.trenchSpot.z);
    p.revive(this.trenchSpot.clone(), -Math.PI / 2);
    p.h.root.visible = true;
    Object.assign(p.h.a, { sit: 0, bound: 0, slump: 0, kneel: 0, handsUp: 0, offer: 0, getup: -1, dead: false, swordOverride: null });
    for (const k of Object.keys(p.weapons)) p.weapons[k].has = false;
    p.weapons.rifle.has = true; p.weapons.rifle.mag = 5; p.weapons.rifle.reserve = 40;
    p.weapons.lmg.has = true; p.weapons.lmg.mag = 20; p.weapons.lmg.reserve = 180;
    p.weapons.sword.has = true;
    p.equip('lmg', true);
    g.hud.updateWeapon(p);
    // the defenders in the trench
    this.trenchMen = D.spots.filter((s) => Math.abs(s.pos.z - this.trenchSpot.z) > 2.5).map((spot, i) => {
      const s = this.spawnAlly(spot.pos.clone(), { name: 'Velmoran Soldier', helmet: i % 3 === 1 ? 'deep' : 'brodie', role: 'defender', yaw: -Math.PI / 2, weapon: i % 5 === 2 ? 'lmg' : 'rifle' });
      s.coverSpot = spot; s.hp = 260; s.accuracy = 0.32;
      return s;
    });
    this.colonel = this.spawnAlly(V(DEF.trenchX + 3.2, 0, HQ.z - 3).setY(g.terrain.getHeight(DEF.trenchX + 3.2, HQ.z - 3)), { uniform: 'velmoraOfficer', weapon: 'none', name: 'Colonel Ashby', skin: 0xc9967a, yaw: -Math.PI / 2 });
    this.colonel.invulnerable = true; this.colonel.holdFire = true;
    this.colonel.lookAt = V(DEF.mineX0, this.colonel.position.y + 1.5, HQ.z);
    this.attackers4 = [];
  },

  // ===== Chapter IV =====
  async chapterFour() {
    const g = this.g, p = g.player, A = g.audio, u = g.post.u;
    this.phase = 'hollin';
    u.uFade.value = 1;
    this.setupHollin();
    await this.battleIntro();
    await this.battle();
    await this.victory();
    await this.roadBack();
    await this.duel();
    await this.walkHome();
    await this.homecoming();
    this.showEnd({ chapter: 'Chapter IV — Iron and Ash', title: 'THE WEIGHT OF THE AXE', sub: 'He surrendered twice. You only believed him once.' });
  },

  // dev/test entry: straight to the road back, axe in hand
  async chapterFourFromRoad() {
    this.phase = 'hollin';
    this.g.post.u.uFade.value = 1;
    this.setupHollin();
    this.g.player.setMelee('axe');
    await this.roadBack();
    await this.duel();
    await this.walkHome();
    await this.homecoming();
    this.showEnd({ chapter: 'Chapter IV — Iron and Ash', title: 'THE WEIGHT OF THE AXE', sub: 'He surrendered twice. You only believed him once.' });
  },

  // ---------- the works, and the enemy on the road ----------
  async battleIntro() {
    const g = this.g, p = g.player, A = g.audio, u = g.post.u, C = this.colonel;
    await this.cutscene(async () => {
      g.hud.titleCard('CHAPTER IV', 'Iron and Ash', 4.2);
      await this.wait(1.2);
      this.tween(u.uFade, 'value', 0, 3);
      A.setMood('tension');
      // dawn over the works: the minefield, the wire, the moat
      const z = HQ.z;
      this.shot((t, o) => { o.pos.set(DEF.wireX - 8 + t * 10, 0, DEF.z0 - 10 + t * 6); o.pos.y = g.terrain.getHeight(o.pos.x, o.pos.z) + 3.2 - t * 0.8; o.look.set(DEF.moatX0 - 2, 0, z + 18); o.look.y = g.terrain.getHeight(o.look.x, o.look.z) + 0.6; o.fov = 50; }, 9);
      await this.wait(3.6);
      g.hud.titleCard('THE THIRD DAY', 'Hollin Ridge · First Light', 4);
      await this.wait(3.4);
      // the Colonel in the trench
      const mid = C.position.clone().lerp(p.position, 0.5);
      C.lookAt = this.headOf(p);
      this.shot((t, o) => { o.pos.copy(mid).add(V(3.4, 1.6, -2.4 + t * 0.6)); o.look.copy(mid).add(V(0, 1.4, 0)); o.fov = 46; }, 6);
      await this.say('Colonel Ashby', 'Two days. You gave us two days, soldier. We used every hour of them.', 4.4, { color: COL.colonel, voice: 'colonel', delivery: 'grave', actor: C });
      this.shot((t, o) => { o.look.copy(this.faceCam(C, o.pos, 1.4, 0.4, 0.05)); o.fov = 38; }, 6);
      await this.say('Colonel Ashby', 'A moat across the west road. Mines in the fields. Wire on every approach. Let them come.', 5.2, { color: COL.colonel, voice: 'colonel', delivery: 'dry', actor: C });
      // the lookout
      A.whistle();
      const top = g.hq.towerTops[0] || g.hq.gateTop;
      const look = this.ground(DEF.mineX0 - 40, HQ.z);
      this.shot((t, o) => { o.pos.copy(top).add(V(2, 1.0, 3)); o.look.copy(look).add(V(0, 2, 0)); o.fov = 40 - t * 8; }, 4);
      this.spawnWave4(6, true);
      await this.wait(0.6);
      await this.say('Sentry', 'Movement on the west road! Kharzan columns — hundreds of them!', 3.4, { color: COL.ally, voice: 'sentry1', delivery: 'panic' });
      C.lookAt = V(DEF.mineX0, C.position.y + 1.5, HQ.z);
      this.shot((t, o) => { o.look.copy(this.faceCam(C, o.pos, 1.6, -0.5, 0.1)); o.fov = 40; }, 4);
      await this.say('Colonel Ashby', 'To your posts! Hold your fire until they reach the mines!', 3.4, { color: COL.colonel, voice: 'colonel', delivery: 'shout', actor: C });
      A.horn();
    });
    this.endCutscene({ yaw: Math.PI / 2, pitch: 0.02 });
    g.hud.setObjective('Hold the trench at Hollin Ridge');
  },

  spawnWave4(n, first = false) {
    const g = this.g;
    const list = [];
    for (let i = 0; i < n; i++) {
      const z = rand(DEF.z0 + 2, DEF.z1 - 2);
      const pos = this.freeSpot(DEF.mineX0 - rand(26, 44), z);
      const heavy = !first && i === 0;
      const e = this.spawnEnemy(pos, { coat: i % 3 === 0, weapon: heavy ? 'lmg' : 'rifle', accuracy: heavy ? 0.12 : 0.18, damage: heavy ? 8 : 11, allyDamageScale: 0.35, name: 'Kharzan Trooper', yaw: Math.PI / 2 });
      e.engageMax = rand(30, 45);
      e.goTo([V(DEF.mineX0 + rand(4, 20), 0, z), V(DEF.wireX - 1.5, 0, z + rand(-2, 2))], rand(3.3, 4.2));
      e.mineAt = Math.random() < 0.4 ? rand(DEF.mineX0 + 2, DEF.mineX1 - 2) : null;
      list.push(e);
    }
    this.attackers4.push(...list);
    return list;
  },

  mineBlast(at) {
    const g = this.g, A = g.audio;
    g.effects.explosion(at, 0.9);
    A.explosion(at);
    g.rig.addTrauma(clamp(1 - at.distanceTo(g.camera.position) / 70, 0.05, 0.6));
    for (const a of g.actors) {
      if (!a.alive || a.isPlayer || a.faction === 'velmora') continue;
      const d = a.position.distanceTo(at);
      if (d < 4.2) a.takeDamage(999, null, a.aimPoint(new THREE.Vector3()), a.position.clone().sub(at).normalize());
      else if (d < 8 && a.knockback) a.knockback(a.position.clone().sub(at).setY(0).normalize(), 4);
    }
  },

  // ---------- the battle ----------
  async battle() {
    const g = this.g, p = g.player, A = g.audio, D = g.defenses;
    this.phase = 'hollinBattle';
    A.setMood('combat');
    let wave = 1, shellT = 6, firstMine = false, said = {};
    const ammoIts = D.ammo.map((pos) => {
      const it = this.addInteract(pos.clone(), 'Take ammunition', () => {
        p.weapons.lmg.reserve = Math.max(p.weapons.lmg.reserve, 180);
        p.weapons.rifle.reserve = Math.max(p.weapons.rifle.reserve, 40);
        A.pickup(); g.hud.updateWeapon(p); g.hud.notify('Ammunition refilled');
        setTimeout(() => { it.enabled = true; }, 1500);
      }, 2.4);
      return it;
    });
    this.checkpoint = async () => {
      p.revive(this.trenchSpot.clone(), -Math.PI / 2);
      p.weapons.lmg.mag = 20; p.weapons.lmg.reserve = Math.max(p.weapons.lmg.reserve, 180);
      p.weapons.rifle.reserve = Math.max(p.weapons.rifle.reserve, 40);
      p.equip('lmg', true);
      g.rig.yaw = Math.PI / 2;
    };
    let retreat = false;
    this.phaseUpdate = (dt) => {
      const alive = this.attackers4.filter((e) => e.alive);
      g.hud.setEnemyCount(alive.length);
      // mines, wire
      for (const e of alive) {
        if (e.retreating) continue;
        if (e.mineAt != null && e.position.x > e.mineAt) { e.mineAt = null; this.mineBlast(e.position.clone()); if (!firstMine) { firstMine = true; this.bark('Velmoran Soldier', 'Mines! They\'ve walked into the mines!', COL.ally, 2.6, 'soldier', 'shout'); } continue; }
        for (const m of D.mines) {
          if (m.live && m.p.distanceTo(e.position) < 1.0) { m.live = false; this.mineBlast(m.p.clone()); break; }
        }
        if (Math.abs(e.position.x - DEF.wireX) < 1.8) e.moveSpeed = Math.min(e.moveSpeed, 1.1); // tangled in the wire
      }
      // Kharzan mortars: short into the stakes, or long into the fort
      shellT -= dt;
      if (shellT <= 0 && !retreat) {
        shellT = rand(5, 9);
        const front = Math.random() < 0.55;
        const at = this.ground(front ? rand(DEF.wireX + 2, DEF.moatX0 - 1) : rand(HQ.x - 20, HQ.x + 20), front ? rand(DEF.z0, DEF.z1) : rand(HQ.z - 20, HQ.z + 20));
        if (at.distanceTo(p.position) > 9) { A.shellWhistle(1.1); setTimeout(() => this.hqShell(at), 1100); }
      }
      // waves
      if (!retreat && alive.length <= 3) {
        if (wave === 1) { wave = 2; this.spawnWave4(10); if (!said.w2) { said.w2 = true; this.bark('Colonel Ashby', 'Hold the line! Make them pay for every yard!', COL.colonel, 3, 'colonel', 'shout'); } }
        else if (wave === 2) { wave = 3; this.spawnWave4(13); this.bark('Kharzan Officer', 'Vesh! Tarak vesh!', COL.enemy, 2.2, 'kharzanFar', 'shout'); }
        else if (wave === 3) {
          retreat = true;
          for (const e of alive) { e.retreating = true; e.role = 'idle'; e.holdFire = true; e.goTo(this.ground(DEF.mineX0 - 70, e.position.z), 5.2); }
          this.bark('Velmoran Soldier', 'They\'re running! They\'re running!', COL.ally, 2.6, 'soldier', 'shout');
        }
      }
    };
    await this.until(() => retreat && p.alive && !this.respawning);
    await this.wait(5);
    this.phaseUpdate = null;
    this.checkpoint = null;
    for (const it of ammoIts) it.enabled = false;
    g.hud.setEnemyCount(null);
    for (const e of this.attackers4) if (e.alive) g.removeSoldier(e);
  },

  // ---------- after the battle: the axe ----------
  async victory() {
    const g = this.g, p = g.player, A = g.audio, u = g.post.u, C = this.colonel;
    await this.cutscene(async () => {
      A.setMood('hope');
      // smoke over the minefield
      const z = HQ.z;
      this.shot((t, o) => { o.pos.set(DEF.trenchX + 2, 0, z - 22 + t * 4); o.pos.y = g.terrain.getHeight(o.pos.x, o.pos.z) + 3.2 + t; o.look.set(DEF.mineX0 - 10, o.pos.y - 3, z + 6); o.fov = 50; }, 6);
      for (const s of this.trenchMen) if (s.alive) { s.role = 'idle'; s.lookAt = V(DEF.mineX0, s.position.y + 1.5, s.position.z); }
      await this.wait(3.2);
      p.equip('none', true);
      p.position.copy(this.trenchSpot); p.vel.set(0, 0, 0);
      p.yaw = Math.PI / 2; p.h.root.rotation.y = p.yaw;
      C.position.copy(this.ground(this.trenchSpot.x + 2.0, this.trenchSpot.z)); C.route = [];
      C.lookAt = this.headOf(p); C.faceYaw = -Math.PI / 2;
      const mid = C.position.clone().lerp(p.position, 0.5);
      this.shot((t, o) => { o.pos.copy(mid).add(V(0.4, 1.6, 3.6 - t * 0.4)); o.look.copy(mid).add(V(0, 1.45, 0)); o.fov = 44; }, 6);
      await this.say('Colonel Ashby', 'Iron Tide broke on Hollin Ridge. Remember this morning — every one of you.', 4.6, { color: COL.colonel, voice: 'colonel', delivery: 'grave', actor: C });
      this.shot((t, o) => { o.look.copy(this.faceCam(C, o.pos, 1.3, 0.35, 0.02)); o.fov = 36; }, 5);
      await this.say('Colonel Ashby', 'As for you, Seventh: Morrow\'s legion is camped at Kharsk. You\'re to report back to your unit.', 5.0, { color: COL.colonel, voice: 'colonel', delivery: 'dry', actor: C });
      // the armorer and the axe
      const arm = this.armorer = this.spawnAlly(this.ground(this.trenchSpot.x + 1.4, this.trenchSpot.z - 2.2), { uniform: 'velmoraQM', weapon: 'none', name: 'Armorer', skin: 0xb8865e });
      arm.invulnerable = true; arm.holdFire = true;
      arm.lookAt = this.headOf(p); arm.faceYaw = Math.atan2(p.position.x - arm.position.x, p.position.z - arm.position.z);
      const axe = this.giftAxe = buildAxe(g.T);
      axe.position.set(0.02, -0.08, 0.05); axe.rotation.set(0.6, 0, 0);
      arm.h.handR.add(axe);
      this.tween(arm.h.a, 'offer', 0.85, 0.9);
      this.shot((t, o) => { o.look.copy(this.faceCam(arm, o.pos, 1.7 - t * 0.2, -0.5, -0.1)); o.look.y -= 0.2; o.fov = 40; }, 9);
      await this.wait(0.8);
      await this.say('Armorer', 'That sabre\'s notched to the hilt, friend. Take this instead — double-bladed, Hollin steel.', 5.0, { color: COL.ally, voice: 'armorer', delivery: 'warm', actor: arm });
      await this.say('Armorer', 'It won\'t bend. Neither should you.', 2.8, { color: COL.ally, voice: 'armorer', delivery: 'dry', actor: arm });
      arm.h.handR.remove(axe);
      this.tween(arm.h.a, 'offer', 0, 0.6);
      p.setMelee('axe');
      p.equip('sword', true);
      A.pickup();
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.5, 0.45, -0.1)); o.look.y -= 0.25; o.fov = 40; }, 4);
      await this.say('You', '…Thank you.', 1.8, { color: COL.you, voice: 'you', delivery: 'thoughtful', actor: p });
      await this.wait(1.2);
      this.tween(u.uFade, 'value', 1, 2.2);
      await this.wait(2.4);
    });
    p.setMelee('axe');
  },

  // ---------- back along the road ----------
  async roadBack() {
    const g = this.g, p = g.player, u = g.post.u, A = g.audio, T = g.terrain;
    this.phase = 'roadBack';
    for (const s of [...g.soldiers]) g.removeSoldier(s);
    this.allies = [];
    g.defenses.group.visible = true;
    const start = this.roadPoint(T.road2.length - 60);
    p.revive(start, 0);
    p.weapons.lmg.has = false;
    p.weapons.rifle.has = true; p.weapons.rifle.mag = 5; p.weapons.rifle.reserve = Math.max(20, p.weapons.rifle.reserve);
    p.equip('sword', true);
    const ahead = this.roadPoint(T.road2.length - 90);
    g.rig.faceYawTowards(ahead, p.position); g.rig.pitch = -0.06;
    p.yaw = Math.atan2(ahead.x - p.position.x, ahead.z - p.position.z);
    g.hud.titleCard('THE ROAD BACK', 'West, to Kharsk', 4);
    this.tween(u.uFade, 'value', 0, 2.5);
    A.setMood('calm');
    this.endCutscene({ yaw: g.rig.yaw, pitch: -0.06 });
    g.hud.setObjective('Return to the Seventh at Kharsk Keep');
    // marker walks west along the road
    this.phaseUpdate = () => {
      const s = this.roadS();
      g.hud.setMarker(this.roadPoint(Math.max(2, s - 30)).add(V(0, 1.2, 0)));
    };
    // Varek waits on the road
    this.varek = this.spawnEnemy(this.roadPoint(DUEL_S), { coat: true, role: 'idle', weapon: 'sword', name: 'Varek of Kharsk', holdFire: true, hp: 999 });
    this.varek.invulnerable = true;
    this.varek.lookAt = this.headOf(p);
    this.varek.faceYaw = Math.atan2(start.x - this.varek.position.x, start.z - this.varek.position.z);
    await this.until(() => this.roadS() < DUEL_S + 26 && p.alive);
    this.phaseUpdate = null;
    g.hud.setMarker(null);
  },

  // ---------- the duel ----------
  async duel() {
    this.phase = 'duel';
    // each round restarts from the cutscene before it, everyone at full health
    for (;;) { await this.duelChallenge(); if (await this.duelFight(1)) break; await this.duelRetry(1); }
    for (;;) { await this.betrayal(); if (await this.duelFight(2)) break; await this.duelRetry(2); }
    await this.execution();
  },

  // you fell: fade out, then reset both fighters to the start of that round
  async duelRetry(round) {
    const g = this.g, p = g.player, Vk = this.varek, D = this.duelState;
    D.active = false; D.done = false;
    this.phaseUpdate = null;
    Vk.route = []; Vk.h.a.swing = -1;
    g.hud.bossBar(null);
    g.controlsEnabled = false;
    const ds = document.getElementById('deathScreen');
    await this.wait(1.2);
    ds.classList.remove('hidden');
    await this.wait(2.6);
    for (const m of this._duelDrops || []) g.scene.remove(m);
    this._duelDrops = [];
    const vs = this.roadPoint(DUEL_S), ps = this.roadPoint(DUEL_S + 7);
    Vk.position.copy(vs); Vk.kb.set(0, 0, 0); Vk.vel.set(0, 0, 0); Vk.stunT = 0;
    Object.assign(Vk.h.a, { kneel: 0, slump: 0, handsUp: 0, swing: -1, hurt: 0, thrust: -1 });
    Vk.setWeapon('sword');
    g.atmo.setupScene(Vk.h.root);
    Vk.invulnerable = true;
    Vk.yaw = Math.atan2(ps.x - vs.x, ps.z - vs.z); Vk.h.root.rotation.y = Vk.yaw;
    D.hp = round === 1 ? D.max : D.max * 0.6;
    p.revive(ps, Math.atan2(vs.x - ps.x, vs.z - ps.z));
    p.hp = p.maxHp;
    p.sword.dmgScale = 1.45;
    p.equip('sword', true);
    Object.assign(p.h.a, { flip: 0, tuck: 0, moveCrouch: 0, swordOverride: null });
    g.hud.updateWeapon(p);
    ds.classList.add('hidden');
  },

  // Varek's challenge (replayed after a death in round one)
  async duelChallenge() {
    const g = this.g, p = g.player, A = g.audio, u = g.post.u, Vk = this.varek;
    await this.cutscene(async () => {
      A.setMood('tension');
      p.vel.set(0, 0, 0);
      const vp = Vk.position.clone();
      const toV = vp.clone().sub(p.position).setY(0);
      if (toV.length() > 7) p.position.copy(this.ground(vp.x - toV.x / toV.length() * 7, vp.z - toV.z / toV.length() * 7));
      p.yaw = Math.atan2(vp.x - p.position.x, vp.z - p.position.z); p.h.root.rotation.y = p.yaw;
      Vk.lookAt = this.headOf(p); Vk.faceYaw = Math.atan2(p.position.x - vp.x, p.position.z - vp.z);
      const mid = vp.clone().lerp(p.position, 0.5);
      const dir = vp.clone().sub(p.position).setY(0).normalize();
      const side = V(-dir.z, 0, dir.x);
      this.shot((t, o) => { o.pos.copy(mid).addScaledVector(side, 6 - t).add(V(0, 1.7, 0)); o.look.copy(mid).add(V(0, 1.3, 0)); o.fov = 46; }, 6);
      await this.say('Varek of Kharsk', 'You. Velmoran. Seventh Company tabs, a bandage on your head… I know you.', 4.8, { color: COL.varek, voice: 'varek', delivery: 'menace', actor: Vk });
      this.shot((t, o) => { o.look.copy(this.faceCam(Vk, o.pos, 1.5 - t * 0.2, 0.35, 0.05)); o.fov = 36; }, 6);
      await this.say('Varek of Kharsk', 'You walked out of Kharsk Keep while it burned. My brothers were in that keep. All of them.', 5.4, { color: COL.varek, voice: 'varek', delivery: 'grave', actor: Vk });
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.3, -0.35, 0.02)); o.fov = 36; }, 3.4);
      await this.say('You', 'I didn\'t light those fires.', 2.2, { color: COL.you, voice: 'you', delivery: 'dry', actor: p });
      this.shot((t, o) => { o.look.copy(this.faceCam(Vk, o.pos, 1.3, -0.3, 0.05)); o.fov = 34; }, 8);
      await this.say('Varek of Kharsk', 'You walked past them. It is the same thing.', 3.0, { color: COL.varek, voice: 'varek', delivery: 'menace', actor: Vk });
      await this.say('Varek of Kharsk', 'Put the rifle down. Face me with steel, like a soldier — or are you only brave from a distance?', 5.6, { color: COL.varek, voice: 'varek', delivery: 'shout', actor: Vk });
      // the rifle goes on the back
      p.equip('sword', true);
      A.pickup();
      this.shot((t, o) => { o.pos.copy(mid).addScaledVector(side, -5).add(V(0, 1.5, 0)); o.look.copy(mid).add(V(0, 1.2, 0)); o.fov = 48; }, 4);
      await this.say('You', '…Fine.', 1.6, { color: COL.you, voice: 'you', delivery: 'dry', actor: p });
      await this.wait(0.6);
    }, { canSkip: true });
    // steel only
    if (!this.stash4) this.stash4 = { rifle: p.weapons.rifle.has };
    p.weapons.rifle.has = false;
    p.equip('sword', true);
    g.hud.updateWeapon(p);
    this.endCutscene({ yaw: Math.atan2(-(Vk.position.x - p.position.x), -(Vk.position.z - p.position.z)) });
    g.hud.setObjective('Defeat Varek — steel only');
    A.setMood('combat');
  },

  // the duelist: approach, wind up, strike, recover, guard; parries some frontal blows
  async duelFight(phaseNo) {
    const g = this.g, p = g.player, A = g.audio, Vk = this.varek;
    const D = this.duelState = this.duelState || { max: 2400, hp: 2400 };
    D.phase = phaseNo; D.active = true; D.state = 'approach'; D.t = 0; D.done = false;
    const floor = phaseNo === 1 ? D.max * 0.3 : 1;
    if (phaseNo === 2) { D.hp = Math.max(D.hp, D.max * 0.6); p.sword.dmgScale = 1.45 * 1.25; } // he gets his second wind; you stop holding back
    Vk.invulnerable = false; Vk.role = 'scripted'; Vk.holdFire = true; Vk.faceYaw = null;
    const fast = phaseNo === 2;
    g.hud.bossBar('Varek of Kharsk', D.hp / D.max);
    // incoming blows run through the duel rules instead of the normal damage model
    Vk.takeDamage = (amount, from, point, dir) => {
      if (!D.active || from !== p) return false;
      const toP = p.position.clone().sub(Vk.position).setY(0).normalize();
      const fwd = V(Math.sin(Vk.yaw), 0, Math.cos(Vk.yaw));
      const facing = fwd.dot(toP) > 0.45;
      if (facing && (D.state === 'guard' || D.state === 'approach') && Math.random() < (fast ? 0.35 : 0.55)) {
        A.clang(point || Vk.position);
        g.effects.sparks(point || Vk.aimPoint(new THREE.Vector3()), toP.clone().negate());
        amount *= 0.15;
        D.state = 'windup'; D.t = 0; D.wound = false; // riposte
      } else {
        if (point && dir) g.effects.blood(point, dir);
        A.impact('flesh', point || Vk.position);
        Vk.h.a.hurt = 1;
        if (amount > 110 && Math.random() < 0.4) { D.state = 'stagger'; D.t = 0; } // only big hits rock him
        if (Math.random() < 0.5) A.grunt(Vk.position.clone().setY(Vk.position.y + 1.5), 0.8);
      }
      D.hp = Math.max(floor, D.hp - amount);
      g.hud.bossBar('Varek of Kharsk', D.hp / D.max);
      if (D.hp <= floor) { D.active = false; D.done = true; }
      return false;
    };
    let variant = 0;
    this.checkpoint = null; // a death restarts the round (see duelRetry)
    this.phaseUpdate = (dt) => {
      if (!D.active) { Vk.route = []; return; }
      const toP = p.position.clone().sub(Vk.position).setY(0);
      const dist = toP.length();
      Vk.faceYaw = Math.atan2(toP.x, toP.z);
      Vk.lookAt = this.headOf(p);
      D.t += dt;
      const a = Vk.h.a;
      switch (D.state) {
        case 'approach': {
          a.swing = -1;
          if (dist > 2.1) Vk.goTo(p.position.clone(), fast ? 4.6 : 3.4);
          else { Vk.route = []; D.state = Math.random() < 0.25 ? 'circle' : 'windup'; D.t = 0; D.side = Math.random() < 0.5 ? -1 : 1; }
          break;
        }
        case 'circle': {
          const side = V(-toP.z, 0, toP.x).normalize().multiplyScalar(D.side * 2.5);
          Vk.goTo(Vk.position.clone().add(side), 2.6);
          if (D.t > rand(0.8, 1.4)) { D.state = 'approach'; D.t = 0; }
          break;
        }
        case 'windup': {
          Vk.route = [];
          if (!D.wound) { D.wound = true; variant = 1 - variant; a.swingVariant = variant; a.swing = 0; A.swing(); }
          const wind = fast ? 0.3 : 0.5;
          a.swing = Math.min(0.3, (D.t / wind) * 0.3);
          if (D.t >= wind) { D.state = 'strike'; D.t = 0; D.hit = false; D.wound = false; }
          break;
        }
        case 'strike': {
          a.swing = 0.3 + Math.min(1, D.t / 0.18) * 0.3;
          if (!D.hit && D.t > 0.1) {
            D.hit = true;
            const fwd = V(Math.sin(Vk.yaw), 0, Math.cos(Vk.yaw));
            if (dist < 2.7 && fwd.dot(toP.clone().normalize()) > 0.4 && p.alive && !p.invulnerable) {
              p.takeDamage(fast ? 34 : 26, Vk, p.aimPoint(new THREE.Vector3()), fwd);
              A.slash(p.position);
            }
          }
          if (D.t > 0.2) { D.state = 'recover'; D.t = 0; }
          break;
        }
        case 'recover': {
          a.swing = Math.min(0.999, 0.6 + D.t / (fast ? 0.35 : 0.55) * 0.4);
          if (a.swing >= 0.999) { a.swing = -1; D.state = Math.random() < (fast ? 0.35 : 0.6) ? 'guard' : 'approach'; D.t = 0; }
          break;
        }
        case 'guard': {
          a.swing = -1;
          if (dist < 2.4) Vk.goTo(Vk.position.clone().addScaledVector(toP.clone().normalize(), -1.5), 1.8);
          if (D.t > (fast ? 0.35 : 0.7)) { D.state = 'approach'; D.t = 0; }
          break;
        }
        case 'stagger': {
          a.swing = -1; Vk.route = [];
          if (D.t > 0.35) { D.state = 'approach'; D.t = 0; }
          break;
        }
      }
    };
    await this.until(() => (D.done && p.alive) || !p.alive);
    this.phaseUpdate = null;
    this.checkpoint = null;
    Vk.route = []; Vk.h.a.swing = -1;
    Vk.invulnerable = true;
    D.active = false;
    return p.alive;
  },

  // he yields… and goes for the knife
  async betrayal() {
    const g = this.g, p = g.player, A = g.audio, Vk = this.varek;
    await this.cutscene(async () => {
      A.setMood('tension');
      const vp = Vk.position.clone();
      p.vel.set(0, 0, 0);
      const toV = vp.clone().sub(p.position).setY(0);
      if (toV.length() < 2.4 || toV.length() > 4) {
        const n = toV.lengthSq() > 0.01 ? toV.normalize() : V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        p.position.copy(this.ground(vp.x - n.x * 3, vp.z - n.z * 3));
      }
      p.yaw = Math.atan2(vp.x - p.position.x, vp.z - p.position.z); p.h.root.rotation.y = p.yaw;
      Vk.faceYaw = Math.atan2(p.position.x - vp.x, p.position.z - vp.z); Vk.lookAt = this.headOf(p);
      // he drops the sabre and goes to his knees
      const sab = Vk.h.weaponModel;
      Vk.h.setWeaponModel(null);
      if (sab) { sab.position.copy(this.ground(vp.x + 0.6, vp.z + 0.4)).add(V(0, 0.04, 0)); sab.rotation.set(0, rand(0, 6), Math.PI / 2); g.scene.add(sab); (this._duelDrops || (this._duelDrops = [])).push(sab); }
      Vk.h.a.kneel = 1; Vk.h.a.handsUp = 0.7;
      g.hud.bossBar(null);
      this.shot((t, o) => { o.look.copy(this.faceCam(Vk, o.pos, 1.6, 0.4, 0.15)); o.look.y -= 0.2; o.fov = 40; }, 5);
      await this.say('Varek of Kharsk', 'Enough… enough! I yield. I yield!', 3.0, { color: COL.varek, voice: 'varek', delivery: 'panic', actor: Vk });
      // the player lowers the axe and turns half away
      p.h.a.swordOverride = { p: [-0.25, -0.42, 0.18], r: [-0.25, 0.2, 0.0], tw: 0 };
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.4, -0.4, 0.0)); o.fov = 38; }, 4);
      await this.say('You', 'Then get up. Go home.', 2.2, { color: COL.you, voice: 'you', delivery: 'dry', actor: p });
      p.yaw += 0.7; p.h.root.rotation.y = p.yaw;
      // the knife
      Vk.h.a.handsUp = 0;
      Vk.h.setWeaponModel(buildDagger());
      g.atmo.setupScene(Vk.h.weaponModel);
      const dir = p.position.clone().sub(Vk.position).setY(0).normalize();
      const side = V(-dir.z, 0, dir.x);
      this.shot((t, o) => { o.pos.copy(p.position).addScaledVector(side, 3.2).addScaledVector(dir, 1.2).add(V(0, 1.4, 0)); o.look.copy(Vk.position).lerp(p.position, 0.5).add(V(0, 1.1, 0)); o.fov = 46; }, 6);
      await this.wait(0.4);
      Vk.h.a.kneel = 0;
      this.bark('Varek of Kharsk', 'For Kharsk!', COL.varek, 1.6, 'varek', 'shout');
      g.timeScale = 0.22;
      A.swing();
      Vk.goTo(p.position.clone(), 6);
      const ok = await g.hud.qte('DODGE', 'SPACE', ['Space', 'KeyA', 'KeyD', 'ShiftLeft'], 1.5);
      g.timeScale = 1;
      if (ok) {
        // leap out of the way: a diving roll sideways, the blade cutting air behind you
        this.leapAside(side.clone().multiplyScalar(-1));
        A.whiz(p.position.clone().setY(p.position.y + 1.4));
      } else {
        Vk.h.a.thrust = 0;
        p.invulnerable = false;
        p.takeDamage(30, Vk, p.aimPoint(new THREE.Vector3()), dir);
        p.invulnerable = true;
        A.slash(p.position);
        g.rig.addTrauma(0.6);
      }
      await this.wait(1.0);
      Object.assign(p.h.a, { flip: 0, tuck: 0, moveCrouch: 0 });
      p.vel.set(0, 0, 0);
      Vk.route = [];
      p.h.a.swordOverride = null;
      p.yaw = Math.atan2(Vk.position.x - p.position.x, Vk.position.z - p.position.z); p.h.root.rotation.y = p.yaw;
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.0 - t * 0.15, 0.25, -0.02)); o.fov = 32; }, 3.4);
      await this.say('You', 'You should have stayed down.', 2.4, { color: COL.you, voice: 'you', delivery: 'menace', actor: p });
    }, { canSkip: false });
    p.h.a.swordOverride = null;
    g.timeScale = 1;
    this.endCutscene({ yaw: Math.atan2(-(Vk.position.x - p.position.x), -(Vk.position.z - p.position.z)) });
    g.hud.setObjective('Stop holding back');
    A.setMood('combat');
  },

  // a diving forward roll in direction jd (game-time driven, so it plays the same in slow motion)
  leapAside(jd) {
    const g = this.g, p = g.player, A = g.audio;
    p.yaw = Math.atan2(jd.x, jd.z); p.h.root.rotation.y = p.yaw;
    p.vel.set(0, 0, 0);
    p.vy = 6.6; p.onGround = false;
    const a = p.h.a;
    a.flip = 0; a.tuck = 0;
    A.swing();
    const t0 = g.time, dur = 0.72, start = p.position.clone(), dist = 3.6;
    const prev = this.phaseUpdate;
    this.phaseUpdate = (dt) => {
      const k = Math.min(1, (g.time - t0) / dur);
      const e = k * k * (3 - 2 * k);
      // carry the body sideways along the leap (height comes from the jump itself)
      const m = Math.min(1, k * 1.15), mv = 1 - (1 - m) * (1 - m);
      p.position.x = start.x + jd.x * dist * mv;
      p.position.z = start.z + jd.z * dist * mv;
      a.flip = Math.PI * 2 * e;
      a.tuck = Math.sin(Math.PI * Math.min(1, k * 1.1));
      a.moveCrouch = k > 0.85 ? 0.7 * (1 - (k - 0.85) / 0.15) : 0;
      if (k >= 1) {
        a.flip = 0; a.tuck = 0; a.moveCrouch = 0;
        A.footstep('dirt', null, 1.5);
        this.phaseUpdate = prev;
      }
      if (prev) prev(dt);
    };
  },

  // the end of it: on his knees; the camera turns to the sky
  async execution() {
    const g = this.g, p = g.player, A = g.audio, u = g.post.u, Vk = this.varek;
    await this.cutscene(async () => {
      A.setMood('silent');
      g.hud.bossBar(null);
      const vp = Vk.position.clone();
      p.vel.set(0, 0, 0);
      const n = vp.clone().sub(p.position).setY(0);
      const nl = n.length() > 0.01 ? n.normalize() : V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      p.position.copy(this.ground(vp.x - nl.x * 1.5, vp.z - nl.z * 1.5));
      p.yaw = Math.atan2(nl.x, nl.z); p.h.root.rotation.y = p.yaw;
      // the dagger falls
      const dg = Vk.h.weaponModel;
      Vk.h.setWeaponModel(null);
      if (dg) { dg.position.copy(this.ground(vp.x + 0.5, vp.z - 0.3)).add(V(0, 0.03, 0)); dg.rotation.set(0, 1.2, Math.PI / 2); g.scene.add(dg); }
      Object.assign(Vk.h.a, { kneel: 1, slump: 0.55, handsUp: 0, swing: -1 });
      Vk.faceYaw = Math.atan2(p.position.x - vp.x, p.position.z - vp.z); Vk.lookAt = this.headOf(p);
      const side = V(-nl.z, 0, nl.x);
      this.shot((t, o) => { o.pos.copy(p.position).addScaledVector(side, 2.6).addScaledVector(nl, -1.6).add(V(0, 1.55, 0)); o.look.copy(vp).add(V(0, 0.8, 0)); o.fov = 42; }, 6);
      await this.wait(1.2);
      Vk.h.a.slump = 0.2;
      await this.say('Varek of Kharsk', 'Go on, then… finish it. Like you finished Kharsk.', 4.0, { color: COL.varek, voice: 'varek', delivery: 'grave', actor: Vk });
      // the player's face
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 0.95 - t * 0.2, 0.2, -0.02)); o.fov = 30; }, 4);
      A.heartbeat(0, 0.5); A.heartbeat(1.1, 0.5); A.heartbeat(2.1, 0.55);
      await this.wait(3.4);
      // the axe goes up
      p.h.a.swordOverride = { p: [-0.12, 0.36, -0.05], r: [-2.9, 0.1, 0.0], tw: 0 };
      this.shot((t, o) => { o.pos.copy(p.position).addScaledVector(nl, -2.6).addScaledVector(side, -1.2).add(V(0, 0.9, 0)); o.look.copy(p.position).add(V(0, 2.1, 0)); o.fov = 48; }, 1.6);
      await this.wait(1.5);
      // cut away: the sky over the road
      const sky = skyDir(300, 34);
      const from = p.position.clone().add(V(0, 1.8, 0));
      this.shot((t, o) => { o.pos.copy(from).addScaledVector(nl, -3); o.look.copy(o.pos).addScaledVector(sky, 100).add(V(0, t * 6, 0)); o.fov = 50; }, 7);
      await this.wait(0.35);
      A.swing();
      await this.wait(0.22);
      A.slam(vp);
      A.impact('flesh', vp);
      g.rig.addTrauma(0.3);
      p.h.a.swordOverride = { p: [0.0, -0.32, 0.42], r: [0.8, 0.0, 0.0], tw: 0 };
      Vk.invulnerable = false;
      Vk.takeDamage = Object.getPrototypeOf(Vk).takeDamage.bind(Vk);
      Vk.die(p, nl);
      // birds scatter
      for (let i = 0; i < 9; i++) A._noiseBurst && setTimeout(() => A.enabled && A._noiseBurst(A.amb, { dur: 0.12, type: 'bandpass', f0: rand(1500, 3000), f1: 900, q: 1.5, gain: 0.25 }), 150 + i * 70);
      await this.wait(4.2);
      // after: the road, the axe lowered
      p.h.a.swordOverride = null;
      this.shot((t, o) => { o.pos.copy(vp).addScaledVector(side, 7 - t).add(V(0, 2.6 + t * 1.2, 0)).addScaledVector(nl, 3); o.look.copy(p.position).add(V(0, 0.9, 0)); o.fov = 46; }, 7);
      A.setMood('sad');
      await this.wait(3.0);
      await this.say('You', '(He surrendered. Then he went for my throat. I didn\'t have a choice.)', 4.4, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
    }, { canSkip: true });
    p.h.a.swordOverride = null;
    if (Vk.alive) { Vk.invulnerable = false; Vk.die(p, null); }
    p.weapons.rifle.has = this.stash4 ? this.stash4.rifle : true;
    p.sword.dmgScale = 1.45;
    g.hud.updateWeapon(p);
    this.endCutscene({ yaw: Math.atan2(-(this.roadPoint(DUEL_S - 30).x - p.position.x), -(this.roadPoint(DUEL_S - 30).z - p.position.z)) });
  },

  // ---------- the long walk home: arguing with yourself ----------
  async walkHome() {
    const g = this.g, p = g.player, u = g.post.u;
    this.phase = 'walkHome';
    // the day burns down: fade, and walk home into the sunset
    if (g.skies && g.skies.sunset) {
      g.controlsEnabled = false;
      this.tween(u.uFade, 'value', 1, 1.4);
      await this.wait(1.5);
      g.setSunset();
      g.hud.titleCard('DUSK', 'The road to Kharsk', 4);
      this.tween(u.uFade, 'value', 0, 2.2);
      await this.wait(1.0);
      g.controlsEnabled = true;
    }
    g.hud.setObjective('Return to the Seventh at Kharsk Keep');
    const thoughts = [
      [DUEL_S - 22, () => this.bark('You', '(…Did I? He was on his knees. So were the men at Kharsk.)', COL.you, 4.2, 'youThought', 'thought')],
      [DUEL_S - 48, () => this.bark('You', '(I called Morrow\'s men murderers for that. What does that make me?)', COL.you, 4.2, 'youThought', 'thought')],
      [DUEL_S - 78, () => this.bark('You', '(The patrol in the clearing. Five men. I never even saw their faces.)', COL.you, 4.2, 'youThought', 'thought')],
      [DUEL_S - 108, () => this.bark('You', '(The scouts on the road. The walls at Velmar. The checkpoint. The bandits. I stopped counting somewhere.)', COL.you, 5.4, 'youThought', 'thought')],
      [DUEL_S - 140, () => this.bark('You', '(Every one of them had a name. I don\'t even have mine.)', COL.you, 4.0, 'youThought', 'thought')],
      [DUEL_S - 168, () => this.bark('You', '(Maybe that\'s why it comes so easy.)', COL.you, 3.2, 'youThought', 'thought')],
      [DUEL_S - 196, () => this.bark('You', '(They\'d have killed me. Every one of them. That\'s what I keep telling myself.)', COL.you, 4.6, 'youThought', 'thought')],
      [DUEL_S - 224, () => this.bark('You', '(But he was right about one thing. I walked past those fires.)', COL.you, 4.2, 'youThought', 'thought')],
      [DUEL_S - 250, () => this.bark('You', '(…Is this who I was? Before I woke up in that forest?)', COL.you, 4.0, 'youThought', 'thought')],
      [DUEL_S - 274, () => this.bark('You', '(Whoever I was… I\'m not sure I want to find him.)', COL.you, 3.8, 'youThought', 'thought')],
    ];
    // each thought plays out in full before the next (sprinting doesn't cut them short)
    let next = 0, freeAt = 0;
    this.phaseUpdate = () => {
      const s = this.roadS();
      g.hud.setMarker(this.roadPoint(Math.max(2, s - 30)).add(V(0, 1.2, 0)));
      if (next < thoughts.length && s < thoughts[next][0] && g.time >= freeAt) {
        thoughts[next][1]();
        const clip = g.audio.voiceManifest && Object.values(g.audio.voiceManifest).find((l) => l.cast === 'youThought' && g.hud.el.sub.textContent.includes(l.text.slice(1, 20)));
        freeAt = g.time + (clip ? clip.dur : 4.2) + 0.8;
        next++;
      }
    };
    // the Seventh's camp at the keep gate
    const K = g.kfort, S = K.spots;
    this.general = this.spawnAlly(S.general.clone(), { uniform: 'velmoraOfficer', weapon: 'none', name: 'General Morrow', skin: 0xd2a07f });
    this.corporal = this.spawnAlly(this.kp(-3, -46), { name: 'Corporal Hale', helmet: 'brodie', role: 'idle' });
    const fire = this.kp(4, -48);
    g.effects.addFire(fire, 0.9);
    this.campMen = [this.kp(6.5, -46), this.kp(2, -50.5), this.kp(7, -50)].map((pos, i) => {
      const s = this.spawnAlly(pos, { name: 'Velmoran Soldier', helmet: i === 1 ? 'deep' : 'brodie', role: 'idle' });
      s.forceCrouch = 0.8; s.lookAt = fire.clone();
      return s;
    });
    for (const s of [this.general, this.corporal, ...this.campMen]) { s.holdFire = true; s.invulnerable = true; }
    await this.until(() => (p.position.distanceTo(this.corporal.position) < 16 || this.roadS() < 12) && p.alive && next >= thoughts.length && g.time >= freeAt);
    this.phaseUpdate = null;
    g.hud.setMarker(null);
  },

  async homecoming() {
    const g = this.g, p = g.player, A = g.audio, u = g.post.u, Gn = this.general, cp = this.corporal;
    await this.cutscene(async () => {
      A.setMood('hope');
      const cpp = cp.position.clone();
      p.vel.set(0, 0, 0);
      const toC = cpp.clone().sub(p.position).setY(0);
      if (toC.length() > 3.5) { const n = toC.normalize(); p.position.copy(this.ground(cpp.x - n.x * 2.6, cpp.z - n.z * 2.6)); }
      p.yaw = Math.atan2(cpp.x - p.position.x, cpp.z - p.position.z); p.h.root.rotation.y = p.yaw;
      cp.lookAt = this.headOf(p); cp.faceYaw = Math.atan2(p.position.x - cpp.x, p.position.z - cpp.z);
      cp.h.a.wave = 1;
      const mid = cpp.clone().lerp(p.position, 0.5);
      const dir = cpp.clone().sub(p.position).setY(0).normalize();
      const side = V(-dir.z, 0, dir.x);
      this.shot((t, o) => { o.pos.copy(mid).addScaledVector(side, 4 - t * 0.5).add(V(0, 1.6, 0)); o.look.copy(mid).add(V(0, 1.4, 0)); o.fov = 46; }, 5);
      await this.say('Corporal Hale', 'Seventh! You made it back! They\'re saying you held Hollin Ridge!', 3.8, { color: COL.ally, voice: 'corporal', delivery: 'cheerful', actor: cp });
      cp.h.a.wave = 0;
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.25, 0.35, 0.02)); o.fov = 36; }, 3.2);
      await this.say('You', '…Something like that.', 2.0, { color: COL.you, voice: 'you', delivery: 'dry', actor: p });
      // the General
      const gp = this.ground(p.position.x - side.x * 2.4 + dir.x * 0.8, p.position.z - side.z * 2.4 + dir.z * 0.8);
      Gn.position.copy(gp); Gn.route = [];
      Gn.lookAt = this.headOf(p); Gn.faceYaw = Math.atan2(p.position.x - gp.x, p.position.z - gp.z);
      p.yaw = Math.atan2(gp.x - p.position.x, gp.z - p.position.z); p.h.root.rotation.y = p.yaw;
      const mid2 = gp.clone().lerp(p.position, 0.5);
      this.shot((t, o) => { o.pos.copy(mid2).addScaledVector(dir, -3.6).add(V(0, 1.6, 0)); o.look.copy(mid2).add(V(0, 1.45, 0)); o.fov = 44; }, 6);
      await this.say('General Morrow', 'Hollin Ridge stands, I hear. Iron Tide broke on their wire.', 4.0, { color: COL.general, voice: 'general', delivery: 'dry', actor: Gn });
      this.shot((t, o) => { o.look.copy(this.faceCam(Gn, o.pos, 1.3 - t * 0.2, 0.3, 0.0)); o.fov = 34; }, 5);
      await this.say('General Morrow', 'And I hear my seal was broken.', 2.8, { color: COL.general, voice: 'general', delivery: 'menace', actor: Gn });
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.15, -0.3, 0.02)); o.fov = 34; }, 3);
      await this.say('You', 'It was.', 1.6, { color: COL.you, voice: 'you', delivery: 'dry', actor: p });
      this.shot((t, o) => { o.look.copy(this.faceCam(Gn, o.pos, 1.15, -0.3, 0.0)); o.fov = 32; }, 7);
      await this.wait(1.4);
      await this.say('General Morrow', 'Get some sleep, soldier. Tomorrow, you and I are going to talk.', 4.0, { color: COL.general, voice: 'general', delivery: 'grave', actor: Gn });
      Gn.faceYaw = null; Gn.lookAt = null;
      Gn.goTo(this.kp(10, -60), 1.4);
      // the axe, in his hands
      const sky = skyDir(300, 28);
      this.shot((t, o) => { const k = easeInOut(t); o.pos.copy(p.position).addScaledVector(dir, -2.4 - k * 6).add(V(0, 1.4 + k * 9, 0)); o.look.copy(p.position).add(V(0, 1, 0)).lerp(o.pos.clone().addScaledVector(sky, 60), Math.max(0, k - 0.45)); o.fov = 48; }, 10);
      await this.wait(7);
      this.tween(u.uFade, 'value', 1, 3);
      await this.wait(3.2);
    }, { canSkip: true });
  },
};
