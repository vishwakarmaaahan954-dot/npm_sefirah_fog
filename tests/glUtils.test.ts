import { describe, expect, it, vi } from 'vitest';
import {
  MAX_FOG_LAYERS,
  bakeCloudNoiseTexture,
  clamp,
  createPingPongFBO,
  createProgram,
  deriveHighlightColor,
  finiteOr,
  interactionModeToInt,
  mergeDefined,
  normalizeDirection,
  parseColor,
  resolveLayers,
} from '../src/core/glUtils';

function createAllocationTrackingGL() {
  let nextId = 1;
  const liveTextures = new Set<object>();
  const liveFBOs = new Set<object>();
  const livePrograms = new Set<object>();
  const liveShaders = new Set<object>();

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    CLAMP_TO_EDGE: 0x812f,
    REPEAT: 0x2901,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    FLOAT: 0x1406,
    TRIANGLE_STRIP: 0x0005,
    createShader: vi.fn(() => {
      const s = { id: `shader-${nextId++}` };
      liveShaders.add(s);
      return s;
    }),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn((s: object | null) => {
      if (s) liveShaders.delete(s);
    }),
    createProgram: vi.fn(() => {
      const p = { id: `program-${nextId++}` };
      livePrograms.add(p);
      return p;
    }),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn((p: object | null) => {
      if (p) livePrograms.delete(p);
    }),
    createTexture: vi.fn((): object | null => {
      const t = { id: `tex-${nextId++}` };
      liveTextures.add(t);
      return t;
    }),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    generateMipmap: vi.fn(),
    deleteTexture: vi.fn((t: object | null) => {
      if (t) liveTextures.delete(t);
    }),
    createFramebuffer: vi.fn((): object | null => {
      const f = { id: `fbo-${nextId++}` };
      liveFBOs.add(f);
      return f;
    }),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    deleteFramebuffer: vi.fn((f: object | null) => {
      if (f) liveFBOs.delete(f);
    }),
    viewport: vi.fn(),
    useProgram: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    bindBuffer: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    drawArrays: vi.fn(),
  } as unknown as WebGLRenderingContext & {
    createTexture: ReturnType<typeof vi.fn>;
    createFramebuffer: ReturnType<typeof vi.fn>;
    deleteTexture: ReturnType<typeof vi.fn>;
    deleteFramebuffer: ReturnType<typeof vi.fn>;
    deleteProgram: ReturnType<typeof vi.fn>;
    drawArrays: ReturnType<typeof vi.fn>;
  };

  return { gl, liveTextures, liveFBOs, livePrograms, liveShaders };
}

describe('glUtils', () => {
  it('parses hex3, hex6, hex8, rgb(), rgba(), and numeric RGB tuples', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1]);
    expect(parseColor('#00ff80')).toEqual([0, 1, 128 / 255]);
    expect(parseColor('#ff0000cc')).toEqual([1, 0, 0]);
    expect(parseColor('rgb(51, 102, 204)')).toEqual([
      51 / 255,
      102 / 255,
      204 / 255,
    ]);
    expect(parseColor('rgba(255, 0, 128, 0.5)')).toEqual([1, 0, 128 / 255]);
    expect(parseColor([0.2, 0.4, 0.8])).toEqual([0.2, 0.4, 0.8]);
    expect(parseColor([255, 128, 0])).toEqual([1, 128 / 255, 0]);
    expect(parseColor('invalid', [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });

  it('derives brighter rim highlight colors', () => {
    const rim = deriveHighlightColor([0.1, 0.2, 0.3]);
    expect(rim[0]).toBeGreaterThan(0.1);
    expect(rim[1]).toBeGreaterThan(0.2);
    expect(rim[2]).toBeGreaterThan(0.3);
    expect(rim.every((c) => c >= 0 && c <= 1)).toBe(true);
  });

  it('normalizes degree angles, vectors, and zero vectors', () => {
    const right = normalizeDirection(0);
    expect(right[0]).toBeCloseTo(1);
    expect(right[1]).toBeCloseTo(0);

    const up = normalizeDirection(90);
    expect(up[0]).toBeCloseTo(0);
    expect(up[1]).toBeCloseTo(1);

    const diag = normalizeDirection({ x: 3, y: 4 });
    expect(diag[0]).toBeCloseTo(0.6);
    expect(diag[1]).toBeCloseTo(0.8);

    expect(normalizeDirection({ x: 0, y: 0 })).toEqual([1, 0]);
  });

  it('maps interaction modes and clamps numbers safely', () => {
    expect(interactionModeToInt('part')).toBe(0);
    expect(interactionModeToInt('swirl')).toBe(1);
    expect(interactionModeToInt('repel')).toBe(2);
    expect(interactionModeToInt('attract')).toBe(3);

    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(finiteOr(NaN, 0.5)).toBe(0.5);
    expect(finiteOr(Infinity, 0.5)).toBe(0.5);
    expect(finiteOr(0.25, 0.5)).toBe(0.25);
  });

  it('merges defined keys without overwriting existing values with undefined', () => {
    const base = { speed: 0.65, enabled: true };
    expect(mergeDefined(base, { speed: undefined, enabled: false })).toEqual({
      speed: 0.65,
      enabled: false,
    });
  });

  it('caps resolveLayers to MAX_FOG_LAYERS and handles NaN/undefined inputs', () => {
    const input = Array.from({ length: 8 }, (_, idx) => ({
      color: '#224466',
      opacity: idx === 0 ? NaN : 0.8,
      scale: 0.001,
      thickness: 99,
      speedMultiplier: 1,
    }));

    const resolved = resolveLayers(input);
    expect(resolved).toHaveLength(MAX_FOG_LAYERS);
    expect(resolved[0].opacity).toBe(0.75);
    expect(resolved[0].scale).toBe(0.05);
    expect(resolved[0].thickness).toBe(3.0);
    expect(resolved[0].highlightColor).toHaveLength(3);
  });

  it('cleans up partial textures and FBOs when createPingPongFBO fails', () => {
    // Failure on first target FBO leaves no orphaned texture
    const first = createAllocationTrackingGL();
    first.gl.createFramebuffer.mockReturnValueOnce(null);
    expect(() => createPingPongFBO(first.gl, 64, 64)).toThrow(
      'Failed to allocate wake FBO/texture'
    );
    expect(first.gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(first.liveTextures.size).toBe(0);
    expect(first.liveFBOs.size).toBe(0);

    // Failure on second (write) target cleans up write partial + read target
    const second = createAllocationTrackingGL();
    const readFbo = { id: 'read-fbo' };
    second.liveFBOs.add(readFbo);
    second.gl.createFramebuffer
      .mockReturnValueOnce(readFbo)
      .mockReturnValueOnce(null);

    expect(() => createPingPongFBO(second.gl, 64, 64)).toThrow(
      'Failed to allocate wake FBO/texture'
    );
    expect(second.liveTextures.size).toBe(0);
    expect(second.liveFBOs.size).toBe(0);
  });

  it('cleans up program, FBO, and texture when bakeCloudNoiseTexture fails', () => {
    const allocFail = createAllocationTrackingGL();
    allocFail.gl.createFramebuffer.mockReturnValueOnce(null);

    expect(() =>
      bakeCloudNoiseTexture(allocFail.gl, 'v', 'f', {} as WebGLBuffer, 64)
    ).toThrow('Failed to allocate cloud noise texture');
    expect(allocFail.livePrograms.size).toBe(0);
    expect(allocFail.liveTextures.size).toBe(0);
    expect(allocFail.liveFBOs.size).toBe(0);
    expect(allocFail.liveShaders.size).toBe(0);

    const drawFail = createAllocationTrackingGL();
    drawFail.gl.drawArrays.mockImplementationOnce(() => {
      throw new Error('draw failure');
    });

    expect(() =>
      bakeCloudNoiseTexture(drawFail.gl, 'v', 'f', {} as WebGLBuffer, 64)
    ).toThrow('draw failure');
    expect(drawFail.livePrograms.size).toBe(0);
    expect(drawFail.liveTextures.size).toBe(0);
    expect(drawFail.liveFBOs.size).toBe(0);
    expect(drawFail.liveShaders.size).toBe(0);
  });

  it('deletes compiled vertex shader when fragment shader compilation fails and guards NaN in parseColor', () => {
    const tracker = createAllocationTrackingGL();
    let compileCall = 0;
    const getShaderParameter = vi.fn(() => {
      compileCall++;
      return compileCall === 1;
    });
    (tracker.gl as unknown as Record<string, unknown>).getShaderParameter =
      getShaderParameter;

    expect(() => createProgram(tracker.gl, 'vert', 'bad frag')).toThrow(
      'Shader compilation failed'
    );
    expect(tracker.liveShaders.size).toBe(0);
    expect(tracker.livePrograms.size).toBe(0);

    expect(parseColor([NaN, 0.5, 0.5], [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    expect(parseColor('rgb(., 100, 200)', [0.1, 0.2, 0.3])).toEqual([
      0.1, 0.2, 0.3,
    ]);
  });
});
