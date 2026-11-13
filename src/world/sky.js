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
  constructor(scene, renderer, quality, camera, { sky: skyTex = null, hdr = null, sunU = 0.5, sunEl = 26.5 } = {}) {
    this.scene = scene;
    this.camera = camera;
    // the light comes from where the panorama's sun is painted (elevation), at our world azimuth
    const elevation = sunEl, azimuth = 128;
    this.sunU = sunU;
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
      const rotY = (sunU - 0.5) * Math.PI * 2 - Math.atan2(this.sunDir.z, this.sunDir.x);
      scene.backgroundRotation.set(0, rotY, 0);
      scene.environmentRotation.set(0, rotY, 0);
      this.fogColor.copy(horizonColor(skyTex.image, this.sunDir, rotY));
      if (hdr) {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = pmrem.fromEquirectangular(hdr).texture;
        scene.environmentIntensity = 0.78;
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

    this.sun = new THREE.DirectionalLight(0xffdcb2, 3.9);
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
        shadowMapSize: high ? 2048 : 1536, lightDirection: this.sunDir.clone().negate(), lightIntensity: 3.9,
        lightNear: 1, lightFar: 700, lightMargin: 180, shadowBias: -0.00015,
      });
      this.csm.fade = true;
      for (const l of this.csm.lights) {
        l.color.set(0xffdcb2);
        l.shadow.normalBias = 0.05;
        l.shadow.radius = 2;
      }
      this._csmMats = new Set();
    } else {
      scene.add(this.sun);
      scene.add(this.sun.target);
    }

    this.hemi = new THREE.HemisphereLight(0xbfd6ee, 0x5e4c32, skyTex ? 1.0 : 0.7); // sky fill + warm ground bounce
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(this.fogColor, 0.0037);

    // light-space basis for texel snapping
    this._right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this._up = new THREE.Vector3().crossVectors(this.sunDir, this._right).normalize();
    this._c = new THREE.Vector3();
  }

  // Chapter III: night under the ringed planet. Moonlight keeps the sun's direction (so
  // baked impostor lighting and shadows stay consistent); only colours and levels change.
  setNight(renderer, nightTex) {
    const scene = this.scene;
    if (!this._day) {
      this._day = {
        bg: scene.background, bgI: scene.backgroundIntensity, bgRot: scene.backgroundRotation.clone(), envRot: scene.environmentRotation.clone(),
        env: scene.environment, envI: scene.environmentIntensity, fog: this.fogColor.clone(), fogD: scene.fog.density,
        hemi: [this.hemi.color.clone(), this.hemi.groundColor.clone(), this.hemi.intensity],
        sun: [this.sun.color.clone(), this.sun.intensity],
        csm: this.csm ? this.csm.lights.map((l) => [l.color.clone(), l.intensity]) : null,
      };
    }
    scene.background = nightTex;
    scene.backgroundIntensity = 1.0;
    scene.backgroundRotation.set(0, 0, 0);
    scene.environmentRotation.set(0, 0, 0);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(nightTex).texture;
    pmrem.dispose();
    scene.environmentIntensity = 3.6;
    this.fogColor.set(0x1f3361);
    scene.fog.color.copy(this.fogColor);
    scene.fog.density = 0.0040;
    this.hemi.color.set(0x8aa4ea); this.hemi.groundColor.set(0x363e54); this.hemi.intensity = 2.5;
    const moon = new THREE.Color(0xa8c0ff);
    this.sun.color.copy(moon); this.sun.intensity = 2.8;
    if (this.csm) for (const l of this.csm.lights) { l.color.copy(moon); l.intensity = 2.8; }
    this.night = true;
  }

  // Swap the sky at runtime (Chapter IV's sunset walk): new panorama + IBL, the light moves
  // to the painted sun (azimuth `az`), with its elevation kept above `minEl` for shadows.
  setSky(renderer, { ldr, hdr, sunU, sunEl }, { az = 128, minEl = 9, sunColor = 0xffa868, sunI = 3.2, hemi = [0x9aa8c8, 0x5a3c2a, 0.85], envI = 0.95, fogD = 0.0034 } = {}) {
    const scene = this.scene;
    const el = Math.max(minEl, sunEl);
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - el), THREE.MathUtils.degToRad(az));
    const skyDirNoClamp = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunEl), THREE.MathUtils.degToRad(az));
    ldr.mapping = THREE.EquirectangularReflectionMapping;
    ldr.colorSpace = THREE.SRGBColorSpace;
    const rotY = (sunU - 0.5) * Math.PI * 2 - Math.atan2(skyDirNoClamp.z, skyDirNoClamp.x);
    scene.background = ldr; scene.backgroundIntensity = 1.15;
    scene.backgroundRotation.set(0, rotY, 0); scene.environmentRotation.set(0, rotY, 0);
    if (hdr) {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
    }
    scene.environmentIntensity = envI;
    this.fogColor.copy(horizonColor(ldr.image, this.sunDir, rotY));
    scene.fog.color.copy(this.fogColor); scene.fog.density = fogD;
    this.hemi.color.set(hemi[0]); this.hemi.groundColor.set(hemi[1]); this.hemi.intensity = hemi[2];
    this.sun.color.set(sunColor); this.sun.intensity = sunI;
    if (this.csm) {
      this.csm.lightDirection.copy(this.sunDir).negate();
      for (const l of this.csm.lights) { l.color.set(sunColor); l.intensity = sunI; }
    }
    this._right.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this._up.crossVectors(this.sunDir, this._right).normalize();
  }

  // back to the morning sky (Chapter IV)
  setDay() {
    const d = this._day, scene = this.scene;
    if (!d || !this.night) return;
    scene.background = d.bg; scene.backgroundIntensity = d.bgI;
    scene.backgroundRotation.copy(d.bgRot); scene.environmentRotation.copy(d.envRot);
    scene.environment = d.env; scene.environmentIntensity = d.envI;
    this.fogColor.copy(d.fog); scene.fog.color.copy(d.fog); scene.fog.density = d.fogD;
    this.hemi.color.copy(d.hemi[0]); this.hemi.groundColor.copy(d.hemi[1]); this.hemi.intensity = d.hemi[2];
    this.sun.color.copy(d.sun[0]); this.sun.intensity = d.sun[1];
    if (this.csm && d.csm) this.csm.lights.forEach((l, i) => { l.color.copy(d.csm[i][0]); l.intensity = d.csm[i][1]; });
    this.night = false;
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
