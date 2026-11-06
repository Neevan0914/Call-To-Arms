import * as THREE from 'three';
import { clamp, lerp, easeInOut } from '../core/utils.js';

// Sabre combat: a four-hit combo (slash -> backhand -> spinning slash -> flip slam),
// a spinning air attack, and an acrobatic flip-jump. Each move is a timeline that drives
// the rig (sword pose, blade twirl, body spin, flip + tuck) and lists its hit windows.

const TAU = Math.PI * 2;
const ease = easeInOut;
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const smooth = (x) => x * x * (3 - 2 * x);
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

// Sword pose keyframes in chest space: p = grip position, r = euler (blade along +Z).
const GUARD = { p: [-0.21, -0.32, 0.25], r: [-0.75, 0.15, 0.0] };
function keys(t, list) {
  let i = 0;
  while (i < list.length - 2 && t > list[i + 1].t) i++;
  const a = list[i], b = list[i + 1];
  const k = smooth(seg(t, a.t, b.t));
  return { p: lerp3(a.p, b.p, k), r: lerp3(a.r, b.r, k), tw: lerp(a.tw || 0, b.tw || 0, k) };
}

export const MOVES = {
  slash: {
    dur: 0.52, sound: [0.18],
    hits: [{ at: 0.44, range: 2.7, arc: 130, dmg: 50, knock: 2.5 }],
    lunge: [[0.25, 0.5, 4.5]],
    pose(t) {
      const k = keys(t, [
        { t: 0, ...GUARD },
        { t: 0.3, p: [-0.3, 0.22, 0.02], r: [-2.4, 0.7, 0.4], tw: 0.45 },
        { t: 0.55, p: [0.12, -0.18, 0.4], r: [0.25, -1.2, -0.5], tw: -0.6 },
        { t: 1, ...GUARD },
      ]);
      return { ...k, twirl: TAU * ease(seg(t, 0.0, 0.3)), crouch: 0.25 * Math.sin(Math.PI * seg(t, 0.25, 0.8)) };
    },
  },
  backhand: {
    dur: 0.52, sound: [0.18],
    hits: [{ at: 0.44, range: 2.7, arc: 130, dmg: 50, knock: 2.5 }],
    lunge: [[0.25, 0.5, 4.5]],
    pose(t) {
      const k = keys(t, [
        { t: 0, ...GUARD },
        { t: 0.3, p: [0.12, 0.18, 0.12], r: [-2.0, -0.9, -0.5], tw: -0.45 },
        { t: 0.55, p: [-0.36, -0.12, 0.34], r: [0.1, 1.15, 0.5], tw: 0.55 },
        { t: 1, ...GUARD },
      ]);
      return { ...k, twirl: -TAU * ease(seg(t, 0.0, 0.3)), crouch: 0.25 * Math.sin(Math.PI * seg(t, 0.25, 0.8)) };
    },
  },
  spin: {
    // full-body 360 with the blade held out: hits everything around
    dur: 0.82, sound: [0.2, 0.48],
    hits: [{ at: 0.42, range: 3.0, arc: 360, dmg: 42, knock: 4 }, { at: 0.66, range: 3.0, arc: 360, dmg: 42, knock: 4 }],
    lunge: [[0.15, 0.7, 2.5]],
    pose(t) {
      const out = { p: [-0.5, 0.05, 0.28], r: [-0.05, -1.25, -0.2] };
      const k = keys(t, [
        { t: 0, ...GUARD },
        { t: 0.16, ...out },
        { t: 0.8, ...out },
        { t: 1, ...GUARD },
      ]);
      return { ...k, spin: -TAU * ease(seg(t, 0.14, 0.8)), twirl: TAU * ease(seg(t, 0.8, 1)), crouch: 0.45 * Math.sin(Math.PI * seg(t, 0.05, 0.95)) };
    },
  },
  flip: {
    // crouch, leap into a tucked front flip, slam the blade down on landing
    dur: 1.1, sound: [0.2, 0.62],
    hits: [{ at: 0.78, range: 3.4, arc: 360, dmg: 85, knock: 7, slam: true }],
    jump: { at: 0.17, vy: 6.6, fwd: 5.5 },
    pose(t) {
      const k = keys(t, [
        { t: 0, ...GUARD },
        { t: 0.17, p: [-0.12, 0.34, -0.06], r: [-2.75, 0.05, 0.0] },
        { t: 0.66, p: [-0.12, 0.34, -0.06], r: [-2.75, 0.05, 0.0] },
        { t: 0.78, p: [0.0, -0.3, 0.42], r: [0.75, 0.0, 0.0] },
        { t: 0.9, p: [0.0, -0.3, 0.42], r: [0.75, 0.0, 0.0] },
        { t: 1, ...GUARD },
      ]);
      const ft = seg(t, 0.19, 0.68);
      return {
        ...k,
        flip: TAU * ease(ft),
        tuck: Math.sin(Math.PI * ft),
        twirl: TAU * 2 * ease(seg(t, 0.2, 0.62)),
        crouch: 0.75 * Math.sin(Math.PI * 0.5 * seg(t, 0, 0.17)) * (1 - seg(t, 0.17, 0.24)) + 0.7 * Math.sin(Math.PI * seg(t, 0.74, 1)),
      };
    },
  },
  aerial: {
    // in the air: spin with the blade out
    dur: 0.62, sound: [0.12, 0.34],
    hits: [{ at: 0.45, range: 2.8, arc: 360, dmg: 45, knock: 3.5 }],
    pose(t) {
      const out = { p: [-0.5, 0.1, 0.25], r: [-0.25, -1.2, -0.3] };
      const k = keys(t, [{ t: 0, ...GUARD }, { t: 0.12, ...out }, { t: 0.82, ...out }, { t: 1, ...GUARD }]);
      return { ...k, spin: -TAU * ease(seg(t, 0.08, 0.85)), twirl: TAU * ease(seg(t, 0.82, 1)), tuck: 0.5 * Math.sin(Math.PI * t) };
    },
  },
  flipJump: {
    // acrobatic jump: front flip when moving, back flip when standing
    dur: 0.95, sound: [],
    hits: [],
    jump: { at: 0.05, vy: 6.4, fwd: 0 },
    pose(t, dir = 1) {
      const ft = seg(t, 0.08, 0.78);
      return { ...GUARD, p: GUARD.p, r: GUARD.r, flip: dir * TAU * ease(ft), tuck: Math.sin(Math.PI * ft), twirl: dir * TAU * ease(ft), crouch: 0.6 * Math.sin(Math.PI * seg(t, 0.78, 1)) };
    },
  },
};

const COMBO = ['slash', 'backhand', 'spin', 'flip'];

export class SwordPlay {
  constructor(player) {
    this.p = player;
    this.move = null;   // { name, def, t, hitsDone, dir, yaw }
    this.step = 0;
    this.queued = false;
    this.comboTimer = 0;
    this._v = new THREE.Vector3();
  }

  get active() { return !!this.move; }
  get locksFacing() { return !!this.move; }

  // input: attack pressed / jump pressed
  update(dt, { attack, jump, moving, onGround }) {
    const P = this.p, g = P.game;
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.step = 0; }
    if (!this.move) {
      if (attack) this.start(onGround ? COMBO[this.step] : 'aerial');
      else if (jump && onGround) this.start('flipJump', moving ? 1 : -1);
    } else if (attack) {
      if (this.move.name === 'flipJump') this.start('aerial');
      else if (this.move.t > 0.4 && this.move.name !== 'aerial') this.queued = true;
    }
    if (!this.move) return;
    const M = this.move, def = M.def;
    const prevT = M.t;
    M.t += dt / def.dur;
    const t = Math.min(1, M.t);
    // sound cues
    for (const s of def.sound) if (prevT < s && t >= s) g.audio.swing();
    // jump impulse
    if (def.jump && prevT < def.jump.at && t >= def.jump.at && P.onGround) {
      P.vy = def.jump.vy;
      P.onGround = false;
      if (def.jump.fwd) { P.vel.x += Math.sin(M.yaw) * def.jump.fwd; P.vel.z += Math.cos(M.yaw) * def.jump.fwd; }
    }
    // lunges
    if (def.lunge) for (const [a, b, sp] of def.lunge) {
      if (t > a && t < b) { const k = sp * dt; P.position.x += Math.sin(M.yaw) * k; P.position.z += Math.cos(M.yaw) * k; }
    }
    // hits
    def.hits.forEach((h, i) => {
      if (!M.hitsDone[i] && t >= h.at) { M.hitsDone[i] = true; this.strike(h, M.yaw); }
    });
    // pose -> rig
    const pose = def.pose(t, M.dir);
    const a = P.h.a;
    a.swordOverride = pose;
    a.flip = pose.flip || 0;
    a.tuck = pose.tuck || 0;
    a.twirl = pose.twirl || 0;
    a.moveCrouch = pose.crouch || 0;
    P.spinYaw = pose.spin || 0;
    if (M.t >= 1) this.finish();
  }

  start(name, dir = 1) {
    const P = this.p;
    const def = MOVES[name];
    const cam = P.game.rig;
    // face where the camera looks at the start of the move
    const yaw = Math.atan2(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
    P.yaw = yaw;
    this.move = { name, def, t: 0, hitsDone: [], dir, yaw };
    this.queued = false;
    if (COMBO.includes(name)) this.step = (COMBO.indexOf(name) + 1) % COMBO.length;
  }

  finish() {
    const a = this.p.h.a;
    const wasCombo = COMBO.includes(this.move.name);
    this.move = null;
    a.swordOverride = null; a.flip = 0; a.tuck = 0; a.twirl = 0; a.moveCrouch = 0;
    this.p.spinYaw = 0;
    if (this.queued && wasCombo) { this.queued = false; this.start(COMBO[this.step]); return; }
    this.comboTimer = 0.45;
  }

  cancel() { if (this.move) { this.queued = false; this.finish(); this.step = 0; } }

  strike(h, yaw) {
    const P = this.p, g = P.game;
    const fwd = this._v.set(Math.sin(yaw), 0, Math.cos(yaw));
    const cosArc = Math.cos((h.arc / 2) * Math.PI / 180);
    let hits = 0;
    for (const a of g.actors) {
      if (a === P || !a.alive || a.faction === P.faction) continue;
      const d = new THREE.Vector3().subVectors(a.position, P.position);
      if (Math.abs(d.y) > 2.2) continue;
      d.y = 0;
      const dist = d.length();
      if (dist > h.range) continue;
      d.normalize();
      if (h.arc < 360 && d.dot(fwd) < cosArc) continue;
      const pt = a.aimPoint(new THREE.Vector3());
      const killed = a.takeDamage(h.dmg, P, pt, d.clone(), 'chest', true);
      if (a.knockback) a.knockback(d, h.knock);
      g.audio.slash(pt);
      g.hud.hitmarker(killed);
      hits++;
    }
    if (h.slam) {
      const at = P.position.clone();
      g.effects.slam(at);
      g.audio.slam(at);
      g.rig.addTrauma(0.55);
    } else if (hits) g.rig.addTrauma(0.15 + 0.05 * hits);
  }
}
