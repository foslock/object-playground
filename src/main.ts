import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Query } = Matter;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ShapeData {
  body: Matter.Body;
  color: string;
  glowColor: string;
}

interface GrowingShape {
  /** pointer / touch identifier (-1 for mouse) */
  pointerId: number;
  /** world-space anchor */
  x: number;
  y: number;
  /** drives deterministic shape outline */
  seed: number;
  startTime: number;
  color: string;
  glowColor: string;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const CHECKERBOARD_SIZE = 28;
const MIN_RADIUS = 14;
const MAX_RADIUS = 110;
/** px per second of hold time */
const GROWTH_RATE = 52;
/** number of blob control points */
const BLOB_POINTS = 8;
const DOUBLE_TAP_MS = 340;
const DOUBLE_TAP_PX = 40;
const MOUSE_ID = -1;

// ─────────────────────────────────────────────────────────────
// Canvas
// ─────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resizeCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  rebuildWalls();
}

// ─────────────────────────────────────────────────────────────
// Physics engine (no Runner – we drive Engine.update manually)
// ─────────────────────────────────────────────────────────────

const engine = Engine.create({
  gravity: { x: 0, y: 1, scale: 0.0018 },
});

let wallBodies: Matter.Body[] = [];

function rebuildWalls(): void {
  if (wallBodies.length) Composite.remove(engine.world, wallBodies);

  const w = canvas.width;
  const h = canvas.height;
  const T = 80; // wall thickness

  wallBodies = [
    // bottom
    Bodies.rectangle(w / 2, h + T / 2, w + T * 2, T, {
      isStatic: true,
      label: 'wall',
      friction: 0.3,
      restitution: 0.4,
    }),
    // top
    Bodies.rectangle(w / 2, -T / 2, w + T * 2, T, {
      isStatic: true,
      label: 'wall',
      friction: 0.3,
      restitution: 0.4,
    }),
    // left
    Bodies.rectangle(-T / 2, h / 2, T, h + T * 2, {
      isStatic: true,
      label: 'wall',
      friction: 0.3,
      restitution: 0.4,
    }),
    // right
    Bodies.rectangle(w + T / 2, h / 2, T, h + T * 2, {
      isStatic: true,
      label: 'wall',
      friction: 0.3,
      restitution: 0.4,
    }),
  ];

  Composite.add(engine.world, wallBodies);
}

// ─────────────────────────────────────────────────────────────
// Shape generation utilities
// ─────────────────────────────────────────────────────────────

/** Cheap deterministic pseudo-random from seed. */
function seededRNG(seed: number): () => number {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return (): number => {
    s = Math.imul(1664525, s) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

/**
 * Returns blob vertices centered at (0, 0).
 * Angles are evenly-spaced with slight jitter; radii vary between 55–100% of
 * the supplied radius.  The resulting polygon is star-convex so Matter.js
 * handles it cleanly without poly-decomp.
 */
function blobVertices(radius: number, seed: number): Matter.Vector[] {
  const rng = seededRNG(seed);
  const verts: Matter.Vector[] = [];

  for (let i = 0; i < BLOB_POINTS; i++) {
    const baseAngle = (i / BLOB_POINTS) * Math.PI * 2 - Math.PI / 2;
    // small angular perturbation, stay within ±20 % of the sector
    const jitter = (rng() - 0.5) * (Math.PI / BLOB_POINTS) * 0.4;
    const angle = baseAngle + jitter;
    const r = radius * (0.55 + rng() * 0.45);
    verts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }

  return verts;
}

/** Pick a vivid HSL colour and a lighter glow variant from the same hue. */
function randomPalette(seed: number): { color: string; glowColor: string } {
  const rng = seededRNG(seed + 0x12345);
  const hue = Math.floor(rng() * 360);
  const sat = 55 + Math.floor(rng() * 30);
  const light = 52 + Math.floor(rng() * 20);
  return {
    color: `hsl(${hue},${sat}%,${light}%)`,
    glowColor: `hsl(${hue},100%,78%)`,
  };
}

// ─────────────────────────────────────────────────────────────
// App state
// ─────────────────────────────────────────────────────────────

const shapes: ShapeData[] = [];
const growing = new Map<number, GrowingShape>();

// ─────────────────────────────────────────────────────────────
// Finalise a held shape into a physics body
// ─────────────────────────────────────────────────────────────

function finaliseShape(g: GrowingShape): void {
  const elapsed = (performance.now() - g.startTime) / 1000;
  const radius = Math.min(MIN_RADIUS + GROWTH_RATE * elapsed, MAX_RADIUS);
  if (radius < 8) return;

  const rawVerts = blobVertices(radius, g.seed);

  // fromVertices centres the body at (x,y)
  const body = Bodies.fromVertices(g.x, g.y, [rawVerts], {
    restitution: 0.35,
    friction: 0.06,
    frictionAir: 0.007,
    density: 0.002,
    label: 'blob',
  });

  if (!body) return;

  // tiny random sideways nudge so objects don't stack perfectly
  Body.applyForce(body, body.position, {
    x: (Math.random() - 0.5) * radius * 0.0004,
    y: 0,
  });

  Composite.add(engine.world, body);
  shapes.push({ body, color: g.color, glowColor: g.glowColor });
}

// ─────────────────────────────────────────────────────────────
// Delete the top-most shape that contains the given point
// ─────────────────────────────────────────────────────────────

function deleteAt(x: number, y: number): void {
  const pt = { x, y };
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (Query.point([shapes[i].body], pt).length > 0) {
      Composite.remove(engine.world, shapes[i].body);
      shapes.splice(i, 1);
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Input – pointer helpers
// ─────────────────────────────────────────────────────────────

function pointerPos(e: MouseEvent | Touch): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}

// Double-tap / double-click detection
const tapHistory = new Map<number, { x: number; y: number; t: number }>();

function isDoubleTap(id: number, x: number, y: number): boolean {
  const now = performance.now();
  const prev = tapHistory.get(id);
  tapHistory.set(id, { x, y, t: now });
  if (!prev) return false;
  const dx = x - prev.x;
  const dy = y - prev.y;
  return now - prev.t < DOUBLE_TAP_MS && Math.hypot(dx, dy) < DOUBLE_TAP_PX;
}

// ─────────────────────────────────────────────────────────────
// Input – mouse
// ─────────────────────────────────────────────────────────────

canvas.addEventListener('mousedown', (e) => {
  const { x, y } = pointerPos(e);

  if (isDoubleTap(MOUSE_ID, x, y)) {
    growing.delete(MOUSE_ID);
    deleteAt(x, y);
    return;
  }

  const seed = (Math.random() * 0xffffff) | 0;
  growing.set(MOUSE_ID, {
    pointerId: MOUSE_ID,
    x,
    y,
    seed,
    startTime: performance.now(),
    ...randomPalette(seed),
  });
});

function releaseMouse(): void {
  const g = growing.get(MOUSE_ID);
  if (g) {
    growing.delete(MOUSE_ID);
    finaliseShape(g);
  }
}

canvas.addEventListener('mouseup', releaseMouse);
canvas.addEventListener('mouseleave', releaseMouse);

// ─────────────────────────────────────────────────────────────
// Input – touch
// ─────────────────────────────────────────────────────────────

canvas.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const { x, y } = pointerPos(t);
      const id = t.identifier;

      if (isDoubleTap(id, x, y)) {
        growing.delete(id);
        deleteAt(x, y);
        continue;
      }

      const seed = (Math.random() * 0xffffff) | 0;
      growing.set(id, {
        pointerId: id,
        x,
        y,
        seed,
        startTime: performance.now(),
        ...randomPalette(seed),
      });
    }
  },
  { passive: false },
);

canvas.addEventListener(
  'touchend',
  (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const g = growing.get(t.identifier);
      if (g) {
        growing.delete(t.identifier);
        finaliseShape(g);
      }
    }
  },
  { passive: false },
);

canvas.addEventListener('touchcancel', (e) => {
  for (const t of Array.from(e.changedTouches)) growing.delete(t.identifier);
});

// ─────────────────────────────────────────────────────────────
// Device orientation → gravity
// ─────────────────────────────────────────────────────────────

function applyOrientation(e: DeviceOrientationEvent): void {
  // beta:  front/back tilt  (-180 → 180)  →  vertical gravity component
  // gamma: left/right tilt  (-90  → 90)   →  horizontal gravity component
  const beta = e.beta ?? 0;
  const gamma = e.gamma ?? 0;

  // Clamp to ±1 so we don't overpower the scale factor
  engine.gravity.x = Math.max(-1, Math.min(1, gamma / 45));
  engine.gravity.y = Math.max(-1, Math.min(1, beta / 45));
}

function setupOrientation(): void {
  const ctor = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };

  if (typeof ctor.requestPermission === 'function') {
    // iOS 13+ requires explicit permission via a user gesture
    const btn = document.getElementById('tilt-btn')!;
    btn.style.display = 'block';
    btn.addEventListener('click', () => {
      ctor.requestPermission!().then((state) => {
        if (state === 'granted') window.addEventListener('deviceorientation', applyOrientation);
        btn.style.display = 'none';
      });
    });
  } else if ('DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', applyOrientation);
  }
}

// ─────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────

function drawCheckerboard(): void {
  const w = canvas.width;
  const h = canvas.height;
  const s = CHECKERBOARD_SIZE;

  ctx.fillStyle = '#f7f7f7';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#ebebeb';
  for (let row = 0; row * s < h; row++) {
    for (let col = 0; col * s < w; col++) {
      if ((row + col) % 2 === 1) {
        ctx.fillRect(col * s, row * s, s, s);
      }
    }
  }
}

/** Draw a smooth closed curve through an array of vertices using quadratic
 *  Bézier segments – control point is each vertex, passing through midpoints. */
function traceBlobPath(verts: readonly Matter.Vector[]): void {
  const n = verts.length;
  if (n < 3) return;

  ctx.beginPath();
  const sx = (verts[n - 1].x + verts[0].x) / 2;
  const sy = (verts[n - 1].y + verts[0].y) / 2;
  ctx.moveTo(sx, sy);

  for (let i = 0; i < n; i++) {
    const v = verts[i];
    const vn = verts[(i + 1) % n];
    ctx.quadraticCurveTo(v.x, v.y, (v.x + vn.x) / 2, (v.y + vn.y) / 2);
  }

  ctx.closePath();
}

function renderShape(s: ShapeData): void {
  // A compound body from fromVertices has parts[0] as the parent; the real
  // collision polygons are parts[1..].  For a simple convex body, parts === [body].
  const parts =
    s.body.parts.length > 1 ? s.body.parts.slice(1) : s.body.parts;

  ctx.save();

  for (const part of parts) {
    traceBlobPath(part.vertices);

    // filled interior
    ctx.shadowColor = s.glowColor;
    ctx.shadowBlur = 22;
    ctx.fillStyle = s.color;
    ctx.fill();

    // glowing border – draw twice to punch up intensity
    ctx.shadowBlur = 30;
    ctx.strokeStyle = s.glowColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.restore();
}

function renderGrowing(g: GrowingShape): void {
  const elapsed = (performance.now() - g.startTime) / 1000;
  const radius = Math.min(MIN_RADIUS + GROWTH_RATE * elapsed, MAX_RADIUS);
  const raw = blobVertices(radius, g.seed);
  const verts = raw.map((v) => ({ x: v.x + g.x, y: v.y + g.y }));

  ctx.save();
  ctx.globalAlpha = 0.82;

  traceBlobPath(verts);

  ctx.shadowColor = g.glowColor;
  ctx.shadowBlur = 24;
  ctx.fillStyle = g.color;
  ctx.fill();

  ctx.shadowBlur = 32;
  ctx.strokeStyle = g.glowColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────

let lastTimestamp = 0;

function loop(timestamp: number): void {
  requestAnimationFrame(loop);

  const raw = timestamp - lastTimestamp;
  lastTimestamp = timestamp;
  // cap delta so a tab going to the background doesn't launch objects into space
  const delta = Math.min(raw, 48);

  Engine.update(engine, delta);

  drawCheckerboard();

  for (const s of shapes) renderShape(s);
  for (const [, g] of growing) renderGrowing(g);
}

// ─────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────

resizeCanvas();
window.addEventListener('resize', resizeCanvas);
setupOrientation();
requestAnimationFrame(loop);
