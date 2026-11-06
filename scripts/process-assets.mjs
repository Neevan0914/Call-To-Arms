// Turns the high-poly source models in assets-src/ into game-ready assets in public/assets/.
//   node scripts/process-assets.mjs
// - Soldiers: welded + decimated to two LODs (they are rigged at runtime, see chars/modelrig.js).
// - Trees: three LODs. Bark is decimated; foliage is thinned by dropping whole leaf/needle
//   clusters (and enlarging the survivors) so the canopy keeps its shape at distance.
// - Weapons: decimated.
import { NodeIO } from '@gltf-transform/core';
import { weld, prune, dedup, simplifyPrimitive, compactPrimitive, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdirSync, statSync, existsSync } from 'node:fs';

await MeshoptSimplifier.ready;
const io = new NodeIO();
const SRC = 'assets-src', OUT = 'public/assets';
for (const d of ['characters', 'nature', 'weapons', 'props']) mkdirSync(`${OUT}/${d}`, { recursive: true });

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

function triCount(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
  return n;
}

function simplifyPrim(prim, ratio, error) {
  if (ratio >= 1) return;
  simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
}

// Drop whole connected clusters (leaf sprays / needle cards), scale survivors up.
function thinClusters(prim, keep, grow, seed) {
  if (keep >= 1) return;
  const pos = prim.getAttribute('POSITION');
  const idxAcc = prim.getIndices();
  const n = pos.getCount();
  const P = pos.getArray();
  const I = idxAcc.getArray();
  const keyMap = new Map(); const wid = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
    let v = keyMap.get(k); if (v === undefined) { v = keyMap.size; keyMap.set(k, v); }
    wid[i] = v;
  }
  const par = new Int32Array(keyMap.size); for (let i = 0; i < par.length; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < I.length; t += 3) {
    const a = find(wid[I[t]]), b = find(wid[I[t + 1]]), c = find(wid[I[t + 2]]);
    par[a] = b; par[find(c)] = find(b);
  }
  const comp = new Int32Array(n); for (let i = 0; i < n; i++) comp[i] = find(wid[i]);
  const cx = new Map();
  for (let i = 0; i < n; i++) {
    let c = cx.get(comp[i]); if (!c) { c = [0, 0, 0, 0]; cx.set(comp[i], c); }
    c[0] += P[i * 3]; c[1] += P[i * 3 + 1]; c[2] += P[i * 3 + 2]; c[3]++;
  }
  const r = rng(seed);
  const kept = new Map();
  for (const [k, c] of cx) kept.set(k, r() < keep);
  const out = [];
  for (let t = 0; t < I.length; t += 3) if (kept.get(comp[I[t]])) out.push(I[t], I[t + 1], I[t + 2]);
  const scaled = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!kept.get(comp[i]) || scaled[i]) continue;
    const c = cx.get(comp[i]);
    const mx = c[0] / c[3], my = c[1] / c[3], mz = c[2] / c[3];
    P[i * 3] = mx + (P[i * 3] - mx) * grow; P[i * 3 + 1] = my + (P[i * 3 + 1] - my) * grow; P[i * 3 + 2] = mz + (P[i * 3 + 2] - mz) * grow;
    scaled[i] = 1;
  }
  pos.setArray(P);
  idxAcc.setArray(new Uint32Array(out));
  compactPrimitive(prim);
}

const FOLIAGE = /leaf|needle/i;

// Source models contain a few zero-length normals, which become NaN in lighting.
function repairNormals(doc) {
  let fixed = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const N = prim.getAttribute('NORMAL');
    if (!N) continue;
    const a = N.getArray();
    for (let i = 0; i < a.length; i += 3) {
      const l = Math.hypot(a[i], a[i + 1], a[i + 2]);
      if (!(l > 1e-4)) { a[i] = 0; a[i + 1] = 1; a[i + 2] = 0; fixed++; } else if (Math.abs(l - 1) > 1e-3) { a[i] /= l; a[i + 1] /= l; a[i + 2] /= l; }
    }
    N.setArray(a);
  }
  return fixed;
}

async function tree(name, lods) {
  // All LODs go into one file (nodes named lod0_*, lod1_*, lod2_*) sharing materials/textures.
  let target = null;
  const report = [];
  for (let li = 0; li < lods.length; li++) {
    const L = lods[li];
    const doc = await io.read(`${SRC}/${name}.glb`);
    await doc.transform(weld());
    const parts = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const foliage = FOLIAGE.test(prim.getMaterial()?.getName() || mesh.getName());
        if (foliage) {
          simplifyPrim(prim, L.leafSimplify, 0.03);
          thinClusters(prim, L.keep, L.grow, 1234 + li);
        } else {
          simplifyPrim(prim, L.bark, L.barkErr);
        }
        parts.push(`${prim.getMaterial()?.getName()}:${prim.getIndices().getCount() / 3}`);
      }
    }
    for (const node of doc.getRoot().listNodes()) node.setName(`lod${li}_${node.getName()}`);
    report.push(`  lod${li}: tris=${triCount(doc)} [${parts.join(' ')}]`);
    if (!target) target = doc;
    else {
      const map = mergeDocuments(target, doc);
      const scene = target.getRoot().listScenes()[0];
      for (const s2 of doc.getRoot().listScenes()) for (const n of s2.listChildren()) scene.addChild(map.get(n));
      for (const s2 of target.getRoot().listScenes()) if (s2 !== scene) s2.dispose();
    }
  }
  await target.transform(dedup(), unpartition(), prune());
  const fx = repairNormals(target); if (fx) console.log(`  repaired ${fx} zero normals`);
  const out = `${OUT}/nature/${name}.glb`;
  await io.write(out, target);
  console.log(`${out}  ${(statSync(out).size / 1e6).toFixed(2)}MB`);
  report.forEach((r) => console.log(r));
}

async function simple(name, dir, ratio, error, outName = name) {
  const doc = await io.read(`${SRC}/${name}.glb`);
  await doc.transform(weld());
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) simplifyPrim(prim, ratio, error);
  await doc.transform(prune(), dedup());
  repairNormals(doc);
  const out = `${OUT}/${dir}/${outName}.glb`;
  await io.write(out, doc);
  console.log(`${out}  tris=${triCount(doc)}  ${(statSync(out).size / 1e6).toFixed(2)}MB`);
}

const only = process.argv[2];
const run = (k) => !only || only === k;

if (run('soldiers')) {
  for (const s of ['soldier_rifleman', 'soldier_gunner']) {
    if (!existsSync(`${SRC}/${s}.glb`)) continue;
    await simple(s, 'characters', 0.05, 0.004, s);
    await simple(s, 'characters', 0.014, 0.012, `${s}_lod1`);
  }
}
if (run('weapons')) {
  if (existsSync(`${SRC}/rifle.glb`)) await simple('rifle', 'weapons', 0.16, 0.0004);
  if (existsSync(`${SRC}/lmg_wz28.glb`)) await simple('lmg_wz28', 'weapons', 0.16, 0.0004);
}
// Generic single-LOD prop: per-material rules { match: RegExp, keep, grow, simplify, error }
async function prop(srcName, outPath, rules) {
  const doc = await io.read(`${SRC}/${srcName}.glb`);
  await doc.transform(weld());
  const parts = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() || mesh.getName();
      const r = rules.find((x) => x.match.test(name)) || rules[rules.length - 1];
      if (r.simplify < 1) simplifyPrim(prim, r.simplify, r.error ?? 0.01);
      if (r.keep < 1) thinClusters(prim, r.keep, r.grow ?? 1, 99);
      parts.push(`${name}:${prim.getIndices().getCount() / 3}`);
    }
  }
  await doc.transform(prune(), dedup());
  repairNormals(doc);
  await io.write(outPath, doc);
  console.log(`${outPath}  tris=${triCount(doc)}  ${(statSync(outPath).size / 1e6).toFixed(2)}MB  [${parts.join(' ')}]`);
}

if (run('expansion') && existsSync(`${SRC}/expansion`)) {
  const X = (n) => `expansion/${n}`;
  const any = /./;
  await prop(X('sabre'), `${OUT}/weapons/sabre.glb`, [{ match: any, keep: 1, simplify: 0.12, error: 0.002 }]);
  await prop(X('sabre_scabbard'), `${OUT}/weapons/sabre_scabbard.glb`, [{ match: any, keep: 1, simplify: 0.22, error: 0.0005 }]);
  for (const h of ['brodie', 'crested', 'deep', 'flared']) {
    await prop(X(`helmet_${h}`), `${OUT}/characters/helmet_${h}.glb`, [{ match: any, keep: 1, simplify: 0.1, error: 0.004 }]);
  }
  for (const b of ['bush_hazel', 'bush_berry']) {
    await prop(X(b), `${OUT}/nature/${b}.glb`, [
      { match: /leaf/i, keep: 0.12, grow: 1.35, simplify: 0.22, error: 0.08 },
      { match: /berry/i, keep: 0.08, grow: 1.4, simplify: 0.1, error: 0.08 },
      { match: any, keep: 1, simplify: 0.04, error: 0.05 },
    ]);
  }
  for (const f of ['fern_clump', 'fern_small']) {
    await prop(X(f), `${OUT}/nature/${f}.glb`, [
      { match: /fern_/i, keep: 0.6, grow: 1.1, simplify: 0.06, error: 0.08 },
      { match: any, keep: 1, simplify: 0.08, error: 0.06 },
    ]);
  }
  for (const [r, k] of [['rock_boulder', 0.025], ['rock_slab', 0.03], ['rock_cluster', 0.015]]) {
    await prop(X(r), `${OUT}/nature/${r}.glb`, [
      { match: /moss/i, keep: 1, simplify: 0.12, error: 0.02 },
      { match: any, keep: 1, simplify: k, error: 0.01 },
    ]);
  }
}

if (run('trees')) {
  // keep: fraction of foliage clusters kept; grow: survivor scale-up; bark: decimation ratio
  // lod0 = near (<~35 m), lod1 = mid (<~75 m). Distant trees use billboard impostors baked at runtime.
  await tree('tree_pine', [
    { keep: 0.7, grow: 1.08, leafSimplify: 1, bark: 0.03, barkErr: 0.02 },
    { keep: 0.2, grow: 1.42, leafSimplify: 1, bark: 0.006, barkErr: 0.1 },
  ]);
  await tree('tree_birch', [
    { keep: 0.38, grow: 1.18, leafSimplify: 0.35, bark: 0.18, barkErr: 0.01 },
    { keep: 0.22, grow: 1.42, leafSimplify: 0.22, bark: 0.04, barkErr: 0.05 },
  ]);
  await tree('tree_oak', [
    { keep: 0.38, grow: 1.18, leafSimplify: 0.35, bark: 0.08, barkErr: 0.01 },
    { keep: 0.22, grow: 1.42, leafSimplify: 0.22, bark: 0.016, barkErr: 0.05 },
  ]);
}
