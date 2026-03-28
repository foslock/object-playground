# Physics Canvas

An interactive browser toy where you sculpt randomly-shaped blobs that collide, bounce, and tumble under real gravity — including your device's physical tilt.

---

## Running locally

```bash
npm install
npm run dev        # starts Vite dev server at http://localhost:5173
npm run build      # production build → dist/
npm run preview    # preview the production build
```

Requires **Node 18+**.

---

## How to interact

| Action | What happens |
|---|---|
| **Click / tap and hold** on empty canvas | A randomly-shaped blob grows at your cursor/finger while held |
| **Release** | The blob is released into the world and obeys physics (gravity, collisions, bouncing) |
| **Hold longer** | The blob grows larger before being released (up to a maximum size) |
| **Double-click / double-tap** on a blob | Deletes that blob from the canvas |
| **Tilt your device** *(mobile)* | Gravity shifts to match the device's physical orientation — blobs roll toward the lowest edge |
| **Tap "Enable Tilt Controls"** *(iOS)* | Grants the accelerometer permission required on iOS 13+ |

The four edges of the canvas are solid walls; blobs cannot escape.

---

## Visual design

- **Checkerboard background** — subtle light-grey pattern gives spatial reference without distraction.
- **Random blob shapes** — each shape is generated from a unique seed using quadratic Bézier curves through 8 randomly-perturbed radial control points, producing organic, amoeba-like outlines.
- **Randomised colours** — every blob gets a unique HSL hue with a vivid saturation, making each one distinct.
- **Glowing border** — each blob has a bright luminous outline rendered via canvas `shadowBlur`, giving an electric glow effect that intensifies when growing.

---

## Technical overview

| Concern | Approach |
|---|---|
| **Build tooling** | [Vite](https://vitejs.dev/) + TypeScript |
| **Physics** | [Matter.js](https://brm.io/matter-js/) — rigid-body dynamics, collision detection, restitution |
| **Rendering** | HTML5 Canvas 2D API — custom render loop driven by `requestAnimationFrame` |
| **Shapes** | `Matter.Bodies.fromVertices` converts the blob polygon into a physics body; the same vertices are rendered via quadratic Bézier curves for smooth outlines |
| **Gravity** | `DeviceOrientationEvent` (beta/gamma) maps directly to `engine.gravity.{x,y}`; falls back to standard downward gravity on desktop |
| **Multi-touch** | Each active `Touch.identifier` has its own growing-shape state so multiple blobs can be sculpted simultaneously |

### File layout

```
object-playground/
├── index.html          # app shell, canvas element, permission button
├── package.json
├── tsconfig.json
├── src/
│   └── main.ts         # entire application (physics, rendering, input)
└── README.md
```

---

## Physics parameters

| Parameter | Value | Effect |
|---|---|---|
| `restitution` | 0.35 | moderate bounciness |
| `friction` | 0.06 | low surface friction → blobs slide easily |
| `frictionAir` | 0.007 | light air drag keeps things moving naturally |
| `density` | 0.002 | consistent mass regardless of size |
| `gravity.scale` | 0.0018 | tuned so gravity feels physical on a typical screen |

Gravity direction is updated in real-time from the device accelerometer when permission is granted; on desktop it defaults to straight down (`y = 1`).
