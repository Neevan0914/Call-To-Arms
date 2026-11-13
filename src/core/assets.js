import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// Loads the game's glTF assets. Every asset is optional: if a file is missing or fails
// to load, the game falls back to its procedural stand-in for that object.
// In the single-file build the GLBs are embedded as data URIs in window.__CTA_ASSETS.
export const ASSET_FILES = {
  pine: 'assets/nature/tree_pine.glb',
  birch: 'assets/nature/tree_birch.glb',
  oak: 'assets/nature/tree_oak.glb',
  rifleman: 'assets/characters/soldier_rifleman.glb',
  riflemanLod: 'assets/characters/soldier_rifleman_lod1.glb',
  gunner: 'assets/characters/soldier_gunner.glb',
  gunnerLod: 'assets/characters/soldier_gunner_lod1.glb',
  rifle: 'assets/weapons/rifle.glb',
  lmg: 'assets/weapons/lmg_wz28.glb',
  sabre: 'assets/weapons/sabre.glb',
  scabbard: 'assets/weapons/sabre_scabbard.glb',
  axe: 'assets/weapons/battle_axe.glb',
  helmet_brodie: 'assets/characters/helmet_brodie.glb',
  helmet_crested: 'assets/characters/helmet_crested.glb',
  helmet_deep: 'assets/characters/helmet_deep.glb',
  helmet_flared: 'assets/characters/helmet_flared.glb',
  bush_hazel: 'assets/nature/bush_hazel.glb',
  bush_berry: 'assets/nature/bush_berry.glb',
  fern_clump: 'assets/nature/fern_clump.glb',
  fern_small: 'assets/nature/fern_small.glb',
  rock_boulder: 'assets/nature/rock_boulder.glb',
  rock_slab: 'assets/nature/rock_slab.glb',
  rock_cluster: 'assets/nature/rock_cluster.glb',
};

// Ground texture sets (albedo + OpenGL normal map, ~1 m per tile) and the sky panorama.
export const TEXTURE_SETS = ['grass', 'dirt', 'forest_floor', 'rock', 'moss'];
// Sky panoramas from the texture pack. sunU/sunEl: where the sun sits in each image
// (measured from the HDR: brightest texel), so the world's light can be lined up with it.
export const SKY_FILES = {
  day: { ldr: 'assets/sky/sky_day_4k.jpg', hdr: 'assets/sky/sky_day_2k.hdr', sunU: 0.6104, sunEl: 38.5 },
  sunset: { ldr: 'assets/sky/sky_sunset_4k.jpg', hdr: 'assets/sky/sky_sunset_2k.hdr', sunU: 0.2222, sunEl: 2.8 },
};

export function assetUrl(path) {
  const embedded = (typeof window !== 'undefined' && window.__CTA_ASSETS) || null;
  return embedded && embedded[path] ? embedded[path] : path;
}

export async function loadTextures(onProgress) {
  const loader = new THREE.TextureLoader();
  const out = {};
  const jobs = [];
  for (const n of TEXTURE_SETS) {
    for (const k of ['ca', 'nrh']) {
      jobs.push(loader.loadAsync(assetUrl(`assets/textures/${n}_${k}.webp`)).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = k === 'ca' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = 8;
        (out[n] = out[n] || {})[k] = t;
      }).catch(() => {}));
    }
  }
  const skies = {};
  for (const [name, f] of Object.entries(SKY_FILES)) {
    jobs.push(loader.loadAsync(assetUrl(f.ldr)).then((t) => { (skies[name] = skies[name] || { ...f }).ldr = t; }).catch(() => {}));
    jobs.push(new RGBELoader().loadAsync(assetUrl(f.hdr)).then((t) => { (skies[name] = skies[name] || { ...f }).hdr = t; }).catch(() => {}));
  }
  let done = 0;
  jobs.forEach((j) => j.then(() => onProgress && onProgress(++done / jobs.length)));
  await Promise.all(jobs);
  const complete = Object.values(out).filter((s) => s.ca && s.nrh).length;
  const day = skies.day || {};
  return { ground: complete === TEXTURE_SETS.length ? out : null, sky: day.ldr || null, hdr: day.hdr || null, skies };
}

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  const out = {};
  const keys = Object.keys(ASSET_FILES);
  let done = 0;
  await Promise.all(keys.map(async (k) => {
    const path = ASSET_FILES[k];
    const url = assetUrl(path);
    try {
      const gltf = await loader.loadAsync(url);
      out[k] = gltf.scene;
    } catch (e) {
      console.warn(`[assets] ${path} unavailable, using procedural fallback`, e && e.message);
      out[k] = null;
    }
    done++;
    if (onProgress) onProgress(done / keys.length, k);
  }));
  return out;
}

// Collect meshes of a glTF scene with their transforms baked into cloned geometry.
export function bakedMeshes(root, filter = null) {
  root.updateMatrixWorld(true);
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (filter && !filter(o)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    list.push({ name: o.name, geometry: g, material: o.material });
  });
  return list;
}

export function boundsOf(list) {
  const b = new THREE.Box3();
  for (const m of list) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox); }
  return b;
}
