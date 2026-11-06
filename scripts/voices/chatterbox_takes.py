#!/usr/bin/env python3
"""Acted dialogue takes with Chatterbox (Resemble AI, MIT licence).

    python scripts/voices/chatterbox_takes.py lines.json refs/ raw/ [--takes 3] [--only ID,ID] [--force]

lines.json comes from `node scripts/generate-voices.mjs --json lines.json` and refs/ from
`--refs refs/` (a clean sample of each character's voice). For every line this records
several takes with the line's delivery direction (emotion intensity, pacing, variation) in the
character's voice, transcribes each take with Whisper, and keeps the best one as raw/<id>.wav:
word-accurate first, then a plausible length, then the most dynamic delivery.
`node scripts/generate-voices.mjs --from-raw raw/` then applies each character's audio
treatment and writes the game's voice files.
"""
import argparse
import json
import os
import re
import sys

import numpy as np
import torch
import torchaudio as ta

# delivery -> (exaggeration, cfg_weight, temperature)
#   exaggeration: emotional intensity (higher = more dramatic, slightly faster)
#   cfg_weight:   adherence/pacing (lower = slower, more deliberate)
DELIVERY = {
    'neutral': (0.5, 0.5, 0.8),
    'groggy': (0.35, 0.25, 0.75),
    'uneasy': (0.5, 0.35, 0.8),
    'panic': (1.0, 0.4, 0.85),
    'shout': (0.9, 0.45, 0.8),
    'urgent': (0.75, 0.45, 0.8),
    'breathless': (0.6, 0.3, 0.8),
    'dry': (0.45, 0.4, 0.8),
    'relieved': (0.55, 0.35, 0.8),
    'warm': (0.55, 0.4, 0.8),
    'grave': (0.45, 0.3, 0.75),
    'shaken': (0.65, 0.35, 0.85),
    'command': (0.8, 0.5, 0.8),
    'cheerful': (0.7, 0.45, 0.85),
    'thoughtful': (0.4, 0.3, 0.75),
    'thought': (0.35, 0.3, 0.75),
    'menace': (0.6, 0.25, 0.75),
}

# invented Kharzan words: Whisper can't transcribe them, so those lines are judged on length only
FICTIONAL = {'hesk', 'varo', 'tan', 'velmori', 'dosk', 'tarak', 'krask'}


# interjections and invented names: Whisper spells these unpredictably, so they don't count
IGNORE = {'ahh', 'ah', 'ugh', 'hm', 'hmm', 'huh', 'wha', 'uh', 'oh', 'velmoran', 'velmora', 'kharzan', 'kharzans',
          'thornwood', 'dell', 'brannoc', 'halvek', 'greycoats', 'rkm', 'r', 'k', 'm'}


def words(t, keep_all=False):
    t = t.lower().replace("'em", 'them').replace('twenty-eight', '28').replace('r k m', 'rkm')
    ws = [w for w in re.sub(r"[^a-z0-9' ]+", ' ', t).split() if w]
    return ws if keep_all else [w for w in ws if w not in IGNORE]


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    if not r:
        return 0.0
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)] / len(r)


def dynamics(audio, sr):
    # spread of loudness across 50 ms frames (dB): flat readings score low
    f = int(sr * 0.05)
    n = len(audio) // f
    if n < 4:
        return 0.0
    rms = np.sqrt(np.mean(audio[: n * f].reshape(n, f) ** 2, axis=1) + 1e-9)
    db = 20 * np.log10(rms)
    db = db[db > db.max() - 40]
    return float(np.std(db))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('lines')
    ap.add_argument('refs')
    ap.add_argument('out')
    ap.add_argument('--takes', type=int, default=3)
    ap.add_argument('--only', default='')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()

    torch.set_num_threads(os.cpu_count() or 4)
    from chatterbox.tts import ChatterboxTTS
    from transformers import pipeline

    lines = json.load(open(a.lines))
    only = set(filter(None, a.only.split(',')))
    os.makedirs(a.out, exist_ok=True)
    model = ChatterboxTTS.from_pretrained(device='cpu')
    asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en', device='cpu')

    for li, line in enumerate(lines):
        lid = line['id']
        if only and lid not in only:
            continue
        dst = os.path.join(a.out, f'{lid}.wav')
        if os.path.exists(dst) and not a.force:
            continue
        ref = os.path.join(a.refs, f"{line['voice']}.wav")
        exag, cfg, temp = DELIVERY.get(line.get('delivery', 'neutral'), DELIVERY['neutral'])
        text = line['spoken']
        nw = max(1, len(words(text, True)))
        fictional = sum(w in FICTIONAL for w in words(text, True)) / nw > 0.4
        expected = 0.33 * nw + 0.35 * text.count('...') + 0.2 * len(re.findall(r'[,.!?]', text)) + 0.3
        best = None
        for k in range(a.takes):
            torch.manual_seed(7919 * (k + 1) + li)
            wav = model.generate(text, audio_prompt_path=ref, exaggeration=exag, cfg_weight=cfg, temperature=temp)
            audio = wav.squeeze(0).cpu().numpy().astype(np.float32)
            dur = len(audio) / model.sr
            hyp = '' if fictional else asr({'raw': audio, 'sampling_rate': model.sr})['text']
            err = 0.0 if fictional else wer(text, hyp)
            ratio = dur / expected
            length_pen = 0.0 if 0.5 <= ratio <= 2.0 else min(1.0, abs(np.log(ratio)) * 0.5)
            dyn = dynamics(audio, model.sr)
            score = err * 2.0 + length_pen - 0.015 * dyn
            print(f'  take {k + 1}: wer={err:.2f} dur={dur:.2f}s (exp {expected:.1f}) dyn={dyn:.1f} score={score:.3f} | {hyp.strip()}', flush=True)
            if best is None or score < best[0]:
                best = (score, wav, err, dur)
            if err == 0.0 and length_pen == 0.0 and k >= 1:
                break  # two clean takes is plenty
        ta.save(dst, best[1], model.sr)
        print(f"[{li + 1}/{len(lines)}] {lid} ({line['cast']}/{line.get('delivery')}) wer={best[2]:.2f} dur={best[3]:.2f}s :: {text}", flush=True)


if __name__ == '__main__':
    sys.exit(main())
