# Asset checklist (what to send for the realism upgrade)

The game runs today on procedural stand-ins, so nothing below is required.
Each asset you send replaces one stand-in. Put the files in `public/assets/`,
using the folders below, and commit them or send them over.

**Format:** `.glb` (binary glTF) is best. `.gltf` and `.fbx` also work, but
I'll convert those to `.glb`. Textures can be inside the `.glb` or sit next to it
as `.png`/`.jpg`.

**Scale:** 1 unit = 1 metre, Y up. A soldier is about 1.8 m tall.

**Licence:** use only assets you're allowed to put in a game (CC0, CC-BY with
credit, Mixamo, or bought). Keep a note of the source for anything that needs credit.

## 1. Characters (`public/assets/characters/`) — biggest visual gain

| File | What | Notes |
| --- | --- | --- |
| `player.glb` | The hero: interwar/WWI-era infantry uniform, no helmet (bandage is a bonus) | Rigged (humanoid skeleton) |
| `ally.glb` | Velmoran soldier: khaki/olive tunic, puttees, helmet | Same skeleton as the player if possible |
| `ally_officer.glb` | Captain: peaked cap, tall boots, Sam Browne belt | Optional; can reuse `ally.glb` |
| `enemy.glb` | Kharzan soldier: grey/slate tunic, steel helmet, jackboots | Rigged |
| `enemy_coat.glb` | Kharzan soldier in a greatcoat (final assault) | Optional |

**Animations** (in the same `.glb`, or as separate Mixamo `.fbx` files on the same
skeleton). Name them like this, or tell me the names you used:

`idle`, `walk`, `run`, `sprint`, `crouch_idle`, `crouch_walk`,
`rifle_idle`, `rifle_aim`, `rifle_walk_aim`, `rifle_fire`, `rifle_reload`,
`sword_idle`, `sword_slash_1`, `sword_slash_2`, `bayonet_thrust`,
`hit_react`, `death_forward`, `death_backward`, `get_up_from_back`,
`lying_on_back`, `talk_gesture`, `wave`, `salute`.

On Mixamo you can upload one character and download all of these "Without Skin"
(everything except the character itself, which goes "With Skin"). If an animation
is missing, I'll keep the procedural version for it.

## 2. Weapons (`public/assets/weapons/`)

| File | What |
| --- | --- |
| `rifle.glb` | Bolt-action rifle (Mauser/Mosin/Lee-Enfield style) |
| `rifle_bayonet.glb` | The same rifle with a bayonet (optional) |
| `lmg.glb` | BAR / RKM wz. 28-style automatic rifle with a bipod |
| `sabre.glb` | Curved cavalry sabre |
| `scabbard.glb` | Its scabbard (optional) |

Point the barrel along **+Z**, with the stock/butt at the origin if you can.
If not, I'll re-orient them myself.

## 3. Vegetation (`public/assets/nature/`)

| File | What |
| --- | --- |
| `pine_*.glb` (2–3 variants) | Spruce/pine trees, ideally with a low-poly LOD |
| `broadleaf_*.glb` (2 variants) | Oak/beech/birch |
| `bush_*.glb`, `fern.glb` | Undergrowth |
| `grass_clump.glb` | Optional (the GPU grass already works) |
| `rock_*.glb`, `log.glb`, `stump.glb` | Forest props |

Foliage with alpha-cutout leaf cards (Poly Haven, Quixel and SpeedTree style)
works great.

## 4. Materials and sky (`public/assets/textures/`, `public/assets/sky/`)

Free CC0 sources: **ambientCG.com** and **polyhaven.com**. For each material,
download the 1K or 2K version with *Color*, *Normal* and *Roughness* maps (and
*AO* if it's there):

`forest_ground`, `grass_ground`, `dirt_path`, `rock`, `bark`, `wood_planks`,
`log_wall`, `roof_shingles`, `fabric_wool`, `sandbag`.

For the sky, one HDRI of a morning or golden-hour forest or field (`.hdr`, 2K or
4K) from Poly Haven.

## 5. Fort (`public/assets/fort/`), optional

A wooden palisade wall segment, a watchtower, a log cabin, crates, barrels,
sandbags and a tent. The procedural fort is decent, so this one matters least.
