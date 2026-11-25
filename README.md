# Sefirah Fog

Sefirah Fog is a browser-side WebGL library for animated, layered fog. It includes five built-in visual presets, pointer and touch interactions, optional backlighting and stars, a framework-free API, and a React component and hook.

The fog is rendered to a canvas with shaders. It does not use image assets or a 3D scene framework.

## Contents

- [Installation](#installation)
- [Requirements](#requirements)
- [Vanilla JavaScript](#vanilla-javascript)
- [Built-in presets](#built-in-presets)
- [Creating and customizing presets](#creating-and-customizing-presets)
- [React](#react)
- [Configuration reference](#configuration-reference)
- [Engine methods](#engine-methods)
- [Performance and accessibility](#performance-and-accessibility)
- [Development](#development)
- [License](#license)

## Installation

Install the core package with your preferred package manager:

```sh
npm install sefirah-fog
```

```sh
pnpm add sefirah-fog
```

```sh
yarn add sefirah-fog
```

React is optional. If your application uses React, install it alongside the package if it is not already installed:

```sh
npm install sefirah-fog react
```

The package publishes ESM and CommonJS entry points, plus TypeScript declarations. It does not publish a standalone UMD or global-script bundle; use a bundler such as Vite, webpack, or another tool that resolves npm package imports.

## Requirements

- A browser with WebGL support. The engine tries WebGL 2 first, then WebGL 1.
- A container or canvas with a nonzero rendered width and height.
- React 18 or newer only when using the optional `sefirah-fog/react` entry point.

The engine uses `ResizeObserver` when available, and falls back to the window resize event. Offscreen pausing and reduced-motion detection use browser APIs when available.

## Vanilla JavaScript

Give the fog container a size, then create the engine:

```html
<div id="fog-hero" class="fog-hero"></div>
```

```css
.fog-hero {
  position: relative;
  width: 100%;
  height: 480px;
  overflow: hidden;
}
```

```ts
import { createSefirahFog } from 'sefirah-fog';

const fog = createSefirahFog('#fog-hero', {
  preset: 'grayFog',
  interaction: { mode: 'swirl' },
});

// For a plain page, release the engine when the page is leaving.
window.addEventListener('pagehide', () => fog.destroy(), { once: true });
```

`createSefirahFog` accepts a CSS selector, an existing `HTMLElement`, or an existing `HTMLCanvasElement`. A selector that matches no element throws an error. When given a container, the engine creates a canvas (`z-index: 0`) and prepends it so it fills the container behind positioned content (`position: relative; z-index: 1`); when given a canvas, it renders into that canvas.

For a transparent overlay above page content, use `transparentBackground: true`. The canvas is positioned over its container. Pointer events are listened for on `window` by default, so the fog can remain interactive behind other page content.

## Built-in presets

Pass a preset name in `options.preset`:

| Preset | Description |
| --- | --- |
| `grayFog` | Dark slate and teal fog, cyan and emerald backlight, and crimson and amber stars. This is the default. |
| `sefirahThrone` | Pale silver fog designed for a luminous, transparent overlay. |
| `crimsonAbyss` | Dark red fog with crimson lighting and a more dramatic atmosphere. |
| `emeraldNebula` | Deep teal fog with cyan and green highlights. |
| `subtleMist` | Lower-opacity, transparent mist intended to sit behind readable interface content. |

Presets supply complete defaults for the visual layers, motion, interaction, and effects. Any options passed alongside `preset` override the matching preset values:

```ts
const fog = createSefirahFog('#fog-hero', {
  preset: 'sefirahThrone',
  opacity: 0.7,
  animation: { speed: 0.2 },
  interaction: { enabled: false },
});
```

You can inspect a preset or resolve partial options into a full configuration:

```ts
import { FOG_PRESETS, resolveConfig } from 'sefirah-fog';

console.log(FOG_PRESETS.grayFog);

const config = resolveConfig({
  preset: 'grayFog',
  stars: { enabled: false },
});
```

`FOG_PRESETS` contains the built-in presets. Avoid mutating its objects; create an options object with your overrides instead.

## Creating and customizing presets

For an application-specific preset, define a reusable `SefirahFogOptions` object. It can start from any built-in preset and override only the properties you want to change:

```ts
import type { SefirahFogOptions } from 'sefirah-fog';

export const moonlitFog: SefirahFogOptions = {
  preset: 'sefirahThrone',
  opacity: 0.78,
  animation: {
    speed: 0.18,
    direction: 24,
  },
  backlight: {
    primaryColor: '#9bdcff',
    secondaryColor: '#b7f3dc',
    intensity: 0.7,
  },
  stars: { enabled: false },
};
```

Use the reusable object when mounting the engine:

```ts
const fog = createSefirahFog('#fog-hero', moonlitFog);
```

To define your own layer stack, provide the full list of layers. Supplying `layers` replaces the preset’s layer list:

```ts
export const customMist: SefirahFogOptions = {
  preset: 'grayFog',
  transparentBackground: true,
  layers: [
    {
      color: '#263943',
      highlightColor: '#9dcbd0',
      opacity: 0.55,
      scale: 0.9,
      thickness: 0.85,
      softness: 0.7,
      speedMultiplier: 0.5,
      yRange: [0.1, 1],
      interactionSensitivity: 0.4,
    },
    {
      color: '#101b22',
      highlightColor: '#547a86',
      opacity: 0.75,
      scale: 1.5,
      thickness: 1.2,
      softness: 0.4,
      speedMultiplier: 1.1,
      yRange: [0, 0.55],
      interactionSensitivity: 1.1,
    },
  ],
};
```

The library supports up to six layers. Each layer needs `color`, `opacity`, `scale`, `thickness`, and `speedMultiplier`; the remaining layer properties are optional.

An app-local custom preset is an options object, not a new value accepted by `FogPresetName`. To add a new built-in preset to a fork, add its name to `FogPresetName` and add its full configuration to `FOG_PRESETS`.

### Changing a running preset

`setPreset` switches to a built-in preset and applies optional overrides:

```ts
fog.setPreset('crimsonAbyss', {
  stars: { count: 35 },
  animation: { speed: 0.3 },
});
```

`updateConfig` changes selected options while retaining the other active settings; nested option groups such as `animation`, `interaction`, `backlight`, and `stars` are merged, and an array such as `layers` is replaced as a whole. Passing a different `preset` resets unmentioned options to that preset and clears active wakes, whereas passing the already active `preset` merges the remaining overrides:

```ts
fog.updateConfig({
  animation: { speed: 0.25 },
  interaction: { mode: 'repel', strength: 0.5 },
});

fog.setLayers(customMist.layers!);
```

`powerPreference` and `opaqueCanvas` are applied when the WebGL context is created. Changing them on an already-running engine does not alter the existing context; set them when creating the engine.

## React

Import the React integration from the `/react` subpath. The component creates and destroys the engine with its React lifecycle and passes option changes through to the existing engine.

```tsx
import { SefirahFog } from 'sefirah-fog/react';

export function Hero() {
  return (
    <SefirahFog
      options={{
        preset: 'grayFog',
        transparentBackground: true,
        interaction: { mode: 'swirl' },
      }}
      style={{ width: '100%', height: '100vh' }}
    >
      <h1>Above the Gray Fog</h1>
    </SefirahFog>
  );
}
```

The `children` render above the fog canvas. Give the component a height; an empty wrapper has no intrinsic height.

The component exposes engine controls through a ref:

```tsx
import { useRef } from 'react';
import { SefirahFog, type SefirahFogRef } from 'sefirah-fog/react';

export function InteractiveHero() {
  const fogRef = useRef<SefirahFogRef>(null);

  return (
    <>
      <button onClick={() => fogRef.current?.triggerPulse(0.5, 0.5)}>
        Create a pulse
      </button>
      <SefirahFog ref={fogRef} style={{ height: '70vh' }} />
    </>
  );
}
```

To attach fog to an existing element instead of rendering the component, use `useSefirahFog`:

```tsx
import { useRef } from 'react';
import { useSefirahFog } from 'sefirah-fog/react';

export function FogBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useSefirahFog(containerRef, { preset: 'subtleMist' });

  return (
    <>
      <div ref={containerRef} style={{ position: 'relative', height: 400 }} />
      <button onClick={() => engineRef.current?.pause()}>Pause</button>
    </>
  );
}
```

`<SefirahFog>` also accepts `fallback?: React.ReactNode` and `onError?: (error: Error) => void` (and `useSefirahFog` accepts `onError` as an optional third argument) to handle missing WebGL support gracefully without crashing React.

The `sefirah-fog/react` bundle includes the `'use client';` directive, so it can be imported directly in React Server Component frameworks such as Next.js App Router while still executing on the client.

## Configuration reference

`SefirahFogOptions` is a deep-partial configuration type: omitted values come from the selected preset (or `grayFog` when no preset is selected). Values below describe behavior; preset defaults can differ.

### Global options

| Option | Description |
| --- | --- |
| `preset` | One of `grayFog`, `sefirahThrone`, `crimsonAbyss`, `emeraldNebula`, or `subtleMist`. Defaults to `grayFog`. |
| `opacity` | Overall fog opacity multiplier, from `0` to `1`. |
| `scale` | Global cloud scale. Higher values create finer clouds. |
| `thickness` | Global fog density multiplier. |
| `detail` | Shader quality level from `2` to `6`. Lower values reduce some detail and shadow work. |
| `backgroundColor` | Background color used when `transparentBackground` is false. |
| `transparentBackground` | Render a transparent canvas background for overlays. |
| `maxDpr` | Upper bound for the device pixel ratio used to size the canvas. Preset defaults vary. |
| `wakeResolution` | Resolution of the interaction wake buffers; clamped to `64`–`512`. Lower values use less memory and GPU work. |
| `powerPreference` | WebGL hint: `'default'`, `'low-power'`, or `'high-performance'`. This is selected when the context is created and may be ignored by the browser. |
| `resolutionScale` | Canvas backing-resolution multiplier from `0.25` to `1`. `0.75` renders about 44% fewer pixels than `1`. |
| `targetFps` | Render rate cap. `0` means uncapped; all built-in presets default to `30`. |
| `pauseWhenOffscreen` | Pause when the canvas is outside the viewport, when `IntersectionObserver` is available. |
| `respectReducedMotion` | Freeze drift animation when the system requests reduced motion. |
| `opaqueCanvas` | Create the WebGL context with `alpha: false` for faster compositing on strictly opaque backgrounds (default `false`; cannot be switched to transparent later). |
| `alertOnError` | Show a browser `alert()` with the exact error message if WebGL initialization or target lookup fails (default `false`). |
| `onError` | Callback invoked with the `Error` object if target lookup or WebGL initialization fails. |
| `layers` | Full array of custom fog layers, up to six. Providing it replaces the preset’s layers. |
| `animation` | Movement and billowing controls; see below. |
| `interaction` | Pointer and touch wake controls; see below. |
| `backlight` | Optional colored glow behind the fog. |
| `stars` | Optional procedural stars and bokeh. |

### Animation options

| Option | Description |
| --- | --- |
| `enabled` | Enable or freeze animation. When animation is stopped and the wake has settled, the engine can sleep until a change occurs. |
| `speed` | Global wind movement speed. |
| `direction` | Angle in degrees (`0` points right, `90` up) or a vector such as `{ x: 1, y: 0 }`. |
| `turbulence` | Curling and domain-warping intensity. |
| `billowSpeed` | Internal cloud morphing speed, separate from wind movement. |

### Interaction options

| Option | Description |
| --- | --- |
| `enabled` | Enable pointer and touch wake effects. |
| `mode` | `part`, `swirl`, `repel`, or `attract`. |
| `radius` | Pointer influence radius, normalized to viewport height. |
| `strength` | Displacement force. Set to `0` for no wake force. |
| `spread` | How much the wake diffuses after being created. |
| `disappearance` | How quickly the wake heals; lower values leave trails longer. |
| `velocityInfluence` | How strongly pointer speed affects the wake. |
| `clearAmount` | How much the wake thins the fog. |
| `touchEnabled` | Enable touch input. |
| `globalEvents` | Listen on `window` (recommended when content outside the container sits above the fog) or on the container/canvas itself (`false`). |

### Backlight and star options

`backlight` accepts `enabled`, `primaryColor`, `secondaryColor`, `intensity`, `position: { x, y }`, and `radius`. Position is normalized to the canvas, with `y: 1` at the top.

`stars` accepts `enabled`, `count` (`0`–`200`; values below `1` hide stars), `primaryColor`, `secondaryColor`, `size`, `radius`, `radiusChance`, `twinkleSpeed`, and `fogOcclusion`. `radiusChance` is the fraction of stars receiving the larger radius.

### Layer options

Each layer supports:

| Option | Description |
| --- | --- |
| `color` | Base shadow/body color. |
| `highlightColor` | Optional rim highlight; derived from `color` when omitted. |
| `opacity` | Layer opacity. |
| `scale` | Relative cloud scale for this layer. |
| `thickness` | Relative density for this layer. |
| `softness` | Cloud-edge softness. |
| `speedMultiplier` | Relative drift speed for parallax. |
| `directionOffset` | Direction offset in degrees from global wind. |
| `yRange` | Vertical coverage `[min, max]`, where `0` is bottom and `1` is top. |
| `yFeather` | Softness of the top and bottom coverage edges. |
| `interactionSensitivity` | How strongly this layer responds to the wake. |
| `seed` | Per-layer variation seed. |

Colors accept `#rrggbb`, `#rgb`, `#rrggbbaa` (RGB channels used), `rgb(r,g,b)` / `rgba(r,g,b,a)` (RGB channels used), or a numeric `[r, g, b]` tuple in either `0`–`1` or `0`–`255`.

## Engine methods

The object returned from `createSefirahFog` is a `SefirahFogEngine` instance:

| Method | Purpose |
| --- | --- |
| `getConfig()` | Get a snapshot of the active configuration. |
| `updateConfig(options)` | Merge partial settings into the current configuration (or reset to the new preset and clear wake when `options.preset` changes). |
| `setPreset(name, overrides?)` | Switch to a built-in preset, then apply overrides. |
| `setLayers(layers)` | Replace all active layers. |
| `addLayer(layer)` / `removeLayer(index)` | Add or remove a layer, up to six total. |
| `setAnimationEnabled(enabled)` | Toggle drift animation. |
| `setInteractionEnabled(enabled)` | Toggle pointer and touch interaction. |
| `triggerPulse(x, y, options?)` | Create a programmatic wake at normalized coordinates (`0,0` bottom-left; `1,1` top-right). |
| `clearWake()` | Clear current wake trails. |
| `pause()` / `resume()` | Manually pause or resume rendering. |
| `resize(width?, height?)` | Recompute the canvas backing size; optional dimensions are in CSS pixels. |
| `renderFrame(dtSeconds?)` | Render one frame manually. |
| `destroy()` | Stop rendering, release listeners and WebGL resources, and remove an injected canvas. |

Always call `destroy()` when a vanilla JavaScript host is removed. The React component and hook handle cleanup automatically.

## Performance and accessibility

- Lower `resolutionScale` or `maxDpr` to reduce the number of rendered pixels. This is usually the largest performance lever.
- Use fewer fog layers and a lower `detail` level on mobile or low-power devices.
- Set `targetFps` to a value such as `30` for an ambient background.
- Lower `wakeResolution` when interaction trails do not need to be sharp.
- Disable stars or backlight if they are not needed.
- Keep `pauseWhenOffscreen` and `respectReducedMotion` enabled unless your experience requires otherwise.
- The `powerPreference` setting is a browser hint, not a guarantee of which GPU is used.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

`npm run dev` rebuilds the package in watch mode, and `npm run test:watch` runs Vitest in watch mode. The demo in `demo/index.html` imports `dist/index.mjs`, so build first and serve the repository over HTTP; for example, run `python -m http.server 8000` from the repository root and visit `/demo/`. Opening the HTML directly with a `file://` URL may prevent its module import from loading.

## License

MIT. See [LICENSE.md](LICENSE.md).
