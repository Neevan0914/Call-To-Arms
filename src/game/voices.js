// Voice cast. Every speaking character has a distinct voice:
//  - `kokoro`: the neural voice used to pre-record the line files (scripts/generate-voices.mjs)
//  - `fx`: post-processing applied to the recording (see the generator)
//  - `tts`: fallback browser speech settings when no recording exists
export const CAST = {
  you: { kokoro: 'am_michael', speed: 0.96, fx: 'clean', tts: { slot: 0, pitch: 1.0, rate: 0.98 } },
  youThought: { kokoro: 'am_michael', speed: 0.9, fx: 'thought', tts: null },
  captain: { kokoro: 'bm_george', speed: 0.92, fx: 'clean', tts: { slot: 1, pitch: 0.86, rate: 0.92 } },
  sergeant: { kokoro: 'am_fenrir', speed: 1.0, fx: 'gruff', tts: { slot: 2, pitch: 0.82, rate: 1.0 } },
  quartermaster: { kokoro: 'bm_fable', speed: 1.02, fx: 'clean', tts: { slot: 3, pitch: 1.04, rate: 1.02 } },
  sentry1: { kokoro: 'am_liam', speed: 1.05, fx: 'shoutFar', tts: { slot: 4, pitch: 1.08, rate: 1.06 } },
  sentry2: { kokoro: 'bm_lewis', speed: 1.06, fx: 'shoutFar', tts: { slot: 5, pitch: 0.96, rate: 1.08 } },
  soldier: { kokoro: 'am_echo', speed: 1.12, fx: 'shout', tts: { slot: 6, pitch: 1.12, rate: 1.15 } },
  kharzan: { kokoro: 'am_onyx', speed: 1.02, fx: 'enemy', tts: { slot: 7, pitch: 0.7, rate: 1.0 } },
  kharzanFar: { kokoro: 'am_onyx', speed: 1.0, fx: 'enemyFar', tts: { slot: 7, pitch: 0.7, rate: 1.0 } },
  scout: { kokoro: 'am_puck', speed: 1.1, fx: 'enemy', tts: { slot: 8, pitch: 0.85, rate: 1.12 } },
  kharzanOfficer: { kokoro: 'bm_daniel', speed: 0.86, fx: 'officer', tts: { slot: 9, pitch: 0.72, rate: 0.86 } },
  // Chapter II
  marshal: { kokoro: 'am_adam', speed: 0.88, fx: 'marshal', tts: { slot: 10, pitch: 0.62, rate: 0.84 } },
  general: { kokoro: 'am_eric', speed: 0.92, fx: 'general', tts: { slot: 11, pitch: 0.8, rate: 0.9 } },
  lieutenant: { kokoro: 'bm_lewis', speed: 1.0, fx: 'gruff', tts: { slot: 12, pitch: 0.9, rate: 1.0 } },
  // Chapter III
  colonel: { kokoro: 'bm_george', speed: 0.94, fx: 'colonel', tts: { slot: 13, pitch: 0.78, rate: 0.92 } },
  bandit: { kokoro: 'am_santa', speed: 1.0, fx: 'bandit', tts: { slot: 14, pitch: 0.75, rate: 1.0 } },
  bandit2: { kokoro: 'am_puck', speed: 1.08, fx: 'gruff', tts: { slot: 15, pitch: 0.95, rate: 1.1 } },
};

// Text as spoken (subtitle typography -> speech-friendly punctuation).
export function spokenText(text) {
  return text
    .replace(/^\((.*)\)$/, '$1')
    .replace(/(\w)—(?=\s|$)/g, '$1-') // cut-off word ("Wha—", "We can't—")
    .replace(/\s*—\s*/g, ', ')
    .replace(/\bModel 28\b/g, 'Model twenty-eight')
    .replace(/…/g, '...')
    .replace(/\bRkm\b/g, 'R K M')
    .replace(/\bKHARZANS\b/g, 'Kharzans')
    .replace(/\bgreycoats\b/gi, (m) => (m[0] === 'G' ? 'Grey coats' : 'grey coats'));
}

// Stable id for a line: cast + FNV-1a hash of the text.
export function lineId(cast, text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${cast}_${h.toString(16).padStart(8, '0')}`;
}

export const VOICE_DIR = 'assets/voice';
