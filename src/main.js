import { Game } from './game/Game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

async function boot() {
  const game = new Game($('app'));
  window.__game = game;
  try {
    await game.init((p, text) => {
      $('loadFill').style.width = `${Math.round(p * 100)}%`;
      $('loadText').textContent = text;
    });
  } catch (e) {
    console.error(e);
    $('loadText').textContent = 'Failed to start: ' + (e && e.message ? e.message : e) + ' — WebGL2 is required.';
    return;
  }
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
