import * as THREE from 'three';
import { Humanoid, UNIFORMS } from './humanoid.js';
import { buildRifle, buildLMG, buildSword } from './weapons.js';
import { clamp, damp, dampAngle, rand, angleDiff } from '../core/utils.js';

let SEED = 1;

export class Soldier {
  constructor(game, opts) {
    this.game = game;
    const T = game.T;
    this.faction = opts.faction;
    this.name = opts.name || (this.faction === 'kharzan' ? 'Kharzan Soldier' : 'Velmoran Soldier');
    this.h = new Humanoid(UNIFORMS[opts.uniform], T, { seed: (SEED++ * 0.6180339) % 1, skin: opts.skin, model: game.modelFor(opts.uniform, { helmet: opts.helmet }) });
    game.scene.add(this.h.root);
    this.position = this.h.root.position;
    this.position.copy(opts.pos);
    this.yaw = opts.yaw ?? 0;
    this.h.root.rotation.y = this.yaw;
    this.hp = opts.hp ?? 100;
    this.maxHp = this.hp;
    this.alive = true;
    this.role = opts.role || 'idle';
    this.weaponType = opts.weapon || 'rifle';
    this.accuracy = opts.accuracy ?? 0.3;
    this.damage = opts.damage ?? 14;
    this.platformY = opts.platformY ?? null;
    this.radius = 0.33;
    this.holdFire = opts.holdFire ?? false;
    this.invulnerable = opts.invulnerable ?? false;
    this.engageMin = rand(7, 13);
    this.engageMax = rand(22, 36);
    this.target = null;
    this.retargetT = rand(0, 0.4);
    this.losT = rand(0, 0.3);
    this.hasLOS = false;
    this.aimT = 0;
    this.fireCd = rand(1.0, 2.5);
    this.route = [];
    this.moveTarget = null;
    this.moveSpeed = 3.5;
    this.strafeT = rand(2, 5);
    this.attackT = -1;
    this.attackCd = 0;
    this.stunT = 0;
    this.crouchT = rand(1, 3);
    this.coverSpot = null;
    this.lookAt = null;
    this.alerted = false;
    this.deadT = 0;
    this.onDeath = opts.onDeath || null;
    this.vel = new THREE.Vector3();
    this.lastPos = this.position.clone();
    this.speedNow = 0;
    this._v = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.setWeapon(this.weaponType);
  }

  setWeapon(type) {
    this.weaponType = type;
    const T = this.game.T;
    let m = null;
    if (type === 'rifle') m = buildRifle(T);
    else if (type === 'bayonet') m = buildRifle(T, { bayonet: true });
    else if (type === 'lmg') m = buildLMG(T);
    else if (type === 'sword') m = buildSword(T);
    this.h.setWeaponModel(m);
    this.isMelee = type === 'bayonet' || type === 'sword';
  }

  aimPoint(out = new THREE.Vector3()) { return this.h.chestWorld(out); }
  get crouched() { return this.h.a.crouch > 0.5; }
  speedXZ() { return this.speedNow; }

  goTo(points, speed = 2.2) {
    this.route = (Array.isArray(points) ? points : [points]).map((p) => p.clone());
    this.moveSpeed = speed;
  }

  takeDamage(amount, from, point, dir, part = 'chest', melee = false) {
    if (!this.alive) return false;
    const g = this.game;
    if (point && dir) {
      g.effects.blood(point, dir);
      g.audio.impact('flesh', point);
    }
    this.h.a.hurt = 1;
    this.alerted = true;
    if (from && from.alive && from.faction !== this.faction) this.target = from;
    if (melee) { this.stunT = 0.55; this.attackT = -1; this.h.a.thrust = -1; }
    if (this.invulnerable) return false;
    this.hp -= amount;
    if (Math.random() < 0.5) g.audio.grunt(this.position.clone().setY(this.position.y + 1.5), rand(0.85, 1.15));
    if (this.hp <= 0) { this.die(from, dir); return true; }
    return false;
  }

  die(from, dir) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    const h = this.h;
    h.a.dead = true; h.a.deathT = 0;
    h.a.crouch = 0;
    // fall away from the hit direction
    if (dir) {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      h.a.deathDir = fwd.dot(dir) > 0 ? 1 : -1;
    } else h.a.deathDir = Math.random() < 0.5 ? 1 : -1;
    // drop weapon
    if (h.weaponModel) {
      const m = h.weaponModel;
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
      m.getWorldPosition(wp);
      h.setWeaponModel(null);
      const gy = this.game.terrain.getHeight(wp.x, wp.z);
      m.position.set(wp.x + rand(-0.4, 0.4), gy + 0.04, wp.z + rand(-0.4, 0.4));
      m.rotation.set(0, rand(0, 6.28), Math.PI / 2);
      this.game.scene.add(m);
      this.droppedWeapon = m;
    }
    this.game.onActorDeath(this, from);
    if (this.onDeath) this.onDeath(this, from);
  }

  _findTarget() {
    const g = this.game;
    let best = null, bd = 160;
    for (const a of g.actors) {
      if (!a.alive || a.faction === this.faction) continue;
      if (a.isPlayer && g.player.hiddenFromAI) continue;
      let d = a.position.distanceTo(this.position);
      if (a === this.target) d *= 0.8; // stickiness
      if (a.isPlayer) d *= 0.85;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  _eye(out) { return out.copy(this.position).setY(this.position.y + (this.h.a.crouch > 0.5 ? 1.05 : 1.55)); }

  update(dt) {
    const g = this.game, h = this.h;
    if (!this.alive) {
      this.deadT += dt;
      if (this.h.a.deathT < 1) h.update(dt);
      return;
    }
    const playerDist = this.position.distanceTo(g.player.position);
    const far = playerDist > 160;
    // ---- perception ----
    this.retargetT -= dt;
    if (this.retargetT <= 0 && this.role !== 'idle' && this.role !== 'scripted') {
      this.retargetT = rand(0.35, 0.6);
      this.target = this._findTarget();
    }
    if (this.target && !this.target.alive) this.target = null;
    this.losT -= dt;
    if (this.target && this.losT <= 0) {
      this.losT = rand(0.2, 0.35);
      this.hasLOS = g.physics.lineOfSight(this._eye(this._a), this.target.aimPoint(this._b));
    }
    if (this.stunT > 0) this.stunT -= dt;

    let wantSpeed = 0;
    let faceTarget = false;
    let aimWant = 0;
    let crouchWant = 0;
    let moveTo = null;

    if (this.route.length) {
      moveTo = this.route[0];
      if (this._distXZ(moveTo) < 0.6) { this.route.shift(); moveTo = this.route[0] || null; }
    }

    const t = this.target;
    const td = t ? this.position.distanceTo(t.position) : Infinity;

    switch (this.role) {
      case 'assault': {
        if (!t) break;
        if (moveTo) {
          wantSpeed = this.moveSpeed;
          if (this.hasLOS && td < 45) { aimWant = 0.3; }
        } else if (!this.hasLOS || td > this.engageMax) {
          moveTo = this._approachPoint(t);
          wantSpeed = td > 30 ? 4.2 : 3.2;
        } else if (td < this.engageMin && Math.random() < 0.01) {
          // hold
        } else {
          faceTarget = true;
          aimWant = 1;
          this.strafeT -= dt;
          if (this.strafeT <= 0) {
            this.strafeT = rand(3, 6.5);
            const side = Math.random() < 0.5 ? -1 : 1;
            const toT = this._v.subVectors(t.position, this.position).setY(0).normalize();
            this.strafePt = this.position.clone().add(new THREE.Vector3(-toT.z * side, 0, toT.x * side).multiplyScalar(rand(2, 4.5)));
          }
          if (this.strafePt && this._distXZ(this.strafePt) > 0.5) { moveTo = this.strafePt; wantSpeed = 1.6; }
        }
        if (t && this.hasLOS && td < 90) { faceTarget = !moveTo || wantSpeed < 2 || td < 25; this._tryFire(dt, t, td); }
        break;
      }
      case 'melee': {
        if (!t) break;
        faceTarget = true;
        if (this.stunT > 0) break;
        if (this.attackT >= 0) {
          this.attackT += dt;
          if (this.attackT > 0.28 && !this.attackHit) {
            this.attackHit = true;
            const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
            const d = this._v.subVectors(t.position, this.position).setY(0);
            if (d.length() < 2.4 && d.normalize().dot(fwd) > 0.45) {
              t.takeDamage(this.damage, this, t.aimPoint(new THREE.Vector3()), fwd);
              g.audio.slash(t.position);
            }
          }
          if (this.attackT > 0.75) { this.attackT = -1; this.attackCd = rand(0.7, 1.3); }
        } else {
          this.attackCd -= dt;
          if (td > 1.7) { moveTo = t.position; wantSpeed = td > 6 ? 5.0 : 3.0; aimWant = 0; }
          else if (this.attackCd <= 0) {
            this.attackT = 0; this.attackHit = false; this.h.a.thrust = 0;
            g.audio.grunt(this.position, 0.9);
          }
        }
        break;
      }
      case 'defender': {
        if (this.coverSpot && !moveTo) {
          if (this._distXZ(this.coverSpot.pos) > 0.6) { moveTo = this.coverSpot.pos; wantSpeed = 4.0; }
        }
        if (!moveTo) {
          this.crouchT -= dt;
          if (this.crouchT <= 0) { this.crouching = !this.crouching; this.crouchT = this.crouching ? rand(1.2, 2.6) : rand(2.0, 4.0); }
          crouchWant = this.crouching ? 1 : 0;
          if (t) {
            faceTarget = true; aimWant = this.crouching ? 0.4 : 1;
            if (!this.crouching && this.hasLOS) this._tryFire(dt, t, td);
          } else if (this.coverSpot) {
            this.lookAt = this.coverSpot.face;
          }
        } else if (t && this.hasLOS && td < 30) { this._tryFire(dt, t, td); }
        break;
      }
      case 'sentry': {
        if (t && td < 110) {
          faceTarget = true; aimWant = 1;
          if (this.hasLOS) this._tryFire(dt, t, td);
        }
        break;
      }
      case 'hold': {
        // waiting for a story trigger; face the target if any
        if (t) { faceTarget = true; aimWant = 0.6; }
        if (moveTo) wantSpeed = this.moveSpeed;
        break;
      }
      default: { // idle / scripted
        if (moveTo) wantSpeed = this.moveSpeed;
        break;
      }
    }

    // ---- movement ----
    let desiredYaw = this.yaw;
    if (moveTo && wantSpeed > 0) {
      const d = this._v.subVectors(moveTo, this.position).setY(0);
      const dist = d.length();
      if (dist > 0.05) {
        d.divideScalar(dist);
        this.vel.x = damp(this.vel.x, d.x * wantSpeed, 8, dt);
        this.vel.z = damp(this.vel.z, d.z * wantSpeed, 8, dt);
        desiredYaw = Math.atan2(d.x, d.z);
      }
    } else {
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
    }
    this.position.x += this.vel.x * dt;
    this.position.z += this.vel.z * dt;
    if (!far) {
      g.physics.resolve(this.position, this.radius);
      g.separate(this, this.radius);
    }
    this.position.y = this.platformY ?? g.terrain.getHeight(this.position.x, this.position.z);
    this.speedNow = Math.hypot(this.position.x - this.lastPos.x, this.position.z - this.lastPos.z) / Math.max(dt, 1e-4);
    this.lastPos.copy(this.position);

    if (faceTarget && t) desiredYaw = Math.atan2(t.position.x - this.position.x, t.position.z - this.position.z);
    else if (this.lookAt && this.speedNow < 0.3 && this.role !== 'assault') {
      desiredYaw = Math.atan2(this.lookAt.x - this.position.x, this.lookAt.z - this.position.z);
    }
    if (this.faceYaw != null && this.speedNow < 0.3) desiredYaw = this.faceYaw;
    this.yaw = dampAngle(this.yaw, desiredYaw, faceTarget ? 9 : 6, dt);
    h.root.rotation.y = this.yaw;

    // ---- anim params ----
    h.a.speed = Math.min(this.speedNow, 7);
    h.a.aim = damp(h.a.aim, aimWant, 6, dt);
    h.a.crouch = damp(h.a.crouch, crouchWant || this.forceCrouch || 0, 6, dt);
    if (faceTarget && t) {
      const tp = t.aimPoint(this._b);
      const e = this._eye(this._a);
      h.a.pitch = damp(h.a.pitch, Math.atan2(tp.y - e.y, Math.hypot(tp.x - e.x, tp.z - e.z)), 6, dt);
      h.a.lookTarget = null;
    } else {
      h.a.pitch = damp(h.a.pitch, 0, 4, dt);
      h.a.lookTarget = this.lookAt;
    }
    if (!far || this.h.root.visible) h.update(dt);
  }

  _distXZ(p) { return Math.hypot(p.x - this.position.x, p.z - this.position.z); }

  _approachPoint(t) {
    // approach with a personal flank offset so groups spread out
    if (!this._flank) this._flank = rand(-1, 1);
    const toT = this._v.subVectors(t.position, this.position).setY(0);
    const d = toT.length();
    toT.normalize();
    const side = new THREE.Vector3(-toT.z, 0, toT.x).multiplyScalar(this._flank * Math.min(8, d * 0.3));
    return this._a.copy(t.position).add(side);
  }

  _tryFire(dt, t, td) {
    if (this.holdFire || this.isMelee || !this.h.weaponModel) return;
    this.aimT += dt;
    this.fireCd -= dt;
    if (this.fireCd > 0 || this.aimT < 0.5 || this.h.a.aim < 0.6) return;
    const lmg = this.weaponType === 'lmg';
    this.fireCd = lmg ? rand(0.09, 0.14) : rand(1.6, 3.2);
    if (lmg) { this.burst = (this.burst || 0) + 1; if (this.burst > 6) { this.burst = 0; this.fireCd = rand(1.2, 2.2); } }
    this.fireAt(t, td);
  }

  fireAt(t, td) {
    const g = this.game, h = this.h;
    const muzzle = h.muzzleWorld(new THREE.Vector3());
    const aim = t.aimPoint(new THREE.Vector3());
    let p = this.accuracy * clamp(1.2 - td / 70, 0.2, 1);
    if (t.speedXZ && t.speedXZ() > 3) p *= 0.7;
    if (t.crouched) p *= 0.55;
    if (t.isPlayer) p *= g.settings.enemyAccuracy;
    const hit = Math.random() < p;
    const dir = new THREE.Vector3().subVectors(aim, muzzle).normalize();
    let end;
    if (hit) {
      end = aim.clone();
      const dmg = t.isPlayer ? this.damage : this.damage * (this.allyDamageScale || 1);
      t.takeDamage(dmg, this, aim, dir);
    } else {
      const miss = aim.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.6, 1.2), rand(-1, 1)).multiplyScalar(rand(0.5, 1.6)));
      const mdir = new THREE.Vector3().subVectors(miss, muzzle).normalize();
      const r = g.physics.raycast(muzzle, mdir, 140);
      end = r ? r.point.clone() : muzzle.clone().addScaledVector(mdir, 140);
      if (r) { g.effects.impact(r.point, r.normal, r.type); if (muzzle.distanceTo(g.player.position) > 4) g.audio.impact(r.type, r.point); }
      // near-miss whiz for the player
      const pp = g.player.position.clone().setY(g.player.position.y + 1.5);
      const seg = new THREE.Line3(muzzle, end);
      const cp = seg.closestPointToPoint(pp, true, new THREE.Vector3());
      if (cp.distanceTo(pp) < 2.5 && t !== g.player || (t === g.player && cp.distanceTo(pp) < 3)) g.audio.whiz(cp);
    }
    g.effects.muzzleFlash(muzzle, dir, this.weaponType === 'lmg');
    g.effects.tracer(muzzle, end, 0.3);
    g.audio.shot(this.weaponType === 'lmg' ? 'lmg' : 'rifle', muzzle);
    h.a.recoil = 1;
  }
}
