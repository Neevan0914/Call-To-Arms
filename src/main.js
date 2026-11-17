import { Game } from './game/Game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---- studio intro: plays while the game loads, then fades into the menu ----
const intro = (() => {
  const el = $('intro'), vid = $('introVideo');
  let videoDone = false, loaded = false, gone = false;
  const reveal = () => {
    if (gone || !videoDone || !loaded) return;
    gone = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 1000);
  };
  const endVideo = () => {
    if (videoDone) return;
    videoDone = true;
    if (!loaded) el.classList.add('waiting'); // hold on the logo with a progress bar
    reveal();
  };
  if (!el || !vid) return { progress() {}, ready() {}, fail() {} };
  vid.addEventListener('ended', endVideo);
  vid.addEventListener('error', endVideo);
  const p = vid.play();
  if (p && p.catch) p.catch(endVideo); // autoplay blocked: skip straight to the loading bar
  const skip = (e) => { if (e) e.preventDefault(); vid.pause(); endVideo(); };
  el.addEventListener('click', skip);
  el.addEventListener('touchstart', skip, { passive: false });
  window.addEventListener('keydown', function onKey() { if (!videoDone) skip(); if (videoDone) window.removeEventListener('keydown', onKey); });
  return {
    progress(f) { const b = $('introFill'); if (b) b.style.width = `${Math.round(f * 100)}%`; },
    ready() { loaded = true; reveal(); },
    fail() { gone = true; el.remove(); },
  };
})();

async function boot() {
  const game = new Game($('app'));
  window.__game = game;
  try {
    await game.init((p, text) => {
      $('loadFill').style.width = `${Math.round(p * 100)}%`;
      $('loadText').textContent = text;
      intro.progress(p);
    });
  } catch (e) {
    console.error(e);
    intro.fail();
    $('loadText').textContent = 'Failed to start: ' + (e && e.message ? e.message : e) + ' — WebGL2 is required.';
    return;
  }
  intro.ready();
  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');

  // settings UI
  const s = game.settings;
  $('setQuality').value = s.quality;
  $('setSens').value = s.sensitivity;
  $('setInvert').checked = s.invertY;
  $('setVoice').checked = s.voice;
  $('setDiff').value = s.difficulty;
  $('setQuality').onchange = (e) => game.setQuality(e.target.value);
  $('setSens').oninput = (e) => { s.sensitivity = +e.target.value; game.input.sensitivity = s.sensitivity; game.saveSettings(); };
  $('setInvert').onchange = (e) => { s.invertY = e.target.checked; game.saveSettings(); };
  $('setVoice').onchange = (e) => { s.voice = e.target.checked; game.audio.voice = s.voice; if (!s.voice) game.audio.stopSpeech(); game.saveSettings(); };
  $('setDiff').onchange = (e) => game.setDifficulty(e.target.value);

  const start = () => {
    $('menu').classList.add('hidden');
    game.audio.init();
    game.input.lock();
    game.started = true;
    game.story.run(params.get('skip') || 'intro');
  };
  $('btnStart').onclick = start;
  $('btnCredits').onclick = () => $('credits').classList.remove('hidden');
  $('btnCreditsBack').onclick = () => $('credits').classList.add('hidden');
  $('btnSettings').onclick = () => { $('pause').classList.remove('hidden'); $('btnResume').textContent = 'Back'; };
  $('btnResume').onclick = () => {
    if (!game.started && !game.story.inCutscene && $('menu').classList.contains('hidden') === false) {
      $('pause').classList.add('hidden');
      $('btnResume').textContent = 'Resume';
      return;
    }
    game.setPaused(false);
  };
  $('btnRestart').onclick = () => location.reload();
  $('btnReplay').onclick = () => location.reload();
  // clicking the canvas re-captures the mouse during play
  game.renderer.domElement.addEventListener('click', () => {
    if (game.started && !game.paused && !game.ended && !game.input.locked) game.input.lock();
  });
  if (params.has('autostart')) start();
}

boot();

// which build is this? (title screen, bottom right)
{ const el = document.getElementById('buildStamp'); if (el) el.textContent = `Build ${typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'}`; }
