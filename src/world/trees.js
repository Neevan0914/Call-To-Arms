import * as THREE from 'three';
import { bakedMeshes } from '../core/assets.js';

// Model-based forest: three species (pine, birch, oak), each with two mesh LODs from the
// asset file (nodes lod0_*, lod1_*) and a billboard impostor for distance. Visibility and
// LOD are chosen per tree every frame, with frustum culling (plus a margin for shadow casters).

export const SPECIES = {
  pine: { trunkR: 0.3, wind: 0.012, transl: 0.45 },
  birch: { trunkR: 0.19, wind: 0.02, transl: 0.65 },
  oak: { trunkR: 0.42, wind: 0.016, transl: 0.6 },
};

const FRAMES = 8;

// Dithered LOD cross-fade. aFade <= 1: keep pixels whose dither value < aFade;
// aFade > 1: keep pixels whose dither value >= aFade - 1. The two LODs of a tree in a
// transition band get complementary values, so together they always cover the tree once.
const DITHER = `{
  float ditherV = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (vFade <= 1.0 ? ditherV >= vFade : ditherV < vFade - 1.0) discard;
}`;
function ditherFade(mat) {
  if (mat.userData.dither) return;
  mat.userData.dither = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('void main() {', `void main() {\n${DITHER}`);
  };
  mat.customProgramCacheKey = () => prevKey + '|dither';
  mat.needsUpdate = true;
}
const FOLIAGE = /leaf|needle/i;

const IMPOSTOR_VS = `
  uniform float uR, uH;
  uniform vec3 uSunDir;
  attribute float aFade;
  varying float vFade;
  varying vec2 vUv;
  varying float vSun;
  varying vec3 vTint;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec3 wp = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float s = length(instanceMatrix[0].xyz);
    float yaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
    vec3 toCam = cameraPosition - wp; toCam.y = 0.0;
    toCam /= max(length(toCam), 1e-3);
    vec3 right = vec3(toCam.z, 0.0, -toCam.x);
    vec3 p = wp + right * position.x * uR * s + vec3(0.0, position.y * uH * s, 0.0);
    float ang = atan(toCam.x, toCam.z) - yaw;
    float f = mod(floor(ang / 6.2831853 * ${FRAMES}.0 + 0.5) + ${FRAMES * 4}.0, ${FRAMES}.0);
    float col = mod(f, 4.0), row = floor(f / 4.0);
    vUv = vec2((col + position.x * 0.5 + 0.5) / 4.0, (row + position.y) / 2.0);
    vec3 n = normalize(right * position.x * 0.9 + toCam * 0.55 + vec3(0.0, position.y * 0.5, 0.0));
    vSun = max(dot(n, uSunDir), 0.0);
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #else
      vTint = vec3(1.0);
    #endif
    vFade = aFade;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const IMPOSTOR_FS = `
  uniform sampler2D tAtlas;
  uniform float uAmb, uSunI;
  uniform vec3 uSunCol;
  varying vec2 vUv;
  varying float vSun;
  varying vec3 vTint;
  varying float vFade;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    ${DITHER}
    // cap the mip level: averaged alpha in small mips would turn silhouettes into blocks
    vec2 tsz = vec2(textureSize(tAtlas, 0));
    vec2 dx = dFdx(vUv * tsz), dy = dFdy(vUv * tsz);
    float lod = 0.5 * log2(max(dot(dx, dx), dot(dy, dy)));
    vec4 t = textureLod(tAtlas, vUv, clamp(lod - 0.5, 0.0, 2.0));
    if (t.a < 0.5) discard;
    vec3 col = t.rgb * vTint * (uAmb + uSunCol * uSunI * vSun);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`;

function lodParts(root, lod) {
  return bakedMeshes(root, (o) => o.name.startsWith(`lod${lod}_`) || (o.parent && o.parent.name.startsWith(`lod${lod}_`)));
}

export class TreeSystem {
  constructor(scene, renderer, assets, trees, { windify, uniforms, quality, sunDir }) {
    this.scene = scene;
    this.trees = trees;
    this.species = {};
    const Q = quality;
    this.setQuality(Q);
    this.draw = Q === 'high' ? 470 : Q === 'medium' ? 400 : 320;
    this.margin = 32;
    const counts = {};
    for (const t of trees) counts[t.species] = (counts[t.species] || 0) + 1;

    for (const name of Object.keys(SPECIES)) {
      const root = assets[name];
      if (!root || !counts[name]) continue;
      const cap = counts[name];
      const sp = { name, lods: [], height: 1, radius: 1 };
      const parts0 = lodParts(root, 0);
      const parts1 = lodParts(root, 1);
      // bounds from LOD0
      let R = 0, Hh = 0;
      for (const p of parts0) {
        const a = p.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) {
          R = Math.max(R, Math.hypot(a.getX(i), a.getZ(i)));
          Hh = Math.max(Hh, a.getY(i));
        }
      }
      sp.radius = R; sp.height = Hh;
      // prepare materials: wind + translucency on foliage
      const seen = new Set();
      for (const p of [...parts0, ...parts1]) {
        const m = p.material;
        if (seen.has(m)) continue;
        seen.add(m);
        if (FOLIAGE.test(m.name)) {
          m.side = THREE.DoubleSide;
          if (m.alphaTest > 0) m.alphaTest = Math.max(m.alphaTest, 0.4);
          windify(m, uniforms, SPECIES[name].wind, Hh, SPECIES[name].transl);
        }
        ditherFade(m);
      }
      for (const [li, parts] of [[0, parts0], [1, parts1]]) {
        const matAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
        matAttr.setUsage(THREE.DynamicDrawUsage);
        const colAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        colAttr.setUsage(THREE.DynamicDrawUsage);
        const fadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
        fadeAttr.setUsage(THREE.DynamicDrawUsage);
        const meshes = parts.map((p) => {
          p.geometry.setAttribute('aFade', fadeAttr);
          const im = new THREE.InstancedMesh(p.geometry, p.material, cap);
          im.instanceMatrix = matAttr;
          im.instanceColor = colAttr;
          im.frustumCulled = false;
          im.castShadow = true;
          im.receiveShadow = true;
          im.count = 0;
          scene.add(im);
          return im;
        });
        sp.lods.push({ meshes, matAttr, colAttr, fadeAttr, count: 0 });
      }
      // impostor
      const atlas = this._bake(renderer, parts0, R, Hh, Q === 'low' ? 256 : 512);
      const g = new THREE.PlaneGeometry(2, 1);
      g.translate(0, 0.5, 0);
      const imat = new THREE.ShaderMaterial({
        vertexShader: IMPOSTOR_VS, fragmentShader: IMPOSTOR_FS, fog: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
          tAtlas: { value: null }, uR: { value: R }, uH: { value: Hh }, uSunDir: { value: sunDir.clone() },
          uAmb: { value: 0.62 }, uSunI: { value: 0.75 }, uSunCol: { value: new THREE.Color(1.0, 0.86, 0.66) },
        }]),
      });
      imat.uniforms.tAtlas.value = atlas.texture;
      (this.impostorMats || (this.impostorMats = [])).push(imat);
      const imp = new THREE.InstancedMesh(g, imat, cap);
      const iMat = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16); iMat.setUsage(THREE.DynamicDrawUsage);
      const iCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); iCol.setUsage(THREE.DynamicDrawUsage);
      const iFade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); iFade.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aFade', iFade);
      imp.instanceMatrix = iMat; imp.instanceColor = iCol;
      imp.frustumCulled = false; imp.castShadow = false; imp.receiveShadow = false; imp.count = 0;
      scene.add(imp);
      sp.lods.push({ meshes: [imp], matAttr: iMat, colAttr: iCol, fadeAttr: iFade, count: 0 });
      sp.atlas = atlas;
      this.species[name] = sp;
    }

    // per-tree matrices
    const n = trees.length;
    this.mats = new Float32Array(n * 16);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), p = new THREE.Vector3();
    trees.forEach((t, i) => {
      q.setFromAxisAngle(up, t.ry);
      m.compose(p.set(t.x, t.y, t.z), q, s.setScalar(t.s));
      m.toArray(this.mats, i * 16);
    });
    this._frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
    this._sph = new THREE.Sphere();
  }

  _bake(renderer, parts, R, H, cell) {
    const rt = new THREE.WebGLRenderTarget(cell * 4, cell * 2, {
      samples: 4, generateMipmaps: false, minFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace,
    });
    const sc = new THREE.Scene();
    for (const p of parts) sc.add(new THREE.Mesh(p.geometry, p.material));
    sc.add(new THREE.HemisphereLight(0xffffff, 0x8a8a7a, 2.3));
    const cam = new THREE.OrthographicCamera(-R, R, H, 0, 0.1, 200);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(0.3, 1, 1);
    cam.add(key);
    sc.add(cam);
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevShadow = renderer.shadowMap.enabled;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x2c3a22, 0);
    renderer.autoClear = false;
    rt.scissorTest = false;
    renderer.clear();
    rt.scissorTest = true;
    for (let k = 0; k < FRAMES; k++) {
      const a = (k / FRAMES) * Math.PI * 2;
      cam.position.set(Math.sin(a) * 60, 0, Math.cos(a) * 60);
      cam.lookAt(0, 0, 0);
      const col = k % 4, row = Math.floor(k / 4);
      rt.viewport.set(col * cell, row * cell, cell, cell);
      rt.scissor.set(col * cell, row * cell, cell, cell);
      renderer.setRenderTarget(rt); // re-bind so the new viewport/scissor take effect
      renderer.render(sc, cam);
    }
    rt.scissorTest = false;
    rt.viewport.set(0, 0, cell * 4, cell * 2);
    rt.scissor.set(0, 0, cell * 4, cell * 2);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.enabled = prevShadow;
    // Read back and re-upload as a regular texture: reliable mipmaps, and transparent
    // texels get their neighbours' colour so distant foliage has no dark fringes.
    const w = cell * 4, h = cell * 2;
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    rt.dispose();
    for (let pass = 0; pass < 4; pass++) {
      const src = px.slice();
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3] > 0) continue;
        let r = 0, g2 = 0, b = 0, n = 0;
        for (const o of [-4, 4, -w * 4, w * 4]) if (src[i + o + 3] > 0) { r += src[i + o]; g2 += src[i + o + 1]; b += src[i + o + 2]; n++; }
        if (n) { px[i] = r / n; px[i + 1] = g2 / n; px[i + 2] = b / n; px[i + 3] = 1; }
      }
    }
    for (let i = 3; i < px.length; i += 4) if (px[i] === 1) px[i] = 0;
    const tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return { texture: tex };
  }

  setSunset(dir) {
    for (const m of this.impostorMats || []) {
      m.uniforms.uSunDir.value.copy(dir);
      m.uniforms.uAmb.value = 0.5;
      m.uniforms.uSunI.value = 0.85;
      m.uniforms.uSunCol.value.set(1.0, 0.66, 0.42);
    }
  }

  setDay() {
    for (const m of this.impostorMats || []) {
      m.uniforms.uAmb.value = 0.62;
      m.uniforms.uSunI.value = 0.75;
      m.uniforms.uSunCol.value.set(1.0, 0.86, 0.66);
    }
  }

  // moonlit impostors (Chapter III)
  setNight() {
    for (const m of this.impostorMats || []) {
      m.uniforms.uAmb.value = 0.32;
      m.uniforms.uSunI.value = 0.85;
      m.uniforms.uSunCol.value.set(0.55, 0.68, 1.0);
    }
  }

  setQuality(q) {
    this.l0 = q === 'high' ? 38 : q === 'medium' ? 28 : 17;
    this.l1 = q === 'high' ? 105 : q === 'medium' ? 80 : 52;
    this.band0 = q === 'low' ? 6 : 10; // cross-fade band widths (m)
    this.band1 = q === 'low' ? 12 : 22;
  }

  update(camera) {
    camera.updateMatrixWorld();
    this._pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
    const cx = camera.position.x, cz = camera.position.z;
    const dr = this.draw * this.draw;
    const a0 = this.l0 - this.band0 / 2, a1 = this.l0 + this.band0 / 2;
    const b0 = this.l1 - this.band1 / 2, b1 = this.l1 + this.band1 / 2;
    for (const k in this.species) for (const L of this.species[k].lods) L.count = 0;
    const T = this.trees, M = this.mats, sph = this._sph, fr = this._frustum;
    const put = (L, i, t, fade) => {
      const j = L.count++;
      const a = L.matAttr.array, o = i * 16, p = j * 16;
      for (let k = 0; k < 16; k++) a[p + k] = M[o + k];
      L.colAttr.array[j * 3] = t.c; L.colAttr.array[j * 3 + 1] = t.c; L.colAttr.array[j * 3 + 2] = t.c;
      L.fadeAttr.array[j] = fade;
    };
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      const sp = this.species[t.species];
      if (!sp) continue;
      const dx = t.x - cx, dz = t.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > dr) continue;
      const d = Math.sqrt(d2);
      const meshLod = d < b1;
      const h = sp.height * t.s;
      sph.center.set(t.x, t.y + h * 0.5, t.z);
      sph.radius = Math.max(h * 0.55, sp.radius * t.s) + (meshLod ? this.margin : 0);
      if (!fr.intersectsSphere(sph)) continue;
      const L = sp.lods;
      if (d < a0) put(L[0], i, t, 1);
      else if (d < a1) { const f = (d - a0) / (a1 - a0); put(L[0], i, t, 1 - f); put(L[1], i, t, 2 - f); }
      else if (d < b0) put(L[1], i, t, 1);
      else if (d < b1) { const f = (d - b0) / (b1 - b0); put(L[1], i, t, 1 - f); put(L[2], i, t, 2 - f); }
      else put(L[2], i, t, 1);
    }
    for (const k in this.species) {
      for (const L of this.species[k].lods) {
        L.matAttr.needsUpdate = true;
        L.colAttr.needsUpdate = true;
        L.fadeAttr.needsUpdate = true;
        L.matAttr.addUpdateRange?.(0, L.count * 16);
        for (const m of L.meshes) { m.count = L.count; m.visible = L.count > 0; }
      }
    }
  }
}
