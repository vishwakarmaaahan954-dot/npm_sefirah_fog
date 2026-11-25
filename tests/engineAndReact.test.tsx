import React, { act, createRef, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSefirahFog,
  MAX_FOG_LAYERS,
  SefirahFogEngine,
  type SefirahFogOptions,
} from '../src/index';
import {
  SefirahFog,
  useSefirahFog,
  type SefirahFogRef,
} from '../src/react/SefirahFog';

function createMockGL() {
  let locCounter = 1;
  return {
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
    COLOR_BUFFER_BIT: 0x4000,
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
    clearColor: vi.fn(),
    clear: vi.fn(),
    activeTexture: vi.fn(),
    getUniformLocation: vi.fn(() => ({ id: locCounter++ })),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform4f: vi.fn(),
    uniform2fv: vi.fn(),
    uniform3fv: vi.fn(),
    uniform4fv: vi.fn(),
  } as unknown as WebGLRenderingContext;
}

describe('SefirahFogEngine & React SefirahFog', () => {
  let intersectionCb: IntersectionObserverCallback | null = null;
  let rafQueue: FrameRequestCallback[] = [];
  let rafCounter = 1;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    rafQueue = [];
    rafCounter = 1;

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
        constructor(cb: IntersectionObserverCallback) {
          intersectionCb = cb;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafCounter++;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    intersectionCb = null;
    document.body.innerHTML = '';
  });

  it('prepends canvas with zIndex 0 and restores container position on destroy', () => {
    const mockGl = createMockGL();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockGl as unknown as RenderingContext);

    const container = document.createElement('div');
    const heading = document.createElement('h1');
    heading.textContent = 'Title';
    container.appendChild(heading);
    document.body.appendChild(container);

    const engine = createSefirahFog(container, { opaqueCanvas: true });
    expect(getContextSpy).toHaveBeenCalledWith(
      'webgl2',
      expect.objectContaining({ alpha: false, powerPreference: 'low-power' })
    );
    expect(container.firstElementChild).toBe(engine.canvas);
    expect(engine.canvas.style.zIndex).toBe('0');
    expect(container.style.position).toBe('relative');

    // Offscreen intersection stops rAF scheduling when returning
    intersectionCb?.(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
    engine.renderFrame(1 / 60);

    engine.destroy();
    expect(container.style.position).toBe('');
    expect(container.contains(engine.canvas)).toBe(false);
  });

  it('supports container-local input (globalEvents: false) and keeps context attributes truthful', () => {
    const mockGl = createMockGL();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockGl as unknown as RenderingContext
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const container = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const engine = createSefirahFog(container, {
      powerPreference: 'low-power',
      opaqueCanvas: false,
      interaction: { globalEvents: false },
    });
    vi.spyOn(engine.canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Injected canvas keeps pointerEvents: 'none', yet container receives local pointer events
    expect(engine.canvas.style.pointerEvents).toBe('none');
    const drawSpy = vi.mocked(mockGl.drawArrays);
    drawSpy.mockClear();
    container.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 100, clientY: 50 }) as Event
    );
    engine.renderFrame(1 / 60);
    expect(drawSpy).toHaveBeenCalledTimes(2);

    // Context attributes cannot be mutated live; config stays truthful and warns
    engine.updateConfig({
      powerPreference: 'high-performance',
      opaqueCanvas: true,
    });
    expect(engine.getConfig().powerPreference).toBe('low-power');
    expect(engine.getConfig().opaqueCanvas).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    engine.destroy();
  });

  it('supports setPreset(), updateConfig() preset switching, and addLayer()/removeLayer()', () => {
    const mockGl = createMockGL();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockGl as unknown as RenderingContext
    );

    const container = document.createElement('div');
    const engine = new SefirahFogEngine(container, {
      preset: 'grayFog',
      opacity: 0.77,
    });

    // Updating with the same preset preserves existing overrides
    engine.updateConfig({ preset: 'grayFog', animation: { speed: 1.4 } });
    expect(engine.getConfig().opacity).toBe(0.77);
    expect(engine.getConfig().animation.speed).toBe(1.4);

    // Switching to a different preset via updateConfig resets to the new preset + clears wake
    const clearSpy = vi.spyOn(engine, 'clearWake');
    engine.updateConfig({ preset: 'crimsonAbyss', opacity: 0.65 });
    expect(engine.getConfig().preset).toBe('crimsonAbyss');
    expect(engine.getConfig().opacity).toBe(0.65);
    expect(engine.getConfig().animation.speed).not.toBe(1.4);
    expect(clearSpy).toHaveBeenCalledTimes(1);

    // setPreset with wakeResolution change rebuilds FBO without calling clearWake
    const deleteFboSpy = vi.mocked(mockGl.deleteFramebuffer);
    const prevDeleteCalls = deleteFboSpy.mock.calls.length;
    engine.setPreset('subtleMist', { stars: { enabled: true } });
    expect(engine.getConfig().preset).toBe('subtleMist');
    expect(engine.getConfig().wakeResolution).toBe(128);
    expect(engine.getConfig().stars.enabled).toBe(true);
    expect(deleteFboSpy.mock.calls.length).toBeGreaterThan(prevDeleteCalls);

    // addLayer caps at MAX_FOG_LAYERS (6), removeLayer ignores invalid indices
    const sampleLayer = {
      color: '#112233',
      opacity: 0.5,
      scale: 1,
      thickness: 1,
      speedMultiplier: 1,
    };
    while (engine.getConfig().layers.length < MAX_FOG_LAYERS) {
      engine.addLayer(sampleLayer);
    }
    expect(engine.getConfig().layers).toHaveLength(MAX_FOG_LAYERS);
    engine.addLayer(sampleLayer);
    expect(engine.getConfig().layers).toHaveLength(MAX_FOG_LAYERS);

    engine.removeLayer(-1);
    engine.removeLayer(99);
    expect(engine.getConfig().layers).toHaveLength(MAX_FOG_LAYERS);

    engine.removeLayer(0);
    expect(engine.getConfig().layers).toHaveLength(MAX_FOG_LAYERS - 1);

    engine.destroy();
  });

  it('transitions cleanly across wake-active, wake-idle, and static-sleep states', () => {
    const mockGl = createMockGL();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockGl as unknown as RenderingContext
    );

    let nowMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

    const container = document.createElement('div');
    const engine = new SefirahFogEngine(container, {
      animation: { enabled: false },
      targetFps: 0,
      interaction: { disappearance: 1.0 },
    });

    const drawSpy = vi.mocked(mockGl.drawArrays);
    const clearSpy = vi.mocked(mockGl.clear);
    // Reset drawArrays count after one-shot bakeCloudNoiseTexture in constructor
    drawSpy.mockClear();
    clearSpy.mockClear();

    // 1. Initial tick with animation disabled and clean wake -> 1 fog draw, then sleeps (no new rAF)
    expect(rafQueue).toHaveLength(1);
    const firstTick = rafQueue.shift()!;
    nowMs += 16;
    firstTick(nowMs);
    expect(drawSpy).toHaveBeenCalledTimes(1);
    expect(rafQueue).toHaveLength(0);

    // 2. Programmatic pulse wakes sleeping loop and activates wake pass (2 draws per frame)
    engine.triggerPulse(0.5, 0.5, { duration: 0.1 });
    expect(rafQueue).toHaveLength(1);

    drawSpy.mockClear();
    const activeTick = rafQueue.shift()!;
    nowMs += 16;
    activeTick(nowMs);
    expect(drawSpy).toHaveBeenCalledTimes(2);
    expect(rafQueue).toHaveLength(1);

    // 3. Advance until pulse ends and wakeDecayTimer expires -> clears FBO, skips wake pass, sleeps
    let steps = 0;
    while (rafQueue.length > 0 && steps < 60) {
      drawSpy.mockClear();
      const nextTick = rafQueue.shift()!;
      nowMs += 45;
      nextTick(nowMs);
      steps++;
    }

    expect(steps).toBeLessThan(60);
    expect(rafQueue).toHaveLength(0);
    // Final settled frame skipped runWakePass (1 fog draw) and cleared FBO once
    expect(drawSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalled();

    // 4. Disabling interaction while wake is active immediately clears and skips wake pass
    engine.setAnimationEnabled(true);
    engine.triggerPulse(0.5, 0.5, { duration: 0.5 });
    rafQueue.shift()!((nowMs += 16));
    drawSpy.mockClear();
    engine.setInteractionEnabled(false);
    rafQueue.shift()!((nowMs += 16));
    expect(drawSpy).toHaveBeenCalledTimes(1);

    engine.destroy();
  });

  it('forwards exact WebGL error via onError and alertOnError in vanilla engine', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const onError = vi.fn();

    const container = document.createElement('div');
    expect(
      () =>
        new SefirahFogEngine(container, {
          alertOnError: true,
          onError,
        })
    ).toThrow(/WebGL is not supported/);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('WebGL is not supported');
    expect(alertSpy).toHaveBeenCalledWith(onError.mock.calls[0][0].message);
  });

  it('renders React fallback & calls onError without crashing when WebGL is missing', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onError = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SefirahFog
          fallback={<div data-testid="fallback">No WebGL</div>}
          onError={onError}
        >
          <span>Overlay Content</span>
        </SefirahFog>
      );
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('No WebGL');
    expect(host.textContent).toContain('Overlay Content');

    await act(async () => {
      root.unmount();
    });
  });

  it('skips redundant updateConfig on equivalent re-renders in React SefirahFog', async () => {
    const mockGl = createMockGL();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockGl as unknown as RenderingContext
    );

    const ref = createRef<SefirahFogRef>();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SefirahFog ref={ref} options={{ preset: 'grayFog', opacity: 0.9 }} />
      );
    });

    const engine = ref.current?.engine;
    expect(engine).not.toBeNull();
    const updateSpy = vi.spyOn(engine!, 'updateConfig');

    // Equivalent inline object should not trigger updateConfig
    await act(async () => {
      root.render(
        <SefirahFog ref={ref} options={{ preset: 'grayFog', opacity: 0.9 }} />
      );
    });
    expect(updateSpy).not.toHaveBeenCalled();

    // Changed option triggers updateConfig once
    await act(async () => {
      root.render(
        <SefirahFog ref={ref} options={{ preset: 'grayFog', opacity: 0.5 }} />
      );
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('supports useSefirahFog hook lifecycle, deepEqual skip, and WebGL error callback', async () => {
    const mockGl = createMockGL();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockGl as unknown as RenderingContext);

    let capturedRef: React.RefObject<SefirahFogEngine | null> | null = null;
    function HookConsumer({
      options,
      onError,
    }: {
      options?: SefirahFogOptions;
      onError?: (err: Error) => void;
    }) {
      const targetRef = useRef<HTMLDivElement | null>(null);
      capturedRef = useSefirahFog(targetRef, options, onError);
      return <div ref={targetRef} />;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <HookConsumer options={{ preset: 'grayFog', opacity: 0.85 }} />
      );
    });

    const engine = capturedRef!.current;
    expect(engine).toBeInstanceOf(SefirahFogEngine);
    const updateSpy = vi.spyOn(engine!, 'updateConfig');
    const destroySpy = vi.spyOn(engine!, 'destroy');

    // Equivalent inline options do not call updateConfig
    await act(async () => {
      root.render(
        <HookConsumer options={{ preset: 'grayFog', opacity: 0.85 }} />
      );
    });
    expect(updateSpy).not.toHaveBeenCalled();

    // Changed option calls updateConfig
    await act(async () => {
      root.render(
        <HookConsumer options={{ preset: 'grayFog', opacity: 0.45 }} />
      );
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    expect(destroySpy).toHaveBeenCalledTimes(1);

    // Also verifies onError when WebGL is unavailable in hook
    getContextSpy.mockReturnValue(null);
    const onError = vi.fn();
    const root2 = createRoot(host);
    await act(async () => {
      root2.render(<HookConsumer onError={onError} />);
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(capturedRef!.current).toBeNull();

    await act(async () => {
      root2.unmount();
    });
  });

  it('disposes all partial WebGL resources when initialization fails midway on a caller-owned canvas', () => {
    const mockGl = createMockGL() as unknown as ReturnType<
      typeof createMockGL
    > & {
      createShader: ReturnType<typeof vi.fn>;
      deleteShader: ReturnType<typeof vi.fn>;
      createProgram: ReturnType<typeof vi.fn>;
      deleteProgram: ReturnType<typeof vi.fn>;
      createBuffer: ReturnType<typeof vi.fn>;
      deleteBuffer: ReturnType<typeof vi.fn>;
      createTexture: ReturnType<typeof vi.fn>;
      deleteTexture: ReturnType<typeof vi.fn>;
      createFramebuffer: ReturnType<typeof vi.fn>;
      deleteFramebuffer: ReturnType<typeof vi.fn>;
    };

    let nextId = 1;
    const liveBuffers = new Set<object>();
    const liveTextures = new Set<object>();
    const liveFramebuffers = new Set<object>();
    const livePrograms = new Set<object>();
    const liveShaders = new Set<object>();

    mockGl.createBuffer.mockImplementation(() => {
      const b = { id: `buf-${nextId++}` };
      liveBuffers.add(b);
      return b;
    });
    mockGl.deleteBuffer.mockImplementation((b: object | null) => {
      if (b) liveBuffers.delete(b);
    });
    mockGl.createTexture.mockImplementation(() => {
      const t = { id: `tex-${nextId++}` };
      liveTextures.add(t);
      return t;
    });
    mockGl.deleteTexture.mockImplementation((t: object | null) => {
      if (t) liveTextures.delete(t);
    });
    let fboCount = 0;
    mockGl.createFramebuffer.mockImplementation(() => {
      fboCount++;
      // Call 1 = bake FBO, Call 2 = wakeFBO.read, Call 3 = wakeFBO.write (fail)
      if (fboCount === 3) return null;
      const f = { id: `fbo-${nextId++}` };
      liveFramebuffers.add(f);
      return f;
    });
    mockGl.deleteFramebuffer.mockImplementation((f: object | null) => {
      if (f) liveFramebuffers.delete(f);
    });
    mockGl.createProgram.mockImplementation(() => {
      const p = { id: `prog-${nextId++}` };
      livePrograms.add(p);
      return p;
    });
    mockGl.deleteProgram.mockImplementation((p: object | null) => {
      if (p) livePrograms.delete(p);
    });
    mockGl.createShader.mockImplementation(() => {
      const s = { id: `shader-${nextId++}` };
      liveShaders.add(s);
      return s;
    });
    mockGl.deleteShader.mockImplementation((s: object | null) => {
      if (s) liveShaders.delete(s);
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockGl as unknown as RenderingContext
    );

    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);

    const onError = vi.fn();
    expect(() => new SefirahFogEngine(canvas, { onError })).toThrow(
      'Failed to allocate wake FBO/texture'
    );

    expect(onError).toHaveBeenCalledTimes(1);
    // Caller owns this canvas; it must stay in place
    expect(canvas.parentElement).toBe(container);
    // Verify earlier allocations happened, then all live GL resources were cleaned up
    expect(mockGl.createBuffer).toHaveBeenCalledTimes(1);
    expect(mockGl.createProgram).toHaveBeenCalledTimes(3);
    expect(mockGl.createTexture).toHaveBeenCalledTimes(3);
    expect(liveBuffers.size).toBe(0);
    expect(liveTextures.size).toBe(0);
    expect(liveFramebuffers.size).toBe(0);
    expect(livePrograms.size).toBe(0);
    expect(liveShaders.size).toBe(0);
  });

  it('cleans up partial WebGL resources on injected-canvas failure and failed context restore', () => {
    const mockGl = createMockGL() as unknown as ReturnType<
      typeof createMockGL
    > & {
      getProgramParameter: ReturnType<typeof vi.fn>;
      createProgram: ReturnType<typeof vi.fn>;
      deleteProgram: ReturnType<typeof vi.fn>;
      createBuffer: ReturnType<typeof vi.fn>;
      deleteBuffer: ReturnType<typeof vi.fn>;
      createTexture: ReturnType<typeof vi.fn>;
      deleteTexture: ReturnType<typeof vi.fn>;
      createFramebuffer: ReturnType<typeof vi.fn>;
      deleteFramebuffer: ReturnType<typeof vi.fn>;
    };

    let nextId = 1;
    const liveBuffers = new Set<object>();
    const liveTextures = new Set<object>();
    const liveFramebuffers = new Set<object>();
    const livePrograms = new Set<object>();

    mockGl.createBuffer.mockImplementation(() => {
      const b = { id: `buf-${nextId++}` };
      liveBuffers.add(b);
      return b;
    });
    mockGl.deleteBuffer.mockImplementation((b: object | null) => {
      if (b) liveBuffers.delete(b);
    });
    mockGl.createTexture.mockImplementation(() => {
      const t = { id: `tex-${nextId++}` };
      liveTextures.add(t);
      return t;
    });
    mockGl.deleteTexture.mockImplementation((t: object | null) => {
      if (t) liveTextures.delete(t);
    });
    mockGl.createFramebuffer.mockImplementation(() => {
      const f = { id: `fbo-${nextId++}` };
      liveFramebuffers.add(f);
      return f;
    });
    mockGl.deleteFramebuffer.mockImplementation((f: object | null) => {
      if (f) liveFramebuffers.delete(f);
    });
    mockGl.createProgram.mockImplementation(() => {
      const p = { id: `prog-${nextId++}` };
      livePrograms.add(p);
      return p;
    });
    mockGl.deleteProgram.mockImplementation((p: object | null) => {
      if (p) livePrograms.delete(p);
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockGl as unknown as RenderingContext
    );

    // Part 1: Injected canvas fails during 3rd program (fog shader link)
    let programCalls = 0;
    mockGl.getProgramParameter.mockImplementation(() => {
      programCalls++;
      return programCalls < 3;
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const failError = vi.fn();

    expect(
      () => new SefirahFogEngine(container, { onError: failError })
    ).toThrow('Program link failed');
    expect(failError).toHaveBeenCalledTimes(1);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.style.position).toBe('');
    expect(liveBuffers.size).toBe(0);
    expect(liveTextures.size).toBe(0);
    expect(liveFramebuffers.size).toBe(0);
    expect(livePrograms.size).toBe(0);

    // Part 2: Caller canvas succeeds initially, loses context, and fails partway through restore
    mockGl.getProgramParameter.mockImplementation(() => true);
    const callerCanvas = document.createElement('canvas');
    container.appendChild(callerCanvas);
    const restoreError = vi.fn();
    const engine = new SefirahFogEngine(callerCanvas, {
      onError: restoreError,
    });

    expect(liveBuffers.size).toBe(1);
    expect(liveTextures.size).toBe(3);
    expect(liveFramebuffers.size).toBe(2);
    expect(livePrograms.size).toBe(2);

    callerCanvas.dispatchEvent(new Event('webglcontextlost'));

    let restoreFboCalls = 0;
    mockGl.createFramebuffer.mockImplementation(() => {
      restoreFboCalls++;
      // Fail on 2nd FBO during restore (wakeFBO.read) after noise bake + quad + wake/fog programs
      if (restoreFboCalls === 2) return null;
      const f = { id: `fbo-${nextId++}` };
      liveFramebuffers.add(f);
      return f;
    });

    callerCanvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(restoreError).toHaveBeenCalledTimes(1);
    expect(restoreError.mock.calls[0][0].message).toContain(
      'Failed to allocate wake FBO/texture'
    );
    expect(liveBuffers.size).toBe(0);
    expect(liveTextures.size).toBe(0);
    expect(liveFramebuffers.size).toBe(0);
    expect(livePrograms.size).toBe(0);

    const deleteCountsAfterFailedRestore = {
      buffer: mockGl.deleteBuffer.mock.calls.length,
      texture: mockGl.deleteTexture.mock.calls.length,
      fbo: mockGl.deleteFramebuffer.mock.calls.length,
      program: mockGl.deleteProgram.mock.calls.length,
    };

    // Rendering & destroying after failed restore must safely no-op without double-deleting
    engine.renderFrame(1 / 60);
    engine.destroy();

    expect(mockGl.deleteBuffer).toHaveBeenCalledTimes(
      deleteCountsAfterFailedRestore.buffer
    );
    expect(mockGl.deleteTexture).toHaveBeenCalledTimes(
      deleteCountsAfterFailedRestore.texture
    );
    expect(mockGl.deleteFramebuffer).toHaveBeenCalledTimes(
      deleteCountsAfterFailedRestore.fbo
    );
    expect(mockGl.deleteProgram).toHaveBeenCalledTimes(
      deleteCountsAfterFailedRestore.program
    );
  });

  it('guards NaN dtSeconds in renderFrame and forwards missing-selector errors in createSefirahFog', () => {
    const mockGl = createMockGL();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockGl as unknown as RenderingContext
    );

    const container = document.createElement('div');
    const engine = new SefirahFogEngine(container);
    engine.renderFrame(NaN);

    const uniform3fvCalls = vi.mocked(mockGl.uniform3fv).mock.calls;
    const lastMotionBuf = uniform3fvCalls[
      uniform3fvCalls.length - 1
    ][1] as Float32Array;
    expect(Array.from(lastMotionBuf).every((n) => Number.isFinite(n))).toBe(true);
    engine.destroy();

    const onError = vi.fn();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    expect(() =>
      createSefirahFog('#non-existent-fog-root', {
        onError,
        alertOnError: true,
      })
    ).toThrow('Target element not found');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(onError.mock.calls[0][0].message);
  });

  it('handles pause/resume, visibilitychange, and prefers-reduced-motion listeners cleanly', () => {
    const mockGl = createMockGL();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockGl as unknown as RenderingContext
    );

    const mediaListeners: { change?: (e: MediaQueryListEvent) => void } = {};
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
          mediaListeners.change = cb;
        },
        removeEventListener: vi.fn(),
      }))
    );

    const container = document.createElement('div');
    const engine = new SefirahFogEngine(container, { targetFps: 0 });
    expect(rafQueue).toHaveLength(1);

    engine.pause();
    expect(cancelAnimationFrame).toHaveBeenCalled();

    rafQueue = [];
    engine.resume();
    expect(rafQueue).toHaveLength(1);

    // Tab hidden pauses loop; visible resumes it
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(2);

    rafQueue = [];
    hiddenSpy.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rafQueue).toHaveLength(1);

    // Reduced motion freezes drift simulation without throwing
    mediaListeners.change?.({ matches: true } as MediaQueryListEvent);
    const prevUniformCalls = vi.mocked(mockGl.uniform3fv).mock.calls.length;
    engine.renderFrame(1 / 60);
    expect(vi.mocked(mockGl.uniform3fv).mock.calls.length).toBeGreaterThan(
      prevUniformCalls
    );

    engine.destroy();
  });
});
