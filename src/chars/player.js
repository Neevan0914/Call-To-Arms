import * as THREE from 'three';
import { Humanoid, UNIFORMS } from './humanoid.js';
import { WEAPONS, buildRifle, buildLMG, buildSword, buildScabbard } from './weapons.js';
import { clamp, damp, dampAngle, rand } from '../core/utils.js';
import { BOUND } from '../world/terrain.js';

export class Player {
  constructor(game) {
    this.game = game;
    const T = game.T;
    this.isPlayer = true;
    this.faction = 'velmora';
    this.name = 'You';
    this.h = new Humanoid(UNIFORMS.player, T, { seed: 0.4242, skin: 0xd9a983, model: game.modelFor('player') });
    game.scene.add(this.h.root);
    this.position = this.h.root.position;
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.yaw = Math.PI;
    this.hp = 100; this.maxHp = 100;
    this.alive = true;
    this.invulnerable = false;
    this.lastHurt = -10;
    this.weapons = {
      rifle: { has: false, mag: 0, reserve: 0 },
      sword: { has: true },
      lmg: { has: false, mag: 0, reserve: 0 },
    };
    this.current = 'none';
    this.models = {
      rifle: buildRifle(T), lmg: buildLMG(T), sword: buildSword(T),
      rifleBack: buildRifle(T), lmgBack: buildLMG(T), swordSheath: buildSword(T),
    };
    const scab = buildScabbard(T);
    scab.rotation.x = 2.55;
    this.h.hipMount.add(scab);
    this.models.swordSheath.rotation.x = 2.55;
    this.h.hipMount.add(this.models.swordSheath);
    this.fireCd = 0;
    this.reloadT = -1;
    this.swingT = -1;
    this.swingVariant = 0;
    this.meleeDone = false;
    this.sinceShot = 10;
    this.bloom = 0;
    this.aiming = false;
    this.sprinting = false;
    this.stats = { kills: 0, shots: 0, hits: 0, start: performance.now() };
    this._stepPhase = 0;
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.radius = 0.35;
    this.equip('none', true);
  }

  aimPoint(out = new THREE.Vector3()) { return this.h.chestWorld(out); }
  get crouched() { return this.h.a.crouch > 0.5; }

  speedXZ() { return Math.hypot(this.vel.x, this.vel.z); }

  equip(id, silent = false) {
    if (id !== 'none' && !this.weapons[id]?.has) return;
    if (this.reloadT >= 0) { this.reloadT = -1; this.h.a.reload = -1; }
    this.current = id;
    this.swingT = -1;
    this.h.a.swing = -1;
    this.h.setWeaponModel(id === 'none' ? null : this.models[id]);
    this.h.setBackModel(this.weapons.rifle.has && id !== 'rifle' ? this.models.rifleBack : null, 0);
    this.h.setBackModel(this.weapons.lmg.has && id !== 'lmg' ? this.models.lmgBack : null, 1);
    this.models.swordSheath.visible = id !== 'sword';
    if (!silent) this.game.audio.pickup();
    this.game.hud?.updateWeapon(this);
  }

  give(id, mag = 0, reserve = 0) {
    const w = this.weapons[id];
    w.has = true;
    if ('mag' in w) { w.mag = mag; w.reserve = reserve; }
    this.equip(id);
  }

  cycleWeapon(dir) {
    const order = ['rifle', 'sword', 'lmg'].filter((k) => this.weapons[k].has);
    if (!order.length) return;
    let i = order.indexOf(this.current);
    i = (i + dir + order.length) % order.length;
    this.equip(order[i]);
  }

  takeDamage(amount, from, point, dir) {
    if (!this.alive) return false;
    if (this.invulnerable) { this.h.a.hurt = 0.6; return false; }
    const g = this.game;
    this.hp -= amount * g.settings.damageScale;
    this.lastHurt = g.time;
    this.h.a.hurt = 1;
    g.hud.damage(from ? from.position : null);
    g.audio.grunt(null, 1.1);
    g.rig.addTrauma(0.25);
    if (point && dir) g.effects.blood(point, dir);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(from);
      return true;
    }
    return false;
  }

  die(from) {
    this.alive = false;
    this.h.a.dead = true;
    this.h.a.deathT = 0;
    this.h.a.deathDir = -1;
    this.aiming = false;
    this.game.story.onPlayerDeath(from);
  }

  revive(pos, yaw) {
    this.alive = true;
    this.hp = this.maxHp;
    this.h.a.dead = false;
    this.h.a.deathT = 0;
    this.h.body.rotation.x = 0;
    this.position.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.h.root.rotation.y = yaw;
    this.reloadT = -1; this.h.a.reload = -1;
    this.swingT = -1; this.h.a.swing = -1;
  }

  update(dt) {
    const g = this.game, inp = g.input, h = this.h;
    const ctrl = g.controlsEnabled && this.alive;
    this.sinceShot += dt;
    if (!this.alive) {
      h.a.speed = 0;
      this.vel.set(0, 0, 0);
      this.position.y = g.terrain.getHeight(this.position.x, this.position.z);
      h.update(dt);
      return;
    }
    // regen
    if (g.time - this.lastHurt > 4.5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 16 * dt);

    const def = WEAPONS[this.current];
    const isGun = this.current === 'rifle' || this.current === 'lmg';
    // ---- input ----
    let mx = 0, mz = 0;
    if (ctrl) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) mz += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) mz -= 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) mx -= 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) mx += 1;
      if (inp.wasPressed('Digit1')) this.equip('rifle');
      if (inp.wasPressed('Digit2')) this.equip('sword');
      if (inp.wasPressed('Digit3')) this.equip('lmg');
      if (inp.mouse.wheel) this.cycleWeapon(inp.mouse.wheel > 0 ? 1 : -1);
      if (inp.wasPressed('KeyC') || inp.wasPressed('ControlLeft')) this.crouchToggle = !this.crouchToggle;
    }
    const moving = mx !== 0 || mz !== 0;
    this.aiming = ctrl && inp.mouse.right && isGun && this.reloadT < 0;
    this.sprinting = ctrl && inp.down('ShiftLeft') && mz > 0 && !this.aiming && this.swingT < 0;
    if (this.sprinting) this.crouchToggle = false;
    const crouch = this.crouchToggle ? 1 : 0;
    h.a.crouch = damp(h.a.crouch, crouch, 10, dt);
    let speed = 0;
    if (moving) speed = this.aiming ? 2.2 : this.sprinting ? 6.4 : 3.9;
    if (crouch) speed *= 0.5;
    const rig = g.rig;
    const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw);
    const rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
    let wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const accel = this.onGround ? 11 : 2;
    this.vel.x = damp(this.vel.x, wx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * speed, accel, dt);
    if (ctrl && inp.wasPressed('Space') && this.onGround && h.a.crouch < 0.3) { this.vy = 5.2; this.onGround = false; }
    this.vy -= 18 * dt;
    this.position.x += this.vel.x * dt;
    this.position.z += this.vel.z * dt;
    this.position.y += this.vy * dt;
    g.physics.resolve(this.position, this.radius);
    g.separate(this, this.radius);
    this.position.x = clamp(this.position.x, -BOUND, BOUND);
    this.position.z = clamp(this.position.z, -BOUND, BOUND);
    const gy = g.terrain.getHeight(this.position.x, this.position.z);
    if (this.position.y <= gy) {
      if (!this.onGround && this.vy < -4) g.audio.footstep(this.surface(), null, 1.4);
      this.position.y = gy; this.vy = 0; this.onGround = true;
    } else if (this.position.y > gy + 0.05 && this.vy <= 0 && this.onGround) {
      // stick to ground on slopes
      if (this.position.y - gy < 0.4) this.position.y = gy; else this.onGround = false;
    }

    // ---- facing ----
    const camFacing = Math.atan2(fx, fz);
    const sp = this.speedXZ();
    let target = this.yaw;
    if (this.aiming || this.sinceShot < 1.2 || this.swingT >= 0 || (this.current !== 'none' && ctrl && inp.mouse.left)) target = camFacing;
    else if (sp > 0.3) target = Math.atan2(this.vel.x, this.vel.z);
    this.yaw = dampAngle(this.yaw, target, this.aiming || this.swingT >= 0 ? 22 : 10, dt);
    h.root.rotation.y = this.yaw;

    h.a.speed = sp;
    const wantAim = this.aiming ? 1 : isGun && this.sinceShot < 0.7 ? 0.85 : 0;
    h.a.aim = damp(h.a.aim, wantAim, 14, dt);
    h.a.pitch = damp(h.a.pitch, wantAim > 0 || this.swingT >= 0 ? rig.pitch + 0.03 : 0, 12, dt);

    // ---- weapons ----
    this.fireCd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    if (isGun) {
      const w = this.weapons[this.current];
      if (this.reloadT >= 0) {
        this.reloadT += dt / def.reload;
        h.a.reload = this.reloadT;
        if (this.reloadT >= 1) {
          const need = def.mag - w.mag;
          const take = Math.min(need, w.reserve);
          w.mag += take; w.reserve -= take;
          this.reloadT = -1; h.a.reload = -1;
          g.hud.updateWeapon(this);
        }
      }
      if (ctrl) {
        const want = def.auto ? inp.mouse.left : inp.mouse.leftPressed;
        if (want && this.fireCd <= 0 && this.reloadT < 0) {
          if (w.mag > 0) this.shoot(def, w);
          else if (inp.mouse.leftPressed) {
            g.audio.dryFire();
            this.fireCd = 0.25;
            if (w.reserve > 0) this.startReload(def);
            else g.hud.notify(`${def.short} — out of ammunition`);
          }
        }
        if (inp.wasPressed('KeyR') && w.mag < def.mag && w.reserve > 0 && this.reloadT < 0) this.startReload(def);
      }
    } else if (this.current === 'sword') {
      if (ctrl && inp.mouse.leftPressed && this.swingT < 0) {
        this.swingT = 0;
        this.swingVariant = 1 - this.swingVariant;
        h.a.swingVariant = this.swingVariant;
        this.meleeDone = false;
        g.audio.swing();
      }
      if (this.swingT >= 0) {
        this.swingT += dt / def.swing;
        h.a.swing = Math.min(1, this.swingT);
        if (!this.meleeDone && this.swingT > 0.42) { this.meleeDone = true; this.meleeHit(def); }
        if (this.swingT >= 1) { this.swingT = -1; h.a.swing = -1; }
      }
    }

    // ---- interaction ----
    g.story.checkInteract(this, ctrl && inp.wasPressed('KeyE'));

    // ---- footsteps ----
    if (sp > 0.5 && this.onGround) {
      const ph = h.a.phase / Math.PI;
      if (Math.floor(ph) !== Math.floor(this._stepPhase)) g.audio.footstep(this.surface(), null, clamp(sp / 5, 0.4, 1.2));
    }
    this._stepPhase = h.a.phase / Math.PI;
    h.update(dt);
  }

  surface() {
    const g = this.game;
    return g.terrain.dirtAt(this.position.x, this.position.z) > 0.5 ? 'dirt' : 'grass';
  }

  startReload(def) {
    this.reloadT = 0;
    this.h.a.reload = 0;
    this.game.audio.reload(def.id);
  }

  shoot(def, w) {
    const g = this.game;
    const cam = g.camera;
    w.mag--;
    this.fireCd = def.fireInterval;
    this.sinceShot = 0;
    this.stats.shots++;
    const dir = this._d;
    cam.getWorldDirection(dir);
    const moveSpread = Math.min(1, this.speedXZ() / 4) * 0.02;
    const spread = (this.aiming ? def.spreadAim : def.spreadHip) + this.bloom + moveSpread;
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    dir.normalize();
    // start the ray at the player's depth so nothing between camera and player is hit
    const origin = this._v.copy(cam.position);
    const toP = new THREE.Vector3().subVectors(this.position, cam.position);
    toP.y += 1.4;
    origin.addScaledVector(dir, Math.max(0, toP.dot(dir) - 0.2));
    const res = g.shootRay(origin, dir, 450, this);
    const muzzle = this.h.muzzleWorld(new THREE.Vector3());
    const mdir = new THREE.Vector3().subVectors(res.point, muzzle).normalize();
    g.effects.muzzleFlash(muzzle, mdir, def.id === 'lmg');
    g.effects.tracer(muzzle, res.point, def.id === 'lmg' ? 0.6 : 0.35);
    g.audio.shot(def.sound);
    if (def.id === 'rifle' && w.mag > 0) g.audio.boltCycle();
    this.h.a.recoil = 1;
    g.rig.recoil(def.recoil * (this.aiming ? 0.8 : 1.1));
    g.rig.addTrauma(def.id === 'rifle' ? 0.12 : 0.05);
    if (def.auto) this.bloom = Math.min(0.03, this.bloom + 0.004);
    if (res.actor) {
      this.stats.hits++;
      g.hud.hitmarker(res.killed);
      g.audio.hitmarker();
    }
    g.alertEnemies(this.position, 70);
    if (def.id === 'rifle' && w.mag === 0 && w.reserve > 0) setTimeout(() => { if (this.current === 'rifle' && this.reloadT < 0) this.startReload(def); }, 500);
    g.hud.updateWeapon(this);
  }

  meleeHit(def) {
    const g = this.game;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let hitAny = false;
    for (const a of g.actors) {
      if (a === this || !a.alive || a.faction === this.faction) continue;
      const d = this._v.subVectors(a.position, this.position);
      d.y = 0;
      const dist = d.length();
      if (dist > def.range) continue;
      d.normalize();
      if (d.dot(fwd) < 0.3) continue;
      const p = a.aimPoint(new THREE.Vector3());
      const killed = a.takeDamage(def.damage, this, p, fwd, 'chest', true);
      g.audio.slash(p);
      g.hud.hitmarker(killed);
      hitAny = true;
    }
    if (hitAny) g.rig.addTrauma(0.15);
  }
}
