import { describe, expect, it, vi } from 'vitest';
import { SefirahFogEngine } from '../src/core/SefirahFogEngine';
import { FOG_FRAGMENT_SHADER } from '../src/shaders/fog.frag';
import { FULLSCREEN_VERTEX_SHADER } from '../src/shaders/fullscreen.vert';
import { NOISE_BAKE_FRAGMENT_SHADER } from '../src/shaders/noiseBake.frag';
import { WAKE_FRAGMENT_SHADER } from '../src/shaders/wake.frag';

function extractShaderUniforms(src: string): string[] {
  const uniforms: string[] = [];
  const regex = /^\s*uniform\s+\w+\s+(\w+)(?:\[\w+\])?\s*;/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(src)) !== null) {
    uniforms.push(match[1]);
  }
  return uniforms;
}

function assertBalancedDelimiters(src: string, label: string): void {
  let braces = 0;
  let parens = 0;
  for (const ch of src) {
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    expect(braces, `${label} unmatched '}'`).toBeGreaterThanOrEqual(0);
    expect(parens, `${label} unmatched ')'`).toBeGreaterThanOrEqual(0);
  }
  expect(braces, `${label} unclosed '{'`).toBe(0);
  expect(parens, `${label} unclosed '('`).toBe(0);
}

describe('GLSL shaders & uniform contracts', () => {
  const shaders = [
    { name: 'fullscreen.vert', src: FULLSCREEN_VERTEX_SHADER, isFrag: false },
    { name: 'noiseBake.frag', src: NOISE_BAKE_FRAGMENT_SHADER, isFrag: true },
    { name: 'wake.frag', src: WAKE_FRAGMENT_SHADER, isFrag: true },
    { name: 'fog.frag', src: FOG_FRAGMENT_SHADER, isFrag: true },
  ];

  it('validates GLSL ES 1.00 structure and balanced delimiters across all shaders', () => {
    for (const { name, src, isFrag } of shaders) {
      expect(src.trim().length, `${name} empty`).toBeGreaterThan(0);
      assertBalancedDelimiters(src, name);
      expect(src, `${name} main()`).toMatch(/\bvoid\s+main\s*\(\s*\)/);

      // WebGL1 GLSL ES 1.00 uses texture2D, not GLSL3 texture()
      expect(src, `${name} should use texture2D`).not.toMatch(/\btexture\s*\(/);

      // GLSL ES leaves smoothstep(edge0, edge1, x) undefined when edge0 >= edge1
      const smoothstepNums =
        /smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g;
      let ssMatch: RegExpExecArray | null;
      while ((ssMatch = smoothstepNums.exec(src)) !== null) {
        const edge0 = parseFloat(ssMatch[1]);
        const edge1 = parseFloat(ssMatch[2]);
        expect(edge0, `${name} smoothstep(${edge0}, ${edge1})`).toBeLessThan(edge1);
      }
      expect(src, `${name} smoothstep(radius, ...)`).not.toMatch(
        /smoothstep\(\s*radius\s*,\s*radius\s*\*/
      );

      if (isFrag) {
        expect(src).toContain('#ifdef GL_FRAGMENT_PRECISION_HIGH');
        expect(src).toContain('#endif');
        expect(src).toContain('gl_FragColor');
      } else {
        expect(src).toContain('gl_Position');
        expect(src).toContain('attribute vec2 a_position');
      }
    }
  });

  it('keeps SefirahFogEngine uniform lookups in sync with wake and fog shaders', () => {
    const queriedUniforms = new Set<string>();
    let locId = 1;
    const mockGl = {
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82,
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88e4,
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
      TEXTURE0: 0x84c0,
      TEXTURE1: 0x84c1,
      FLOAT: 0x1406,
      TRIANGLE_STRIP: 0x0005,
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      getShaderInfoLog: vi.fn(() => ''),
      deleteShader: vi.fn(),
      createProgram: vi.fn(() => ({})),
      attachShader: vi.fn(),
      bindAttribLocation: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      getProgramInfoLog: vi.fn(() => ''),
      deleteProgram: vi.fn(),
      createBuffer: vi.fn(() => ({})),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      deleteBuffer: vi.fn(),
      createTexture: vi.fn(() => ({})),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      texImage2D: vi.fn(),
      generateMipmap: vi.fn(),
      deleteTexture: vi.fn(),
      createFramebuffer: vi.fn(() => ({})),
      bindFramebuffer: vi.fn(),
      framebufferTexture2D: vi.fn(),
      deleteFramebuffer: vi.fn(),
      viewport: vi.fn(),
      useProgram: vi.fn(),
      getAttribLocation: vi.fn(() => 0),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      drawArrays: vi.fn(),
      activeTexture: vi.fn(),
      getUniformLocation: vi.fn((_p: unknown, name: string) => {
        queriedUniforms.add(name.replace(/\[0\]$/, ''));
        return { id: locId++ };
      }),
    } as unknown as WebGLRenderingContext;

    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockGl as unknown as RenderingContext
    );

    const container = document.createElement('div');
    const engine = new SefirahFogEngine(container);

    const declaredUniforms = new Set([
      ...extractShaderUniforms(WAKE_FRAGMENT_SHADER),
      ...extractShaderUniforms(FOG_FRAGMENT_SHADER),
    ]);

    for (const u of declaredUniforms) {
      expect(queriedUniforms.has(u), `Missing getUniformLocation for "${u}"`).toBe(
        true
      );
    }
    for (const q of queriedUniforms) {
      expect(declaredUniforms.has(q), `Queried uniform "${q}" not in shader`).toBe(
        true
      );
    }

    engine.destroy();
    vi.unstubAllGlobals();
  });
});
