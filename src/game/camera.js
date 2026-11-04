import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/utils.js';
import { Simplex2 } from '../core/noise.js';

export class CameraRig {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;
    this.yaw = Math.PI;
    this.pitch = -0.05;
    this.mode = 'free';
    this.aim = 0;
    this.trauma = 0;
    this.kick = 0;
    this.noise = new Simplex2(5);
    this.t = 0;
    this.track = null; // {fn, dur, t}
    this.blend = 0;
    this.blendFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60 };
    this.baseFov = 66;
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._p = new THREE.Vector3(); this._l = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.cutPos = new THREE.Vector3(); this.cutLook = new THREE.Vector3(); this.cutFov = 50;
    this.distScale = 1;
  }

  forward(out = this._f) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  addTrauma(v) { this.trauma = Math.min(1, this.trauma + v); }
  recoil(v) { this.kick += v; }

  setThird(blendTime = 0.8) {
    if (this.mode !== 'third') {
      this.blendFrom.pos.copy(this.camera.position);
      this.blendFrom.quat.copy(this.camera.quaternion);
      this.blendFrom.fov = this.camera.fov;
      this.blend = blendTime > 0 ? 1 : 0;
      this.blendTime = blendTime;
    }
    this.mode = 'third';
    this.track = null;
  }

  // Cutscene camera: fn(t01, out{pos, look, fov}) evaluated over `dur` seconds.
  play(fn, dur) {
    this.mode = 'cutscene';
    this.track = { fn, dur, t: 0 };
    this._applyTrack(0);
  }

  finishTrack() {
    if (this.track) { this.track.t = this.track.dur; this._applyTrack(1); }
  }

  _applyTrack(k) {
    const o = { pos: this.cutPos, look: this.cutLook, fov: this.cutFov };
    this.track.fn(k, o);
    this.cutFov = o.fov;
  }

  faceYawTowards(target, from) {
    const dx = target.x - from.x, dz = target.z - from.z;
    this.yaw = Math.atan2(-dx, -dz);
  }

  update(dt, realDt) {
    this.t += realDt;
    const cam = this.camera;
    const g = this.game;
    const input = g.input;
    const player = g.player;

    if (this.mode === 'third' && player) {
      if (g.controlsEnabled && input.locked) {
        const sens = 0.0021 * input.sensitivity * (this.aim > 0.5 ? 0.6 : 1);
        this.yaw -= input.mouse.dx * sens;
        this.pitch -= input.mouse.dy * sens * (g.settings.invertY ? -1 : 1);
      }
      // recoil kick (recovers)
      this.pitch += this.kick * Math.min(1, dt * 25);
      this.kick -= this.kick * Math.min(1, dt * 25);
      this.pitch = clamp(this.pitch, -1.15, 1.05);
      this.aim = damp(this.aim, player.aiming ? 1 : 0, 12, realDt);
      const crouch = player.h.a.crouch;
      const pivot = this._p.copy(player.position);
      pivot.y += 1.58 - crouch * 0.38;
      const f = this.forward();
      const r = this._r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const sprint = player.sprinting ? 1 : 0;
      this.sprintK = damp(this.sprintK || 0, sprint, 5, realDt);
      const dist = lerp(3.3, 1.85, this.aim) * this.distScale + this.sprintK * 0.3;
      const shoulder = lerp(0.58, 0.72, this.aim);
      const sh = this._l.copy(pivot).addScaledVector(r, shoulder);
      sh.y += lerp(0.1, 0.06, this.aim);
      // collision
      const back = this._d.copy(f).negate();
      const origin = new THREE.Vector3().copy(pivot).addScaledVector(r, 0.25);
      const to = new THREE.Vector3().copy(sh).addScaledVector(back, dist);
      const dir = new THREE.Vector3().subVectors(to, origin);
      const len = dir.length();
      dir.divideScalar(len);
      const hit = g.physics.raycast(origin, dir, len + 0.25, { trees: true, boxes: true, terrain: true });
      let finalLen = len;
      if (hit) finalLen = Math.max(0.3, hit.dist - 0.25);
      this.camLen = damp(this.camLen ?? finalLen, finalLen, finalLen < (this.camLen ?? 0) ? 30 : 6, realDt);
      const pos = origin.addScaledVector(dir, this.camLen);
      const gh = g.terrain.getHeight(pos.x, pos.z) + 0.25;
      if (pos.y < gh) pos.y = gh;
      cam.position.copy(pos);
      const look = sh.addScaledVector(f, 30);
      cam.lookAt(look);
      const fov = lerp(this.baseFov, 46, this.aim) + this.sprintK * 5;
      cam.fov = fov;
      if (this.blend > 0) {
        this.blend = Math.max(0, this.blend - realDt / this.blendTime);
        const k = this.blend * this.blend * (3 - 2 * this.blend);
        cam.position.lerp(this.blendFrom.pos, k);
        cam.quaternion.slerp(this.blendFrom.quat, k);
        cam.fov = lerp(fov, this.blendFrom.fov, k);
      }
    } else if (this.mode === 'cutscene' && this.track) {
      this.track.t = Math.min(this.track.dur, this.track.t + dt);
      this._applyTrack(this.track.dur > 0 ? this.track.t / this.track.dur : 1);
      cam.position.copy(this.cutPos);
      const gh = g.terrain.getHeight(cam.position.x, cam.position.z) + 0.2;
      if (cam.position.y < gh) cam.position.y = gh;
      cam.lookAt(this.cutLook);
      cam.fov = this.cutFov;
    } else if (this.mode === 'free') {
      // title screen flyover
      const t = this.t * 0.03;
      cam.position.set(Math.sin(t) * 40 + 10, g.terrain.getHeight(10, -40) + 26 + Math.sin(t * 2) * 2, -40 + Math.cos(t) * 40);
      cam.lookAt(25, g.terrain.getHeight(25, -200) + 6, -220);
      cam.fov = 55;
    }

    // shake
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      const n = this.noise, tt = this.t * 22;
      cam.rotateX(n.noise(tt, 1) * 0.05 * s);
      cam.rotateY(n.noise(tt, 7) * 0.05 * s);
      cam.rotateZ(n.noise(tt, 13) * 0.04 * s);
      this.trauma = Math.max(0, this.trauma - realDt * 0.9);
    }
    // handheld idle sway in cutscenes
    if (this.mode === 'cutscene') {
      const n = this.noise, tt = this.t * 0.6;
      cam.rotateX(n.noise(tt, 3) * 0.006);
      cam.rotateY(n.noise(tt, 9) * 0.006);
    }
    cam.updateProjectionMatrix();
  }
}
