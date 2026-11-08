import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Renders the scene into its own MSAA target with a depth texture, then uses that
// depth for screen-space effects:
//  - ambient occlusion (half resolution, hemisphere sampling, depth-aware blur)
//  - volumetric sun shafts / god rays (half resolution radial march over sky pixels)
//  - depth of field for cutscenes (golden-angle gather)

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const AO_FRAG = `
  #include <packing>
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform mat4 uProj, uInvProj;
  uniform float uRadius, uIntensity, uFrame, uNear, uFar;
  uniform vec2 uSunUV;
  uniform float uSunVis;
  uniform float uAO, uAspect;
  varying vec2 vUv;
  float depthAt(vec2 uv) { return texture2D(tDepth, uv).x; }
  vec3 viewPos(vec2 uv, float d) {
    vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 v = uInvProj * c;
    return v.xyz / v.w;
  }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    float d = depthAt(vUv);
    float ao = 1.0;
    float n = ign(gl_FragCoord.xy + uFrame * 5.588238);
    if (uAO > 0.5 && d < 0.99999) {
      vec3 P = viewPos(vUv, d);
      vec2 px = 1.0 / uRes;
      vec3 Pr = viewPos(vUv + vec2(px.x, 0.0), depthAt(vUv + vec2(px.x, 0.0)));
      vec3 Pl = viewPos(vUv - vec2(px.x, 0.0), depthAt(vUv - vec2(px.x, 0.0)));
      vec3 Pu = viewPos(vUv + vec2(0.0, px.y), depthAt(vUv + vec2(0.0, px.y)));
      vec3 Pd = viewPos(vUv - vec2(0.0, px.y), depthAt(vUv - vec2(0.0, px.y)));
      vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
      vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
      vec3 N = normalize(cross(dx, dy));
      float dist = -P.z;
      float radius = uRadius * (1.0 + dist * 0.02);
      float occ = 0.0;
      const int S = 14;
      for (int i = 0; i < S; i++) {
        float fi = (float(i) + n) / float(S);
        float phi = float(i) * 2.39996323 + n * 6.2831853;
        float ct = 1.0 - 2.0 * fract(fi * 7.31 + n);
        float st = sqrt(max(0.0, 1.0 - ct * ct));
        vec3 dir = vec3(cos(phi) * st, sin(phi) * st, ct);
        if (dot(dir, N) < 0.0) dir = -dir;
        vec3 S3 = P + (dir + N * 0.1) * radius * mix(0.15, 1.0, fi * fi);
        vec4 c = uProj * vec4(S3, 1.0);
        vec2 suv = c.xy / c.w * 0.5 + 0.5;
        if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
        vec3 SP = viewPos(suv, depthAt(suv));
        float range = smoothstep(0.0, 1.0, radius / max(1e-3, abs(P.z - SP.z)));
        occ += step(S3.z + 0.03, SP.z) * range;
      }
      ao = 1.0 - (occ / float(S)) * uIntensity;
      ao = mix(clamp(ao, 0.0, 1.0), 1.0, smoothstep(45.0, 120.0, dist));
    }
    float rays = 0.0;
    if (uSunVis > 0.001) {
      const int R = 36;
      vec2 delta = (uSunUV - vUv) / float(R) * 0.85;
      vec2 uv = vUv + delta * n;
      float w = 1.0, tot = 0.0;
      for (int i = 0; i < R; i++) {
        uv += delta;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
        vec2 ds = (uv - uSunUV) * vec2(uAspect, 1.0);
        rays += step(0.99999, depthAt(uv)) * exp(-dot(ds, ds) * 9.0) * w;
        tot += w;
        w *= 0.965;
      }
      rays = tot > 0.0 ? rays / tot : 0.0;
      // only light that passes through gaps: fade out where the pixel itself is open sky
      rays *= uSunVis * (1.0 - 0.75 * step(0.99999, d));
    }
    gl_FragColor = vec4(ao, rays, 0.0, 1.0);
  }`;

const COMP_FRAG = `
  #include <packing>
  uniform sampler2D tColor, tDepth, tAO;
  uniform vec2 uRes, uAORes;
  uniform float uNear, uFar, uAOStrength, uRayStrength, uFocus, uDOF, uAperture;
  uniform vec3 uSunColor;
  varying vec2 vUv;
  float linZ(float d) { return -perspectiveDepthToViewZ(d, uNear, uFar); }
  float coc(float z) { return clamp(abs(z - uFocus) / max(z, 0.1) * uAperture, 0.0, 1.0) * uDOF; }
  void main() {
    float d = texture2D(tDepth, vUv).x;
    float z = linZ(d);
    vec3 col = texture2D(tColor, vUv).rgb;
    // depth of field (cutscenes)
    if (uDOF > 0.001 && d < 0.99999) { // the sky (stars, planets) stays sharp
      float c0 = coc(z);
      if (c0 > 0.02) {
        vec3 acc = col; float wsum = 1.0;
        float rad = c0 * 9.0;
        for (int i = 1; i < 28; i++) {
          float fi = float(i);
          float r = sqrt(fi / 28.0) * rad;
          float a = fi * 2.39996323;
          vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
          float sz = linZ(texture2D(tDepth, uv).x);
          float w = sz < z ? clamp(coc(sz) * 9.0 / max(r, 0.5), 0.0, 1.0) : 1.0;
          acc += texture2D(tColor, uv).rgb * w; wsum += w;
        }
        col = acc / wsum;
      }
    }
    // depth-aware AO blur (4x4 on the half-res buffer)
    if (uAOStrength > 0.001) {
      float ao = 0.0, wsum = 0.0;
      for (int x = -1; x <= 2; x++) for (int y = -1; y <= 2; y++) {
        vec2 o = (vec2(float(x), float(y)) - 0.5) / uAORes;
        float sz = linZ(texture2D(tDepth, vUv + o).x);
        float w = exp(-abs(sz - z) / (0.04 * z + 0.05));
        ao += texture2D(tAO, vUv + o).r * w; wsum += w;
      }
      ao = wsum > 0.0 ? ao / wsum : 1.0;
      col *= mix(1.0, ao, uAOStrength);
    }
    // sun shafts
    if (uRayStrength > 0.001) {
      float r = 0.0;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) r += texture2D(tAO, vUv + vec2(float(x), float(y)) * 1.5 / uAORes).g;
      col += uSunColor * (r / 9.0) * uRayStrength;
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export class WorldPass extends Pass {
  constructor(scene, camera, { samples = 4, ao = true, rays = true } = {}) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = true;
    this.aoEnabled = ao;
    this.raysEnabled = rays;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunColor = new THREE.Color(1.0, 0.78, 0.5);
    this.frame = 0;
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.aoRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.aoMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tDepth: { value: this.sceneRT.depthTexture }, uRes: { value: new THREE.Vector2() },
        uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
        uRadius: { value: 0.9 }, uIntensity: { value: 1.25 }, uFrame: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uSunUV: { value: new THREE.Vector2() }, uSunVis: { value: 0 }, uAO: { value: 1 }, uAspect: { value: 1 },
      },
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: this.sceneRT.texture }, tDepth: { value: this.sceneRT.depthTexture }, tAO: { value: this.aoRT.texture },
        uRes: { value: new THREE.Vector2() }, uAORes: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uAOStrength: { value: ao ? 0.85 : 0 }, uRayStrength: { value: 0 }, uFocus: { value: 10 }, uDOF: { value: 0 }, uAperture: { value: 0.9 },
        uSunColor: { value: this.sunColor },
      },
    });
    this.quad = new FullScreenQuad(this.aoMat);
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  setSize(w, h) {
    this.sceneRT.setSize(w, h);
    const hw = Math.max(1, Math.floor(w / 2)), hh = Math.max(1, Math.floor(h / 2));
    this.aoRT.setSize(hw, hh);
    this.aoMat.uniforms.uRes.value.set(hw, hh);
    this.aoMat.uniforms.uAspect.value = w / h;
    this.compMat.uniforms.uRes.value.set(w, h);
    this.compMat.uniforms.uAORes.value.set(hw, hh);
  }

  setFeatures({ ao, rays }) {
    if (ao !== undefined) { this.aoEnabled = ao; this.compMat.uniforms.uAOStrength.value = ao ? 0.85 : 0; }
    if (rays !== undefined) this.raysEnabled = rays;
  }

  render(renderer, writeBuffer) {
    const cam = this.camera;
    this.frame++;
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    renderer.render(this.scene, cam);

    const au = this.aoMat.uniforms, cu = this.compMat.uniforms;
    au.uProj.value.copy(cam.projectionMatrix);
    au.uInvProj.value.copy(cam.projectionMatrixInverse);
    au.uFrame.value = this.frame % 64;
    au.uNear.value = cu.uNear.value = cam.near;
    au.uFar.value = cu.uFar.value = cam.far;
    au.uAO.value = this.aoEnabled ? 1 : 0;
    // sun screen position
    let vis = 0;
    if (this.raysEnabled) {
      cam.getWorldDirection(this._f);
      const facing = this._f.dot(this.sunDir);
      const p = this._v.copy(cam.position).addScaledVector(this.sunDir, 500).project(cam);
      if (facing > 0 && p.z < 1) {
        au.uSunUV.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
        const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
        vis = THREE.MathUtils.smoothstep(facing, 0.15, 0.6) * (1 - THREE.MathUtils.smoothstep(edge, 1.1, 2.2));
      }
    }
    au.uSunVis.value = vis;
    cu.uRayStrength.value = vis > 0 ? 0.9 * (this.rayScale ?? 1) : 0;
    if (this.aoEnabled || vis > 0) {
      renderer.setRenderTarget(this.aoRT);
      this.quad.material = this.aoMat;
      this.quad.render(renderer);
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.material = this.compMat;
    this.quad.render(renderer);
  }

  dispose() {
    this.sceneRT.dispose(); this.aoRT.dispose(); this.aoMat.dispose(); this.compMat.dispose(); this.quad.dispose();
  }
}
