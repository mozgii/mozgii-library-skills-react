---
name: react-3d-and-canvas
description: Builds 3D scenes and canvas graphics in React that stay fast and usable - choosing between SVG, Canvas 2D, react-three-fiber with three.js and drei, or a plain three.js scene; react-three-fiber 9 setup for React 19, loading glTF models with Suspense and progress, on-demand rendering with frameloop="demand" and invalidate, animating in useFrame through refs instead of state, instancing, level of detail, compressed models and textures, disposing GPU resources, adaptive resolution, WebGL fallbacks, keyboard controls, reduced motion and text alternatives, and a Canvas 2D loop with devicePixelRatio and ResizeObserver. Use when adding a 3D product viewer, a configurator, a data or map visualization in WebGL, a game-like scene, particles or a drawing canvas, or when a scene drops frames, drains the battery, leaks memory or shows a black canvas.
metadata:
  tags:
  - react
  - 3d
  - three.js
  - react-three-fiber
  - drei
  - canvas
  - webgl
  - performance
---

# React 3D and canvas

React describes the scene; the GPU draws it. react-three-fiber (R3F) is a React renderer for three.js: JSX elements become three.js objects, and hooks give access to the render loop. Canvas 2D needs no renderer at all, only a loop you control. In both, frame rate depends on what you do per frame, so the rules are: render only when something changes, animate through refs instead of React state, draw many similar objects as one, and release GPU memory you no longer need.

## Step 0: read the installed 3D packages

R3F majors are tied to React majors, so check the pairing first:

```bash
node -p "['react','react-dom','three','@react-three/fiber','@react-three/drei','@react-three/postprocessing','@types/three'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `three` 0.187.0, `@react-three/fiber` 9.8.2 (peer range `react >=19 <19.4`), `@react-three/drei` 10.7.9 (needs fiber 9). R3F 8 pairs with React 18; R3F 9 with React 19; a v10 alpha exists and is not for production. Keep `@types/three` at the same minor as `three`; three.js breaks APIs between minor (0.x) releases, so read its migration notes before upgrading.

## Decision table: which drawing technology

| Need | Use | Why the others lose |
|---|---|---|
| Icons, diagrams, charts with fewer than a few thousand shapes; text that must be selectable and accessible | SVG in JSX | each shape is a DOM node with events and accessibility; Canvas loses both |
| Many 2D shapes or pixels changing every frame (particles, drawing, heatmaps, sparklines at scale) | Canvas 2D (`getContext('2d')`) | SVG with 10,000 nodes stalls layout; WebGL is more code for flat drawing |
| 3D in a React app (product viewer, configurator, scene with UI) | react-three-fiber 9 + drei | declarative scene, Suspense loading, React state for UI around it |
| A 3D engine embedded once, no React state inside | plain three.js in an effect | R3F adds little when React never touches the scene |
| Large 2D scenes with sprites (games, whiteboards) | a 2D WebGL engine (PixiJS) | Canvas 2D slows past tens of thousands of draws per frame |

## react-three-fiber basics for React 19

`<Canvas>` creates the renderer, scene and camera; children are three.js objects named in camelCase (`<mesh>`, `<boxGeometry>`, `<meshStandardMaterial>`); constructor arguments go in `args`:

```tsx
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'

<Canvas camera={{ position: [3, 2, 4], fov: 45 }} dpr={[1, 2]} frameloop="demand" fallback={<img src="/product.jpg" alt="Desk lamp" />}>
  <ambientLight intensity={0.4} />
  <directionalLight position={[5, 5, 5]} intensity={1.2} />
  <mesh rotation={[0, Math.PI / 4, 0]}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color="hotpink" />
  </mesh>
  <OrbitControls makeDefault />
</Canvas>
```

- Hooks that use R3F (`useFrame`, `useThree`, `useLoader`) work only inside `<Canvas>`; React context from outside is bridged into the canvas in R3F 9.
- `dpr={[1, 2]}` caps the device pixel ratio at 2; a 3x phone screen otherwise renders 2.25 times the pixels for little visible gain.
- `fallback` renders when WebGL is not available.

## Render on demand with frameloop and invalidate

By default R3F renders 60 or more frames per second forever, even when nothing moves, draining batteries. For viewers and configurators, render only when something changes:

- `frameloop="demand"` renders only after a prop change or an `invalidate()` call; drei controls call `invalidate` while the user drags.
- Call `invalidate()` (from `useThree((s) => s.invalidate)`) after changing a three.js object outside React (a texture finished loading, an imperative tween step).
- Use `frameloop="always"` only for continuous animation, and switch to `"never"` while the canvas is off screen or the tab is hidden.

## Animate in useFrame through refs, not state

`useFrame((state, delta) => …)` runs every frame before rendering. Mutate the three.js object through a ref; calling `setState` 60 times a second re-renders React every frame:

```tsx
function Spinner({ speed = 1 }: { speed?: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => { if (ref.current) ref.current.rotation.y += delta * speed })   // frame-rate independent
  return <mesh ref={ref}><torusKnotGeometry args={[0.6, 0.2, 128, 16]} /><meshNormalMaterial /></mesh>
}
```

- Multiply by `delta` so speed is the same at 30, 60 and 120 frames per second.
- Never allocate in `useFrame` (`new THREE.Vector3()` per frame creates garbage and stutters); create scratch objects once outside.
- Keep React state for discrete changes (selected colour, open panel), and let the scene read it.

## Draw many objects with instancing

Every mesh is a draw call; thousands of draw calls drop frames. Draw identical geometry with one `InstancedMesh` (or drei's `<Instances>` and `<Instance>`), setting a matrix per instance:

```tsx
const COUNT = 5000
function Points({ positions }: { positions: Float32Array }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    for (let i = 0; i < COUNT; i++) { m.setPosition(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!); ref.current!.setMatrixAt(i, m) }
    ref.current!.instanceMatrix.needsUpdate = true
  }, [positions])
  return <instancedMesh ref={ref} args={[undefined, undefined, COUNT]}><sphereGeometry args={[0.02, 8, 8]} /><meshBasicMaterial color="white" /></instancedMesh>
}
```

Share geometries and materials between meshes (create them once with `useMemo`, or declare them once and reference them) instead of creating one per mesh.

## Load glTF models with Suspense

glTF (`.glb`) is the format to ship 3D models. drei's `useGLTF` loads a model through Suspense and caches it; preload models the user will likely open:

```tsx
import { useGLTF } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'
function Lamp(props: ThreeElements['group']) {
  const { scene } = useGLTF('/models/lamp.glb')            // suspends until loaded; Draco and Meshopt decoders supported
  return <primitive object={scene} {...props} />
}
useGLTF.preload('/models/lamp.glb')
```

- Compress models before shipping: `npx @gltf-transform/cli optimize in.glb out.glb` (the package is scoped, and its command inside is `gltf-transform`; geometry with Meshopt or Draco, textures to KTX2 or WebP, resized). Models straight from modelling tools are often ten times larger than needed.
- `npx gltfjsx model.glb --types` generates a typed component with named nodes, so you can change materials per part.
- Wrap the scene in `<Suspense fallback={…}>` inside the canvas and show progress with drei's `useProgress` in an `<Html>` overlay.

## Release GPU memory you no longer need

R3F disposes geometries, materials and textures it created when their components unmount. Objects you created yourself (with `new`, or a loaded scene you cloned) are your job: call `.dispose()` on geometries, materials and textures in an effect cleanup. Cached loader results stay in memory until cleared (`useGLTF.clear(url)`). Watch `renderer.info.memory` (`useThree((s) => s.gl.info)`) while navigating between scenes: geometry and texture counts should return to their baseline.

## Adaptive quality for slow devices

Let the scene lower its cost when frames drop: drei's `<PerformanceMonitor>` reports when the frame rate falls or recovers, and you lower `dpr`, turn off shadows or post-processing, or swap to simpler models; `<AdaptiveDpr pixelated />` drops resolution while the camera moves. drei's `<Detailed distances={[0, 15, 30]}>` switches level-of-detail meshes by camera distance, and `<Bvh>` speeds up raycasting (pointer events) on dense meshes.

## Accessibility for canvas and 3D scenes

A canvas is a single image to assistive technology. Make the experience usable without seeing or pointing at it:

- Give the canvas wrapper `role="img"` and an `aria-label` describing what it shows, or a nearby text description; for interactive scenes, expose the important actions as real HTML buttons beside the canvas.
- Provide keyboard controls for rotation and zoom (buttons, or arrow keys on a focused wrapper with visible focus).
- Respect `prefers-reduced-motion`: no auto-rotation or camera fly-ins; switch to static views.
- Keep text in HTML (drei's `<Html>` or overlays), not as textures, so it can be read, translated and zoomed.

## Worked example: a product viewer with loading, fallback and keyboard controls

A glTF product viewer that renders on demand, shows loading progress, falls back to an image without WebGL or when the model fails, supports keyboard rotation, and respects reduced motion:

```tsx
import { Suspense, useRef, type ComponentRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Bounds, Environment, Html, OrbitControls, useGLTF, useProgress } from '@react-three/drei'
import { ErrorBoundary } from 'react-error-boundary'

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>   // drei's controls instance, without importing three-stdlib

const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  return <primitive object={scene} />
}

function Progress() {
  const { progress } = useProgress()
  return <Html center><p role="status" className="viewer-progress">Loading model… {Math.round(progress)}%</p></Html>
}

function KeyboardRotate({ controls }: { controls: React.RefObject<OrbitControlsImpl | null> }) {
  const invalidate = useThree((s) => s.invalidate)
  const turn = (step: number) => {
    const c = controls.current
    if (!c) return
    c.setAzimuthalAngle(c.getAzimuthalAngle() + step); c.update(); invalidate()
  }
  return (
    <Html fullscreen style={{ pointerEvents: 'none' }}>
      <div className="viewer-controls" style={{ pointerEvents: 'auto' }}>
        <button type="button" aria-label="Rotate left" onClick={() => turn(Math.PI / 8)}>⟲</button>
        <button type="button" aria-label="Rotate right" onClick={() => turn(-Math.PI / 8)}>⟳</button>
        <button type="button" aria-label="Reset view" onClick={() => { controls.current?.reset(); invalidate() }}>Reset</button>
      </div>
    </Html>
  )
}

export function ProductViewer({ modelUrl, posterUrl, name }: { modelUrl: string | null; posterUrl: string; name: string }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const poster = <img src={posterUrl} alt={name} className="viewer-poster" />
  if (!modelUrl) return <figure className="viewer">{poster}<figcaption>3D view is not available for this product.</figcaption></figure>
  return (
    <figure className="viewer" role="group" aria-label={`3D view of ${name}. Drag or use the buttons to rotate.`}>
      <ErrorBoundary fallback={<>{poster}<p role="alert">The 3D model could not be loaded.</p></>}>
        <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 40, position: [0, 0.6, 3] }} fallback={poster} style={{ aspectRatio: '4 / 3', width: '100%' }}>
          <Suspense fallback={<Progress />}>
            <Environment files="/env/studio-1k.hdr" />
            <Bounds fit clip observe margin={1.2}><Model url={modelUrl} /></Bounds>
          </Suspense>
          <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={1.5} maxDistance={6}
            autoRotate={!reduceMotion} autoRotateSpeed={0.6} />
          <KeyboardRotate controls={controls} />
        </Canvas>
      </ErrorBoundary>
      <figcaption>{name}</figcaption>
    </figure>
  )
}
```

Serve the environment map yourself from `public/env/`: drei's `preset` prop fetches its HDR from a third-party CDN at run time, and drei's docs say presets are not meant for production because they may fail. A figure takes one `<figcaption>`, so the failure message is a plain alert above the caption. With `frameloop="demand"`, `autoRotate` still needs frames: OrbitControls requests them while rotating, and reduced-motion users get a still model. More recipes (Canvas 2D loop, raycasting, post-processing, WebGPU): [canvas-and-3d-recipes.md](references/canvas-and-3d-recipes.md).

## Verify 3D and canvas work

- Chrome DevTools Performance with CPU 4x slowdown: frames stay under 16 ms while interacting. With reduced motion on (DevTools Rendering panel), idle with `frameloop="demand"` shows no frames; with it off, `autoRotate` keeps asking for them.
- `gl.info.render.calls` stays low (tens, not thousands) for scenes with many objects; `gl.info.memory` returns to baseline after leaving the page.
- Disable WebGL (`chrome://flags` or a browser without it): the fallback image shows, no blank box.
- Block the model URL: the error boundary shows the poster and a message, and the figure still has one caption.
- Network panel: the HDR and the model come from your own origin; no request goes to a CDN you do not control.
- Keyboard: Tab to the controls, rotate, reset; screen reader reads the description.
- Check the shipped `.glb` sizes in the network panel: models compressed, textures resized.

## Gotchas and anti-patterns in 3D and canvas

Each gotcha names the symptom, its cause and the fix.

1. **"Hooks can only be used within the Canvas component".** Cause: `useFrame` or `useThree` called outside `<Canvas>`. Fix: move the component inside the canvas.
2. **The canvas is black or invisible.** Cause: no lights for a standard material, the camera inside the model, or a parent with zero height. Fix: add lights or an `Environment`, fit with `<Bounds>`, give the container a size.
3. **The fan spins up on a static scene.** Cause: the default `frameloop="always"`. Fix: `frameloop="demand"` and `invalidate()` on changes.
4. **Animation stutters and React DevTools shows constant renders.** Cause: `setState` inside `useFrame`. Fix: mutate refs; keep state for discrete changes.
5. **Memory grows on every visit to the page.** Cause: self-created geometries, materials or textures never disposed, or cached models never cleared. Fix: dispose in cleanups; `useGLTF.clear` when a model is gone for good.
6. **The model takes ten seconds to appear.** Cause: an uncompressed 40 MB `.glb` with 4K textures. Fix: `npx @gltf-transform/cli optimize`, KTX2 or WebP textures, preload.
7. **Canvas 2D drawing is blurry on high-DPI screens.** Cause: the canvas's pixel size equals its CSS size. Fix: multiply the backing size by `devicePixelRatio` and scale the context.
8. **Peer dependency errors installing R3F.** Cause: R3F 9 with React 18, or React outside fiber's peer range. Fix: R3F 8 for React 18, R3F 9 for React 19.0 to 19.3.
9. **Lighting vanishes or the scene never leaves its loading state in production.** Cause: `<Environment preset="…">` loads from a CDN that can fail or that your Content Security Policy blocks. Fix: self-host a 1K `.hdr` and pass it with `files`.
10. **`npx gltf-transform` returns a 404 from npm.** Cause: no package has that bare name. Fix: `npx @gltf-transform/cli`.

## Pre-merge checklist for 3D and canvas

1. The technology fits (SVG, Canvas 2D, R3F, plain three.js).
2. R3F and drei versions match React's major; `@types/three` matches `three`.
3. Static scenes use `frameloop="demand"`; animations use refs and `delta`; nothing allocates per frame.
4. Repeated objects are instanced; geometries and materials are shared.
5. Models and environment maps are compressed, self-hosted and loaded with Suspense, progress and an error fallback.
6. GPU resources created by hand are disposed; memory returns to baseline.
7. A WebGL fallback, keyboard controls, a text description and reduced-motion behaviour exist.

See also: react-performance, react-animation, react-charts-and-dataviz, react-accessibility, react-suspense-and-concurrency.
