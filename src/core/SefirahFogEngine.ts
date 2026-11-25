import { resolveConfig } from '../presets';
import { FOG_FRAGMENT_SHADER } from '../shaders/fog.frag';
import { FULLSCREEN_VERTEX_SHADER } from '../shaders/fullscreen.vert';
import { NOISE_BAKE_FRAGMENT_SHADER } from '../shaders/noiseBake.frag';
import { WAKE_FRAGMENT_SHADER } from '../shaders/wake.frag';
import type {
  FogLayerConfig,
  FogPresetName,
  ResolvedFogLayer,
  RGBTuple,
  SefirahFogConfig,
  SefirahFogOptions,
} from '../types';
import {
  bakeCloudNoiseTexture,
  clamp,
  clearPingPongFBO,
  createFullscreenQuad,
  createPingPongFBO,
  createProgram,
  finiteOr,
  interactionModeToInt,
  MAX_FOG_LAYERS,
  mergeDefined,
  normalizeDirection,
  parseColor,
  resolveLayers,
  type PingPongFBO,
} from './glUtils';
import { InteractionManager } from './InteractionManager';

interface WakeUniforms {
  u_prevWake: WebGLUniformLocation | null;
  u_texel: WebGLUniformLocation | null;
  u_aspect: WebGLUniformLocation | null;
  u_dt: WebGLUniformLocation | null;
  u_mouse: WebGLUniformLocation | null;
  u_prevMouse: WebGLUniformLocation | null;
  u_mouseActive: WebGLUniformLocation | null;
  u_mode: WebGLUniformLocation | null;
  u_radius: WebGLUniformLocation | null;
  u_spread: WebGLUniformLocation | null;
  u_decayBase: WebGLUniformLocation | null;
  u_windVel: WebGLUniformLocation | null;
  u_moveDir: WebGLUniformLocation | null;
  u_moveSpeed: WebGLUniformLocation | null;
  u_wakePower: WebGLUniformLocation | null;
}

interface FogUniforms {
  u_wakeTex: WebGLUniformLocation | null;
  u_noiseTex: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_nebulaOffset: WebGLUniformLocation | null;
  u_opacity: WebGLUniformLocation | null;
  u_detail: WebGLUniformLocation | null;
  u_detailWeight: WebGLUniformLocation | null;
  u_bgColor: WebGLUniformLocation | null;
  u_transparentBg: WebGLUniformLocation | null;
  u_turbulence: WebGLUniformLocation | null;
  u_wakeActive: WebGLUniformLocation | null;
  u_interactionStrength: WebGLUniformLocation | null;
  u_clearAmount: WebGLUniformLocation | null;
  u_backlightEnabled: WebGLUniformLocation | null;
  u_backlightPrimary: WebGLUniformLocation | null;
  u_backlightSecondary: WebGLUniformLocation | null;
  u_backlightIntensity: WebGLUniformLocation | null;
  u_backlightPos: WebGLUniformLocation | null;
  u_backlightRadius: WebGLUniformLocation | null;
  u_starsEnabled: WebGLUniformLocation | null;
  u_starPrimary: WebGLUniformLocation | null;
  u_starSecondary: WebGLUniformLocation | null;
  u_starSize: WebGLUniformLocation | null;
  u_starTwinklePhase: WebGLUniformLocation | null;
  u_starDrift: WebGLUniformLocation | null;
  u_starParams: WebGLUniformLocation | null;
  u_layerCount: WebGLUniformLocation | null;
  u_layerColor: WebGLUniformLocation | null;
  u_layerHighlight: WebGLUniformLocation | null;
  u_layerParamsA: WebGLUniformLocation | null;
  u_layerParamsB: WebGLUniformLocation | null;
  u_layerYBand: WebGLUniformLocation | null;
  u_layerMotion: WebGLUniformLocation | null;
}

const STAR_CELL_PERIOD = 128;
const TWO_PI = Math.PI * 2;

function wrapPositive(val: number, period: number): number {
  return ((val % period) + period) % period;
}

export class SefirahFogEngine {
  public readonly canvas: HTMLCanvasElement;
  private ownsCanvas: boolean;
  private container: HTMLElement;

  private gl: WebGLRenderingContext;
  private wakeProgram: WebGLProgram | null = null;
  private fogProgram: WebGLProgram | null = null;
  private wakeUniforms: WakeUniforms | null = null;
  private fogUniforms: FogUniforms | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private wakeFBO: PingPongFBO | null = null;
  private noiseTex: WebGLTexture | null = null;

  private config: SefirahFogConfig;
  private resolvedLayers: ResolvedFogLayer[] = [];
  private bgColorRGB: RGBTuple = [0, 0, 0];
  private backlightPrimaryRGB: RGBTuple = [0, 1, 1];
  private backlightSecondaryRGB: RGBTuple = [0, 1, 0.5];
  private starPrimaryRGB: RGBTuple = [1, 0.1, 0.2];
  private starSecondaryRGB: RGBTuple = [1, 0.7, 0.3];
  private windDir: [number, number] = [1, 0];
  private layerWindDirs: [number, number][] = [];

  // Pre-allocated typed arrays to eliminate GC pressure during rendering
  private layerColorsBuf = new Float32Array(MAX_FOG_LAYERS * 3);
  private layerHighlightsBuf = new Float32Array(MAX_FOG_LAYERS * 3);
  private layerParamsABuf = new Float32Array(MAX_FOG_LAYERS * 3);
  private layerParamsBBuf = new Float32Array(MAX_FOG_LAYERS * 4);
  private layerYBandBuf = new Float32Array(MAX_FOG_LAYERS * 3);
  private layerMotionBuf = new Float32Array(MAX_FOG_LAYERS * 3);
  private starDriftBuf = new Float32Array(6);

  private backlightActive = false;
  private starsActive = false;
  private starDensityScaleSqrt = 1;

  private wakeStaticDirty = true;
  private fogStaticDirty = true;

  private interaction: InteractionManager;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private mediaQuery: MediaQueryList | null = null;

  private rafId: number | null = null;
  private pausedByUser = false;
  private pausedByVisibility = false;
  private pausedByIntersection = false;
  private prefersReducedMotion = false;
  private isSleepingOnDemand = false;
  private isDestroyed = false;
  private isContextLost = false;

  private isWakeClean = true;
  private wakeDecayTimer = 0;
  private pendingWakeClear = false;
  private didMutateContainerPosition = false;
  private prevContainerInlinePosition = '';
  private readonly contextPowerPreference: WebGLPowerPreference;
  private readonly contextOpaqueCanvas: boolean;

  private lastFrameTime = 0;
  private simTime = 0;
  private billowTime = 0;

  constructor(
    target: HTMLCanvasElement | HTMLElement,
    options: SefirahFogOptions = {}
  ) {
    this.config = resolveConfig(options);
    this.contextPowerPreference = this.config.powerPreference;
    this.contextOpaqueCanvas = this.config.opaqueCanvas;

    if (target instanceof HTMLCanvasElement) {
      this.canvas = target;
      this.container = target.parentElement ?? target;
      this.ownsCanvas = false;
    } else {
      this.container = target;
      this.canvas = document.createElement('canvas');
      this.ownsCanvas = true;
      this.styleInjectedCanvas();
      this.container.prepend(this.canvas);
    }

    const contextAttributes: WebGLContextAttributes = {
      alpha: !this.config.opaqueCanvas,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: this.config.powerPreference,
    };

    const gl =
      (this.canvas.getContext('webgl2', contextAttributes) as WebGLRenderingContext | null) ??
      (this.canvas.getContext('webgl', contextAttributes) as WebGLRenderingContext | null) ??
      (this.canvas.getContext('experimental-webgl', contextAttributes) as WebGLRenderingContext | null);

    if (!gl) {
      this.cleanupInjectedCanvas();
      const err = new Error(
        '[sefirah-fog] WebGL is not supported in this browser or environment.'
      );
      this.reportInitError(err);
      throw err;
    }

    this.gl = gl;
    try {
      this.syncDerivedConfig();
      this.initGLResources();
    } catch (cause) {
      this.disposeGLResources();
      this.cleanupInjectedCanvas();
      const err = cause instanceof Error ? cause : new Error(String(cause));
      this.reportInitError(err);
      throw err;
    }

    this.interaction = new InteractionManager(
      this.canvas,
      this.config.interaction,
      this.handleInteractionActivity,
      this.ownsCanvas ? this.container : this.canvas
    );

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.setupReducedMotionListener();
    this.resize();
    this.setupResizeObserver();
    this.setupIntersectionObserver();

    this.lastFrameTime = performance.now();
    this.syncLoopState();
  }

  /**
   * Returns a shallow-cloned snapshot of the active configuration.
   */
  public getConfig(): SefirahFogConfig {
    return {
      ...this.config,
      layers: this.config.layers.map((l) => ({ ...l })),
      animation: { ...this.config.animation },
      interaction: { ...this.config.interaction },
      backlight: {
        ...this.config.backlight,
        position: { ...this.config.backlight.position },
      },
      stars: { ...this.config.stars },
    };
  }

  /**
   * Live-updates any subset of options (colors, layers, speed, direction, spread, disappearance, etc.)
   * without restarting the WebGL context.
   */
  public updateConfig(partial: SefirahFogOptions): void {
    if (this.isDestroyed) return;

    const prevWakeRes = this.config.wakeResolution;
    const prevMaxDpr = this.config.maxDpr;
    const prevResScale = this.config.resolutionScale;
    const prevPauseOffscreen = this.config.pauseWhenOffscreen;

    const isPresetSwitch =
      partial.preset !== undefined && partial.preset !== this.config.preset;
    if (isPresetSwitch) {
      this.config = resolveConfig(partial);
    } else {
      const mergedTop = mergeDefined(this.config, partial);
      this.config = {
        ...mergedTop,
        layers:
          partial.layers !== undefined
            ? partial.layers.map((l) => ({ ...l }))
            : this.config.layers,
        animation: mergeDefined(this.config.animation, partial.animation),
        interaction: mergeDefined(this.config.interaction, partial.interaction),
        backlight: {
          ...mergeDefined(this.config.backlight, partial.backlight),
          position: mergeDefined(
            this.config.backlight.position,
            partial.backlight?.position
          ),
        },
        stars: mergeDefined(this.config.stars, partial.stars),
      };
    }

    this.lockContextAttributes(partial);
    this.applyRuntimeConfigChanges(
      prevWakeRes,
      prevMaxDpr,
      prevResScale,
      prevPauseOffscreen,
      isPresetSwitch
    );
  }

  /**
   * Switches immediately to a built-in preset, with optional custom overrides.
   */
  public setPreset(preset: FogPresetName, overrides: SefirahFogOptions = {}): void {
    if (this.isDestroyed) return;

    const prevWakeRes = this.config.wakeResolution;
    const prevMaxDpr = this.config.maxDpr;
    const prevResScale = this.config.resolutionScale;
    const prevPauseOffscreen = this.config.pauseWhenOffscreen;

    this.config = resolveConfig({ ...overrides, preset });
    this.lockContextAttributes(overrides);
    this.applyRuntimeConfigChanges(
      prevWakeRes,
      prevMaxDpr,
      prevResScale,
      prevPauseOffscreen,
      true
    );
  }

  private applyRuntimeConfigChanges(
    prevWakeRes: number,
    prevMaxDpr: number,
    prevResScale: number,
    prevPauseOffscreen: boolean,
    clearWakeOnSameRes: boolean
  ): void {
    this.syncDerivedConfig();
    this.interaction.updateConfig(this.config.interaction);

    if (this.config.wakeResolution !== prevWakeRes) {
      this.rebuildWakeFBO();
    } else if (clearWakeOnSameRes) {
      this.clearWake();
    }
    if (
      this.config.maxDpr !== prevMaxDpr ||
      this.config.resolutionScale !== prevResScale
    ) {
      this.resize();
    }
    if (this.config.pauseWhenOffscreen !== prevPauseOffscreen) {
      this.teardownIntersectionObserver();
      if (this.config.pauseWhenOffscreen) {
        this.setupIntersectionObserver();
      } else {
        this.pausedByIntersection = false;
      }
    }

    this.wakeFromSleep();
  }

  /** Replaces all fog color layers (up to 6). */
  public setLayers(layers: FogLayerConfig[]): void {
    this.updateConfig({ layers });
  }

  /** Appends a new fog layer (ignored if already at max 6 layers). */
  public addLayer(layer: FogLayerConfig): void {
    if (this.config.layers.length >= MAX_FOG_LAYERS) return;
    this.updateConfig({ layers: [...this.config.layers, layer] });
  }

  /** Removes a fog layer by index. */
  public removeLayer(index: number): void {
    if (index < 0 || index >= this.config.layers.length) return;
    const next = this.config.layers.filter((_, i) => i !== index);
    this.updateConfig({ layers: next });
  }

  /** Toggles wind drift & billowing animation on/off. */
  public setAnimationEnabled(enabled: boolean): void {
    this.updateConfig({ animation: { enabled } });
  }

  /** Toggles mouse/touch wake interactivity on/off. */
  public setInteractionEnabled(enabled: boolean): void {
    this.updateConfig({ interaction: { enabled } });
  }

  /** Immediately clears any active mouse wake trails. */
  public clearWake(): void {
    this.pendingWakeClear = true;
    this.wakeFromSleep();
  }

  /**
   * Programmatically creates a parting/swirling ripple in the fog at normalized coordinates.
   * @param x Horizontal position (0 = left, 1 = right)
   * @param y Vertical position (0 = bottom, 1 = top)
   */
  public triggerPulse(
    x: number,
    y: number,
    options?: { velX?: number; velY?: number; duration?: number }
  ): void {
    this.interaction.triggerPulse(x, y, options);
  }

  /** Pauses the requestAnimationFrame render loop. */
  public pause(): void {
    this.pausedByUser = true;
    this.stopRaf();
  }

  /** Resumes the requestAnimationFrame render loop. */
  public resume(): void {
    if (this.isDestroyed || !this.pausedByUser) return;
    this.pausedByUser = false;
    this.isSleepingOnDemand = false;
    this.syncLoopState();
  }

  /** Recomputes canvas backing resolution from its layout box. */
  public resize(optCssWidth?: number, optCssHeight?: number): void {
    if (this.isDestroyed || this.isContextLost) return;

    let cssWidth: number;
    let cssHeight: number;
    if (
      optCssWidth !== undefined &&
      optCssHeight !== undefined &&
      optCssWidth > 0 &&
      optCssHeight > 0
    ) {
      cssWidth = optCssWidth;
      cssHeight = optCssHeight;
    } else {
      const targetEl = this.ownsCanvas ? this.container : this.canvas;
      const rect = targetEl.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width || window.innerWidth);
      cssHeight = Math.max(1, rect.height || window.innerHeight);
    }

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      clamp(finiteOr(this.config.maxDpr, 1), 0.5, 4)
    );
    const scale = clamp(finiteOr(this.config.resolutionScale, 1), 0.25, 1.0);
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr * scale));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr * scale));

    this.interaction?.invalidateRect();

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.wakeStaticDirty = true;
      this.fogStaticDirty = true;
      this.wakeFromSleep();
    }
  }

  /** Renders a single frame manually (useful when paused or exporting frames). */
  public renderFrame(dtSeconds = 1 / 60): void {
    if (this.isDestroyed || this.isContextLost) return;

    const dt = clamp(finiteOr(dtSeconds, 1 / 60), 0.001, 0.05);

    if (this.isAnimationActive()) {
      this.simTime += dt;
      this.billowTime += dt * this.config.animation.billowSpeed;
    }

    const wakeFBO = this.wakeFBO;
    if (!wakeFBO) return;

    const pointer = this.interaction.step(dt);
    const interactionEnabled =
      this.config.interaction.enabled && this.config.interaction.strength > 0;

    if (this.pendingWakeClear) {
      clearPingPongFBO(this.gl, wakeFBO);
      this.pendingWakeClear = false;
      this.isWakeClean = true;
      this.wakeDecayTimer = 0;
    } else if (!interactionEnabled) {
      if (!this.isWakeClean) {
        clearPingPongFBO(this.gl, wakeFBO);
        this.isWakeClean = true;
        this.wakeDecayTimer = 0;
      }
    } else if (pointer.active) {
      this.isWakeClean = false;
      const decayBase = this.getWakeDecayBase();
      this.wakeDecayTimer = Math.max(0.25, 6.8 / decayBase);
    } else if (!this.isWakeClean) {
      this.wakeDecayTimer -= dt;
      if (this.wakeDecayTimer <= 0) {
        clearPingPongFBO(this.gl, wakeFBO);
        this.isWakeClean = true;
        this.wakeDecayTimer = 0;
      }
    }

    if (!this.isWakeClean) {
      this.runWakePass(dt, pointer);
    }
    this.runFogPass();
  }

  /** Releases all WebGL resources, listeners, and removes injected canvas if owned. */
  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.stopRaf();
    this.interaction.dispose();

    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.teardownReducedMotionListener();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.teardownIntersectionObserver();
    window.removeEventListener('resize', this.handleWindowResize);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener(
      'webglcontextrestored',
      this.handleContextRestored
    );

    if (!this.isContextLost) {
      this.disposeGLResources();
    } else {
      this.clearGLResourceRefs();
    }

    this.cleanupInjectedCanvas();
  }

  private lockContextAttributes(patch?: SefirahFogOptions): void {
    if (
      patch?.powerPreference !== undefined &&
      patch.powerPreference !== this.contextPowerPreference
    ) {
      console.warn(
        '[sefirah-fog] "powerPreference" is fixed when the WebGL context is created and cannot be changed live.'
      );
    }
    if (
      patch?.opaqueCanvas !== undefined &&
      patch.opaqueCanvas !== this.contextOpaqueCanvas
    ) {
      console.warn(
        '[sefirah-fog] "opaqueCanvas" is fixed when the WebGL context is created and cannot be changed live.'
      );
    }
    this.config.powerPreference = this.contextPowerPreference;
    this.config.opaqueCanvas = this.contextOpaqueCanvas;
  }

  private reportInitError(error: Error): void {
    this.config.onError?.(error);
    if (this.config.alertOnError && typeof window !== 'undefined') {
      window.alert(error.message);
    }
  }

  private cleanupInjectedCanvas(): void {
    if (this.ownsCanvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    if (this.didMutateContainerPosition) {
      this.container.style.position = this.prevContainerInlinePosition;
      this.didMutateContainerPosition = false;
    }
  }

  private isAnimationActive(): boolean {
    return (
      this.config.animation.enabled &&
      !(this.config.respectReducedMotion && this.prefersReducedMotion)
    );
  }

  private getWakeDecayBase(): number {
    const d = clamp(this.config.interaction.disappearance, 0.005, 1);
    return 0.28 + (6.2 - 0.28) * Math.pow(d, 1.35);
  }

  private shouldRunLoop(): boolean {
    return (
      !this.isDestroyed &&
      !this.isContextLost &&
      !this.pausedByUser &&
      !this.pausedByVisibility &&
      !this.pausedByIntersection
    );
  }

  private wakeFromSleep = (): void => {
    this.isSleepingOnDemand = false;
    this.syncLoopState();
  };

  private handleInteractionActivity = (): void => {
    if (this.isSleepingOnDemand) {
      this.wakeFromSleep();
    }
  };

  private handleVisibilityChange = (): void => {
    this.pausedByVisibility = document.hidden;
    this.syncLoopState();
  };

  private handleReducedMotionChange = (e: MediaQueryListEvent): void => {
    this.prefersReducedMotion = e.matches;
    this.wakeStaticDirty = true;
    this.wakeFromSleep();
  };

  private setupReducedMotionListener(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.prefersReducedMotion = this.mediaQuery.matches;
    this.mediaQuery.addEventListener?.('change', this.handleReducedMotionChange);
  }

  private teardownReducedMotionListener(): void {
    if (!this.mediaQuery) return;
    this.mediaQuery.removeEventListener?.(
      'change',
      this.handleReducedMotionChange
    );
    this.mediaQuery = null;
  }

  private setupIntersectionObserver(): void {
    if (
      !this.config.pauseWhenOffscreen ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        this.pausedByIntersection = !entry.isIntersecting;
        this.syncLoopState();
      },
      { threshold: 0 }
    );
    this.intersectionObserver.observe(this.ownsCanvas ? this.container : this.canvas);
  }

  private teardownIntersectionObserver(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
  }

  private styleInjectedCanvas(): void {
    const computed = window.getComputedStyle(this.container);
    if (computed.position === 'static' || !computed.position) {
      this.prevContainerInlinePosition = this.container.style.position;
      this.container.style.position = 'relative';
      this.didMutateContainerPosition = true;
    }
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '0',
      display: 'block',
      pointerEvents: 'none',
    });
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry?.contentRect) {
          this.resize(entry.contentRect.width, entry.contentRect.height);
        } else {
          this.resize();
        }
      });
      this.resizeObserver.observe(this.ownsCanvas ? this.container : this.canvas);
    } else {
      window.addEventListener('resize', this.handleWindowResize, { passive: true });
    }
  }

  private handleWindowResize = (): void => {
    this.resize();
  };

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.isContextLost = true;
    this.stopRaf();
  };

  private handleContextRestored = (): void => {
    this.isContextLost = false;
    try {
      this.initGLResources();
      this.resize();
      this.wakeFromSleep();
    } catch (cause) {
      this.isContextLost = true;
      const err = cause instanceof Error ? cause : new Error(String(cause));
      this.reportInitError(err);
    }
  };

  private initGLResources(): void {
    const gl = this.gl;
    this.disposeGLResources();

    try {
      const quadBuffer = createFullscreenQuad(gl);
      this.quadBuffer = quadBuffer;

      const noiseTex = bakeCloudNoiseTexture(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        NOISE_BAKE_FRAGMENT_SHADER,
        quadBuffer,
        256
      );
      this.noiseTex = noiseTex;

      const wakeProgram = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        WAKE_FRAGMENT_SHADER,
        'a_position'
      );
      this.wakeProgram = wakeProgram;

      const fogProgram = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        FOG_FRAGMENT_SHADER,
        'a_position'
      );
      this.fogProgram = fogProgram;

      // Bind fullscreen quad to attribute 0 and keep noise texture bound on TEXTURE1 permanently
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, noiseTex);
      gl.activeTexture(gl.TEXTURE0);

      this.wakeUniforms = {
        u_prevWake: gl.getUniformLocation(wakeProgram, 'u_prevWake'),
        u_texel: gl.getUniformLocation(wakeProgram, 'u_texel'),
        u_aspect: gl.getUniformLocation(wakeProgram, 'u_aspect'),
        u_dt: gl.getUniformLocation(wakeProgram, 'u_dt'),
        u_mouse: gl.getUniformLocation(wakeProgram, 'u_mouse'),
        u_prevMouse: gl.getUniformLocation(wakeProgram, 'u_prevMouse'),
        u_mouseActive: gl.getUniformLocation(wakeProgram, 'u_mouseActive'),
        u_mode: gl.getUniformLocation(wakeProgram, 'u_mode'),
        u_radius: gl.getUniformLocation(wakeProgram, 'u_radius'),
        u_spread: gl.getUniformLocation(wakeProgram, 'u_spread'),
        u_decayBase: gl.getUniformLocation(wakeProgram, 'u_decayBase'),
        u_windVel: gl.getUniformLocation(wakeProgram, 'u_windVel'),
        u_moveDir: gl.getUniformLocation(wakeProgram, 'u_moveDir'),
        u_moveSpeed: gl.getUniformLocation(wakeProgram, 'u_moveSpeed'),
        u_wakePower: gl.getUniformLocation(wakeProgram, 'u_wakePower'),
      };

      this.fogUniforms = {
        u_wakeTex: gl.getUniformLocation(fogProgram, 'u_wakeTex'),
        u_noiseTex: gl.getUniformLocation(fogProgram, 'u_noiseTex'),
        u_resolution: gl.getUniformLocation(fogProgram, 'u_resolution'),
        u_nebulaOffset: gl.getUniformLocation(fogProgram, 'u_nebulaOffset'),
        u_opacity: gl.getUniformLocation(fogProgram, 'u_opacity'),
        u_detail: gl.getUniformLocation(fogProgram, 'u_detail'),
        u_detailWeight: gl.getUniformLocation(fogProgram, 'u_detailWeight'),
        u_bgColor: gl.getUniformLocation(fogProgram, 'u_bgColor'),
        u_transparentBg: gl.getUniformLocation(fogProgram, 'u_transparentBg'),
        u_turbulence: gl.getUniformLocation(fogProgram, 'u_turbulence'),
        u_wakeActive: gl.getUniformLocation(fogProgram, 'u_wakeActive'),
        u_interactionStrength: gl.getUniformLocation(
          fogProgram,
          'u_interactionStrength'
        ),
        u_clearAmount: gl.getUniformLocation(fogProgram, 'u_clearAmount'),
        u_backlightEnabled: gl.getUniformLocation(
          fogProgram,
          'u_backlightEnabled'
        ),
        u_backlightPrimary: gl.getUniformLocation(
          fogProgram,
          'u_backlightPrimary'
        ),
        u_backlightSecondary: gl.getUniformLocation(
          fogProgram,
          'u_backlightSecondary'
        ),
        u_backlightIntensity: gl.getUniformLocation(
          fogProgram,
          'u_backlightIntensity'
        ),
        u_backlightPos: gl.getUniformLocation(fogProgram, 'u_backlightPos'),
        u_backlightRadius: gl.getUniformLocation(
          fogProgram,
          'u_backlightRadius'
        ),
        u_starsEnabled: gl.getUniformLocation(fogProgram, 'u_starsEnabled'),
        u_starPrimary: gl.getUniformLocation(fogProgram, 'u_starPrimary'),
        u_starSecondary: gl.getUniformLocation(fogProgram, 'u_starSecondary'),
        u_starSize: gl.getUniformLocation(fogProgram, 'u_starSize'),
        u_starTwinklePhase: gl.getUniformLocation(
          fogProgram,
          'u_starTwinklePhase'
        ),
        u_starDrift: gl.getUniformLocation(fogProgram, 'u_starDrift[0]'),
        u_starParams: gl.getUniformLocation(fogProgram, 'u_starParams'),
        u_layerCount: gl.getUniformLocation(fogProgram, 'u_layerCount'),
        u_layerColor: gl.getUniformLocation(fogProgram, 'u_layerColor[0]'),
        u_layerHighlight: gl.getUniformLocation(
          fogProgram,
          'u_layerHighlight[0]'
        ),
        u_layerParamsA: gl.getUniformLocation(
          fogProgram,
          'u_layerParamsA[0]'
        ),
        u_layerParamsB: gl.getUniformLocation(
          fogProgram,
          'u_layerParamsB[0]'
        ),
        u_layerYBand: gl.getUniformLocation(fogProgram, 'u_layerYBand[0]'),
        u_layerMotion: gl.getUniformLocation(fogProgram, 'u_layerMotion[0]'),
      };

      const res = clamp(Math.round(this.config.wakeResolution), 64, 512);
      const wakeFBO = createPingPongFBO(gl, res, res);
      this.wakeFBO = wakeFBO;
      gl.bindTexture(gl.TEXTURE_2D, wakeFBO.read.texture);
      this.isWakeClean = true;
      this.wakeDecayTimer = 0;
      this.wakeStaticDirty = true;
      this.fogStaticDirty = true;
    } catch (err) {
      this.disposeGLResources();
      throw err;
    }
  }

  private rebuildWakeFBO(): void {
    if (this.isContextLost) return;
    this.wakeFBO?.dispose();
    this.wakeFBO = null;
    const res = clamp(Math.round(this.config.wakeResolution), 64, 512);
    const wakeFBO = createPingPongFBO(this.gl, res, res);
    this.wakeFBO = wakeFBO;
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, wakeFBO.read.texture);
    this.isWakeClean = true;
    this.wakeDecayTimer = 0;
    this.wakeStaticDirty = true;
    this.fogStaticDirty = true;
  }

  private clearGLResourceRefs(): void {
    this.wakeFBO = null;
    this.quadBuffer = null;
    this.wakeProgram = null;
    this.fogProgram = null;
    this.noiseTex = null;
    this.wakeUniforms = null;
    this.fogUniforms = null;
  }

  private disposeGLResources(): void {
    const gl = this.gl;
    if (this.wakeFBO) {
      this.wakeFBO.dispose();
    }
    if (this.quadBuffer) {
      gl.deleteBuffer(this.quadBuffer);
    }
    if (this.wakeProgram) {
      gl.deleteProgram(this.wakeProgram);
    }
    if (this.fogProgram) {
      gl.deleteProgram(this.fogProgram);
    }
    if (this.noiseTex) {
      gl.deleteTexture(this.noiseTex);
    }
    this.clearGLResourceRefs();
  }

  private syncDerivedConfig(): void {
    this.bgColorRGB = parseColor(this.config.backgroundColor, [0.02, 0.05, 0.06]);
    this.backlightPrimaryRGB = parseColor(
      this.config.backlight.primaryColor,
      [0.18, 0.95, 0.89]
    );
    this.backlightSecondaryRGB = parseColor(
      this.config.backlight.secondaryColor,
      [0.1, 0.83, 0.53]
    );
    this.starPrimaryRGB = parseColor(
      this.config.stars.primaryColor,
      [1.0, 0.12, 0.2]
    );
    this.starSecondaryRGB = parseColor(
      this.config.stars.secondaryColor,
      [1.0, 0.67, 0.33]
    );
    this.windDir = normalizeDirection(this.config.animation.direction);
    this.resolvedLayers = resolveLayers(this.config.layers);

    const globalOpacity = clamp(finiteOr(this.config.opacity, 0.9), 0, 1);
    const globalScale = Math.max(0.1, finiteOr(this.config.scale, 2.0));
    const globalThickness = clamp(finiteOr(this.config.thickness, 1.0), 0.1, 3.0);

    // Pack static layer buffers & precompute wind vectors for fast uniform upload
    this.layerColorsBuf.fill(0);
    this.layerHighlightsBuf.fill(0);
    this.layerParamsABuf.fill(0);
    this.layerParamsBBuf.fill(0);
    this.layerYBandBuf.fill(0);
    this.layerWindDirs = [];

    for (let i = 0; i < this.resolvedLayers.length; i++) {
      const l = this.resolvedLayers[i];
      const i3 = i * 3;
      const i4 = i * 4;

      const cosDir = Math.cos(l.directionOffsetRad);
      const sinDir = Math.sin(l.directionOffsetRad);
      this.layerWindDirs.push([
        this.windDir[0] * cosDir - this.windDir[1] * sinDir,
        this.windDir[0] * sinDir + this.windDir[1] * cosDir,
      ]);

      const effectiveOpacity = l.opacity * globalOpacity;
      const effectiveScale = l.scale * globalScale;
      const effectiveThickness = l.thickness * globalThickness;
      const softness = clamp(l.softness, 0.1, 1.0);

      this.layerColorsBuf[i3] = l.color[0];
      this.layerColorsBuf[i3 + 1] = l.color[1];
      this.layerColorsBuf[i3 + 2] = l.color[2];

      this.layerHighlightsBuf[i3] = l.highlightColor[0];
      this.layerHighlightsBuf[i3 + 1] = l.highlightColor[1];
      this.layerHighlightsBuf[i3 + 2] = l.highlightColor[2];

      this.layerParamsABuf[i3] = effectiveOpacity;
      this.layerParamsABuf[i3 + 1] = effectiveScale;
      this.layerParamsABuf[i3 + 2] = effectiveThickness;

      this.layerParamsBBuf[i4] = l.interactionSensitivity;
      this.layerParamsBBuf[i4 + 1] = clamp(0.62 - effectiveThickness * 0.21, 0.12, 0.76);
      this.layerParamsBBuf[i4 + 2] = 0.11 + (0.3 - 0.11) * softness;
      this.layerParamsBBuf[i4 + 3] = 0.24 / Math.max(effectiveScale * 0.55, 0.35);

      this.layerYBandBuf[i3] = l.yMin;
      this.layerYBandBuf[i3 + 1] = l.yMax;
      this.layerYBandBuf[i3 + 2] = l.yFeather;
    }

    this.wakeStaticDirty = true;
    this.fogStaticDirty = true;
  }

  private stopRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private syncLoopState(): void {
    if (!this.shouldRunLoop()) {
      this.stopRaf();
      return;
    }
    if (this.isSleepingOnDemand) {
      return;
    }
    if (this.rafId === null) {
      this.lastFrameTime = performance.now();
      this.startLoop();
    }
  }

  private startLoop(): void {
    const tick = (now: number) => {
      this.rafId = null;
      if (!this.shouldRunLoop() || this.isSleepingOnDemand) return;

      const elapsedMs = now - this.lastFrameTime;
      const targetFps = Math.max(0, finiteOr(this.config.targetFps, 0));
      if (targetFps > 0) {
        const minFrameMs = 1000 / targetFps;
        if (elapsedMs < minFrameMs * 0.92) {
          this.rafId = requestAnimationFrame(tick);
          return;
        }
      }

      const dt = elapsedMs * 0.001;
      this.lastFrameTime = now;

      this.renderFrame(dt);

      // Put loop to sleep when drift animation is disabled/reduced and wake has settled
      if (
        !this.isAnimationActive() &&
        this.isWakeClean &&
        !this.pendingWakeClear
      ) {
        this.isSleepingOnDemand = true;
        return;
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private runWakePass(
    dt: number,
    pointer: ReturnType<InteractionManager['step']>
  ): void {
    const gl = this.gl;
    const wakeFBO = this.wakeFBO;
    const wakeProgram = this.wakeProgram;
    const u = this.wakeUniforms;
    if (!wakeFBO || !wakeProgram || !u) return;

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, wakeFBO.write.fbo);
    gl.viewport(0, 0, wakeFBO.width, wakeFBO.height);
    gl.useProgram(wakeProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, wakeFBO.read.texture);

    if (this.wakeStaticDirty) {
      gl.uniform1i(u.u_prevWake, 0);
      gl.uniform2f(u.u_texel, 1 / wakeFBO.width, 1 / wakeFBO.height);
      gl.uniform1f(u.u_aspect, aspect);
      gl.uniform1i(u.u_mode, interactionModeToInt(this.config.interaction.mode));
      gl.uniform1f(
        u.u_radius,
        clamp(finiteOr(this.config.interaction.radius, 0.15), 0.015, 1.0)
      );
      gl.uniform1f(
        u.u_spread,
        clamp(finiteOr(this.config.interaction.spread, 0.6), 0, 1)
      );
      gl.uniform1f(u.u_decayBase, this.getWakeDecayBase());

      const activeWindSpeed = this.isAnimationActive()
        ? Math.max(0, finiteOr(this.config.animation.speed, 0.3))
        : 0;
      gl.uniform2f(
        u.u_windVel,
        this.windDir[0] * activeWindSpeed * 0.055,
        this.windDir[1] * activeWindSpeed * 0.055
      );
      this.wakeStaticDirty = false;
    }

    gl.uniform1f(u.u_dt, dt);
    gl.uniform2f(u.u_mouse, pointer.x, pointer.y);
    gl.uniform2f(u.u_prevMouse, pointer.prevX, pointer.prevY);

    const active =
      this.config.interaction.enabled && pointer.active ? 1.0 : 0.0;
    gl.uniform1f(u.u_mouseActive, active);

    if (active > 0.5) {
      const velScaledX = pointer.velX * aspect;
      const velScaledY = pointer.velY;
      const speed = Math.hypot(velScaledX, velScaledY);
      const moveDirX = speed > 1e-5 ? velScaledX / speed : 0;
      const moveDirY = speed > 1e-5 ? velScaledY / speed : 0;
      const velInf = clamp(this.config.interaction.velocityInfluence, 0, 1);
      const motionFactor = 1 + (clamp(speed * 1.35, 0, 2.2) - 1) * velInf;
      const wakePower = this.config.interaction.strength * motionFactor;

      gl.uniform2f(u.u_moveDir, moveDirX, moveDirY);
      gl.uniform1f(u.u_moveSpeed, speed);
      gl.uniform1f(u.u_wakePower, wakePower);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    wakeFBO.swap();
  }

  private runFogPass(): void {
    const gl = this.gl;
    const fogProgram = this.fogProgram;
    const wakeFBO = this.wakeFBO;
    const u = this.fogUniforms;
    if (!fogProgram || !wakeFBO || !u) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(fogProgram);

    const wakeActive = !this.isWakeClean;
    if (wakeActive || this.fogStaticDirty) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, wakeFBO.read.texture);
    }

    if (this.fogStaticDirty) {
      gl.uniform1i(u.u_wakeTex, 0);
      gl.uniform1i(u.u_noiseTex, 1);
      gl.uniform2f(u.u_resolution, this.canvas.width, this.canvas.height);

      const detail = clamp(Math.round(finiteOr(this.config.detail, 5)), 2, 6);
      gl.uniform1f(u.u_opacity, clamp(finiteOr(this.config.opacity, 0.9), 0, 1));
      gl.uniform1i(u.u_detail, detail);
      gl.uniform1f(u.u_detailWeight, clamp((detail - 2) / 4, 0.25, 1));
      gl.uniform3f(
        u.u_bgColor,
        this.bgColorRGB[0],
        this.bgColorRGB[1],
        this.bgColorRGB[2]
      );
      gl.uniform1f(
        u.u_transparentBg,
        this.config.transparentBackground ? 1.0 : 0.0
      );
      gl.uniform1f(
        u.u_turbulence,
        clamp(finiteOr(this.config.animation.turbulence, 0.88), 0, 2.5)
      );

      gl.uniform1f(
        u.u_interactionStrength,
        clamp(finiteOr(this.config.interaction.strength, 1), 0, 5)
      );
      gl.uniform1f(
        u.u_clearAmount,
        clamp(finiteOr(this.config.interaction.clearAmount, 0.6), 0, 1)
      );

      const backlightIntensity = clamp(
        finiteOr(this.config.backlight.intensity, 0.8),
        0,
        5
      );
      this.backlightActive =
        this.config.backlight.enabled && backlightIntensity > 0.001;
      gl.uniform1f(u.u_backlightEnabled, this.backlightActive ? 1.0 : 0.0);
      gl.uniform3f(
        u.u_backlightPrimary,
        this.backlightPrimaryRGB[0],
        this.backlightPrimaryRGB[1],
        this.backlightPrimaryRGB[2]
      );
      gl.uniform3f(
        u.u_backlightSecondary,
        this.backlightSecondaryRGB[0],
        this.backlightSecondaryRGB[1],
        this.backlightSecondaryRGB[2]
      );
      gl.uniform1f(u.u_backlightIntensity, backlightIntensity);
      gl.uniform2f(
        u.u_backlightPos,
        finiteOr(this.config.backlight.position.x, 0.5),
        finiteOr(this.config.backlight.position.y, 0.9)
      );
      gl.uniform1f(
        u.u_backlightRadius,
        clamp(finiteOr(this.config.backlight.radius, 0.6), 0.05, 5)
      );

      const starCount = clamp(finiteOr(this.config.stars.count, 60), 0, 200);
      this.starsActive = this.config.stars.enabled && starCount >= 1;
      this.starDensityScaleSqrt = Math.sqrt(clamp(starCount / 80, 0.25, 2.2));
      gl.uniform1f(u.u_starsEnabled, this.starsActive ? 1.0 : 0.0);
      gl.uniform3f(
        u.u_starPrimary,
        this.starPrimaryRGB[0],
        this.starPrimaryRGB[1],
        this.starPrimaryRGB[2]
      );
      gl.uniform3f(
        u.u_starSecondary,
        this.starSecondaryRGB[0],
        this.starSecondaryRGB[1],
        this.starSecondaryRGB[2]
      );
      gl.uniform1f(
        u.u_starSize,
        clamp(finiteOr(this.config.stars.size, 1), 0.1, 5)
      );
      gl.uniform4f(
        u.u_starParams,
        this.starDensityScaleSqrt,
        clamp(finiteOr(this.config.stars.radius, 2.3), 0.5, 4.5),
        clamp(finiteOr(this.config.stars.radiusChance, 0.26), 0, 1),
        clamp(finiteOr(this.config.stars.fogOcclusion, 0.72), 0, 1)
      );

      gl.uniform1i(u.u_layerCount, this.resolvedLayers.length);
      gl.uniform3fv(u.u_layerColor, this.layerColorsBuf);
      gl.uniform3fv(u.u_layerHighlight, this.layerHighlightsBuf);
      gl.uniform3fv(u.u_layerParamsA, this.layerParamsABuf);
      gl.uniform4fv(u.u_layerParamsB, this.layerParamsBBuf);
      gl.uniform3fv(u.u_layerYBand, this.layerYBandBuf);

      this.fogStaticDirty = false;
    }

    // Update only per-frame dynamic uniforms (all phase/drift values bounded for multi-day precision)
    const windSpeed = Math.max(0, finiteOr(this.config.animation.speed, 0.3));
    gl.uniform1f(u.u_wakeActive, wakeActive ? 1.0 : 0.0);

    if (this.backlightActive) {
      gl.uniform2f(
        u.u_nebulaOffset,
        wrapPositive(-this.windDir[0] * this.simTime * 0.006, 1),
        wrapPositive(
          -this.windDir[1] * this.simTime * 0.006 + this.billowTime * 0.01,
          1
        )
      );
    }

    if (this.starsActive) {
      const twinkleSpeed = clamp(
        finiteOr(this.config.stars.twinkleSpeed, 1),
        0,
        10
      );
      gl.uniform2f(
        u.u_starTwinklePhase,
        wrapPositive(this.simTime * twinkleSpeed * 1.2, TWO_PI),
        wrapPositive(this.simTime * twinkleSpeed * 0.85, TWO_PI)
      );

      const scale1 = 22.0 * this.starDensityScaleSqrt;
      const scale2 = 7.5 * this.starDensityScaleSqrt;
      const scale3 = 2.6;
      const baseDrift = this.simTime * windSpeed;
      const wx = -this.windDir[0] * baseDrift;
      const wy = -this.windDir[1] * baseDrift;

      this.starDriftBuf[0] = wrapPositive(wx * 0.006 * scale1, STAR_CELL_PERIOD);
      this.starDriftBuf[1] = wrapPositive(wy * 0.006 * scale1, STAR_CELL_PERIOD);
      this.starDriftBuf[2] = wrapPositive(
        41.2 + wx * 0.018 * scale2,
        STAR_CELL_PERIOD
      );
      this.starDriftBuf[3] = wrapPositive(
        19.8 + wy * 0.018 * scale2,
        STAR_CELL_PERIOD
      );
      this.starDriftBuf[4] = wrapPositive(
        7.4 + wx * 0.035 * scale3,
        STAR_CELL_PERIOD
      );
      this.starDriftBuf[5] = wrapPositive(
        3.1 + wy * 0.035 * scale3,
        STAR_CELL_PERIOD
      );
      gl.uniform2fv(u.u_starDrift, this.starDriftBuf);
    }

    for (let i = 0; i < this.resolvedLayers.length; i++) {
      const l = this.resolvedLayers[i];
      const wind = this.layerWindDirs[i];
      const driftDist = this.simTime * windSpeed * l.speedMultiplier * 0.26;
      const i3 = i * 3;
      const offsetX = l.seed * 7.31 - wind[0] * driftDist;
      const offsetY = l.seed * 3.17 - wind[1] * driftDist;
      const localBillow =
        this.billowTime * (0.65 + l.speedMultiplier * 0.3) + l.seed * 3.7;
      // Wrap at exact integer UV periods of sampleCloudDensity to avoid float drift over long sessions
      this.layerMotionBuf[i3] = wrapPositive(offsetX, 2000);
      this.layerMotionBuf[i3 + 1] = wrapPositive(offsetY, 2000);
      this.layerMotionBuf[i3 + 2] = wrapPositive(localBillow, 500);
    }
    gl.uniform3fv(u.u_layerMotion, this.layerMotionBuf);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
