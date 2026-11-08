import * as THREE from 'three';
import { WEAPONS } from '../chars/weapons.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), obj: $('objText'), objPanel: $('objective'), hp: $('hpFill'), hpDelay: $('hpDelay'),
      wName: $('weaponName'), mag: $('ammoMag'), res: $('ammoRes'), ammo: $('ammo'), slots: $('weaponSlots'),
      cross: $('crosshair'), hit: $('hitmarker'), prompt: $('prompt'), marker: $('worldMarker'), markerDist: $('markerDist'),
      compass: $('compassStrip'), compassMarker: $('compassMarker'), notes: $('notifications'), sub: $('subtitles'),
      letter: $('letterbox'), skip: $('skipHint'), title: $('titleCard'), dmg: $('damageDirs'), lowhp: $('lowHealth'),
      reload: $('reloadBar'), reloadFill: $('reloadFill'), enemies: $('enemyCount'),
    };
    this.marker = null;
    this.hpShown = 100;
    this.hpDelay = 100;
    this._v = new THREE.Vector3();
    this._buildCompass();
  }

  _buildCompass() {
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let rep = -1; rep <= 1; rep++) {
      for (let d = 0; d < 360; d += 15) {
        const deg = d + rep * 360;
        const lab = labels[d];
        html += `<span class="tick ${lab ? (lab.length === 1 ? 'major' : 'mid') : ''}" style="left:${deg * 3}px">${lab || '|'}</span>`;
      }
    }
    this.el.compass.innerHTML = html;
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }
  setObjective(text) {
    this.el.obj.textContent = text || '';
    this.el.objPanel.classList.toggle('hidden', !text);
    if (text) { this.el.objPanel.classList.remove('flash'); void this.el.objPanel.offsetWidth; this.el.objPanel.classList.add('flash'); }
  }
  setMarker(v) { this.marker = v; }
  setEnemyCount(n) {
    if (n == null) { this.el.enemies.classList.add('hidden'); return; }
    this.el.enemies.classList.remove('hidden');
    this.el.enemies.textContent = `HOSTILES ${n}`;
  }

  prompt(text) {
    if (text) { this.el.prompt.innerHTML = `<kbd>E</kbd> ${text}`; this.el.prompt.classList.remove('hidden'); }
    else this.el.prompt.classList.add('hidden');
  }

  updateWeapon(p) {
    const id = p.current;
    const def = WEAPONS[id];
    if (!def) { this.el.wName.textContent = 'UNARMED'; this.el.ammo.style.display = 'none'; }
    else {
      this.el.wName.textContent = def.name.toUpperCase();
      if (def.melee) this.el.ammo.style.display = 'none';
      else {
        const w = p.weapons[id];
        this.el.ammo.style.display = '';
        this.el.mag.textContent = w.mag;
        this.el.res.textContent = w.reserve;
        this.el.mag.classList.toggle('empty', w.mag === 0);
      }
    }
    const slots = [['1', 'rifle'], ['2', 'sword'], ['3', 'lmg']].filter(([, k]) => p.weapons[k].has);
    this.el.slots.innerHTML = slots.map(([n, k]) => `<span class="slot ${k === id ? 'active' : ''}"><kbd>${n}</kbd>${WEAPONS[k].short}</span>`).join('');
  }

  hitmarker(kill) {
    const h = this.el.hit;
    h.classList.remove('show', 'kill');
    void h.offsetWidth;
    h.classList.add('show');
    if (kill) h.classList.add('kill');
  }

  damage(fromPos) {
    const el = document.createElement('div');
    el.className = 'dmgdir';
    if (fromPos) {
      const cam = this.game.camera;
      const f = new THREE.Vector3(); cam.getWorldDirection(f);
      const ang = Math.atan2(fromPos.x - cam.position.x, fromPos.z - cam.position.z) - Math.atan2(f.x, f.z);
      el.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
    } else el.style.transform = 'translate(-50%,-50%)';
    this.el.dmg.appendChild(el);
    setTimeout(() => el.remove(), 1200);
    this.game.post.u.uDamage.value = Math.min(1, this.game.post.u.uDamage.value + 0.45);
  }

  notify(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'note ' + cls;
    el.textContent = text;
    this.el.notes.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3500);
    setTimeout(() => el.remove(), 4200);
    while (this.el.notes.children.length > 4) this.el.notes.firstChild.remove();
  }

  subtitle(speaker, text, color = '#e8d9a8', italic = false) {
    if (!text) { this.el.sub.classList.remove('show'); return; }
    this.el.sub.innerHTML = `${speaker ? `<span class="spk" style="color:${color}">${speaker}</span>` : ''}<span class="line ${italic ? 'thought' : ''}">${text}</span>`;
    this.el.sub.classList.add('show');
  }

  // Dialogue choice: resolves with the chosen index (keys 1-n, click or tap); after
  // `timeout` seconds the `fallback` option is taken.
  choose(question, options, { timeout = 12, fallback = options.length - 1 } = {}) {
    const box = $('choices');
    box.querySelector('.q').textContent = question || '';
    const wrap = box.querySelector('.opts');
    wrap.innerHTML = '';
    const fill = box.querySelector('.fill');
    return new Promise((resolve) => {
      let done = false;
      const pick = (i) => {
        if (done) return;
        done = true;
        const b = wrap.children[i];
        if (b) b.classList.add('sel');
        clearInterval(tick);
        window.removeEventListener('keydown', onKey, true);
        setTimeout(() => { box.classList.add('hidden'); resolve(i); }, 450);
      };
      options.forEach((o, i) => {
        const b = document.createElement('button');
        b.innerHTML = `<kbd>${i + 1}</kbd><span class="${/^\[.*\]$/.test(o) ? 'act' : ''}">${o}</span>`;
        b.addEventListener('click', (e) => { e.stopPropagation(); pick(i); });
        b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); pick(i); }, { passive: false });
        wrap.appendChild(b);
      });
      const onKey = (e) => {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= options.length) { e.preventDefault(); e.stopPropagation(); pick(n - 1); }
      };
      window.addEventListener('keydown', onKey, true);
      let el = 0, last = performance.now();
      const tick = setInterval(() => {
        const now = performance.now();
        if (!this.game.paused) el += now - last;
        last = now;
        const k = Math.min(1, el / (timeout * 1000));
        fill.style.transform = `scaleX(${1 - k})`;
        if (k >= 1) pick(fallback);
      }, 50);
      fill.style.transform = 'scaleX(1)';
      box.classList.remove('hidden');
    });
  }

  // Full-screen document (captured papers); resolves when closed (E / Enter / Esc / click / tap).
  showDocument(html, { minTime = 2.5 } = {}) {
    const box = $('document');
    box.querySelector('.paper').innerHTML = html;
    box.querySelector('.paper').scrollTop = 0;
    box.classList.remove('hidden');
    const t0 = performance.now();
    return new Promise((resolve) => {
      const close = (e) => {
        if (performance.now() - t0 < minTime * 1000) return;
        if (e && e.type === 'keydown' && !['KeyE', 'Enter', 'Escape'].includes(e.code)) return;
        if (e) { e.preventDefault(); e.stopPropagation(); }
        window.removeEventListener('keydown', close, true);
        box.removeEventListener('click', close);
        box.removeEventListener('touchend', close);
        box.classList.add('hidden');
        resolve();
      };
      window.addEventListener('keydown', close, true);
      box.addEventListener('click', close);
      box.addEventListener('touchend', close);
    });
  }

  letterbox(on) { this.el.letter.classList.toggle('on', on); }
  skipHint(on, progress = 0) {
    this.el.skip.classList.toggle('show', on);
    this.el.skip.style.setProperty('--p', progress);
  }

  titleCard(title, sub, dur = 4.5) {
    const t = this.el.title;
    t.innerHTML = `<div class="t1">${title}</div>${sub ? `<div class="t2">${sub}</div>` : ''}`;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(this._tc);
    this._tc = setTimeout(() => t.classList.remove('show'), dur * 1000);
  }

  update(dt) {
    const g = this.game, p = g.player;
    // health
    this.hpShown += (p.hp - this.hpShown) * Math.min(1, dt * 12);
    if (this.hpDelay > p.hp) this.hpDelay -= dt * 30; else this.hpDelay = p.hp;
    this.el.hp.style.width = `${this.hpShown}%`;
    this.el.hpDelay.style.width = `${Math.max(this.hpShown, this.hpDelay)}%`;
    this.el.hp.classList.toggle('low', p.hp < 35);
    this.el.lowhp.style.opacity = p.alive ? Math.max(0, (40 - p.hp) / 40) * 0.8 : 0;
    // reload bar
    if (p.reloadT >= 0) { this.el.reload.classList.remove('hidden'); this.el.reloadFill.style.width = `${p.reloadT * 100}%`; }
    else this.el.reload.classList.add('hidden');
    // crosshair
    const def = WEAPONS[p.current];
    const gun = def && !def.melee;
    this.el.cross.classList.toggle('hidden', !g.controlsEnabled || !p.alive || p.current === 'none');
    this.el.cross.classList.toggle('melee', !!(def && def.melee));
    if (gun) {
      const spread = (p.aiming ? def.spreadAim : def.spreadHip) + p.bloom + Math.min(1, p.speedXZ() / 4) * 0.02;
      const px = 6 + spread * 500;
      this.el.cross.style.setProperty('--gap', `${px}px`);
    } else this.el.cross.style.setProperty('--gap', '6px');
    // compass
    const yaw = g.rig.yaw;
    let heading = ((-yaw * 180) / Math.PI + 180) % 360; // 0 = north (-z)
    heading = (360 - heading) % 360;
    // compute heading from camera forward to be safe
    const f = this._v; g.camera.getWorldDirection(f);
    heading = ((Math.atan2(f.x, -f.z) * 180) / Math.PI + 360) % 360;
    this.el.compass.style.transform = `translateX(${-heading * 3}px)`;
    // world marker
    if (this.marker && g.controlsEnabled) {
      const m = this.marker;
      const v = this._v.copy(m).project(g.camera);
      const behind = v.z > 1;
      const w = window.innerWidth, h = window.innerHeight;
      let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      if (behind) { x = w - x; y = h - 40; }
      x = Math.max(40, Math.min(w - 40, x)); y = Math.max(70, Math.min(h - 120, y));
      this.el.marker.style.transform = `translate(${x}px, ${y}px)`;
      this.el.marker.classList.remove('hidden');
      const d = g.player.position.distanceTo(m);
      this.el.markerDist.textContent = `${Math.round(d)}m`;
      this.el.marker.classList.toggle('near', d < 6);
      const ang = ((Math.atan2(m.x - g.camera.position.x, -(m.z - g.camera.position.z)) * 180) / Math.PI + 360) % 360;
      let dd = ang - heading;
      if (dd > 180) dd -= 360; if (dd < -180) dd += 360;
      this.el.compassMarker.style.left = `calc(50% + ${Math.max(-160, Math.min(160, dd * 3))}px)`;
      this.el.compassMarker.classList.remove('hidden');
    } else {
      this.el.marker.classList.add('hidden');
      this.el.compassMarker.classList.add('hidden');
    }
    // damage fade
    const u = g.post.u;
    u.uDamage.value = Math.max(0, u.uDamage.value - dt * 0.9);
  }
}
