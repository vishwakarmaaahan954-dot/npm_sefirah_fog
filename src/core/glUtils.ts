import type {
  ColorInput,
  DeepPartial,
  DirectionInput,
  FogLayerConfig,
  InteractionMode,
  ResolvedFogLayer,
  RGBTuple,
} from '../types';

export const MAX_FOG_LAYERS = 6;
const ZERO_BYTE = 128;

export interface PingPongFBO {
  width: number;
  height: number;
  read: FramebufferPair;
  write: FramebufferPair;
  swap: () => void;
  dispose: () => void;
}

export interface FramebufferPair {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
}

/**
 * Converts hex, rgb/rgba string, or numeric RGB tuple into a normalized [0..1] RGBTuple.
 */
export function parseColor(input: ColorInput, fallback: RGBTuple = [0.15, 0.25, 0.3]): RGBTuple {
  if (
    Array.isArray(input) &&
    input.length >= 3 &&
    Number.isFinite(input[0]) &&
    Number.isFinite(input[1]) &&
    Number.isFinite(input[2])
  ) {
    const is255 = input[0] > 1 || input[1] > 1 || input[2] > 1;
    const div = is255 ? 255 : 1;
    return [
      clamp01(input[0] / div),
      clamp01(input[1] / div),
      clamp01(input[2] / div),
    ];
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();

    if (trimmed.startsWith('#')) {
      const hex = trimmed.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16) / 255;
        const g = parseInt(hex[1] + hex[1], 16) / 255;
        const b = parseInt(hex[2] + hex[2], 16) / 255;
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          return [r, g, b];
        }
      } else if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          return [r, g, b];
        }
      }
    }

    const rgbMatch = trimmed.match(
      /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i
    );
    if (rgbMatch) {
      const r = parseFloat(rgbMatch[1]);
      const g = parseFloat(rgbMatch[2]);
      const b = parseFloat(rgbMatch[3]);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return [
          clamp01(r / 255),
          clamp01(g / 255),
          clamp01(b / 255),
        ];
      }
    }
  }

  return [...fallback] as RGBTuple;
}

/**
 * Auto-derives a luminous rim highlight color when a layer omits `highlightColor`.
 */
export function deriveHighlightColor(base: RGBTuple): RGBTuple {
  return [
    clamp01(base[0] * 1.65 + 0.14),
    clamp01(base[1] * 1.75 + 0.17),
    clamp01(base[2] * 1.8 + 0.19),
  ];
}

/**
 * Normalizes an angle in degrees (0 = right, 90 = up) or {x, y} vector into a unit [x, y] vector.
 */
export function normalizeDirection(dir: DirectionInput): [number, number] {
  if (typeof dir === 'number') {
    const rad = (dir * Math.PI) / 180;
    return [Math.cos(rad), Math.sin(rad)];
  }
  const len = Math.hypot(dir.x, dir.y);
  if (len < 1e-6) {
    return [1, 0];
  }
  return [dir.x / len, dir.y / len];
}

/**
 * Maps string InteractionMode to the shader's integer enum.
 */
export function interactionModeToInt(mode: InteractionMode): number {
  switch (mode) {
    case 'part':
      return 0;
    case 'swirl':
      return 1;
    case 'repel':
      return 2;
    case 'attract':
      return 3;
    default:
      return 1;
  }
}

/**
 * Converts user-provided FogLayerConfig array into GPU-ready normalized structures (max 6 layers).
 */
export function resolveLayers(layers: FogLayerConfig[]): ResolvedFogLayer[] {
  return layers.slice(0, MAX_FOG_LAYERS).map((layer, index) => {
    const color = parseColor(layer.color);
    const highlightColor = layer.highlightColor
      ? parseColor(layer.highlightColor)
      : deriveHighlightColor(color);
    const yRange = layer.yRange ?? [0, 1];

    return {
      color,
      highlightColor,
      opacity: clamp(finiteOr(layer.opacity, 0.75), 0, 1),
      scale: Math.max(0.05, finiteOr(layer.scale, 1.0)),
      thickness: clamp(finiteOr(layer.thickness, 1.0), 0.05, 3.0),
      softness: clamp(finiteOr(layer.softness, 0.5), 0.08, 1.0),
      speedMultiplier: finiteOr(layer.speedMultiplier, 1.0),
      directionOffsetRad: (finiteOr(layer.directionOffset, 0) * Math.PI) / 180,
      yMin: clamp(finiteOr(yRange[0], 0), -0.5, 1.5),
      yMax: clamp(finiteOr(yRange[1], 1), -0.5, 1.5),
      yFeather: clamp(finiteOr(layer.yFeather, 0.25), 0.01, 1.0),
      interactionSensitivity: clamp(
        finiteOr(layer.interactionSensitivity, 1.0),
        0,
        3.0
      ),
      seed: finiteOr(layer.seed, (index + 1) * 3.73),
    };
  });
}

export function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('[sefirah-fog] Failed to allocate WebGLShader.');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`[sefirah-fog] Shader compilation failed:\n${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGLRenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
  bindAttrib0: string | null = 'a_position'
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  let fs: WebGLShader;
  try {
    fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  } catch (err) {
    gl.deleteShader(vs);
    throw err;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error('[sefirah-fog] Failed to allocate WebGLProgram.');
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  if (bindAttrib0) {
    gl.bindAttribLocation(program, 0, bindAttrib0);
  }
  gl.linkProgram(program);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown link error';
    gl.deleteProgram(program);
    throw new Error(`[sefirah-fog] Program link failed:\n${log}`);
  }

  return program;
}

/**
 * Creates a neutral 8-bit ping-pong framebuffer pair initialized to (128, 128, 0, 0)
 * so initial wake velocity is exact zero with zero drift.
 */
export function createPingPongFBO(
  gl: WebGLRenderingContext,
  width: number,
  height: number
): PingPongFBO {
  const w = Math.max(32, Math.floor(width));
  const h = Math.max(32, Math.floor(height));

  const neutralPixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < neutralPixels.length; i += 4) {
    neutralPixels[i] = ZERO_BYTE;
    neutralPixels[i + 1] = ZERO_BYTE;
    neutralPixels[i + 2] = 0;
    neutralPixels[i + 3] = 0;
  }

  const makeTarget = (): FramebufferPair => {
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) {
      if (texture) gl.deleteTexture(texture);
      if (fbo) gl.deleteFramebuffer(fbo);
      throw new Error('[sefirah-fog] Failed to allocate wake FBO/texture.');
    }

    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        neutralPixels
      );

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
      );

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      return { fbo, texture };
    } catch (err) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);
      throw err;
    }
  };

  let read = makeTarget();
  let write: FramebufferPair;
  try {
    write = makeTarget();
  } catch (err) {
    gl.deleteFramebuffer(read.fbo);
    gl.deleteTexture(read.texture);
    throw err;
  }

  return {
    width: w,
    height: h,
    get read() {
      return read;
    },
    get write() {
      return write;
    },
    swap() {
      const tmp = read;
      read = write;
      write = tmp;
    },
    dispose() {
      gl.deleteFramebuffer(read.fbo);
      gl.deleteTexture(read.texture);
      gl.deleteFramebuffer(write.fbo);
      gl.deleteTexture(write.texture);
    },
  };
}

/**
 * Resets both buffers in a PingPongFBO to exact neutral velocity (128, 128, 0, 0) via hardware clear.
 */
export function clearPingPongFBO(
  gl: WebGLRenderingContext,
  fbo: PingPongFBO
): void {
  const neutral = ZERO_BYTE / 255;
  gl.clearColor(neutral, neutral, 0, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.read.fbo);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.write.fbo);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * Fullscreen clip-space quad (-1..1) drawn as a triangle strip.
 */
export function createFullscreenQuad(gl: WebGLRenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error('[sefirah-fog] Failed to create vertex buffer.');
  }
  const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return buffer;
}
/**
 * Renders a one-shot seamlessly tileable 256x256 Perlin-Worley RGBA noise texture
 * with mipmaps enabled so the fog shader runs with near-zero GPU overhead.
 */
export function bakeCloudNoiseTexture(
  gl: WebGLRenderingContext,
  vertexSrc: string,
  bakeFragSrc: string,
  quadBuffer: WebGLBuffer,
  size = 256
): WebGLTexture {
  const program = createProgram(gl, vertexSrc, bakeFragSrc);
  let texture: WebGLTexture | null = null;
  let fbo: WebGLFramebuffer | null = null;
  let completed = false;

  try {
    texture = gl.createTexture();
    fbo = gl.createFramebuffer();

    if (!texture || !fbo) {
      throw new Error('[sefirah-fog] Failed to allocate cloud noise texture.');
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      size,
      size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    );

    gl.viewport(0, 0, size, size);
    gl.useProgram(program);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    if (posLoc >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);

    completed = true;
    return texture;
  } finally {
    // Release temporary baking resources immediately (and partial texture on error)
    if (fbo) gl.deleteFramebuffer(fbo);
    gl.deleteProgram(program);
    if (!completed && texture) {
      gl.deleteTexture(texture);
    }
  }
}
export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function clamp01(val: number): number {
  return clamp(val, 0, 1);
}

/** Returns `val` when finite, otherwise `fallback`. */
export function finiteOr(val: number | undefined, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

/** Shallow-merges `patch` onto `base`, ignoring keys whose value is `undefined`. */
export function mergeDefined<T extends object>(
  base: T,
  patch?: DeepPartial<T>
): T {
  if (!patch) return { ...base };
  const result = { ...base };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = (patch as Record<keyof T, unknown>)[key];
    if (value !== undefined) {
      result[key] = value as T[keyof T];
    }
  }
  return result;
}