# Call To Arms — Chapter I: *The Thornwood*

A third-person 3D action game that runs in the browser (Three.js + WebGL2). There are
no external assets: the terrain, forest, fort, soldiers, weapons, textures, flags,
sound effects, music and voices are all generated in code when the game loads.

## Story (Chapter I)

1. **Wake up.** You come round in a forest clearing with a head wound and no memory.
   The cutscene shows the canopy through blurred, blinking eyes; then you sit up and stand.
2. **Ambush.** A five-man Kharzan patrol (grey-coated soldiers) opens fire. Your rifle,
   the *Varn M.09*, is lying in the grass beside you: pick it up (**E**) and fight them off.
3. **Out of ammo.** That was your last round, so you draw your **cavalry sabre**. Find
   the dirt road and follow it, cutting down two bayonet-wielding scouts on the way.
4. **Fort Velmar.** The road leads to a log fort flying the flag of the *Free Marches
   of Velmora*, a fictional nation (diagonal green/burgundy field, gold border, ivory
   roundel with a golden eight-pointed star). The sentries spot your burgundy collar
   tabs and open the gate.
5. **Welcome.** The garrison greets you as one of their own, and you suspect they're
   on your side. The quartermaster hands you an **Rkm M28 automatic rifle**, modelled
   on the interwar RKM Browning wz. 28.
6. **The attack.** A Kharzan assault blows open the west wall and storms the gate.
   You fight beside the garrison, but the fort falls. *To be continued…*

## Running it

```bash
npm install
npm run dev        # then open the printed URL (default http://localhost:5173)
```

Production build (static files in `dist/`, can be hosted anywhere):

```bash
npm run build
npm run preview
```

Single standalone file (everything inlined, opens straight from disk with no server):

```bash
npm run build:single   # -> dist/CallToArms.html
```

You need a browser with WebGL2 (current Chrome, Edge, Firefox or Safari) and a
reasonably capable GPU. The default is the **High** preset; switch to Medium or Low in
the pause menu (**Esc**) if the frame rate drops.

## Controls

| Action | Key |
| --- | --- |
| Move / sprint / jump / crouch | `WASD` / `Shift` / `Space` / `C` |
| Look | Mouse |
| Aim | Right mouse |
| Fire / sabre slash | Left mouse |
| Reload | `R` |
| Switch weapon | `1` rifle, `2` sabre, `3` Rkm M28, or mouse wheel |
| Interact | `E` |
| Skip cutscene | Hold `Space` |
| Pause / settings | `Esc` |

## Graphics & presentation

- Physical sky with image-based lighting, a golden-morning sun with soft shadows that
  follow the player, and exponential haze.
- GPU-instanced forest in streaming tiles, with wind sway on pines, broadleaf trees,
  bushes and ferns. Around the camera, about 140k wind-blown grass blades that bend
  away from the player.
- Splat-mapped terrain (grass, forest floor, dirt road with wheel ruts, rock) with
  anti-tiling, plus light shafts and drifting dust motes in the clearing.
- Cascaded shadow maps (3 cascades on High, 2 on Medium), so trees cast shadows
  far into the distance while staying crisp near the player.
- Screen-space ambient occlusion, volumetric sun shafts through the canopy, and
  cinematic depth of field that focuses on each cutscene shot's subject.
- Backlit translucency on leaves, needles and grass. Tree LODs (detailed near,
  lightweight far) give a longer draw distance, and the forest floor has pebbles,
  fallen branches, mushrooms and wildflowers.
- Post-processing: 4× MSAA, bloom, ACES tone mapping, split-tone grade, vignette,
  subtle chromatic aberration and film grain. Cutscenes add eyelid, blur and
  desaturation effects (waking up, the final shell blast).
- Procedurally animated soldiers: gait cycle, two-bone arm IK onto weapon grips,
  aiming, recoil, reloads, sabre swings, bayonet thrusts, get-up and death falls.
- The HUD is semi-transparent: objective, compass with a waypoint, health, ammo,
  hit markers, damage-direction indicators, subtitles and letterboxed cutscenes.
- Synthesized audio: gunshots with forest reverb, bolt cycling, bullet whizz,
  impacts, footsteps, explosions, an officer's whistle, birdsong and wind, and adaptive
  music. Dialogue uses the browser's speech synthesis (you can turn it off in settings).

## 3D assets

The game now uses real models for the soldiers, the rifle, the Rkm M28 and the forest
(pine, birch, oak). The high-poly source files live in `assets-src/`, which is git-ignored
because it's large. To rebuild the game-ready versions in `public/assets/`, run:

```bash
node scripts/process-assets.mjs
```

That script:
- **Soldiers:** cuts them to about 25k triangles, plus a distant version of about 9k.
- **Trees:** builds a near and a mid-distance version (the mid one thins leaf clusters
  and enlarges the ones it keeps), and repairs broken normals.
- **Weapons:** cuts them to about 15k triangles.

At runtime:
- **Soldier rigging:** the models are static, so `src/chars/modelrig.js` skins each vertex
  onto the game's animation skeleton. The skin weights respect each material (sleeves follow
  the arms, puttees follow the legs) and blend smoothly at the joints.
- **Factions:** the Velmorans use the rifleman model in olive. The Kharzan use the gunner
  model (tall boots), tinted slate grey, with their own coal-scuttle helmet.
- **Distant trees:** pictures of each tree, rendered from 8 angles at load, shown on cards
  that turn to face you.
- **Fallback:** if a file is missing, that object falls back to its procedural version.

## Voices

Every character has their own voice (`src/game/voices.js`), and every line in
`src/game/story.js` carries a delivery direction such as `groggy`, `panic`, `warm`,
`command` or `menace`. The lines are recorded in two stages:

1. **Voice samples:** Kokoro-82M (Apache-2.0) records a clean sample of each character's
   voice.
2. **Acted takes:** Chatterbox (Resemble AI, MIT) performs each line in that voice, with
   emotion intensity and pacing set by the line's delivery. It records several takes per
   line, Whisper transcribes them, and the script keeps the take that is word-accurate, a
   sensible length, and the most dynamic.

After that, the line gets its character's audio treatment: shouts, distant calls, a deeper
and grittier voice for the Kharzan, an echo for inner thoughts.

```bash
# one-time tools (big download: PyTorch + models from huggingface.co)
npm i --no-save kokoro-js@1.2.1
uv venv -p 3.11 .ttsenv && VIRTUAL_ENV=.ttsenv uv pip install chatterbox-tts==0.1.7

node scripts/generate-voices.mjs --json voicework/lines.json   # lines + delivery
node scripts/generate-voices.mjs --refs voicework/refs         # voice samples
.ttsenv/bin/python scripts/voices/chatterbox_takes.py voicework/lines.json voicework/refs voicework/raw
node scripts/generate-voices.mjs --from-raw voicework/raw      # effects -> public/assets/voice
```

To quickly redo everything with Kokoro alone, run `node scripts/generate-voices.mjs --force`.
Any line without a recording falls back to the browser's speech synthesis.

## Adding more 3D assets

See [ASSETS.md](ASSETS.md) for the list of models, animations and textures
that will replace the procedural stand-ins, and where to put them.

## Developer shortcuts

- `?q=low|medium|high` forces a quality preset.
- `?skip=ambush|path|fort|welcome|defend` jumps straight to a chapter section.
- `?autostart` skips the title screen.

## Project layout

```
src/
  core/    noise, audio synth, input, post-processing, helpers
  world/   terrain + road, sky/lighting, vegetation + grass, fort, physics/raycasts, VFX
  chars/   humanoid rig & animation, weapons, player controller, soldier AI
  game/    Game loop, camera rig, HUD, story/cutscene director
```

New chapters go in `src/game/story.js`: add a phase method and append it to `run()`.
