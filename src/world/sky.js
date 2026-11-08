import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CSM } from 'three/addons/csm/CSM.js';

// Average colour of the panorama just above the horizon, looking away from the sun
// (where most of the fogged distance is seen), in linear space.
function horizonColor(img, sunDir, rotY) {
  try {
    const w = 256, h = 128;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const row = ctx.getImageData(0, Math.floor(h * 0.47), w, 3).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < row.length; i += 4) { r += row[i]; g += row[i + 1]; b += row[i + 2]; n++; }
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace).multiplyScalar(1.1);
  } catch (e) {
    return new THREE.Color(0x9fb0b4);
  }
}

// Golden early-morning atmosphere: physical sky, IBL from the sky, warm sun with
// a texel-snapped shadow frustum that follows the focus point, and haze.
export class Atmosphere {
  constructor(scene, renderer, quality, camera, { sky: skyTex = null, hdr = null } = {}) {
    this.scene = scene;
    this.camera = camera;
    const elevation = 17, azimuth = 128;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.fogColor = new THREE.Color(0x9fb0b4);
    if (skyTex) {
      // Painted panorama (asset pack). Rotate it so its sun (+X in the image) sits at our sun.
      skyTex.mapping = THREE.EquirectangularReflectionMapping;
      skyTex.colorSpace = THREE.SRGBColorSpace;
      scene.background = skyTex;
      scene.backgroundIntensity = 1.2;
      const rotY = -Math.atan2(this.sunDir.z, this.sunDir.x);
      scene.backgroundRotation.set(0, rotY, 0);
      scene.environmentRotation.set(0, rotY, 0);
      this.fogColor.copy(horizonColor(skyTex.image, this.sunDir, rotY));
      if (hdr) {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = pmrem.fromEquirectangular(hdr).texture;
        scene.environmentIntensity = 0.62;
      } else {
        scene.environment = pmrem.fromEquirectangular(skyTex).texture;
        scene.environmentIntensity = 0.5;
      }
      this.sky = null;
    } else {
      const sky = new Sky();
      sky.scale.setScalar(900);
      const u = sky.material.uniforms;
      u.turbidity.value = 3.2;
      u.rayleigh.value = 2.2;
      u.mieCoefficient.value = 0.004;
      u.mieDirectionalG.value = 0.86;
      u.sunPosition.value.copy(this.sunDir);
      this.sky = sky;
      scene.add(sky);
      // Environment lighting from the sky
      const envScene = new THREE.Scene();
      const sky2 = new Sky();
      sky2.scale.setScalar(900);
      for (const k of Object.keys(u)) sky2.material.uniforms[k].value = u[k].value;
      envScene.add(sky2);
      scene.environment = pmrem.fromScene(envScene, 0, 0.1, 1000).texture;
      scene.environmentIntensity = 0.42;
    }
    pmrem.dispose();

    this.sun = new THREE.DirectionalLight(0xffd6a6, 3.4);
    this.sun.castShadow = true;
    this.shadowExtent = 60;
    const cam = this.sun.shadow.camera;
    cam.left = -this.shadowExtent; cam.right = this.shadowExtent;
    cam.top = this.shadowExtent; cam.bottom = -this.shadowExtent;
    cam.near = 1; cam.far = 400;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.045;
    this.setShadowQuality(quality);
    // Cascaded shadow maps on medium/high: crisp shadows near the player and tree
    // shadows that reach far into the distance. Low keeps a single follow-cam map.
    this.csm = null;
    if (camera && quality !== 'low') {
      const high = quality === 'high';
      this.csm = new CSM({
        camera, parent: scene, cascades: high ? 3 : 2, maxFar: high ? 190 : 120, mode: 'practical',
        shadowMapSize: high ? 2048 : 1536, lightDirection: this.sunDir.clone().negate(), lightIntensity: 3.4,
        lightNear: 1, lightFar: 700, lightMargin: 180, shadowBias: -0.00015,
      });
      this.csm.fade = true;
      for (const l of this.csm.lights) {
        l.color.set(0xffd6a6);
        l.shadow.normalBias = 0.05;
        l.shadow.radius = 2;
      }
      this._csmMats = new Set();
    } else {
      scene.add(this.sun);
      scene.add(this.sun.target);
    }

    this.hemi = new THREE.HemisphereLight(0xb9d0e6, 0x4a3b26, skyTex ? 0.75 : 0.55);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(this.fogColor, 0.0048);

    // light-space basis for texel snapping
    this._right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this._up = new THREE.Vector3().crossVectors(this.sunDir, this._right).normalize();
    this._c = new THREE.Vector3();
  }

  // Chapter III: night under the ringed planet. Moonlight keeps the sun's direction (so
  // baked impostor lighting and shadows stay consistent); only colours and levels change.
  setNight(renderer, nightTex) {
    const scene = this.scene;
    scene.background = nightTex;
    scene.backgroundIntensity = 1.0;
    scene.backgroundRotation.set(0, 0, 0);
    scene.environmentRotation.set(0, 0, 0);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(nightTex).texture;
    pmrem.dispose();
    scene.environmentIntensity = 1.6;
    this.fogColor.set(0x14244a);
    scene.fog.color.copy(this.fogColor);
    scene.fog.density = 0.0052;
    this.hemi.color.set(0x5470b8); this.hemi.groundColor.set(0x0d111c); this.hemi.intensity = 0.7;
    const moon = new THREE.Color(0xa8c0ff);
    this.sun.color.copy(moon); this.sun.intensity = 1.05;
    if (this.csm) for (const l of this.csm.lights) { l.color.copy(moon); l.intensity = 1.05; }
    this.night = true;
  }

  setShadowQuality(q) {
    const size = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.radius = q === 'low' ? 1 : 2;
  }

  // Enable cascaded shadows on a lit material, keeping any existing shader hooks.
  setupMaterial(mat) {
    if (!this.csm || this._csmMats.has(mat) || !mat.isMaterial) return;
    if (!(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial)) return;
    this._csmMats.add(mat);
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey();
    this.csm.setupMaterial(mat);
    const hook = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); hook.call(this, sh, r); };
    mat.customProgramCacheKey = () => prevKey + '|csm';
    mat.needsUpdate = true;
  }

  setupScene(root) {
    if (!this.csm) return;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => this.setupMaterial(m));
    });
  }

  update(camera, focus) {
    if (this.sky) this.sky.position.copy(camera.position);
    if (this.csm) {
      if (camera.fov !== this._fov || camera.aspect !== this._aspect) {
        this._fov = camera.fov; this._aspect = camera.aspect;
        this.csm.updateFrustums();
      }
      this.csm.update();
      return;
    }
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const a = Math.round(focus.dot(this._right) / texel) * texel;
    const b = Math.round(focus.dot(this._up) / texel) * texel;
    const c = focus.dot(this.sunDir);
    this._c.copy(this._right).multiplyScalar(a).addScaledVector(this._up, b).addScaledVector(this.sunDir, c);
    this.sun.target.position.copy(this._c);
    this.sun.position.copy(this._c).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
  }
}
