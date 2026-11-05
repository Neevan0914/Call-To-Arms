import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
};

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  const embedded = (typeof window !== 'undefined' && window.__CTA_ASSETS) || null;
  const out = {};
  const keys = Object.keys(ASSET_FILES);
  let done = 0;
  await Promise.all(keys.map(async (k) => {
    const path = ASSET_FILES[k];
    const url = embedded && embedded[path] ? embedded[path] : path;
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
