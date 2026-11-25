/** Supported color formats: '#rrggbb', '#rgb', '#rrggbbaa', 'rgb(r,g,b)', 'rgba(r,g,b,a)', or numeric [r, g, b] (0..1 or 0..255) */
export type ColorInput = string | [number, number, number];

/** Normalized RGB tuple (0..1) used internally by shaders */
export type RGBTuple = [number, number, number];

/** Direction can be an angle in degrees (0 = right, 90 = up, 180 = left, 270 = down) or a 2D vector */
export type DirectionInput = number | { x: number; y: number };

/** How cursor motion physically alters the fog layers */
export type InteractionMode = 'part' | 'swirl' | 'repel' | 'attract';

/** Built-in preset identifiers */
export type FogPresetName =
  | 'grayFog'
  | 'sefirahThrone'
  | 'crimsonAbyss'
  | 'emeraldNebula'
  | 'subtleMist';

/**
 * Configuration for a single fog depth stratum.
 * Up to 6 layers are composited back-to-front on the GPU.
 */
export interface FogLayerConfig {
  /** Base shadow/body color of this fog layer */
  color: ColorInput;
  /** Backlit / rim-illuminated crest color for billowing 3D depth */
  highlightColor?: ColorInput;
  /** Layer transparency (0 = invisible, 1 = fully opaque) */
  opacity: number;
  /** Cloud size multiplier relative to global scale (lower = bigger clouds, higher = finer wisps) */
  scale: number;
  /** Density / thickness of this layer (0.1 = wispy veil, 2.0 = heavy dense bank) */
  thickness: number;
  /** Softness of cloud edges (0.1 = sharp billowing fronts, 1.0 = smooth haze) */
  softness?: number;
  /** Relative drift speed multiplier for parallax depth */
  speedMultiplier: number;
  /** Angular offset in degrees from the global wind direction */
  directionOffset?: number;
  /**
   * Vertical coverage band in normalized screen space [minY, maxY] where 0 = bottom, 1 = top.
   * Example: [0.0, 0.55] pins heavy foreground fog to the bottom half of the viewport.
   */
  yRange?: [number, number];
  /** Vertical feathering at the top/bottom boundaries of yRange (0..1) */
  yFeather?: number;
  /** How strongly mouse wake affects this layer (0 = unaffected background, 1.5 = reactive foreground) */
  interactionSensitivity?: number;
  /** Seed offset so layers never overlap identically */
  seed?: number;
}

/** Motion & animation controls */
export interface FogAnimationConfig {
  /** Master toggle to enable or freeze fog animation */
  enabled: boolean;
  /** Global movement speed multiplier (0 = stationary, 1 = cinematic drift, 3+ = storm) */
  speed: number;
  /** Wind travel direction in degrees (0 = right, 90 = up) or { x, y } vector */
  direction: DirectionInput;
  /** Internal curling / domain-warping intensity (0 = flat scrolling, 1.5 = heavy rolling billows) */
  turbulence: number;
  /** Speed of internal billowing/morphing separate from linear wind drift */
  billowSpeed: number;
}

/** Mouse & touch wake physics (including spread & disappearance after motion) */
export interface FogInteractionConfig {
  /** Enable or disable pointer/touch interaction */
  enabled: boolean;
  /**
   * - 'part': Clears/thins fog and pushes clouds aside along the cursor path
   * - 'swirl': Creates rolling vortices in the direction of pointer movement
   * - 'repel': Pushes fog outward radially from the cursor
   * - 'attract': Pulls surrounding mist inward toward the cursor
   */
  mode: InteractionMode;
  /** Cursor influence radius in normalized viewport height (0.04 = tight finger, 0.35 = broad sweep) */
  radius: number;
  /** Force/intensity of displacement & parting (0..2.5) */
  strength: number;
  /**
   * How aggressively the wake spreads outward into surrounding fog after motion (0..1).
   * Higher values create wide billowing shockwaves/diffusion rings.
   */
  spread: number;
  /**
   * How fast the disturbed trail heals and disappears after motion stops (0.01..1.0).
   * Lower = lingering ghostly trail (5–8s), Higher = quick recovery (<0.8s).
   */
  disappearance: number;
  /** How much pointer movement speed amplifies the wake (0 = constant hover, 1 = motion-driven) */
  velocityInfluence: number;
  /** Amount of fog thinning (alpha clearing) inside the disturbed wake (0..1) */
  clearAmount: number;
  /** Enable touch drag support on mobile devices */
  touchEnabled: boolean;
  /** Listen on `window` instead of only the canvas element (recommended when canvas is behind UI) */
  globalEvents: boolean;
}

/** Optional ethereal backlight/nebula glow shining through thinner fog pockets */
export interface FogBacklightConfig {
  enabled: boolean;
  /** Primary eerie glow color (e.g., cyan-teal aurora) */
  primaryColor: ColorInput;
  /** Secondary accent glow color (e.g., emerald mist) */
  secondaryColor: ColorInput;
  /** Overall glow brightness (0..2) */
  intensity: number;
  /** Normalized screen position of the glow source { x: 0..1, y: 0..1 } (y=1 is top) */
  position: { x: number; y: number };
  /** Spread radius of the ambient backlight */
  radius: number;
}

/** Optional floating crimson/amber prayer stars suspended inside the fog */
export interface FogStarsConfig {
  enabled: boolean;
  /** Star density / count (0..200; values below 1 disable active stars) */
  count: number;
  /** Primary star color (e.g., iconic deep crimson) */
  primaryColor: ColorInput;
  /** Secondary star color (e.g., warm amber/gold) */
  secondaryColor: ColorInput;
  /** Base star glow size multiplier applied to all stars (0.5..3.0) */
  size: number;
  /** Expanded radius multiplier applied only to prominent stars selected by `radiusChance` (0.5..4.0) */
  radius: number;
  /** Fraction of stars that receive the expanded `radius` (0 = none, 0.25 = 25%, 1 = all) */
  radiusChance: number;
  /** Pulsing/twinkling animation speed */
  twinkleSpeed: number;
  /** How strongly thick fog occludes and softens stars behind it (0..1) */
  fogOcclusion: number;
}

/** Full user-facing configuration for SefirahFog */
export interface SefirahFogConfig {
  /** Optional starting preset; any explicit options below override the preset */
  preset?: FogPresetName;
  /** Global fog transparency multiplier (0..1) */
  opacity: number;
  /** Global cloud scale (lower = giant cathedral-scale clouds, higher = detailed fine mist) */
  scale: number;
  /** Global thickness / density multiplier (0.2..2.5) */
  thickness: number;
  /** Fractal noise detail octaves (3 = fast mobile, 5 = crisp anime detail, 6 = ultra) */
  detail: number;
  /** Background base color (set `transparentBackground: true` to overlay over an existing webpage) */
  backgroundColor: ColorInput;
  /** When true, canvas clears with alpha 0 so the fog floats seamlessly over website content */
  transparentBackground: boolean;
  /** Device pixel ratio cap for smooth performance (presets default to 1.0, or 1.25 for subtleMist) */
  maxDpr: number;
  /** Internal wake FBO resolution (128, 256, or 512 — 256 is ideal) */
  wakeResolution: number;
  /** GPU power preference hint set at WebGL context creation ('low-power' avoids waking discrete GPUs; default: 'low-power') */
  powerPreference: WebGLPowerPreference;
  /** Backing-store resolution scale multiplier (0.25..1.0; e.g. 0.75 cuts fragment load by 44%; default: 1.0) */
  resolutionScale: number;
  /** Target frame rate cap in FPS (0 = uncapped rAF, or e.g. 30 for low-power ambient backgrounds; presets default to 30) */
  targetFps: number;
  /** Automatically pause rendering when canvas is scrolled out of the viewport via IntersectionObserver (default: true) */
  pauseWhenOffscreen: boolean;
  /** Freeze drift animation to a static frame when OS prefers-reduced-motion is active (default: true) */
  respectReducedMotion: boolean;
  /** Create an opaque WebGL context (alpha: false) at context creation for faster compositing (default: false) */
  opaqueCanvas: boolean;
  /** Show a browser alert() with the exact error message if WebGL initialization fails (default: false) */
  alertOnError: boolean;
  /** Optional error callback invoked with the exact Error if initialization fails */
  onError?: (error: Error) => void;
  /** Individual color & depth layers (up to 6) */
  layers: FogLayerConfig[];
  /** Movement & animation settings */
  animation: FogAnimationConfig;
  /** Mouse/touch interactivity, spread, and disappearance settings */
  interaction: FogInteractionConfig;
  /** Backlit nebula/aurora illumination */
  backlight: FogBacklightConfig;
  /** Floating spirit/prayer stars */
  stars: FogStarsConfig;
}

/** Deep-partial helper so users can pass only the properties they want to customize */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends Array<infer U>
      ? Array<U>
      : T[K] extends object
        ? DeepPartial<T[K]>
        : T[K];
};

export type SefirahFogOptions = DeepPartial<SefirahFogConfig>;

/** Normalized internal representation of a layer ready for WebGL uniform upload */
export interface ResolvedFogLayer {
  color: RGBTuple;
  highlightColor: RGBTuple;
  opacity: number;
  scale: number;
  thickness: number;
  softness: number;
  speedMultiplier: number;
  directionOffsetRad: number;
  yMin: number;
  yMax: number;
  yFeather: number;
  interactionSensitivity: number;
  seed: number;
}