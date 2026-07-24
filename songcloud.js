/*
 * songcloud.js — full-bleed hero point cloud of the Wytham great tit song embedding.
 */

import * as THREE from 'three';

const PALETTE = ['#52D9CF', '#9C93D6', '#F5B265'];
const DARK_MIX = 0.26;
const BG = { r: 0x0f / 255, g: 0x1a / 255, b: 0x1d / 255 };

const IDLE_SPIN = 0.06;

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

function paletteColor(t) {
  const stops = PALETTE.map(hexToRgb);
  const scaled = Math.min(0.999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = stops[i];
  const b = stops[Math.min(stops.length - 1, i + 1)];
  return {
    r: a.r + (b.r - a.r) * f,
    g: a.g + (b.g - a.g) * f,
    b: a.b + (b.b - a.b) * f,
  };
}

function towardBackground(c, amount) {
  return {
    r: c.r + (BG.r - c.r) * amount,
    g: c.g + (BG.g - c.g) * amount,
    b: c.b + (BG.b - c.b) * amount,
  };
}

const VERTEX_SHADER = /* glsl */ `
  attribute float birdId;
  uniform float uSelected;
  uniform float uSize;
  uniform float uDim;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = color;
    bool isSelected = uSelected >= 0.0 && abs(birdId - uSelected) < 0.5;
    bool anySelection = uSelected >= 0.0;

    float boost = isSelected ? 1.8 : 1.0;
    vAlpha = anySelection ? (isSelected ? 1.0 : uDim) : 0.92;
    if (isSelected) { vColor = min(vColor * 1.45, vec3(1.0)); }

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * boost * uPixelRatio * (1.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uFade;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    float edge = smoothstep(0.25, 0.06, r);
    gl_FragColor = vec4(vColor, vAlpha * edge * uFade);
  }
`;

export class HeroControls {
  constructor(camera, element, opts = {}) {
    this.camera = camera;
    this.el = element;

    this.radius = opts.radius ?? 0.48;
    this.minRadius = opts.minRadius ?? 0.25;
    this.maxRadius = opts.maxRadius ?? 6.5;

    this.theta = opts.initialTheta ?? 0.4;
    this.phi = opts.initialPhi ?? (Math.PI / 2);
    this.targetTheta = this.theta;
    this.targetPhi = this.phi;
    this.targetRadius = this.radius;

    this.clusterCenter = opts.clusterCenter || new THREE.Vector3(0, 0, 0);
    this.currentLookAt = this.clusterCenter.clone();
    this.targetLookAt = this.clusterCenter.clone();

    this.enabled = true;
    this.onEnterProfile = opts.onEnterProfile || null;
    this.onZoomOutDeselect = opts.onZoomOutDeselect || null;

    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    this._bind();
  }

  _bind() {
    if (!this.el) return;

    // Wheel zoom with normalized delta step
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      // Clamp delta so high-frequency trackpad ticks don't skyrocket the zoom
      const delta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 50);
      const factor = 1 + delta * 0.0015; // Controlled zoom sensitivity
      
      this._dollyBy(factor);
    }, { passive: false });

    // Drag / Pointer Orbit
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;

      this.targetTheta -= dx * 0.005;
      this.targetPhi = Math.max(0.05, Math.min(Math.PI - 0.05, this.targetPhi - dy * 0.005));
    });

    window.addEventListener('pointerup', () => {
      this._dragging = false;
    });
  }

  _dollyBy(factor) {
    this.maxRadius = 5.5; 
    this.targetRadius = Math.min(this.maxRadius, Math.max(this.minRadius, this.targetRadius * factor));

    const zoomProgress = Math.min(1, Math.max(0, (this.targetRadius - 0.48) / 3.5));
    this.targetLookAt.lerpVectors(this.clusterCenter, new THREE.Vector3(0, 0, 0), zoomProgress);

    // 1. When fully zoomed out (>= 4.2), ensure profile opens & selection is cleared
    if (this.targetRadius >= 4.2) {
      if (typeof this.deselectAll === 'function') {
        this.deselectAll();
      }

      if (this.onEnterProfile) {
        this.onEnterProfile();
      }
    } 
    // 2. When zooming back in (< 3.5), close profile
    else if (this.targetRadius < 3.5) {
      if (this.onZoomInFromProfile) {
        this.onZoomInFromProfile();
      }
    }
  }
  update(dt) {
    const spinRate = this.enabled ? IDLE_SPIN : IDLE_SPIN * 0.35;
    this.targetTheta += spinRate * dt;

    this.theta += (this.targetTheta - this.theta) * 0.08;
    this.phi += (this.targetPhi - this.phi) * 0.08;
    this.radius += (this.targetRadius - this.radius) * 0.05;

    this.currentLookAt.lerp(this.targetLookAt, 0.08);

    const sinPhi = Math.sin(this.phi);
    const camX = this.currentLookAt.x + this.radius * sinPhi * Math.sin(this.theta);
    const camY = this.currentLookAt.y + this.radius * Math.cos(this.phi);
    const camZ = this.currentLookAt.z + this.radius * sinPhi * Math.cos(this.theta);

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.currentLookAt);
  }
}

export async function initSongCloud(options = {}) {
  const {
    canvas,
    dataUrl = './songcloud.json',
    binUrl = './songcloud.bin',
    onStatus = () => {},
    onEnterProfile = null,
  } = options;

  if (!canvas) throw new Error('initSongCloud requires a canvas');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  onStatus({ state: 'loading', text: 'Loading song embedding…' });

  let header, buffer;
  try {
    [header, buffer] = await Promise.all([
      fetch(dataUrl).then((r) => {
        if (!r.ok) throw new Error(`${dataUrl}: ${r.status}`);
        return r.json();
      }),
      fetch(binUrl).then((r) => {
        if (!r.ok) throw new Error(`${binUrl}: ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
  } catch (err) {
    onStatus({ state: 'error', text: `Failed to load data: ${err.message}` });
    throw err;
  }

  const n = header.n;
  let offset = 0;
  const rawCoords = new Int16Array(buffer, offset, n * 3);
  offset += n * 3 * 2;
  const birdIds = new Uint16Array(buffer, offset, n);
  offset += n * 2;
  const yearIds = new Uint8Array(buffer, offset, n);

  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) positions[i] = rawCoords[i] / 32767;

  const birdCount = header.fathers.length;

  const birdColors = [];
  for (let b = 0; b < birdCount; b++) {
    const shuffled = ((b * 97) % birdCount) / Math.max(1, birdCount - 1);
    const base = paletteColor(shuffled);
    const lift = 0.78 + 0.44 * (((b * 53) % 17) / 16);
    birdColors.push(
      towardBackground(
        { r: Math.min(1, base.r * lift), g: Math.min(1, base.g * lift), b: Math.min(1, base.b * lift) },
        DARK_MIX,
      ),
    );
  }

  const colors = new Float32Array(n * 3);
  const birdAttr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = birdColors[birdIds[i]];
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    birdAttr[i] = birdIds[i];
  }

  const scene = new THREE.Scene();
  // Near plane set to 0.001 to prevent close macro points from clipping
  const camera = new THREE.PerspectiveCamera(55, 1, 0.001, 100);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('birdId', new THREE.BufferAttribute(birdAttr, 1));

  // Count songs per bird to filter out empty/tiny clusters
  const birdCounts = new Uint32Array(birdCount);
  for (let i = 0; i < n; i++) birdCounts[birdIds[i]]++;

  const validBirdIds = [];
  for (let b = 0; b < birdCount; b++) {
    if (birdCounts[b] >= 15) {
      validBirdIds.push(b);
    }
  }

  // Pick a random valid bird cluster on load
  const INITIAL_BIRD_ID = validBirdIds.length > 0
    ? validBirdIds[Math.floor(Math.random() * validBirdIds.length)]
    : 0;

  // Compute 3D centroid of the selected bird's cluster
  let sumX = 0, sumY = 0, sumZ = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (birdIds[i] === INITIAL_BIRD_ID) {
      sumX += positions[i * 3 + 0];
      sumY += positions[i * 3 + 1];
      sumZ += positions[i * 3 + 2];
      count++;
    }
  }

  const cx = count > 0 ? sumX / count : 0;
  const cy = count > 0 ? sumY / count : 0;
  const cz = count > 0 ? sumZ / count : 0;

  const clusterCenter = new THREE.Vector3(cx, cy, cz);

  // Angle camera from an aesthetic offset vector relative to the cluster
  const initialTheta = Math.atan2(cx || 1, cz || 1) + 0.3;
  const initialPhi = Math.PI / 2.2;

  const uniforms = {
    uSelected: { value: INITIAL_BIRD_ID },
    uSize: { value: 3.2 },
    uDim: { value: 0.08 },
    uFade: { value: 1 },
    uPixelRatio: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexColors: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  let selectedBird = INITIAL_BIRD_ID;

  function setSelection(birdIdx) {
    selectedBird = birdIdx;
    uniforms.uSelected.value = birdIdx;
    if (birdIdx >= 0) {
      const bName = header.fathers[birdIdx] || `Bird #${birdIdx}`;
      const cnt = birdCounts[birdIdx];
      onStatus({ state: 'selected', text: `${bName} · ${cnt} dawn songs isolated` });
    } else {
      onStatus({ state: 'ready', text: idleText });
    }
  }

  const controls = new HeroControls(camera, canvas, {
    radius: 0.48,
    minRadius: 0.25,
    maxRadius: 6.5,
    initialTheta: initialTheta,
    initialPhi: initialPhi,
    clusterCenter: clusterCenter, // Frame directly on the centroid
    onEnterProfile,
    onZoomOutDeselect: () => {
      if (selectedBird !== -1) setSelection(-1);
    },
  });

  if (reduceMotion) controls.targetTheta = controls.theta;

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.025;
  const pointer = new THREE.Vector2();

  window.addEventListener('pointermove', (e) => {
    if (!controls.enabled) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(points);

    if (intersects.length > 0) {
      canvas.style.cursor = 'pointer';
      if (selectedBird === -1) {
        uniforms.uSelected.value = birdIds[intersects[0].index];
      }
    } else {
      canvas.style.cursor = 'default';
      if (selectedBird === -1) {
        uniforms.uSelected.value = -1;
      }
    }
  });

  window.addEventListener('click', (e) => {
    if (!controls.enabled) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(points);

    if (intersects.length > 0) {
      const bId = birdIds[intersects[0].index];
      setSelection(bId === selectedBird ? -1 : bId);
    } else {
      setSelection(-1);
    }
  });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    camera.clearViewOffset();
    camera.updateProjectionMatrix();

    uniforms.uPixelRatio.value = dpr;
    uniforms.uSize.value = h < 700 ? 3.4 : 4.6;
  }

  window.addEventListener('resize', resize);
  resize();

  const idleText = `${n.toLocaleString()} songs · ${birdCount} birds · 2020–2022`;

  // Display initial selected bird info in HUD
  const initName = header.fathers[INITIAL_BIRD_ID] || `Bird #${INITIAL_BIRD_ID}`;
  onStatus({ state: 'selected', text: `${initName} · ${birdCounts[INITIAL_BIRD_ID]} dawn songs isolated` });

  let last = performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    controls.update(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  return {
    controls,
    camera,
    clearSelection() {
      setSelection(-1);
    },
    stats: { points: n, birds: birdCount, years: header.years },
  };
}