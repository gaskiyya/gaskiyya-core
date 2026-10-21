import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const C = {
  emerald: 0x0a7a55,
  emeraldBright: 0x1fb07c,
  mint: 0x5fd6a4,
  ink: 0x0e1512,
  paper: 0xf6f5f1,
  green: 0x1fb07c,
  teal: 0x0a7a55,
  blue: 0x0a7a55,
  deepBlue: 0x0e1512,
  indigo: 0x0e1512,
  orange: 0xff9f0a,
  red: 0xff453a,
  white: 0xffffff,
  pearl: 0xf6f5f1,
  graphite: 0x2c2f36,
  gray: 0x9aa3b2,
};

function gloss(color, o = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: o.roughness ?? 0.28,
    metalness: o.metalness ?? 0,
    clearcoat: o.clearcoat ?? 1,
    clearcoatRoughness: o.clearcoatRoughness ?? 0.12,
    sheen: o.sheen ?? 0,
    sheenColor: new THREE.Color(0xffffff),
    iridescence: o.iridescence ?? 0,
    transmission: o.transmission ?? 0,
    thickness: o.thickness ?? 0,
    ior: o.ior ?? 1.45,
    envMapIntensity: o.env ?? 0.75,
    transparent: (o.transmission ?? 0) > 0,
    side: o.side ?? THREE.FrontSide,
  });
}

function gradient(geometry, top, bottom, axis = 'y') {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color(bottom);
  const b = new THREE.Color(top);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const v = axis === 'y' ? pos.getY(i) : pos.getX(i);
    const min = axis === 'y' ? bb.min.y : bb.min.x;
    const max = axis === 'y' ? bb.max.y : bb.max.x;
    const t = THREE.MathUtils.smoothstep((v - min) / (max - min || 1), 0, 1);
    tmp.copy(a).lerp(b, t);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function gradMat(o = {}) {
  const m = gloss(0xffffff, o);
  m.vertexColors = true;
  return m;
}

function extrude(shape, depth, bevel = 0.08, segments = 14, curve = 48) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments: curve,
  });
  g.center();
  return mergeVertices(g, 1e-4);
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function stroke(points, radius, material) {
  const group = new THREE.Group();
  const path = new THREE.CurvePath();
  for (let i = 0; i < points.length - 1; i++) path.add(new THREE.LineCurve3(points[i], points[i + 1]));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(path, 64, radius, 32, false), material));
  for (const p of points) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
    cap.position.copy(p);
    group.add(cap);
  }
  return group;
}

function checkMark(scale, radius, material) {
  const v = (x, y) => new THREE.Vector3(x * scale, y * scale, 0);
  return stroke([v(-0.42, 0.02), v(-0.12, -0.3), v(0.46, 0.34)], radius, material);
}

function shieldScene() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, 1.18);
  s.bezierCurveTo(0.42, 0.98, 0.78, 0.92, 1.0, 0.9);
  s.bezierCurveTo(1.02, 0.2, 0.98, -0.42, 0.62, -0.82);
  s.bezierCurveTo(0.4, -1.06, 0.2, -1.18, 0, -1.28);
  s.bezierCurveTo(-0.2, -1.18, -0.4, -1.06, -0.62, -0.82);
  s.bezierCurveTo(-0.98, -0.42, -1.02, 0.2, -1.0, 0.9);
  s.bezierCurveTo(-0.78, 0.92, -0.42, 0.98, 0, 1.18);
  const body = gradient(extrude(s, 0.32, 0.14, 18), C.emeraldBright, C.emerald);
  g.add(new THREE.Mesh(body, gradMat({ roughness: 0.22 })));

  const inner = extrude(s, 0.04, 0.05, 10);
  const plate = new THREE.Mesh(inner, gloss(C.white, { roughness: 0.08, transmission: 0.6, thickness: 0.4, iridescence: 0.25 }));
  plate.scale.set(0.74, 0.74, 1);
  plate.position.z = 0.27;
  g.add(plate);

  const check = checkMark(1.05, 0.105, gloss(C.white, { roughness: 0.15 }));
  check.position.set(0, -0.04, 0.42);
  g.add(check);
  g.rotation.set(0.08, -0.42, 0.03);
  return { object: g, camera: [0, 0.15, 6.4] };
}

function messageScene() {
  const g = new THREE.Group();
  const w = 2.3, h = 1.6, r = 0.52;
  const s = roundedRectShape(w, h, r);
  const tail = new THREE.Shape();
  tail.moveTo(-0.72, -0.62);
  tail.quadraticCurveTo(-0.86, -1.08, -1.18, -1.2);
  tail.quadraticCurveTo(-0.6, -1.18, -0.3, -0.7);
  const bubbleGeo = mergeVertices(new THREE.ExtrudeGeometry([s, tail], { depth: 0.24, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.13, bevelSegments: 16, curveSegments: 48 }), 1e-4);
  bubbleGeo.center();
  bubbleGeo.computeVertexNormals();
  g.add(new THREE.Mesh(bubbleGeo, gloss(C.pearl, { roughness: 0.2, sheen: 0.2 })));

  const lineMat = gloss(0xc9d0dc, { roughness: 0.35 });
  [[1.42, 0.36], [1.12, 0.0], [1.36, -0.36]].forEach(([len, y], i) => {
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, len, 12, 24), i === 1 ? gloss(C.emerald, { roughness: 0.3 }) : lineMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(-0.08 - (1.42 - len) / 2, y + 0.05, 0.27);
    g.add(cap);
  });

  const badge = new THREE.Group();
  const seal = new THREE.Shape();
  const N = 12;
  for (let i = 0; i <= N * 8; i++) {
    const a = (i / (N * 8)) * Math.PI * 2;
    const rr = 0.62 + 0.045 * Math.cos(a * N);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    i === 0 ? seal.moveTo(x, y) : seal.lineTo(x, y);
  }
  const sealGeo = gradient(extrude(seal, 0.16, 0.09, 14), C.emeraldBright, C.emerald);
  badge.add(new THREE.Mesh(sealGeo, gradMat({ roughness: 0.2 })));
  const ck = checkMark(0.72, 0.075, gloss(C.white, { roughness: 0.15 }));
  ck.position.z = 0.2;
  badge.add(ck);
  badge.position.set(1.08, 0.78, 0.45);
  badge.rotation.set(0.1, -0.15, 0.08);
  g.add(badge);

  g.rotation.set(0.12, -0.38, 0.02);
  return { object: g, camera: [0, 0.1, 7.0] };
}

function digitTexture(d) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#0e1512';
  x.font = '700 168px -apple-system, "SF Pro Display", Inter, "Helvetica Neue", Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(d, 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function callScene() {
  const g = new THREE.Group();
  const phone = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, 3.0, 0.2, 10, 0.2), gloss(C.graphite, { roughness: 0.25, metalness: 0.3 }));
  phone.add(body);
  const screenGeo = gradient(new RoundedBoxGeometry(1.36, 2.84, 0.02, 8, 0.16), C.mint, C.emerald);
  const screen = new THREE.Mesh(screenGeo, gradMat({ roughness: 0.1, clearcoatRoughness: 0.05 }));
  screen.position.z = 0.105;
  phone.add(screen);
  const island = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.28, 8, 16), gloss(0x050505, { roughness: 0.3 }));
  island.rotation.z = Math.PI / 2;
  island.position.set(0, 1.25, 0.13);
  phone.add(island);
  const handset = stroke(
    [new THREE.Vector3(-0.32, 0.55, 0), new THREE.Vector3(-0.18, 0.32, 0), new THREE.Vector3(0.12, 0.08, 0), new THREE.Vector3(0.36, 0.02, 0)],
    0.07,
    gloss(C.white, { roughness: 0.2 }),
  );
  handset.position.set(0, 0.45, 0.16);
  phone.add(handset);
  phone.rotation.set(0.1, -0.5, 0.12);
  phone.position.set(-0.55, 0.15, -0.4);
  g.add(phone);

  [0.55, 0.85].forEach((rad, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.045, 16, 96, Math.PI * 0.55), gloss(i ? C.emerald : C.emeraldBright, { roughness: 0.25 }));
    ring.position.set(0.3, 1.05, -0.2);
    ring.rotation.set(0, -0.45, -0.1);
    g.add(ring);
  });

  const digits = ['4', '8', '2', '7'];
  digits.forEach((d, i) => {
    const tile = new THREE.Group();
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.74, 0.22, 8, 0.12), gloss(C.paper, { roughness: 0.18 }));
    tile.add(box);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: digitTexture(d), transparent: true }));
    face.position.z = 0.112;
    face.material.toneMapped = false;
    face.material.blending = THREE.MultiplyBlending;
    tile.add(face);
    tile.position.set(-0.55 + i * 0.72, -1.05 + Math.sin(i * 1.3) * 0.08, 0.85);
    tile.rotation.set(0.12, -0.32 + i * 0.04, 0.05 * (i % 2 ? 1 : -1));
    g.add(tile);
  });
  return { object: g, camera: [0.15, 0.1, 7.2] };
}

function lockScene() {
  const g = new THREE.Group();
  const bodyGeo = gradient(new RoundedBoxGeometry(2.0, 1.6, 0.8, 12, 0.3), 0x26332d, C.ink);
  const body = new THREE.Mesh(bodyGeo, gradMat({ roughness: 0.22 }));
  body.position.y = -0.45;
  g.add(body);

  const shackleMat = gloss(0xe6e9f0, { roughness: 0.12, metalness: 0.9, clearcoat: 0.6 });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.15, 32, 96, Math.PI), shackleMat);
  arc.position.y = 0.72;
  g.add(arc);
  for (const x of [-0.62, 0.62]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, x < 0 ? 0.62 : 0.4, 32), shackleMat);
    leg.position.set(x, x < 0 ? 0.42 : 0.52, 0);
    g.add(leg);
  }

  const kh = new THREE.Shape();
  kh.absarc(0, 0.12, 0.17, 0, Math.PI * 2, false);
  const keyCircle = new THREE.Mesh(extrude(kh, 0.04, 0.03, 8), gloss(C.emeraldBright, { roughness: 0.3 }));
  keyCircle.position.set(0, -0.3, 0.44);
  g.add(keyCircle);
  const slot = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.38, 0.08, 4, 0.04), gloss(C.emeraldBright, { roughness: 0.3 }));
  slot.position.set(0, -0.62, 0.42);
  g.add(slot);

  const chipMat = gloss(C.emeraldBright, { roughness: 0.2 });
  [[-1.35, 0.55, 0.3], [1.4, 0.15, 0.4], [-1.15, -1.2, 0.5]].forEach(([x, y, z], i) => {
    const chip = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.42, 0.12, 6, 0.1), i === 1 ? gloss(C.emerald, { roughness: 0.2 }) : chipMat);
    chip.position.set(x, y, z);
    chip.rotation.set(0.4 * i, 0.6, 0.3 + i);
    g.add(chip);
    const hash = stroke([new THREE.Vector3(-0.1, -0.12, 0), new THREE.Vector3(-0.04, 0.12, 0)], 0.022, gloss(C.white));
    const hash2 = stroke([new THREE.Vector3(0.05, -0.12, 0), new THREE.Vector3(0.11, 0.12, 0)], 0.022, gloss(C.white));
    const hash3 = stroke([new THREE.Vector3(-0.14, 0.05, 0), new THREE.Vector3(0.15, 0.05, 0)], 0.022, gloss(C.white));
    const hash4 = stroke([new THREE.Vector3(-0.16, -0.05, 0), new THREE.Vector3(0.13, -0.05, 0)], 0.022, gloss(C.white));
    const hg = new THREE.Group();
    hg.add(hash, hash2, hash3, hash4);
    hg.position.z = 0.075;
    chip.add(hg);
  });

  g.rotation.set(0.1, -0.4, 0.02);
  return { object: g, camera: [0, 0.05, 7.0] };
}

function linkScene() {
  const g = new THREE.Group();
  const linkGeo = (len) => {
    const path = new THREE.CurvePath();
    const r = 0.42, l = len / 2;
    path.add(new THREE.LineCurve3(new THREE.Vector3(-l, -r, 0), new THREE.Vector3(l, -r, 0)));
    path.add(arc3(l, 0, r, -Math.PI / 2, Math.PI / 2));
    path.add(new THREE.LineCurve3(new THREE.Vector3(l, r, 0), new THREE.Vector3(-l, r, 0)));
    path.add(arc3(-l, 0, r, Math.PI / 2, Math.PI * 1.5));
    return new THREE.TubeGeometry(path, 200, 0.16, 32, true);
  };
  function arc3(cx, cy, r, a0, a1) {
    const c = new THREE.Curve();
    c.getPoint = (t, target = new THREE.Vector3()) => {
      const a = a0 + (a1 - a0) * t;
      return target.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0);
    };
    return c;
  }
  const a = new THREE.Mesh(gradient(linkGeo(0.9), C.emeraldBright, C.emerald, 'x'), gradMat({ roughness: 0.2 }));
  a.position.set(-0.55, 0.12, 0);
  a.rotation.set(0, 0, 0.35);
  const b = new THREE.Mesh(gradient(linkGeo(0.9), 0x2a3631, C.ink, 'x'), gradMat({ roughness: 0.2 }));
  b.position.set(0.55, -0.12, 0);
  b.rotation.set(Math.PI / 2, 0, 0.35);
  g.add(a, b);
  g.rotation.set(0.25, -0.35, 0);
  return { object: g, camera: [0, 0, 6.2] };
}

function verdictScene(kind) {
  const g = new THREE.Group();
  if (kind === 'confirmed') {
    const seal = new THREE.Shape();
    const N = 12;
    for (let i = 0; i <= N * 8; i++) {
      const a = (i / (N * 8)) * Math.PI * 2;
      const rr = 1.0 + 0.07 * Math.cos(a * N);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i === 0 ? seal.moveTo(x, y) : seal.lineTo(x, y);
    }
    g.add(new THREE.Mesh(gradient(extrude(seal, 0.3, 0.14, 16), C.emeraldBright, C.emerald), gradMat({ roughness: 0.2 })));
    const ck = checkMark(1.2, 0.12, gloss(C.white, { roughness: 0.15 }));
    ck.position.z = 0.35;
    g.add(ck);
  } else if (kind === 'not_confirmed') {
    const t = new THREE.Shape();
    const R = 1.25, rr = 0.28;
    const pts = [0, 1, 2].map((i) => new THREE.Vector2(Math.cos(Math.PI / 2 + (i * 2 * Math.PI) / 3) * R, Math.sin(Math.PI / 2 + (i * 2 * Math.PI) / 3) * R - 0.12));
    for (let i = 0; i < 3; i++) {
      const p = pts[i], prev = pts[(i + 2) % 3], next = pts[(i + 1) % 3];
      const a = p.clone().lerp(prev, rr / p.distanceTo(prev) * 1.6);
      const b = p.clone().lerp(next, rr / p.distanceTo(next) * 1.6);
      i === 0 ? t.moveTo(a.x, a.y) : t.lineTo(a.x, a.y);
      t.quadraticCurveTo(p.x, p.y, b.x, b.y);
    }
    t.closePath();
    g.add(new THREE.Mesh(gradient(extrude(t, 0.3, 0.14, 16), 0xffb340, 0xff7a00), gradMat({ roughness: 0.22 })));
    const white = gloss(C.white, { roughness: 0.15 });
    const bar = stroke([new THREE.Vector3(0, 0.38, 0), new THREE.Vector3(0, -0.12, 0)], 0.11, white);
    bar.position.z = 0.35;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 24), white);
    dot.position.set(0, -0.42, 0.35);
    g.add(bar, dot);
  } else {
    const cloudMat = gloss(0xd5dae3, { roughness: 0.25 });
    [[-0.6, -0.1, 0.55], [0.05, 0.25, 0.75], [0.65, -0.05, 0.6], [0, -0.3, 0.6]].forEach(([x, y, r]) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), cloudMat);
      s.position.set(x, y, 0);
      s.scale.z = 0.7;
      g.add(s);
    });
    const slash = stroke([new THREE.Vector3(-0.85, -0.85, 0), new THREE.Vector3(0.85, 0.75, 0)], 0.1, gloss(C.gray, { roughness: 0.3 }));
    slash.position.z = 0.55;
    g.add(slash);
  }
  g.rotation.set(0.1, -0.35, 0);
  return { object: g, camera: [0, 0, 6.2] };
}

function appIconScene() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, 1.18);
  s.bezierCurveTo(0.42, 0.98, 0.78, 0.92, 1.0, 0.9);
  s.bezierCurveTo(1.02, 0.2, 0.98, -0.42, 0.62, -0.82);
  s.bezierCurveTo(0.4, -1.06, 0.2, -1.18, 0, -1.28);
  s.bezierCurveTo(-0.2, -1.18, -0.4, -1.06, -0.62, -0.82);
  s.bezierCurveTo(-0.98, -0.42, -1.02, 0.2, -1.0, 0.9);
  s.bezierCurveTo(-0.78, 0.92, -0.42, 0.98, 0, 1.18);
  g.add(new THREE.Mesh(extrude(s, 0.3, 0.14, 18), gloss(C.white, { roughness: 0.15, sheen: 0.2 })));
  const ck = checkMark(1.05, 0.11, gloss(C.blue, { roughness: 0.2 }));
  ck.position.set(0, -0.04, 0.33);
  g.add(ck);
  g.rotation.set(0.06, -0.2, 0);
  return { object: g, camera: [0, 0.05, 6.0] };
}

function logoScene(dark = false) {
  const g = new THREE.Group();
  const S = 1 / 20;
  const arc = new THREE.Curve();
  const a0 = THREE.MathUtils.degToRad(38);
  const a1 = Math.PI * 2;
  arc.getPoint = (t, target = new THREE.Vector3()) => {
    const a = a0 + (a1 - a0) * t;
    return target.set(Math.cos(a), Math.sin(a), 0);
  };
  const r = 2.5 * S;
  const inkMat = dark ? gloss(C.paper, { roughness: 0.2 }) : gloss(C.ink, { roughness: 0.22, clearcoatRoughness: 0.06 });
  g.add(new THREE.Mesh(new THREE.TubeGeometry(arc, 240, r, 40, false), inkMat));
  for (const t of [0, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), inkMat);
    cap.position.copy(arc.getPoint(t));
    g.add(cap);
  }
  const p = (x, y) => new THREE.Vector3((x - 32) * S, (32 - y) * S, 0.02);
  const check = stroke([p(30, 35.5), p(37, 42.5), p(52, 32)], r, gloss(0x0f8f63, { roughness: 0.18 }));
  g.add(check);
  g.scale.setScalar(1.15);
  g.rotation.set(0.12, -0.42, 0.02);
  return { object: g, camera: [0, 0.1, 6.2] };
}

function appTileScene() {
  const g = new THREE.Group();
  const tile = new THREE.Mesh(gradient(new RoundedBoxGeometry(2.4, 2.4, 0.42, 16, 0.6), C.emeraldBright, C.emerald), gradMat({ roughness: 0.25 }));
  g.add(tile);
  const S = 1 / 20 * 0.85;
  const r = 2.5 * S;
  const arc = new THREE.Curve();
  const a0 = THREE.MathUtils.degToRad(38);
  arc.getPoint = (t, target = new THREE.Vector3()) => {
    const a = a0 + (Math.PI * 2 - a0) * t;
    return target.set(Math.cos(a) * 20 * S, Math.sin(a) * 20 * S, 0.26);
  };
  const paper = gloss(C.paper, { roughness: 0.2 });
  g.add(new THREE.Mesh(new THREE.TubeGeometry(arc, 200, r, 32, false), paper));
  for (const t of [0, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), paper);
    cap.position.copy(arc.getPoint(t));
    g.add(cap);
  }
  const p = (x, y) => new THREE.Vector3((x - 32) * S, (32 - y) * S, 0.26);
  g.add(stroke([p(30, 35.5), p(37, 42.5), p(52, 32)], r, paper));
  g.rotation.set(0.16, -0.38, 0.03);
  return { object: g, camera: [0, 0.1, 6.4] };
}

export const SCENES = {
  logo: () => logoScene(false),
  logo_dark: () => logoScene(true),
  app_tile: appTileScene,
  shield: shieldScene,
  message: messageScene,
  call: callScene,
  lock: lockScene,
  link: linkScene,
  verdict_confirmed: () => verdictScene('confirmed'),
  verdict_not_confirmed: () => verdictScene('not_confirmed'),
  verdict_cannot_check: () => verdictScene('cannot_check'),
  app_icon_glyph: appIconScene,
};

export async function render(name, size = 1024, shadow = true) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = shadow;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const { object, camera: cp } = SCENES[name]();
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  scene.add(object);

  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(28 / 2))) * 1.08;
  const dir = new THREE.Vector3(...cp).normalize();
  camera.position.copy(dir.multiplyScalar(dist));
  camera.lookAt(0, 0, 0);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-2, 8, 4);
  key.castShadow = shadow;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 26;
  key.shadow.blurSamples = 24;
  key.shadow.camera.left = key.shadow.camera.bottom = -4;
  key.shadow.camera.right = key.shadow.camera.top = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe6ff, 1.4);
  rim.position.set(5, 2, -4);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe6f2, 0.7));

  if (shadow) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.16 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = new THREE.Box3().setFromObject(object).min.y - 0.12;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}
