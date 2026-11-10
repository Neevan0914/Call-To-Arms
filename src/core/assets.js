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
export const TEXTURE_SETS = ['grass', 'dirt', 'forest_floor', 'rock', 'moss', 'gravel'];
export const SKY_FILES = { ldr: 'assets/sky/sky_morning.jpg', hdr: 'assets/sky/sky_morning_2k.hdr' };

export function assetUrl(path) {
  const embedded = (typeof window !== 'undefined' && window.__CTA_ASSETS) || null;
  return embedded && embedded[path] ? embedded[path] : path;
}

export async function loadTextures(onProgress) {
  const loader = new THREE.TextureLoader();
  const out = {};
  const jobs = [];
  for (const n of TEXTURE_SETS) {
    for (const k of ['albedo', 'normal']) {
      jobs.push(loader.loadAsync(assetUrl(`assets/textures/${n}_${k}.jpg`)).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = k === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = 8;
        (out[n] = out[n] || {})[k] = t;
      }).catch(() => {}));
    }
  }
  let sky = null;
  jobs.push(loader.loadAsync(assetUrl(SKY_FILES.ldr)).then((t) => { sky = t; }).catch(() => {}));
  let hdr = null;
  jobs.push(new RGBELoader().loadAsync(assetUrl(SKY_FILES.hdr)).then((t) => { hdr = t; }).catch(() => {}));
  let done = 0;
  jobs.forEach((j) => j.then(() => onProgress && onProgress(++done / jobs.length)));
  await Promise.all(jobs);
  const complete = Object.values(out).filter((s) => s.albedo && s.normal).length;
  return { ground: complete === TEXTURE_SETS.length ? out : null, sky, hdr };
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
