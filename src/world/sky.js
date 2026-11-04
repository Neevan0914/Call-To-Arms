import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Golden early-morning atmosphere: physical sky, IBL from the sky, warm sun with
// a texel-snapped shadow frustum that follows the focus point, and haze.
export class Atmosphere {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    const elevation = 17, azimuth = 128;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

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
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(900);
    for (const k of Object.keys(u)) sky2.material.uniforms[k].value = u[k].value;
    envScene.add(sky2);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 1000);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.42;
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
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xb9d0e6, 0x4a3b26, 0.55);
    scene.add(this.hemi);

    this.fogColor = new THREE.Color(0x9fb0b4);
    scene.fog = new THREE.FogExp2(this.fogColor, 0.0048);

    // light-space basis for texel snapping
    this._right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this._up = new THREE.Vector3().crossVectors(this.sunDir, this._right).normalize();
    this._c = new THREE.Vector3();
  }

  setShadowQuality(q) {
    const size = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.radius = q === 'low' ? 1 : 2;
  }

  update(camera, focus) {
    this.sky.position.copy(camera.position);
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
