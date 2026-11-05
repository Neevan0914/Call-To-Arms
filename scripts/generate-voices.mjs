// Pre-records every dialogue line with a neural voice (Kokoro-82M, Apache-2.0) so the game
// doesn't depend on the browser's robotic speech synthesis.
//
//   npm i --no-save kokoro-js@1.2.1        # one-time; downloads the model from huggingface.co
//   node scripts/generate-voices.mjs        # writes public/assets/voice/*.mp3 + manifest.json
//   node scripts/generate-voices.mjs --list # just print the lines and their cast
//   node scripts/generate-voices.mjs --force # re-record every line
//
// Lines are read from src/game/story.js (this.say / this.bark calls). Each character's
// voice, speed and audio treatment come from src/game/voices.js. Requires ffmpeg.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CAST, lineId, spokenText } from '../src/game/voices.js';

const OUT = 'public/assets/voice';
const listOnly = process.argv.includes('--list');
const force = process.argv.includes('--force');

// ---- collect lines ----
const src = readFileSync('src/game/story.js', 'utf8');
const lines = new Map();
const str = `(['"])((?:\\\\.|(?!\\2).)*)\\2`;
const unescape = (t) => t.replace(/\\(['"\\])/g, '$1');
for (const row of src.split('\n')) {
  let m = row.match(new RegExp(`this\\.say\\(\\s*'([^']*)'\\s*,\\s*${str}`));
  if (m) {
    const v = row.match(/voice: '(\w+)'/);
    const cast = v ? v[1] : 'soldier';
    lines.set(lineId(cast, unescape(m[3])), { speaker: m[1], text: unescape(m[3]), cast });
    continue;
  }
  m = row.match(new RegExp(`this\\.bark\\(\\s*'([^']*)'\\s*,\\s*${str}\\s*,\\s*COL\\.\\w+\\s*,\\s*[\\d.]+\\s*,\\s*'(\\w+)'\\)`));
  if (m) lines.set(lineId(m[4], unescape(m[3])), { speaker: m[1], text: unescape(m[3]), cast: m[4] });
}
for (const [id, l] of lines) if (!CAST[l.cast]) throw new Error(`unknown cast "${l.cast}" for line ${id}`);
console.log(`${lines.size} lines`);
if (listOnly) {
  for (const [id, l] of lines) console.log(`${id.padEnd(26)} ${l.cast.padEnd(15)} ${CAST[l.cast].kokoro.padEnd(11)} ${spokenText(l.text)}`);
  process.exit(0);
}

// ---- audio treatments (ffmpeg filter chains, 24 kHz mono input) ----
// trim -> character effect -> loudness normalisation (per effect) -> limiter
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse';
const COMP = 'highpass=f=75,acompressor=threshold=-21dB:ratio=3:attack=5:release=90';
const pitch = (k) => `asetrate=24000*${k},aresample=24000,atempo=${(1 / k).toFixed(4)}`;
const FX = {
  clean: { chain: COMP, lufs: -17 },
  thought: { chain: `${COMP},lowpass=f=6500,aecho=0.9:0.9:45|95:0.32|0.18`, lufs: -19 },
  gruff: { chain: `${pitch(0.94)},equalizer=f=180:t=q:w=1:g=3,${COMP}`, lufs: -17 },
  shout: { chain: `equalizer=f=2600:t=q:w=1:g=4,${COMP}`, lufs: -16 },
  shoutFar: { chain: `equalizer=f=2600:t=q:w=1:g=4,${COMP},aecho=0.9:0.9:85|170:0.3|0.16,lowpass=f=5200`, lufs: -18 },
  enemy: { chain: `${pitch(0.9)},equalizer=f=1300:t=q:w=1.2:g=3,${COMP}`, lufs: -17 },
  enemyFar: { chain: `${pitch(0.9)},${COMP},lowpass=f=2300,aecho=0.9:0.9:120|260:0.35|0.22`, lufs: -20 },
  officer: { chain: `${pitch(0.88)},${COMP},aecho=0.9:0.9:35:0.14`, lufs: -17 },
};
const fxChain = (fx) => `${TRIM},${FX[fx].chain},loudnorm=I=${FX[fx].lufs}:TP=-2:LRA=8,alimiter=limit=0.8:level=false,apad=pad_dur=0.15`;

// ---- synthesize ----
let KokoroTTS;
try { ({ KokoroTTS } = await import('kokoro-js')); } catch (e) {
  console.error('kokoro-js is not installed. Run: npm i --no-save kokoro-js@1.2.1');
  process.exit(1);
}
const short = (e) => `${e && e.name}: ${String(e && e.message).slice(0, 400)}${e && e.cause ? ` (cause: ${String(e.cause.message || e.cause).slice(0, 200)})` : ''}`;
process.on('uncaughtException', (e) => { console.error('[uncaught]', short(e)); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[unhandled]', short(e)); process.exit(1); });
let tts;
try {
  tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu' });
} catch (e) { console.error('model load failed:', short(e)); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const tmp = `${OUT}/.tmp.wav`;
const manifest = { lines: {} };
for (const [id, l] of lines) {
  const c = CAST[l.cast];
  const file = `${id}.mp3`;
  const out = `${OUT}/${file}`;
  if (force || !existsSync(out)) {
    const audio = await tts.generate(spokenText(l.text), { voice: c.kokoro, speed: c.speed });
    await audio.save(tmp);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', fxChain(c.fx), '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', out]);
  }
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
  manifest.lines[id] = { file, dur: +dur.toFixed(2), cast: l.cast, text: l.text };
  console.log(`${file}  ${dur.toFixed(2)}s  [${l.cast}/${c.kokoro}] ${l.text}`);
}
if (existsSync(tmp)) rmSync(tmp);
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(`wrote ${OUT}/manifest.json`);
