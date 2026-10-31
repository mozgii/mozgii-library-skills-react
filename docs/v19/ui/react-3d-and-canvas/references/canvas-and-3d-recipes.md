---
title: Canvas 2D and 3D recipes for React
author: MOZGII, Inc.
lang: en
---

# Canvas 2D and 3D recipes for React

Recipes for drawing in React beyond the basic viewer: a Canvas 2D render loop with high-DPI support, drawing in a worker with OffscreenCanvas, pausing scenes that are off screen, pointer events and selection in react-three-fiber, post-processing, and the state of WebGPU. Sources: MDN (Canvas API, OffscreenCanvas, ResizeObserver), the react-three-fiber 9 and drei 10 documentation and type definitions, and the three.js manual.

## A Canvas 2D render loop with devicePixelRatio and ResizeObserver

A canvas has two sizes: its CSS size and its backing pixel size. Match the backing size to the CSS size times `devicePixelRatio`, redraw on resize, and run the loop with `requestAnimationFrame` only while needed. `draw` returns true to keep animating and false to stop; `redraw()` starts the loop again when the data changes after it stopped:

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

type Draw = (ctx: CanvasRenderingContext2D, size: { w: number; h: number }, t: number) => boolean

export function useCanvasLoop(draw: Draw) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  const startRef = useRef<() => void>(() => {})
  useLayoutEffect(() => { drawRef.current = draw })            // the latest draw, set after commit, never during render
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0, w = 0, h = 0
    const frame = (t: number) => {
      raf = 0
      if (drawRef.current(ctx, { w, h }, t)) raf = requestAnimationFrame(frame)   // true: keep animating
    }
    const start = () => { if (!raf) raf = requestAnimationFrame(frame) }       // one loop at a time
    startRef.current = start
    const ro = new ResizeObserver(([entry]) => {
      const box = entry!.contentRect
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = box.width; h = box.height
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)                  // draw in CSS pixels
      start()
    })
    ro.observe(canvas)
    return () => { ro.disconnect(); cancelAnimationFrame(raf); raf = 0; startRef.current = () => {} }
  }, [])
  const redraw = useCallback(() => startRef.current(), [])
  return { ref, redraw }
}
```

A static chart draws once and returns false, then asks for one more frame whenever its data changes:

```tsx
export function Sparkline({ points }: { points: number[] }) {
  const { ref, redraw } = useCanvasLoop((ctx, { w, h }) => {
    ctx.clearRect(0, 0, w, h)
    const max = Math.max(1, ...points)
    ctx.beginPath()
    points.forEach((p, i) => ctx.lineTo((i / Math.max(1, points.length - 1)) * w, h - (p / max) * h))
    ctx.stroke()
    return false                                              // nothing moves: stop until redraw()
  })
  useEffect(redraw, [points, redraw])
  return <canvas ref={ref} role="img" aria-label={`Trend of ${points.length} values`} style={{ width: '100%', height: 40 }} />
}
```

- `drawRef` is written in a layout effect, not during render: React may render and throw away a render (Strict Mode, a suspended transition), and a ref written then holds a `draw` that never committed.
- Without `redraw()`, a loop that once returned false never draws again until the canvas resizes: new data shows a stale picture.

Give the canvas a CSS size (`width: 100%; aspect-ratio: 16 / 9`); its default 300 by 150 backing size is otherwise stretched and blurry.

## Drawing in a worker with OffscreenCanvas

Heavy drawing (large heatmaps, image processing) can move off the main thread. Transfer control of the canvas to a worker once; the worker draws, and the main thread stays responsive:

```ts
// main thread
const off = canvasRef.current!.transferControlToOffscreen()
const worker = new Worker(new URL('./draw.worker.ts', import.meta.url), { type: 'module' })
worker.postMessage({ type: 'init', canvas: off, dpr: devicePixelRatio }, [off])
worker.postMessage({ type: 'data', points })          // send data, not drawing commands
```

`transferControlToOffscreen` can be called only once per canvas element: in Strict Mode development, effects run twice, so guard it with a ref or create the canvas element imperatively. Resize by posting the new size to the worker.

## Pause scenes that are off screen

A scene below the fold or in a hidden tab should not render. Switch the frame loop with an `IntersectionObserver` and the page visibility:

```tsx
const subscribeTab = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb)
  return () => document.removeEventListener('visibilitychange', cb)
}

function useVisible<T extends Element>() {
  const ref = useRef<T>(null)
  const [onScreen, setOnScreen] = useState(true)
  const tabVisible = useSyncExternalStore(subscribeTab, () => document.visibilityState === 'visible', () => true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setOnScreen(e!.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, onScreen && tabVisible] as const
}
// <div ref={ref}><Canvas frameloop={visible ? 'always' : 'never'}>…</Canvas></div>
```

Keep the two signals apart: one flag written by both would restart a scene below the fold as soon as the tab comes back.

## Pointer events and selection in react-three-fiber

R3F raycasts pointer events against meshes: `onClick`, `onPointerOver`, `onPointerOut` and friends work on `<mesh>` like on DOM elements. Call `event.stopPropagation()` to hit only the nearest object, and set the cursor with drei's `useCursor(hovered)`. For dense meshes, wrap them in drei's `<Bvh>` so raycasting stays fast. Mirror important selections in HTML (a list of parts with buttons) so keyboard and screen reader users can select too.

## Post-processing effects

`@react-three/postprocessing` adds effects (bloom, depth of field, outline) through an `<EffectComposer>`. Each effect costs a full-screen pass: keep two or three, turn them off on low-end devices through `<PerformanceMonitor>`, and remember that post-processing disables the renderer's built-in antialiasing, so add an SMAA or FXAA pass when edges look jagged.

## WebGPU with three.js

three.js ships a `WebGPURenderer` (import from `three/webgpu`) that falls back to WebGL 2 where WebGPU is unavailable, with node-based materials (TSL). In react-three-fiber 9, pass an async factory to the `gl` prop that creates the renderer and awaits `renderer.init()`. Prefer the WebGL renderer for production scenes unless you need compute shaders or measured WebGPU gains: drei helpers and post-processing support WebGPU unevenly, and react-three-fiber's WebGPU-first major (v10) is still in alpha.

## Text, labels and HTML overlays

drei's `<Html>` places DOM elements at a 3D position: labels stay crisp, translatable and accessible, and `occlude` hides them behind geometry. For many labels (hundreds), use SDF text (drei's `<Text>`) instead; it is a mesh, so give it an HTML equivalent for assistive technology.

## Loading states and preloading assets

`useProgress` reports loading across all three.js loaders, which makes a single progress bar for the whole scene. Preload assets for the next step of a configurator (`useGLTF.preload(url)`, `useTexture.preload(url)`) when the user hovers the option, and keep the previous model visible during the swap with a Transition (`startTransition(() => setModel(next))`), so the scene does not fall back to the Suspense fallback.
