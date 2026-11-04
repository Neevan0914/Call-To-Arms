import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { WorldPass } from './worldpass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Cinematic grade: lens blur (wake-up), eyelids, split-tone, vignette, damage, grain, fade.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) },
    uBlur: { value: 0 }, uEyelid: { value: 0 }, uDamage: { value: 0 }, uDesat: { value: 0 }, uFade: { value: 0 },
    uVignette: { value: 0.55 }, uGrain: { value: 0.035 }, uChroma: { value: 0.0007 }, uRedTint: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uAspect, uBlur, uEyelid, uDamage, uDesat, uFade, uVignette, uGrain, uChroma, uRedTint;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 sampleCA(vec2 uv, float k) {
      vec2 d = (uv - 0.5) * k;
      return vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
    }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      vec3 col;
      if (uBlur > 0.002) {
        col = vec3(0.0);
        float tot = 0.0;
        for (int i = 0; i < 16; i++) {
          float a = float(i) * 2.39996;
          float rr = sqrt(float(i) / 16.0) * uBlur * 0.025;
          vec2 o = vec2(cos(a), sin(a)) * rr * vec2(1.0 / uAspect, 1.0);
          col += texture2D(tDiffuse, uv + o).rgb;
          tot += 1.0;
        }
        col /= tot;
      } else {
        col = sampleCA(uv, uChroma * (1.0 + r * 2.0));
      }
      // split toning: cool shadows, warm highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * vec3(0.94, 1.0, 1.06), (1.0 - smoothstep(0.0, 0.45, l)) * 0.35);
      col = mix(col, col * vec3(1.06, 1.0, 0.92), smoothstep(0.5, 1.0, l) * 0.3);
      col = (col - 0.5) * 1.04 + 0.5;
      col = mix(col, vec3(l), uDesat);
      col = mix(col, col * vec3(1.25, 0.7, 0.65), uRedTint);
      // vignette
      float v = smoothstep(1.05, 0.28, r);
      col *= mix(1.0, v, uVignette);
      // damage edges
      float edge = smoothstep(0.35, 0.95, r);
      col = mix(col, vec3(0.35, 0.0, 0.0), uDamage * edge * 0.85);
      // eyelids
      if (uEyelid > 0.001) {
        float lidCurve = 1.0 - pow(abs(c.x) * 1.6, 2.0) * 0.35;
        float openH = (1.0 - uEyelid) * 0.62 * lidCurve;
        float lid = smoothstep(openH, openH + 0.08, abs(c.y));
        col *= 1.0 - lid;
      }
      col += (hash(uv * uRes + fract(uTime) * 100.0) - 0.5) * uGrain;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.world = new WorldPass(scene, camera, { samples: quality === 'low' ? 0 : 4, ao: quality !== 'low', rays: quality !== 'low' });
    this.composer.addPass(this.world);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.5, 0.95);
    this.bloom.enabled = quality !== 'low';
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.u = this.grade.uniforms;
    this.setSize(size.x, size.y);
  }

  setQuality(q) {
    this.bloom.enabled = q !== 'low';
    this.world.setFeatures({ ao: q !== 'low', rays: q !== 'low' });
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.u.uAspect.value = w / h;
    this.u.uRes.value.set(w, h);
  }

  render(dt) {
    this.u.uTime.value += dt;
    this.composer.render(dt);
  }
}
