import * as THREE from 'three';

// A twin-engine Velmoran bomber built from primitives (no asset needed): tapered fuselage,
// glazed nose, high wing with two radial engines + spinning props, twin-fin tail and
// the Velmoran roundel. Nose points along +Z.
let ROUNDEL = null;
function roundelTex() {
  if (ROUNDEL) return ROUNDEL;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const ring = (r, col) => { x.fillStyle = col; x.beginPath(); x.arc(64, 64, r, 0, 6.283); x.fill(); };
  ring(62, '#d9c27a'); ring(54, '#6b1f2a'); ring(34, '#2f5a3a'); ring(16, '#efe6cf');
  ROUNDEL = new THREE.CanvasTexture(c);
  ROUNDEL.colorSpace = THREE.SRGBColorSpace;
  return ROUNDEL;
}

export function buildBomber() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x4d5a3f, roughness: 0.62, metalness: 0.35 });
  const belly = new THREE.MeshStandardMaterial({ color: 0x8a9286, roughness: 0.6, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2328, roughness: 0.15, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1d1b, roughness: 0.5, metalness: 0.6 });
  const mesh = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  // fuselage (lathe profile along +Z)
  const prof = [];
  const L = 15;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const r = t < 0.18 ? 0.35 + 0.65 * Math.sin((t / 0.18) * Math.PI / 2) : t < 0.6 ? 1.0 : 1.0 - 0.72 * ((t - 0.6) / 0.4) ** 1.2;
    prof.push(new THREE.Vector2(Math.max(0.05, r * 0.95), (0.5 - t) * L));
  }
  const fus = new THREE.LatheGeometry(prof, 16);
  fus.rotateX(Math.PI / 2);
  mesh(fus, skin, 0, 0, 0);
  mesh(new THREE.SphereGeometry(0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0, L / 2 - 0.25, Math.PI / 2);
  mesh(new THREE.BoxGeometry(0.9, 0.45, 1.6), glass, 0, 0.75, 3.6); // cockpit canopy
  mesh(new THREE.SphereGeometry(0.42, 10, 8), glass, 0, 0.9, -1.8); // dorsal turret
  // wings
  const wing = new THREE.BoxGeometry(23, 0.32, 3.0);
  const wp = wing.attributes.position;
  for (let i = 0; i < wp.count; i++) {
    const ax = Math.abs(wp.getX(i)) / 11.5;
    wp.setZ(i, wp.getZ(i) * (1 - ax * 0.45) - ax * 0.4);
    wp.setY(i, wp.getY(i) * (1 - ax * 0.5) + ax * 0.55);
  }
  wing.computeVertexNormals();
  mesh(wing, skin, 0, 0.35, 1.2);
  // engines + props
  g.userData.props = [];
  for (const sx of [-1, 1]) {
    const nac = new THREE.CylinderGeometry(0.62, 0.5, 3.2, 14);
    nac.rotateX(Math.PI / 2);
    mesh(nac, skin, sx * 4.0, 0.25, 2.2);
    mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.5, 16, 1, true).rotateX(Math.PI / 2), dark, sx * 4.0, 0.25, 3.7);
    const hub = mesh(new THREE.ConeGeometry(0.22, 0.5, 10).rotateX(Math.PI / 2), dark, sx * 4.0, 0.25, 4.15);
    const prop = new THREE.Group();
    prop.position.set(sx * 4.0, 0.25, 4.05);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.55, 0.04), dark);
      blade.position.y = 0.78;
      const arm = new THREE.Group(); arm.rotation.z = (b / 3) * Math.PI * 2; arm.add(blade);
      prop.add(arm);
    }
    // motion-blur disc
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    prop.add(disc);
    g.add(prop);
    g.userData.props.push(prop);
    void hub;
  }
  // tailplane + twin fins
  mesh(new THREE.BoxGeometry(7.2, 0.18, 1.7), skin, 0, 0.25, -L / 2 + 1.0);
  for (const sx of [-1, 1]) {
    const fin = new THREE.BoxGeometry(0.14, 2.0, 1.5);
    const fp = fin.attributes.position;
    for (let i = 0; i < fp.count; i++) if (fp.getY(i) > 0) fp.setZ(i, fp.getZ(i) - 0.45);
    fin.computeVertexNormals();
    mesh(fin, skin, sx * 3.5, 1.05, -L / 2 + 0.9);
  }
  // pale belly strip
  mesh(new THREE.BoxGeometry(1.1, 0.12, 8), belly, 0, -0.88, 0.5);
  // roundels on the wings + fuselage
  const rm = new THREE.MeshStandardMaterial({ map: roundelTex(), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sx of [-1, 1]) {
    const top = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), rm);
    top.rotation.x = -Math.PI / 2; top.position.set(sx * 8.2, 0.52 + 0.4, 0.75); g.add(top);
    const under = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), rm);
    under.rotation.x = Math.PI / 2; under.position.set(sx * 8.2, 0.28 + 0.38, 0.75); g.add(under);
    const side = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), rm);
    side.rotation.y = sx * Math.PI / 2; side.position.set(sx * 0.82, 0.1, -3.2); g.add(side);
  }
  return g;
}

export function buildBomb() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2e2f2a, roughness: 0.5, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.75, 4, 10), mat);
  body.rotation.x = Math.PI / 2; g.add(body);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.36, 0.3), mat);
    f.position.z = -0.55; f.rotation.z = (i / 4) * Math.PI; g.add(f);
  }
  return g;
}

// Formation flight across the keep, dropping bombs on a list of targets.
export class Raid {
  constructor(game, { from, to, alt = 70, speed = 52, count = 4, targets = [], onImpact = null }) {
    this.g = game;
    this.planes = [];
    this.bombs = [];
    this.dir = new THREE.Vector3().subVectors(to, from).setY(0).normalize();
    this.side = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    this.speed = speed;
    this.targets = targets.map((p) => ({ p: p.clone(), dropped: false }));
    this.onImpact = onImpact;
    this.alt = alt;
    this.t = 0;
    this.bombMesh = buildBomb();
    const offs = [[0, 0], [-1, -1], [1, -1], [0, -2], [-2, -2], [2, -2]].slice(0, count);
    for (const [s, b] of offs) {
      const m = buildBomber();
      const p = from.clone().addScaledVector(this.side, s * 26).addScaledVector(this.dir, b * 20);
      p.y = (game.terrain.getHeight(p.x, p.z) || 0) + alt + Math.abs(s) * 4;
      m.position.copy(p);
      m.lookAt(p.clone().add(this.dir));
      game.atmo.setupScene && game.atmo.setupScene(m);
      game.scene.add(m);
      this.planes.push({ m, wob: Math.random() * 6 });
    }
    this.done = false;
  }

  update(dt) {
    const g = this.g;
    this.t += dt;
    for (const P of this.planes) {
      P.m.position.addScaledVector(this.dir, this.speed * dt);
      P.m.rotation.z = Math.sin(this.t * 0.7 + P.wob) * 0.04;
      for (const pr of P.m.userData.props) pr.rotation.z += dt * 55;
      // drop on targets as a plane passes over them (lead the drop by the fall time)
      for (const T of this.targets) {
        if (T.dropped) continue;
        const fall = Math.sqrt((2 * (P.m.position.y - T.p.y)) / 9.8);
        const lead = this.speed * fall;
        const rel = T.p.clone().sub(P.m.position).setY(0);
        const along = rel.dot(this.dir), across = Math.abs(rel.dot(this.side));
        if (across < 22 && along < lead && along > lead - 25) {
          T.dropped = true;
          const b = this.bombMesh.clone();
          b.position.copy(P.m.position).add(new THREE.Vector3(0, -1.2, 0));
          g.scene.add(b);
          const v = this.dir.clone().multiplyScalar(this.speed);
          // aim correction so the bomb lands on the target
          const corr = T.p.clone().sub(b.position).setY(0).addScaledVector(v, -fall).divideScalar(fall);
          v.add(corr);
          this.bombs.push({ m: b, v, target: T.p, whistled: false });
        }
      }
    }
    for (const B of this.bombs) {
      if (B.dead) continue;
      B.v.y -= 9.8 * dt;
      B.m.position.addScaledVector(B.v, dt);
      B.m.lookAt(B.m.position.clone().add(B.v));
      const gy = g.terrain.getHeight(B.m.position.x, B.m.position.z);
      if (!B.whistled && B.m.position.y - gy < 120) { B.whistled = true; }
      if (B.m.position.y <= gy + 0.3) {
        B.dead = true;
        g.scene.remove(B.m);
        const at = B.m.position.clone(); at.y = gy;
        if (this.onImpact) this.onImpact(at);
      }
    }
    this.bombs = this.bombs.filter((b) => !b.dead);
    if (!this.done && this.t > 3 && this.planes.every((P) => P.m.position.distanceTo(g.camera.position) > 900)) this.done = true;
  }

  dispose() {
    for (const P of this.planes) this.g.scene.remove(P.m);
    for (const B of this.bombs) this.g.scene.remove(B.m);
    this.planes = []; this.bombs = [];
  }
}
