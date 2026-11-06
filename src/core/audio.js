import * as THREE from 'three';
import { rand } from './utils.js';
import { CAST, lineId, spokenText, VOICE_DIR } from '../game/voices.js';

// Fully procedural audio: synthesized weapons, foley, ambience, music, and
// optional speech-synthesis voices for dialogue.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.voice = true;
    this.listener = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };
    this.musicLayers = {};
    this.muffle = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 20000; this.lowpass.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(this.lowpass); this.lowpass.connect(comp); comp.connect(ctx.destination);

    this.sfx = ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.32; this.mus.connect(this.master);

    // reverb (forest / courtyard echo)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.6);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 0.55;
    this.reverbIn.connect(this.reverb); this.reverb.connect(this.master);

    // noise buffers
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.enabled = true;
    this._decodeVoices();
    this._startAmbience();
    this._startMusic();
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // early reflections (tree trunks / walls) then diffuse tail
        const er = i < ctx.sampleRate * 0.12 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + er) * 0.6;
      }
    }
    return buf;
  }

  // ---------- spatial helper ----------
  _spatial(pos, refDist = 6) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    if (!pos) { out.connect(this.sfx); return { node: out, dist: 0 }; }
    const L = this.listener;
    const dx = pos.x - L.pos.x, dy = pos.y - L.pos.y, dz = pos.z - L.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const side = dist > 0.01 ? (dx * L.right.x + dz * L.right.z) / dist : 0;
    const g = ctx.createGain();
    g.gain.value = Math.min(1, refDist / Math.max(refDist, dist));
    out.connect(g);
    if (pan) { pan.pan.value = Math.max(-1, Math.min(1, side * 0.85)); g.connect(pan); pan.connect(this.sfx); } else g.connect(this.sfx);
    // distance air absorption
    if (dist > 25) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = Math.max(900, 14000 - dist * 70);
      out.disconnect(); out.connect(lp); lp.connect(g);
    }
    return { node: out, dist };
  }

  _noiseBurst(dest, { t0 = 0, dur = 0.3, type = 'lowpass', f0 = 4000, f1 = 300, q = 0.7, gain = 1, attack = 0.002, buffer = null, rate = 1 }) {
    const ctx = this.ctx, now = ctx.currentTime + t0;
    const src = ctx.createBufferSource();
    src.buffer = buffer || this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, now);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(now, Math.random() * 1.5);
    src.stop(now + dur + 0.05);
    return g;
  }

  _tone(dest, { t0 = 0, dur = 0.2, type = 'sine', f0 = 200, f1 = 60, gain = 0.5, attack = 0.003 }) {
    const ctx = this.ctx, now = ctx.currentTime + t0;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(dest);
    o.start(now); o.stop(now + dur + 0.05);
    return g;
  }

  // ---------- weapons ----------
  shot(kind = 'rifle', pos = null) {
    if (!this.enabled) return;
    const { node, dist } = this._spatial(pos, 8);
    const wet = this.ctx.createGain();
    wet.gain.value = pos ? Math.min(1.2, 0.4 + dist / 60) : 0.5;
    node.connect(wet); wet.connect(this.reverbIn);
    const heavy = kind === 'rifle';
    const v = pos ? 0.9 : 1;
    // crack
    this._noiseBurst(node, { dur: 0.05, type: 'highpass', f0: 2500, f1: 1200, gain: 0.9 * v });
    // body
    this._noiseBurst(node, { dur: heavy ? 0.55 : 0.32, type: 'lowpass', f0: heavy ? 5200 : 6000, f1: 160, q: 0.9, gain: (heavy ? 1.3 : 1.0) * v });
    // thump
    this._tone(node, { dur: heavy ? 0.28 : 0.16, f0: heavy ? 150 : 180, f1: 40, gain: (heavy ? 1.0 : 0.7) * v });
    if (pos && dist > 40) this._noiseBurst(node, { t0: 0.05, dur: 0.9, type: 'lowpass', f0: 800, f1: 120, gain: 0.35, buffer: this.brown });
  }

  boltCycle(pos = null) {
    if (!this.enabled) return;
    const { node } = this._spatial(pos, 3);
    this._noiseBurst(node, { t0: 0.35, dur: 0.05, type: 'bandpass', f0: 3200, f1: 2000, q: 3, gain: 0.35 });
    this._tone(node, { t0: 0.36, dur: 0.06, type: 'square', f0: 1800, f1: 1400, gain: 0.05 });
    this._noiseBurst(node, { t0: 0.58, dur: 0.05, type: 'bandpass', f0: 2600, f1: 1800, q: 3, gain: 0.35 });
    this._tone(node, { t0: 0.59, dur: 0.05, type: 'square', f0: 1500, f1: 1100, gain: 0.05 });
  }

  reload(kind = 'rifle') {
    if (!this.enabled) return;
    const { node } = this._spatial(null);
    const times = kind === 'rifle' ? [0.2, 0.5, 0.9, 1.3, 1.7, 2.2, 2.45] : [0.3, 0.9, 1.9, 2.6, 2.9];
    for (const t of times) {
      this._noiseBurst(node, { t0: t, dur: 0.06, type: 'bandpass', f0: rand(1800, 3600), f1: 1200, q: 2.5, gain: 0.3 });
      this._tone(node, { t0: t, dur: 0.05, type: 'triangle', f0: rand(900, 2000), f1: 600, gain: 0.04 });
    }
  }

  dryFire() {
    if (!this.enabled) return;
    this._noiseBurst(this.sfx, { dur: 0.03, type: 'bandpass', f0: 4000, f1: 3000, q: 4, gain: 0.3 });
  }

  whiz(pos) {
    if (!this.enabled) return;
    const { node } = this._spatial(pos, 2);
    this._noiseBurst(node, { dur: 0.16, type: 'bandpass', f0: 5000, f1: 900, q: 6, gain: 0.6, attack: 0.01 });
    this._tone(node, { dur: 0.14, type: 'sine', f0: rand(2500, 4000), f1: 700, gain: 0.05, attack: 0.01 });
  }

  impact(type, pos) {
    if (!this.enabled) return;
    const { node, dist } = this._spatial(pos, 3);
    if (dist > 60) return;
    if (type === 'flesh') {
      this._noiseBurst(node, { dur: 0.12, type: 'lowpass', f0: 900, f1: 120, gain: 0.7 });
      this._tone(node, { dur: 0.1, f0: 140, f1: 50, gain: 0.4 });
    } else if (type === 'wood') {
      this._noiseBurst(node, { dur: 0.1, type: 'bandpass', f0: 900, f1: 400, q: 2, gain: 0.6 });
    } else if (type === 'stone' || type === 'metal') {
      this._noiseBurst(node, { dur: 0.08, type: 'highpass', f0: 3000, f1: 1500, gain: 0.4 });
      this._tone(node, { dur: 0.25, type: 'sine', f0: rand(2000, 3500), f1: 1800, gain: 0.05 });
    } else {
      this._noiseBurst(node, { dur: 0.12, type: 'lowpass', f0: 1500, f1: 200, gain: 0.5 });
    }
  }

  swing() {
    if (!this.enabled) return;
    this._noiseBurst(this.sfx, { dur: 0.32, type: 'bandpass', f0: 500, f1: 2400, q: 1.8, gain: 0.5, attack: 0.08 });
  }

  slash(pos) {
    if (!this.enabled) return;
    const { node } = this._spatial(pos, 3);
    this._noiseBurst(node, { dur: 0.14, type: 'lowpass', f0: 1800, f1: 150, gain: 0.9 });
    this._tone(node, { dur: 0.12, f0: 180, f1: 60, gain: 0.5 });
  }

  slam(pos) {
    if (!this.enabled) return;
    const { node } = this._spatial(pos, 5);
    this._tone(node, { dur: 0.45, f0: 110, f1: 32, gain: 1.1, attack: 0.004 });
    this._noiseBurst(node, { dur: 0.5, type: 'lowpass', f0: 1400, f1: 90, q: 0.8, gain: 1.0, buffer: this.brown });
    this._noiseBurst(node, { t0: 0.04, dur: 0.7, type: 'bandpass', f0: 2200, f1: 500, q: 0.9, gain: 0.35 });
  }

  clang(pos) {
    if (!this.enabled) return;
    const { node } = this._spatial(pos, 3);
    this._tone(node, { dur: 0.5, type: 'triangle', f0: 2200, f1: 1900, gain: 0.25 });
    this._tone(node, { dur: 0.4, type: 'sine', f0: 3300, f1: 3100, gain: 0.12 });
    this._noiseBurst(node, { dur: 0.05, type: 'highpass', f0: 4000, f1: 3000, gain: 0.5 });
  }

  footstep(surface = 'grass', pos = null, vol = 1) {
    if (!this.enabled) return;
    const { node, dist } = this._spatial(pos, 2);
    if (dist > 30) return;
    if (surface === 'wood') {
      this._noiseBurst(node, { dur: 0.08, type: 'bandpass', f0: 600, f1: 300, q: 1.5, gain: 0.35 * vol });
    } else if (surface === 'dirt') {
      this._noiseBurst(node, { dur: 0.09, type: 'lowpass', f0: 2600, f1: 300, gain: 0.32 * vol });
      this._noiseBurst(node, { t0: 0.02, dur: 0.06, type: 'highpass', f0: 4000, f1: 2500, gain: 0.08 * vol });
    } else {
      this._noiseBurst(node, { dur: 0.12, type: 'bandpass', f0: rand(1800, 3000), f1: 900, q: 0.8, gain: 0.22 * vol, attack: 0.01 });
    }
  }

  grunt(pos, pitch = 1) {
    if (!this.enabled) return;
    const { node } = this._spatial(pos, 4);
    this._tone(node, { dur: 0.22, type: 'sawtooth', f0: 160 * pitch, f1: 90 * pitch, gain: 0.08, attack: 0.02 });
    this._noiseBurst(node, { dur: 0.2, type: 'bandpass', f0: 700 * pitch, f1: 400, q: 2, gain: 0.2, attack: 0.02 });
  }

  explosion(pos) {
    if (!this.enabled) return;
    const { node, dist } = this._spatial(pos, 20);
    const wet = this.ctx.createGain(); wet.gain.value = 1.0; node.connect(wet); wet.connect(this.reverbIn);
    this._noiseBurst(node, { dur: 2.6, type: 'lowpass', f0: 3500, f1: 60, q: 0.6, gain: 2.0, buffer: this.brown });
    this._noiseBurst(node, { dur: 0.6, type: 'lowpass', f0: 6000, f1: 300, gain: 1.4 });
    this._tone(node, { dur: 1.4, f0: 70, f1: 25, gain: 1.6 });
    // debris patter
    for (let i = 0; i < 10; i++) this._noiseBurst(node, { t0: 0.4 + Math.random() * 1.5, dur: 0.05, type: 'bandpass', f0: rand(800, 2500), f1: 500, q: 2, gain: 0.15 });
    return dist;
  }

  shellWhistle(dur = 1.4) {
    if (!this.enabled) return;
    this._tone(this.sfx, { dur, type: 'sine', f0: 1700, f1: 500, gain: 0.12, attack: 0.3 });
  }

  whistle() {
    if (!this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2650;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 28;
    const lg = ctx.createGain(); lg.gain.value = 120;
    lfo.connect(lg); lg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
    g.gain.setValueAtTime(0.18, now + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    g.gain.setValueAtTime(0.0001, now + 0.75);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.8);
    g.gain.setValueAtTime(0.18, now + 1.6);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.75);
    o.connect(g); g.connect(this.sfx); g.connect(this.reverbIn);
    o.start(now); lfo.start(now); o.stop(now + 1.8); lfo.stop(now + 1.8);
  }

  horn() {
    if (!this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    for (const f of [146, 147.5, 220]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.07, now + 0.3);
      g.gain.setValueAtTime(0.07, now + 2.0);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
      o.connect(lp); lp.connect(g); g.connect(this.sfx); g.connect(this.reverbIn);
      o.start(now); o.stop(now + 2.7);
    }
  }

  heartbeat(t0 = 0, vol = 0.6) {
    if (!this.enabled) return;
    this._tone(this.sfx, { t0, dur: 0.18, f0: 70, f1: 35, gain: vol });
    this._tone(this.sfx, { t0: t0 + 0.24, dur: 0.16, f0: 60, f1: 32, gain: vol * 0.7 });
  }

  tinnitus(dur = 4, vol = 0.05) {
    if (!this.enabled) return;
    this._tone(this.sfx, { dur, type: 'sine', f0: 3900, f1: 3800, gain: vol, attack: 0.05 });
  }

  pickup() {
    if (!this.enabled) return;
    this._noiseBurst(this.sfx, { dur: 0.12, type: 'bandpass', f0: 1200, f1: 600, q: 1.5, gain: 0.4 });
    this._noiseBurst(this.sfx, { t0: 0.15, dur: 0.05, type: 'bandpass', f0: 3000, f1: 2000, q: 3, gain: 0.25 });
  }

  hitmarker() {
    if (!this.enabled) return;
    this._tone(this.sfx, { dur: 0.05, type: 'triangle', f0: 1400, f1: 1200, gain: 0.05 });
  }

  // ---------- ambience ----------
  _startAmbience() {
    const ctx = this.ctx;
    // wind through the canopy
    const src = ctx.createBufferSource(); src.buffer = this.brown; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 400; lp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.22;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(this.amb);
    src.start(); lfo.start();
    // leaves rustle
    const src2 = ctx.createBufferSource(); src2.buffer = this.noise; src2.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const g2 = ctx.createGain(); g2.gain.value = 0.015;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.13;
    const lg2 = ctx.createGain(); lg2.gain.value = 0.012;
    lfo2.connect(lg2); lg2.connect(g2.gain);
    src2.connect(hp); hp.connect(g2); g2.connect(this.amb);
    src2.start(); lfo2.start();
    this.birdsOn = true;
    this._birdTimer = 1;
  }

  _bird() {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = rand(-0.9, 0.9);
    pan.connect(this.amb);
    const g0 = rand(0.015, 0.05);
    const kind = Math.floor(Math.random() * 3);
    const notes = kind === 0 ? 3 + Math.floor(Math.random() * 4) : kind === 1 ? 2 : 6;
    let t = 0;
    const base = rand(2200, 4200);
    for (let i = 0; i < notes; i++) {
      const f0 = kind === 2 ? base * rand(0.95, 1.05) : base * rand(0.85, 1.25);
      const d = kind === 1 ? 0.25 : rand(0.05, 0.12);
      this._tone(pan, { t0: t, dur: d, type: 'sine', f0, f1: kind === 1 ? f0 * 0.7 : f0 * rand(1.1, 1.4), gain: g0, attack: 0.01 });
      t += d + (kind === 2 ? 0.03 : rand(0.04, 0.15));
    }
  }

  // ---------- music ----------
  _startMusic() {
    const ctx = this.ctx;
    const mk = (freqs, type, cutoff, vol) => {
      const out = ctx.createGain(); out.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.8;
      lp.connect(out); out.connect(this.mus); out.connect(this.reverbIn);
      const oscs = freqs.map((f) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
        o.detune.value = rand(-8, 8);
        const g = ctx.createGain(); g.gain.value = vol;
        o.connect(g); g.connect(lp); o.start();
        return o;
      });
      return { out, lp, oscs, target: 0 };
    };
    // D minor-ish drones / pads
    this.musicLayers.drone = mk([73.4, 110, 146.8], 'sawtooth', 380, 0.12);
    this.musicLayers.pad = mk([293.7, 349.2, 440, 587.3], 'triangle', 1400, 0.05);
    this.musicLayers.low = mk([36.7, 55], 'sine', 200, 0.4);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = 250;
    lfo.connect(lg); lg.connect(this.musicLayers.drone.lp.frequency); lfo.start();
    this.drumOn = false;
    this._drumT = 0;
    this.mood = 'silent';
  }

  setMood(m) {
    this.mood = m;
    const L = this.musicLayers;
    if (!L.drone) return;
    const set = (k, v) => { L[k].target = v; };
    if (m === 'calm') { set('drone', 0.0); set('pad', 0.35); set('low', 0.2); this.drumOn = false; }
    else if (m === 'tension') { set('drone', 0.6); set('pad', 0.15); set('low', 0.6); this.drumOn = false; }
    else if (m === 'combat') { set('drone', 0.9); set('pad', 0.0); set('low', 0.8); this.drumOn = true; }
    else if (m === 'hope') { set('drone', 0.0); set('pad', 0.7); set('low', 0.3); this.drumOn = false; }
    else if (m === 'sad') { set('drone', 0.3); set('pad', 0.5); set('low', 0.5); this.drumOn = false; }
    else { set('drone', 0); set('pad', 0); set('low', 0); this.drumOn = false; }
  }

  // ---------- voices ----------
  // Recorded dialogue: assets/voice/manifest.json lists the generated clips
  // ({ lines: { id: { file, dur } } }). Raw files are fetched at load and decoded
  // once the AudioContext exists; lines without a clip fall back to speech synthesis.
  async loadVoices(resolveUrl) {
    this.voiceClips = {};
    this.voiceRaw = {};
    try {
      const res = await fetch(resolveUrl(`${VOICE_DIR}/manifest.json`));
      if (!res.ok) return 0;
      const man = await res.json();
      this.voiceManifest = man.lines || {};
      await Promise.all(Object.entries(this.voiceManifest).map(async ([id, info]) => {
        try {
          const r = await fetch(resolveUrl(`${VOICE_DIR}/${info.file}`));
          if (r.ok) this.voiceRaw[id] = await r.arrayBuffer();
        } catch (e) { /* missing clip -> fallback */ }
      }));
      if (this.ctx) this._decodeVoices();
      return Object.keys(this.voiceRaw).length;
    } catch (e) {
      return 0;
    }
  }

  _decodeVoices() {
    if (!this.voiceRaw) return;
    for (const [id, buf] of Object.entries(this.voiceRaw)) {
      delete this.voiceRaw[id];
      this.ctx.decodeAudioData(buf).then((ab) => { this.voiceClips[id] = ab; }).catch(() => {});
    }
  }

  // Returns the clip duration in seconds when a recording played, else 0.
  playLine(cast, text, { pos = null, fallback = true } = {}) {
    const id = lineId(cast, text);
    const clip = this.voiceClips && this.voiceClips[id];
    if (clip && this.enabled && this.voice) {
      this.stopVoice();
      const src = this.ctx.createBufferSource();
      src.buffer = clip;
      const { node } = this._spatial(pos, 9);
      const g = this.ctx.createGain();
      g.gain.value = 1.35;
      src.connect(g); g.connect(node);
      const wet = this.ctx.createGain();
      wet.gain.value = pos ? 0.22 : 0.08;
      g.connect(wet); wet.connect(this.reverbIn);
      src.start();
      this._voiceSrc = src;
      return clip.duration;
    }
    if (clip && !this.voice) return clip.duration; // voices muted: keep the timing
    const knownDur = this.voiceManifest && this.voiceManifest[id] ? this.voiceManifest[id].dur : 0;
    if (fallback && CAST[cast] && CAST[cast].tts) this.speak(spokenText(text), CAST[cast].tts);
    return knownDur && !this.voice ? knownDur : 0;
  }

  stopVoice() {
    if (this._voiceSrc) { try { this._voiceSrc.stop(); } catch (e) { /* */ } this._voiceSrc = null; }
  }

  // Fallback: browser speech synthesis. Picks the most natural-sounding English voices the
  // browser offers (neural/"Natural"/Google/enhanced first) and gives each character a
  // different one, with a gentle per-character pitch and pace.
  _rankedVoices() {
    const all = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
    if (this._rankCache && this._rankCache.n === all.length) return this._rankCache.list;
    const MALE = /daniel|arthur|george|ryan|guy|thomas|oliver|alex|fred|rishi|liam|christopher|eric|andrew|brian|davis|roger|steffan|william|james|male|aaron|reed|ralph|tom|gordon|lee|nathan|connor|mark|david|jacob/i;
    const FEMALE = /female|samantha|victoria|karen|moira|tessa|fiona|serena|susan|zira|hazel|libby|sonia|aria|jenny|michelle|emma|ava|allison|kate|martha|catherine/i;
    const score = (v) => {
      let s = 0;
      if (/natural|neural|online/i.test(v.name)) s += 8;
      if (/premium|enhanced/i.test(v.name)) s += 5;
      if (/google/i.test(v.name)) s += 3;
      if (/en[-_](GB|IE|AU|NZ|ZA)/i.test(v.lang)) s += 1.5;
      if (MALE.test(v.name)) s += 4;
      if (FEMALE.test(v.name)) s -= 6;
      if (/espeak|compact/i.test(v.name)) s -= 6;
      return s;
    };
    const list = all.filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a));
    this._rankCache = { n: all.length, list };
    return list;
  }

  speak(text, { pitch = 1, rate = 1, slot = 0 } = {}) {
    if (!this.voice || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const voices = this._rankedVoices();
      if (voices.length) u.voice = voices[slot % Math.min(voices.length, 6)];
      // modest shifts: big pitch changes are what makes synthesis sound robotic
      u.pitch = 1 + (pitch - 1) * 0.6; u.rate = 1 + (rate - 1) * 0.8; u.volume = 0.95;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }
  stopSpeech() { this.stopVoice(); try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* */ } }

  update(dt, camera) {
    if (!this.enabled) return;
    camera.getWorldPosition(this.listener.pos);
    camera.getWorldDirection(this.listener.fwd);
    this.listener.right.set(-this.listener.fwd.z, 0, this.listener.fwd.x).normalize();
    const now = this.ctx.currentTime;
    for (const k in this.musicLayers) {
      const L = this.musicLayers[k];
      L.out.gain.setTargetAtTime(L.target, now, 1.5);
    }
    this.lowpass.frequency.setTargetAtTime(this.muffle > 0 ? 20000 * Math.pow(0.02, this.muffle) : 20000, now, 0.2);
    if (this.birdsOn) {
      this._birdTimer -= dt;
      if (this._birdTimer <= 0) { this._bird(); this._birdTimer = rand(1.5, 6); }
    }
    if (this.drumOn) {
      this._drumT -= dt;
      if (this._drumT <= 0) {
        this._drumT = 0.5;
        this._beat = (this._beat || 0) + 1;
        const b = this._beat % 8;
        this._tone(this.mus, { dur: 0.35, f0: 110, f1: 45, gain: b % 4 === 0 ? 0.9 : 0.45 });
        if (b === 2 || b === 6) this._noiseBurst(this.mus, { dur: 0.18, type: 'bandpass', f0: 900, f1: 300, q: 1, gain: 0.25 });
        if (b === 7) this._tone(this.mus, { t0: 0.25, dur: 0.25, f0: 95, f1: 40, gain: 0.5 });
      }
    }
  }
}
