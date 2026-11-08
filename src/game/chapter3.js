import * as THREE from 'three';
import { SITES } from '../world/roadside.js';
import { skyDir } from '../world/nightsky.js';
import { FOLDER } from './chapter2.js';
import { rand, clamp, easeInOut } from '../core/utils.js';

// ============================================================================
// Chapter III — The Long Road
// Night under the ringed planet. The General sends the player east with the Kharzan
// war plans. Bandits and a Kharzan checkpoint stand in the way. At an abandoned camp
// the player may break the seal: the plans reveal Operation Iron Tide, an attack on
// Hollin Ridge, the very base they are walking to. Warn Command, or keep the secret
// and turn back. (Keep every this.say / this.bark on one line: the voice script reads them.)
// ============================================================================

const COL = { you: '#e8d9a8', ally: '#9fc7a8', enemy: '#e08a7a', general: '#d6bf7c', bandit: '#d8a070', colonel: '#cfd6a0' };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const PLANS = `
  <span class="stamp">SECRET</span>
  <span class="seal"></span>
  <h1>DOMINION OF KHARZ &mdash; HIGH COMMAND</h1>
  <h2>OPERATION IRON TIDE</h2>
  <p><b>To:</b> Marshal Dravek, Northern March<br><b>Copy:</b> 3rd and 7th Assault Divisions</p>
  <p>1. The Velmoran field command has withdrawn to <span class="hl">HOLLIN RIDGE</span>. Our agents confirm it holds their staff, their maps and their last reserve.</p>
  <p>2. The 3rd Assault Division crosses the Varr by night and closes on Hollin Ridge by the west road. The 7th cuts the east road so that none escape.</p>
  <p>3. The guns open at first light on <span class="hl">the third day</span> after this order. The infantry goes in under the barrage.</p>
  <p>4. No warning may reach them. Couriers on the roads are to be taken or killed. Bounties are to be paid to any who bring us their papers.</p>
  <p>5. When Hollin Ridge falls, the Free Marches fall with it.</p>
  <p class="sig">By order of the Supreme Council<br>&mdash; Iron and Ash &mdash;</p>`;

export const ChapterThree = {
  // ---------------- helpers ----------------
  // the player's distance along the long road
  roadS(pos = this.g.player.position) {
    const T = this.g.terrain;
    const q = T.road2Query(pos.x, pos.z);
    if (q.d < 40) { this._lastS = q.s; return q.s; }
    let best = 0, bd = Infinity;
    for (const p of T.road2.path) { const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2; if (d < bd) { bd = d; best = p.s; } }
    this._lastS = best;
    return best;
  },

  roadPoint(s, off = 0) { return this.g.roadside.at(s, off); },

  spawnBandit(pos, o = {}) {
    const melee = o.weapon === 'sword';
    const s = this.g.spawnSoldier({
      faction: 'bandit', uniform: 'bandit', weapon: o.weapon || 'rifle', pos, yaw: o.yaw ?? 0, role: o.role || 'idle',
      accuracy: o.accuracy ?? 0.22, damage: o.damage ?? (melee ? 22 : 13), hp: o.hp ?? 90, name: o.name || 'Bandit', holdFire: true, helmet: o.helmet,
    });
    s.isBandit = true;
    return s;
  },

  // walk-over ammo from fallen enemies' weapons
  lootTick() {
    const g = this.g, p = g.player;
    for (const s of g.soldiers) {
      if (s.alive || s.looted || !s.droppedWeapon || s.faction === 'velmora') continue;
      if (s.droppedWeapon.position.distanceTo(p.position) < 1.9) {
        s.looted = true;
        const n = s.weaponType === 'lmg' ? 10 : s.weaponType === 'rifle' ? 5 : 0;
        if (n && p.weapons.rifle.has) {
          p.weapons.rifle.reserve += n;
          g.audio.pickup();
          g.hud.notify(`+${n} rifle rounds`);
          g.hud.updateWeapon(p);
        }
      }
    }
  },

  // marker on the road ahead + loot; `extra` runs too
  roadUpdate(extra = null) {
    const g = this.g;
    this.phaseUpdate = (dt) => {
      const s = this.roadS();
      const target = this.markerTarget ? this.markerTarget() : null;
      if (target) g.hud.setMarker(target);
      else {
        const pt = this.roadPoint(Math.min(s + 30, g.terrain.road2.length - 5));
        g.hud.setMarker(pt.clone().add(V(0, 1.2, 0)));
      }
      this.lootTick();
      if (this.campLight) this.campLight.intensity = 16 + Math.sin(g.time * 13) * 2 + Math.sin(g.time * 7.3) * 3 + Math.random() * 1.5;
      if (extra) extra(dt, s);
    };
  },

  // ---------- setup: night at the burnt keep ----------
  setupRoad() {
    const g = this.g, p = g.player, K = g.kfort, A = g.audio, u = g.post.u;
    this.clearChapterOne();
    g.setNight();
    K.activate();
    K.ignite(g.effects);
    K.glow(true);
    K.glowScale = 0.3; // embers by night, not a blaze
    K.setLamp(false);
    A.fireLoop(0.3);
    g.timeScale = 1;
    u.uBlur.value = 0; u.uDesat.value = 0; u.uRedTint.value = 0; u.uEyelid.value = 0;
    A.muffle = 0;
    const S = K.spots;
    p.revive(this.roadPoint(4, -1.5), 0);
    p.h.root.visible = true;
    Object.assign(p.h.a, { sit: 0, bound: 0, slump: 0, kneel: 0, handsUp: 0, offer: 0, getup: -1, dead: false });
    for (const k of Object.keys(p.weapons)) p.weapons[k].has = false;
    p.equip('none', true);
    g.hud.updateWeapon(p);
    // the General's camp at the gate
    this.general = this.spawnAlly(S.general.clone(), { uniform: 'velmoraOfficer', weapon: 'none', name: 'General Morrow', skin: 0xd2a07f });
    this.aide = this.spawnAlly(S.aide.clone(), { name: 'Aide', helmet: 'brodie', role: 'idle' });
    const extras = [this.kp(-6, -40), this.kp(8, -42), this.kp(-2, -45)].map((pos, i) => {
      const s = this.spawnAlly(pos, { name: 'Velmoran Soldier', helmet: i === 1 ? 'brodie' : undefined, role: 'idle' });
      s.lookAt = K.center.clone().add(V(0, 3, 0));
      return s;
    });
    for (const s of [this.general, this.aide, ...extras]) { s.holdFire = true; s.invulnerable = true; }
    this.camp3 = extras;
  },

  // ===== Chapter III =====
  async chapterThree() {
    const g = this.g, p = g.player, A = g.audio, u = g.post.u;
    this.phase = 'road';
    this.setupRoad();
    u.uFade.value = 1;
    const Gn = this.general, aide = this.aide;

    // ---------- 1. Orders ----------
    await this.cutscene(async () => {
      g.hud.titleCard('CHAPTER III', 'The Long Road', 4.2);
      await this.wait(1.0);
      this.tween(u.uFade, 'value', 0, 3);
      A.setMood('tension');
      // the planet over the smouldering keep
      const gp = Gn.position.clone();
      const toRoad = this.roadPoint(30).sub(gp).setY(0).normalize();
      const side = V(-toRoad.z, 0, toRoad.x);
      const sky = skyDir(146, 24);
      this.shot((t, o) => {
        o.pos.copy(gp).addScaledVector(toRoad, 8 + t * 2).add(V(0, 1.4 + t * 0.6, 0));
        o.look.copy(o.pos).addScaledVector(sky, 100).lerp(gp.clone().add(V(0, 1.5, 0)), easeInOut(Math.max(0, t - 0.55) / 0.45) * 0.6);
        o.fov = 55;
      }, 9);
      await this.wait(7.5);
      // stage: player before the General
      p.position.copy(this.ground(gp.x + toRoad.x * 2.2, gp.z + toRoad.z * 2.2));
      p.yaw = Math.atan2(gp.x - p.position.x, gp.z - p.position.z); p.h.root.rotation.y = p.yaw;
      Gn.lookAt = this.headOf(p); Gn.faceYaw = Math.atan2(p.position.x - gp.x, p.position.z - gp.z);
      aide.lookAt = this.headOf(p);
      const mid = gp.clone().lerp(p.position, 0.5);
      this.shot((t, o) => { o.pos.copy(mid).addScaledVector(side, 3.6 - t * 0.4).add(V(0, 1.55, 0)); o.look.copy(mid).add(V(0, 1.45, 0)); o.fov = 46; }, 6);
      await this.say('General Morrow', 'You. Seventh. I have a job for you.', 3.0, { color: COL.general, voice: 'general', delivery: 'dry', actor: Gn });
      // the folder again
      this.folder3 = FOLDER();
      this.folder3.position.set(0.02, -0.12, 0.05); this.folder3.rotation.set(0.2, 0, 0.1);
      Gn.h.handR.add(this.folder3);
      this.tween(Gn.h.a, 'offer', 0.85, 1.0);
      this.shot((t, o) => { o.look.copy(this.faceCam(Gn, o.pos, 1.5 - t * 0.15, -0.4, -0.08)); o.look.y -= 0.15; o.fov = 38; }, 7);
      await this.say('General Morrow', 'These plans go to Command at Hollin Ridge. East, along the old road. Two days on foot, if you don\'t sleep.', 6.0, { color: COL.general, voice: 'general', delivery: 'command', actor: Gn });
      await this.say('General Morrow', 'My men stay here to hold the ruins. You go alone. Nobody notices one soldier on a road.', 5.0, { color: COL.general, voice: 'general', delivery: 'dry', actor: Gn });
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.3, 0.35, 0.02)); o.fov = 36; }, 3.4);
      await this.say('You', 'And if I\'m stopped?', 2.0, { color: COL.you, voice: 'you', delivery: 'dry', actor: p });
      this.shot((t, o) => { o.look.copy(this.faceCam(Gn, o.pos, 1.2, 0.3, 0.0)); o.fov = 34; }, 8);
      await this.say('General Morrow', 'Then burn them. And don\'t get stopped.', 3.0, { color: COL.general, voice: 'general', delivery: 'dry', actor: Gn });
      // hand over
      Gn.h.handR.remove(this.folder3);
      p.h.handR.add(this.folder3);
      A.pickup();
      this.tween(Gn.h.a, 'offer', 0, 0.8);
      await this.say('General Morrow', 'One more thing, soldier. The seal stays unbroken. Those pages are for Command\'s eyes only.', 5.0, { color: COL.general, voice: 'general', delivery: 'menace', actor: Gn });
      // the aide brings weapons
      aide.goTo(this.ground(p.position.x + side.x * 1.2, p.position.z + side.z * 1.2), 1.6);
      this.shot((t, o) => { o.pos.copy(mid).addScaledVector(side, -3.4).add(V(0, 1.6, 0)); o.look.copy(this.headOf(aide)).lerp(this.headOf(p), 0.5); o.fov = 44; }, 5);
      await this.wait(1.4);
      await this.say('Aide', 'Your sabre, and a rifle. Twenty rounds. Make them count.', 3.4, { color: COL.ally, voice: 'soldier', delivery: 'dry', actor: aide });
      p.give('rifle', 5, 15);
      p.weapons.sword.has = true;
      A.pickup();
    });
    // the folder rides in the coat from here on
    if (this.folder3 && this.folder3.parent) this.folder3.parent.remove(this.folder3);
    if (!p.weapons.rifle.has) p.give('rifle', 5, 15);
    p.weapons.sword.has = true;
    p.equip('rifle', true);
    g.hud.updateWeapon(p);
    this.general.h.a.offer = 0;
    this.endCutscene({ yaw: Math.atan2(-(this.roadPoint(25).x - p.position.x), -(this.roadPoint(25).z - p.position.z)) });
    g.hud.setObjective('Take the plans to Hollin Ridge');
    g.hud.notify('Follow the old road east');
    this.roadUpdate((dt, s) => {
      // leaving the keep: let its fires die down behind you and borrow the glow for the camp
      if (s > 90 && !this._keepDark) {
        this._keepDark = true;
        g.effects.emitters.length = 0;
        g.kfort.glow(false);
        g.audio.fireLoop(0);
        for (const a of [this.general, this.aide, ...this.camp3]) g.removeSoldier(a);
      }
    });

    // ---------- 2. Bandits at the wagon ----------
    await this.encounterWagon();
    // ---------- 3. The camp ----------
    const choice = await this.restAtCamp();
    if (choice === 'keep') { await this.endingKeep(); return; }
    // ---------- 4. The checkpoint, 5. the narrows ----------
    await this.encounterCheckpoint();
    await this.encounterNarrows();
    // ---------- 6. Hollin Ridge ----------
    await this.arriveHQ(choice);
  },

  // generic fight: spawn(), then wait for every enemy to fall; death restarts it
  async fight(spawn, startPos) {
    const g = this.g, p = g.player;
    let enemies = spawn();
    this.checkpoint = async () => {
      for (const e of enemies) g.removeSoldier(e);
      enemies = spawn(true);
      for (const e of enemies) { e.holdFire = false; e.role = e.weaponType === 'sword' ? 'melee' : 'assault'; }
      const sp = startPos();
      p.revive(sp, Math.atan2(enemies[0].position.x - sp.x, enemies[0].position.z - sp.z));
      p.weapons.rifle.reserve = Math.max(p.weapons.rifle.reserve, 15);
      p.weapons.rifle.mag = Math.max(p.weapons.rifle.mag, 5);
      g.hud.updateWeapon(p);
      g.rig.faceYawTowards(enemies[0].position, p.position);
    };
    this.liveEnemies = () => enemies;
    await this.until(() => enemies.every((e) => !e.alive) && p.alive && !this.respawning);
    this.checkpoint = null;
    g.hud.setEnemyCount(null);
    g.audio.setMood('calm');
    return enemies;
  },

  async encounterWagon() {
    const g = this.g, p = g.player, R = g.roadside, A = g.audio;
    await this.until(() => this.roadS() > SITES.wagon - 45 && p.alive);
    const fire = R.wagonFire;
    g.effects.addFire(fire, 0.7);
    const spawn = () => {
      const list = [
        this.spawnBandit(this.ground(fire.x + 1.2, fire.z + 0.6), { name: 'Bandit Leader', hp: 120 }),
        this.spawnBandit(this.ground(fire.x - 1.0, fire.z + 1.1), { helmet: 'brodie' }),
        this.spawnBandit(this.ground(fire.x + 0.4, fire.z - 1.3), { weapon: 'sword', role: 'idle' }),
        this.spawnBandit(R.wagon.p.clone().addScaledVector(R.wagon.r, 2.2), {}),
      ];
      for (const b of list) b.lookAt = fire.clone().add(V(0, 0.5, 0));
      list[3].lookAt = R.wagon.p.clone();
      return list;
    };
    const fightP = this.fight(spawn, () => this.roadPoint(SITES.wagon - 40));
    const enemies = this.liveEnemies();
    // they notice you, talk, then open up
    await this.until(() => enemies.some((e) => !e.alive || e.hp < e.maxHp) || p.position.distanceTo(fire) < 30);
    const lead = enemies[0];
    for (const e of enemies) if (e.alive) e.lookAt = this.headOf(p);
    if (lead.alive) this.bark('Bandit Leader', 'Well, look what the road brought us. Leave the satchel, soldier, and maybe you keep your boots.', COL.bandit, 4.6, 'bandit', 'menace');
    A.setMood('tension');
    await this.until(() => enemies.some((e) => !e.alive || e.hp < e.maxHp) || p.position.distanceTo(fire) < 16 || this._t3(4.6));
    this._t3w = 0;
    if (enemies[1].alive) this.bark('Bandit', 'Take him!', COL.bandit, 1.6, 'bandit2', 'shout');
    A.setMood('combat');
    for (const e of enemies) { e.holdFire = false; e.role = e.weaponType === 'sword' ? 'melee' : 'assault'; e.alerted = true; }
    this._enemyCountFn = () => enemies.filter((e) => e.alive).length;
    await fightP;
  },

  // simple one-shot timer usable inside until() predicates
  _t3(sec) {
    if (!this._t3w) this._t3w = this.g.time + sec;
    if (this.g.time >= this._t3w) { this._t3w = 0; return true; }
    return false;
  },

  // ---------- the abandoned camp ----------
  async restAtCamp() {
    const g = this.g, p = g.player, R = g.roadside, K = g.kfort, A = g.audio;
    const fire = R.campFire;
    g.hud.setObjective('Rest at the abandoned camp');
    this.markerTarget = () => fire.clone().add(V(0, 1.4, 0));
    // the embers are still alive: light them, and bring the keep's light along
    await this.until(() => this.roadS() > SITES.camp - 90);
    g.effects.addFire(fire, 0.8);
    if (K.fireLight) {
      this.campLight = K.fireLight;
      this.campLight.removeFromParent();
      g.scene.add(this.campLight);
      this.campLight.color.set(0xff8a3a); this.campLight.distance = 20; this.campLight.decay = 1.5;
      this.campLight.position.copy(fire).add(V(0, 0.8, 0));
    }
    let rest = false;
    this.addInteract(fire.clone(), 'Rest by the fire', () => { rest = true; }, 3.2);
    await this.until(() => rest && p.alive);
    this.markerTarget = null;
    g.hud.setMarker(null);
    let result = 'sealed';
    await this.cutscene(async () => {
      A.setMood('sad');
      p.equip('none', true);
      p.position.copy(R.campSeat); p.vel.set(0, 0, 0);
      p.yaw = R.campSeatYaw; p.h.root.rotation.y = p.yaw;
      p.h.a.sit = 1;
      // the sky over the camp
      const sky = skyDir(146, 22);
      const base = fire.clone().add(V(0, 1.1, 0));
      this.shot((t, o) => { o.pos.copy(base).addScaledVector(sky, -3).add(V(0, t * 0.4, 0)); o.look.copy(o.pos).addScaledVector(sky, 100).add(V(0, -18 + t * 10, 0)); o.fov = 58; }, 8);
      await this.wait(3.2);
      // by the fire
      const fside = V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      this.shot((t, o) => { o.pos.copy(fire).addScaledVector(fside, 0.6).add(V(1.6 - t * 0.3, 0.75, 0.4)); o.look.copy(this.headOf(p)).add(V(0, -0.1, 0)); o.fov = 42; }, 9);
      await this.say('You', '(Command\'s eyes only. That\'s what he said.)', 3.4, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
      // the folder comes out
      this.folder3 = this.folder3 || FOLDER();
      this.folder3.position.set(0.02, -0.12, 0.05); this.folder3.rotation.set(0.2, 0, 0.1);
      p.h.handR.add(this.folder3);
      this.tween(p.h.a, 'offer', 0.7, 1.0);
      await this.say('You', '(After Kharsk… I don\'t know whose eyes I trust anymore.)', 4.0, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
      const fw = new THREE.Vector3();
      this.shot((t, o) => { this.folder3.getWorldPosition(fw); o.pos.copy(fw).addScaledVector(fside, 0.55).add(V(0.2, 0.32, 0)); o.look.copy(fw); o.fov = 36; }, 30);
      const c = await g.hud.choose('The General\'s seal', ['Break the seal and read the plans', 'Leave it sealed'], { timeout: 30, fallback: 1 });
      if (c === 1) {
        await this.say('You', '(Not my war to read. Just get it there.)', 3.0, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
        result = 'sealed';
        return;
      }
      // break the seal
      A.pickup();
      A._noiseBurst && A.enabled && A._noiseBurst(A.sfx, { dur: 0.35, type: 'bandpass', f0: 3500, f1: 1800, q: 1.2, gain: 0.35 });
      this.readPlans = true;
      await this.wait(0.5);
      await g.hud.showDocument(PLANS, { minTime: 3 });
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.05, 0.3, -0.05)); o.fov = 34; }, 30);
      await this.say('You', '(Operation Iron Tide… Hollin Ridge. They\'re going to hit Command.)', 4.2, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
      await this.say('You', '(Two days on the road, and the guns open on the third. I\'d walk in just in time to die with them.)', 5.2, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
      const d = await g.hud.choose('What will you do?', ['Go on to Hollin Ridge and warn them', 'Keep the secret. Turn back.'], { timeout: 40, fallback: 0 });
      if (d === 0) {
        await this.say('You', '(Whatever they did at Kharsk… the men at Hollin Ridge don\'t deserve to burn.)', 4.4, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
        result = 'warn';
      } else {
        await this.say('You', '(They shot men on their knees. Let Command find out what that feels like.)', 4.4, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
        result = 'keep';
      }
    }, { canSkip: false });
    if (this.folder3 && this.folder3.parent) this.folder3.parent.remove(this.folder3);
    Object.assign(p.h.a, { sit: 0, offer: 0 });
    this.choice3 = result;
    if (result === 'keep') return result;
    p.equip('rifle', true);
    g.hud.updateWeapon(p);
    this.endCutscene({ yaw: Math.atan2(-(this.roadPoint(SITES.camp + 30).x - p.position.x), -(this.roadPoint(SITES.camp + 30).z - p.position.z)) });
    g.hud.setObjective(result === 'warn' ? 'Warn Command at Hollin Ridge' : 'Take the plans to Hollin Ridge');
    return result;
  },

  // ---------- Kharzan checkpoint ----------
  async encounterCheckpoint() {
    const g = this.g, p = g.player, R = g.roadside, A = g.audio, K = g.kfort;
    await this.until(() => this.roadS() > SITES.checkpoint - 80 && p.alive);
    // the cell lamp becomes the checkpoint lantern
    if (K.lampLight) {
      this.cpLamp = K.lampLight;
      this.cpLamp.removeFromParent(); g.scene.add(this.cpLamp);
      this.cpLamp.color.set(0xffb060); this.cpLamp.distance = 14; this.cpLamp.decay = 1.6; this.cpLamp.intensity = 7;
      this.cpLamp.position.copy(R.lanternPos);
      K.lampOn = false;
    }
    const F = R.checkpoint;
    const at = (fwd, side) => this.ground(F.p.x + F.f.x * fwd + F.r.x * side, F.p.z + F.f.z * fwd + F.r.z * side);
    const face = F.p.clone().addScaledVector(F.f, -30);
    const spawn = () => {
      const list = [
        this.spawnEnemy(at(0.2, -4.2), { role: 'idle', holdFire: true, name: 'Kharzan Sentry', accuracy: 0.24 }),
        this.spawnEnemy(at(0.2, 4.4), { role: 'idle', holdFire: true, weapon: 'lmg', name: 'Kharzan Gunner', accuracy: 0.16, damage: 9 }),
        this.spawnEnemy(at(2.6, -1.6), { role: 'idle', holdFire: true, coat: true, name: 'Kharzan Sergeant', accuracy: 0.24 }),
        this.spawnEnemy(at(4.5, 6.5), { role: 'idle', holdFire: true, name: 'Kharzan Soldier', accuracy: 0.22 }),
        this.spawnEnemy(at(5.5, -7.5), { role: 'idle', holdFire: true, name: 'Kharzan Soldier', accuracy: 0.22 }),
      ];
      for (const e of list) { e.lookAt = face.clone().add(V(0, 1.5, 0)); e.faceYaw = F.yaw + Math.PI; }
      // the two behind the sandbags fight from cover
      list[0].coverSpot = { pos: at(0.2, -4.2), face: face.clone() };
      list[1].coverSpot = { pos: at(0.2, 4.4), face: face.clone() };
      return list;
    };
    const fightP = this.fight(spawn, () => this.roadPoint(SITES.checkpoint - 60));
    const enemies = this.liveEnemies();
    await this.until(() => enemies.some((e) => !e.alive || e.hp < e.maxHp) || p.position.distanceTo(F.p) < 42);
    if (enemies[2].alive) this.bark('Kharzan Sergeant', 'Hesk! Velmori — tarak, tarak!', COL.enemy, 2.4, 'kharzan', 'shout');
    A.setMood('combat');
    for (const e of enemies) {
      e.holdFire = false; e.faceYaw = null; e.alerted = true;
      e.role = e.coverSpot ? 'defender' : 'assault';
    }
    await fightP;
    if (this.cpLamp) this.cpLamp.intensity = 5;
  },

  // ---------- bandit ambush in the narrows ----------
  async encounterNarrows() {
    const g = this.g, p = g.player, A = g.audio;
    await this.until(() => this.roadS() > SITES.narrows - 30 && p.alive);
    const N = SITES.narrows;
    const spawn = () => [
      this.spawnBandit(this.roadPoint(N + 6, -9), { name: 'Bandit Chief', hp: 130, helmet: 'flared', accuracy: 0.26 }),
      this.spawnBandit(this.roadPoint(N + 2, 10), {}),
      this.spawnBandit(this.roadPoint(N + 14, 8), { helmet: 'brodie' }),
      this.spawnBandit(this.roadPoint(N - 6, -11), {}),
      this.spawnBandit(this.roadPoint(N + 10, -3), { weapon: 'sword' }),
      this.spawnBandit(this.roadPoint(N - 2, 6), { weapon: 'sword' }),
    ];
    const fightP = this.fight(spawn, () => this.roadPoint(N - 45));
    const enemies = this.liveEnemies();
    for (const e of enemies) e.lookAt = this.headOf(p);
    this.bark('Bandit Chief', 'There he is — the courier! The greycoats pay gold for that satchel!', COL.bandit, 3.6, 'bandit', 'shout');
    A.setMood('combat');
    await this.wait(1.6);
    if (enemies[1].alive) this.bark('Bandit', 'Cut him off!', COL.bandit, 1.6, 'bandit2', 'shout');
    for (const e of enemies) { e.holdFire = false; e.role = e.weaponType === 'sword' ? 'melee' : 'assault'; e.alerted = true; }
    await fightP;
    this.bark('You', 'Kharzan bounties on couriers… just like the plans said.', COL.you, 3, 'you', 'breathless');
  },

  // ---------- Hollin Ridge ----------
  async arriveHQ(choice) {
    const g = this.g, p = g.player, H = g.hq, A = g.audio, S = H.spots;
    // the garrison
    this.hqSentries = [-2.4, 2.4].map((sx) => {
      const s = this.spawnAlly(V(H.gateTop.x + sx, H.gateTop.y, H.gateTop.z + 0.3), { name: 'Sentry', helmet: 'brodie', platformY: H.gateTop.y - 0.02, role: 'idle' });
      s.faceYaw = 0; s.holdFire = true; s.invulnerable = true;
      return s;
    });
    this.colonel = this.spawnAlly(S.captain.clone(), { uniform: 'velmoraOfficer', weapon: 'none', name: 'Colonel Ashby', skin: 0xc9967a });
    this.colonel.invulnerable = true; this.colonel.lookAt = S.gateInside;
    this.hqMen = S.gather.slice(0, 6).map((pos, i) => {
      const s = this.spawnAlly(pos.clone(), { name: 'Velmoran Soldier', helmet: i % 2 ? 'brodie' : undefined, role: 'idle' });
      s.holdFire = true; s.invulnerable = true; s.lookAt = H.campfire;
      return s;
    });
    g.effects.addFire(H.campfire, 1);
    g.hud.setObjective(choice === 'warn' ? 'Warn Command at Hollin Ridge' : 'Deliver the plans to Hollin Ridge');
    await this.until(() => p.position.distanceTo(S.gateOutside) < 26 && p.alive);
    this.phaseUpdate = null;
    g.hud.setMarker(null);
    // at the gate
    await this.cutscene(async () => {
      A.setMood('hope');
      p.position.copy(S.gateOutside); p.vel.set(0, 0, 0);
      p.yaw = Math.atan2(S.gateFront.x - p.position.x, S.gateFront.z - p.position.z); p.h.root.rotation.y = p.yaw;
      const s0 = this.hqSentries[0], gt = H.gateTop.clone();
      s0.lookAt = this.headOf(p); s0.aimHold = 1;
      this.shot((t, o) => { o.pos.copy(gt).add(V(-3 + t, -1.2, 9)); o.look.copy(s0.position).add(V(0, 1.4, 0)); o.fov = 40; }, 3.4);
      await this.say('Sentry', 'Halt! Name and unit!', 2.0, { color: COL.ally, voice: 'sentry1', delivery: 'shout', actor: s0 });
      this.shot((t, o) => { o.pos.copy(p.position).add(V(0.7, 1.55, -1.8)); o.look.copy(gt).add(V(0, 1.2, 0)); o.fov = 46; }, 4);
      await this.say('You', 'Seventh Company. Dispatches from General Morrow, for Command.', 3.6, { color: COL.you, voice: 'you', delivery: 'urgent', actor: p });
      await this.say('Sentry', 'Morrow\'s courier? Open the gate!', 2.4, { color: COL.ally, voice: 'sentry1', delivery: 'shout', actor: s0 });
      s0.aimHold = 0;
      H.openGate();
      this.shot((t, o) => { o.pos.copy(S.gateOutside).add(V(-4, 2.4, 6)); o.look.copy(S.gateFront).add(V(0, 2.5, -4)); o.fov = 50; }, 3);
      await this.wait(3);
    });
    H.openGate();
    this.endCutscene({ yaw: Math.atan2(-(S.gateFront.x - p.position.x), -(S.gateFront.z - p.position.z)) });
    g.hud.setObjective(choice === 'warn' ? 'Warn the Colonel' : 'Report to the Colonel');
    g.hud.setMarker(this.colonel.position.clone().add(V(0, 2.1, 0)));
    let met = false;
    this.addInteract(this.colonel.position.clone(), choice === 'warn' ? 'Warn the Colonel' : 'Hand over the plans', () => { met = true; }, 2.8);
    this.colonel.lookAt = p.position;
    await this.until(() => met && p.alive);
    g.hud.setMarker(null);
    if (choice === 'warn') await this.endingWarn(); else await this.endingSealed();
  },

  // stage the player and the Colonel face to face
  _faceColonel() {
    const g = this.g, p = g.player, C = this.colonel;
    const cp = C.position.clone();
    p.position.copy(this.ground(cp.x, cp.z + 2.0)); p.vel.set(0, 0, 0);
    p.yaw = Math.PI; p.h.root.rotation.y = p.yaw;
    C.faceYaw = 0; C.lookAt = this.headOf(p);
    p.equip('none', true);
    return { cp, mid: cp.clone().lerp(p.position, 0.5) };
  },

  // ---------- ending A: the seal held ----------
  async endingSealed() {
    const g = this.g, p = g.player, C = this.colonel, A = g.audio, u = g.post.u, H = g.hq;
    await this.cutscene(async () => {
      const { mid } = this._faceColonel();
      this.folder3 = this.folder3 || FOLDER();
      p.h.handR.add(this.folder3);
      this.tween(p.h.a, 'offer', 0.8, 1.0);
      this.shot((t, o) => { o.pos.copy(mid).add(V(3.4 - t * 0.4, 1.55, 0)); o.look.copy(mid).add(V(0, 1.4, 0)); o.fov = 44; }, 6);
      await this.say('You', 'From General Morrow, sir. For Command\'s eyes only.', 3.2, { color: COL.you, voice: 'you', delivery: 'dry', actor: p });
      p.h.handR.remove(this.folder3); C.h.handR.add(this.folder3);
      this.tween(p.h.a, 'offer', 0, 0.6);
      this.shot((t, o) => { o.look.copy(this.faceCam(C, o.pos, 1.25, 0.35, 0.0)); o.fov = 36; }, 6);
      await this.say('Colonel Ashby', 'Morrow. Of course. Put it with the others — Command will read it in the morning.', 5.0, { color: COL.colonel, voice: 'colonel', delivery: 'dry', actor: C });
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.2, -0.3, 0.02)); o.fov = 36; }, 3);
      await this.say('You', 'Sir, the General said it was—', 2.2, { color: COL.you, voice: 'you', delivery: 'urgent', actor: p });
      this.shot((t, o) => { o.look.copy(this.faceCam(C, o.pos, 1.2, -0.3, 0.0)); o.fov = 36; }, 6);
      await this.say('Colonel Ashby', 'Everything Morrow sends is urgent, soldier. Get some food. Get some sleep. You\'ve earned it.', 5.0, { color: COL.colonel, voice: 'colonel', delivery: 'warm', actor: C });
      this.tween(u.uFade, 'value', 1, 2.5);
      await this.wait(2.8);
      // before dawn
      C.h.handR.remove(this.folder3);
      p.position.copy(H.spots.campfireSeats[0]); p.yaw = 0.6; p.h.root.rotation.y = p.yaw;
      p.h.a.sit = 1;
      g.hud.titleCard('BEFORE DAWN', 'Hollin Ridge', 3.6);
      await this.wait(1.2);
      const fp = H.campfire.clone();
      this.shot((t, o) => { o.pos.copy(fp).add(V(-3.2 + t * 0.5, 1.4, 2.8)); o.look.copy(fp).add(V(0, 0.8, -2)); o.fov = 48; }, 12);
      this.tween(u.uFade, 'value', 0, 2.5);
      await this.wait(3.5);
      // the guns open
      A.shellWhistle(1.3);
      await this.wait(1.3);
      this.hqShell(H.center.clone().add(V(-14, 0, -10)));
      p.h.a.sit = 0;
      A.setMood('combat');
      await this.wait(1.0);
      A.siren(10, 0.07);
      this.bark('Velmoran Soldier', 'KHARZANS! On the walls — they\'re everywhere!', COL.ally, 3, 'soldier', 'panic');
      for (let i = 0; i < 6; i++) setTimeout(() => this.hqShell(H.center.clone().add(V(rand(-25, 25), 0, rand(-25, 25)))), 800 + i * rand(700, 1200));
      this.shot((t, o) => { o.pos.copy(H.center).add(V(-30 + t * 6, 24 - t * 4, 48)); o.look.copy(H.center).add(V(0, 2, -6)); o.fov = 52; }, 8);
      await this.wait(6.5);
      this.tween(u.uFade, 'value', 1, 2.5);
      this.tween(A, 'muffle', 0.6, 2.5);
      await this.wait(2.8);
    }, { canSkip: true });
    this.showEnd({ chapter: 'Chapter III — The Long Road', title: 'THE SEAL HELD', sub: 'You delivered the plans. Nobody read them in time.' });
  },

  // ---------- ending B: warn Command ----------
  async endingWarn() {
    const g = this.g, p = g.player, C = this.colonel, A = g.audio, u = g.post.u, H = g.hq;
    await this.cutscene(async () => {
      const { mid } = this._faceColonel();
      this.shot((t, o) => { o.pos.copy(mid).add(V(3.4 - t * 0.4, 1.55, 0)); o.look.copy(mid).add(V(0, 1.4, 0)); o.fov = 44; }, 5);
      await this.say('You', 'Colonel — the Kharzans are coming. Here, to Hollin Ridge. In two days.', 4.2, { color: COL.you, voice: 'you', delivery: 'urgent', actor: p });
      this.shot((t, o) => { o.look.copy(this.faceCam(C, o.pos, 1.25, 0.35, 0.0)); o.fov = 36; }, 4);
      await this.say('Colonel Ashby', 'And how would a private know that?', 2.6, { color: COL.colonel, voice: 'colonel', delivery: 'dry', actor: C });
      this.folder3 = this.folder3 || FOLDER();
      p.h.handR.add(this.folder3);
      this.tween(p.h.a, 'offer', 0.85, 0.8);
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.3, -0.35, 0.0)); o.fov = 38; }, 5);
      await this.say('You', 'I broke the seal. It\'s all in there. Operation Iron Tide.', 3.6, { color: COL.you, voice: 'you', delivery: 'urgent', actor: p });
      p.h.handR.remove(this.folder3); C.h.handR.add(this.folder3);
      this.tween(p.h.a, 'offer', 0, 0.6);
      this.tween(C.h.a, 'offer', 0.8, 0.8);
      C.lookAt = null;
      const fw = new THREE.Vector3();
      this.shot((t, o) => { this.folder3.getWorldPosition(fw); o.pos.copy(fw).add(V(0.6, 0.5, -0.4)); o.look.copy(this.headOf(C)).lerp(fw, 0.5); o.fov = 38; }, 5);
      await this.wait(2.6);
      await this.say('Colonel Ashby', '…Iron Tide.', 2.0, { color: COL.colonel, voice: 'colonel', delivery: 'grave', actor: C });
      this.shot((t, o) => { o.look.copy(this.faceCam(C, o.pos, 1.5, 0.4, 0.05)); o.fov = 40; }, 5);
      C.lookAt = H.spots.gateInside;
      await this.say('Colonel Ashby', 'Ring the bell! Every man on the walls, every gun on the west road. Now!', 4.0, { color: COL.colonel, voice: 'colonel', delivery: 'shout', actor: C });
      A.bell();
      A.setMood('combat');
      // the fort wakes
      const walls = H.coverSpots;
      this.hqMen.forEach((s, i) => { const c = walls[i % walls.length]; s.goTo(c.pos.clone(), 4.2); s.lookAt = c.face; });
      this.shot((t, o) => { o.pos.copy(H.center).add(V(-18 + t * 4, 9, 22)); o.look.copy(H.center).add(V(0, 1, 6)); o.fov = 52; }, 5);
      await this.wait(4.6);
      this.tween(C.h.a, 'offer', 0, 0.6);
      C.lookAt = this.headOf(p);
      this.shot((t, o) => { o.pos.copy(mid).add(V(-3.0, 1.6, 0.4)); o.look.copy(mid).add(V(0, 1.45, 0)); o.fov = 44; }, 9);
      await this.say('Colonel Ashby', 'You broke a sealed order, soldier. On another night, I\'d have you shot.', 4.4, { color: COL.colonel, voice: 'colonel', delivery: 'grave', actor: C });
      await this.say('Colonel Ashby', 'Tonight… you may have saved every man in this fort. What\'s your name?', 4.4, { color: COL.colonel, voice: 'colonel', delivery: 'warm', actor: C });
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.15, 0.3, 0.02)); o.fov = 34; }, 5);
      await this.say('You', 'I… don\'t know, sir.', 2.6, { color: COL.you, voice: 'you', delivery: 'shaken', actor: p });
      // the walls manned under the planet
      const sky = skyDir(146, 20);
      const top = H.gateTop.clone();
      this.shot((t, o) => { o.pos.copy(top).add(V(-6 + t * 3, 3.5 + t * 6, -8 - t * 6)); o.look.copy(top).addScaledVector(sky, 80).lerp(top, 0.55 - t * 0.3); o.fov = 54; }, 10);
      await this.wait(8);
      this.tween(u.uFade, 'value', 1, 2.5);
      await this.wait(2.8);
    }, { canSkip: true });
    this.showEnd({ chapter: 'Chapter III — The Long Road', title: 'HOLLIN RIDGE STANDS READY', sub: 'You broke the seal. When the guns open, the walls will be manned.' });
  },

  // ---------- ending C: keep the secret ----------
  async endingKeep() {
    const g = this.g, p = g.player, A = g.audio, u = g.post.u, K = g.kfort;
    await this.cutscene(async () => {
      // stand, look back down the road toward the keep
      p.h.a.sit = 0;
      const back = this.roadPoint(SITES.camp - 40);
      p.yaw = Math.atan2(back.x - p.position.x, back.z - p.position.z); p.h.root.rotation.y = p.yaw;
      p.equip('rifle', true);
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.6 - t * 0.3, 0.4, 0.05)); o.fov = 40; }, 4);
      await this.wait(2.5);
      this.tween(u.uFade, 'value', 1, 2.0);
      await this.wait(2.2);
      // two nights later, back at the keep
      if (this.campLight) this.campLight.intensity = 0;
      this.phaseUpdate = null;
      g.effects.emitters.length = 0;
      K.ignite(g.effects, 0);
      for (const f of K.spots.fires.slice(0, 4)) g.effects.addFire(f.p.clone().setY(f.p.y + 0.4), 0.8); // embers
      const S = K.spots;
      this.general = this.spawnAlly(S.general.clone(), { uniform: 'velmoraOfficer', weapon: 'none', name: 'General Morrow', skin: 0xd2a07f });
      this.aide = this.spawnAlly(this.kp(-4, -60), { name: 'Aide', helmet: 'brodie', role: 'idle' });
      for (const s of [this.general, this.aide]) { s.holdFire = true; s.invulnerable = true; }
      const Gn = this.general;
      const gp = Gn.position.clone();
      const toRoad = this.roadPoint(30).sub(gp).setY(0).normalize();
      const side = V(-toRoad.z, 0, toRoad.x);
      p.position.copy(this.ground(gp.x + toRoad.x * 2.2, gp.z + toRoad.z * 2.2)); p.vel.set(0, 0, 0);
      p.yaw = Math.atan2(gp.x - p.position.x, gp.z - p.position.z); p.h.root.rotation.y = p.yaw;
      Gn.lookAt = this.headOf(p); Gn.faceYaw = Math.atan2(p.position.x - gp.x, p.position.z - gp.z);
      g.hud.titleCard('TWO NIGHTS LATER', 'Kharsk Keep', 3.6);
      await this.wait(1.5);
      this.tween(u.uFade, 'value', 0, 2.5);
      const mid = gp.clone().lerp(p.position, 0.5);
      this.shot((t, o) => { o.pos.copy(mid).addScaledVector(side, 3.8 - t * 0.5).add(V(0, 1.6, 0)); o.look.copy(mid).add(V(0, 1.45, 0)); o.fov = 44; }, 9);
      await this.wait(2.6);
      await this.say('General Morrow', 'Back already, Seventh? Command has the plans?', 3.4, { color: COL.general, voice: 'general', delivery: 'dry', actor: Gn });
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 1.2, 0.3, 0.02)); o.fov = 34; }, 4);
      await this.say('You', 'Delivered, sir. Into the Colonel\'s own hands.', 3.0, { color: COL.you, voice: 'you', delivery: 'dry', actor: p });
      this.shot((t, o) => { o.look.copy(this.faceCam(Gn, o.pos, 1.25, -0.3, 0.0)); o.fov = 36; }, 4);
      await this.say('General Morrow', 'Good. Then we\'ve done our part.', 2.6, { color: COL.general, voice: 'general', delivery: 'dry', actor: Gn });
      this.shot((t, o) => { o.look.copy(this.faceCam(p, o.pos, 0.95, -0.2, -0.04)); o.fov = 30; }, 5);
      await this.say('You', '(The folder\'s still inside my coat. The seal\'s still broken.)', 4.0, { color: COL.you, italic: true, voice: 'youThought', delivery: 'thought', speak: false });
      // the news
      const aide = this.aide;
      aide.goTo(this.ground(gp.x + side.x * 1.6, gp.z + side.z * 1.6), 4.6);
      A.footstep('dirt', aide.position, 1.2);
      this.shot((t, o) => { o.pos.copy(mid).addScaledVector(side, -4).add(V(0, 1.7, 0)); o.look.copy(this.headOf(aide)); o.fov = 46; }, 4.5);
      await this.wait(2.6);
      aide.lookAt = this.headOf(Gn);
      await this.say('Aide', 'General! Signal from Hollin Ridge — the Kharzans hit them at dawn. They\'re gone, sir. Nobody saw it coming.', 6.0, { color: COL.ally, voice: 'soldier', delivery: 'panic', actor: aide });
      A.setMood('sad');
      Gn.lookAt = this.headOf(p);
      this.shot((t, o) => { o.look.copy(this.faceCam(Gn, o.pos, 1.3 - t * 0.35, 0.25, 0.0)); o.fov = 32; }, 7);
      await this.wait(1.6);
      await this.say('General Morrow', '…Nobody saw it coming.', 3.2, { color: COL.general, voice: 'general', delivery: 'grave', actor: Gn });
      await this.wait(1.6);
      this.tween(u.uFade, 'value', 1, 3);
      await this.wait(3.2);
    }, { canSkip: true });
    this.showEnd({ chapter: 'Chapter III — The Long Road', title: 'HOLLIN RIDGE BURNS', sub: 'You kept the secret. Now the secret keeps you.' });
  },

  hqShell(pos) {
    const g = this.g, A = g.audio;
    pos.y = g.terrain.getHeight(pos.x, pos.z);
    g.effects.explosion(pos, 1.1);
    A.explosion(pos);
    g.rig.addTrauma(Math.max(0.15, 1 - pos.distanceTo(g.camera.position) / 50));
  },
};
