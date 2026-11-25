'use client';

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { SefirahFogEngine } from '../core/SefirahFogEngine';
import type { FogPresetName, SefirahFogOptions } from '../types';

export { FOG_PRESETS, resolveConfig } from '../presets';
export type * from '../types';

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (
      !Object.prototype.hasOwnProperty.call(objB, key) ||
      !deepEqual(objA[key], objB[key])
    ) {
      return false;
    }
  }
  return true;
}

export interface SefirahFogRef {
  /** Direct access to the underlying WebGL engine instance */
  readonly engine: SefirahFogEngine | null;
  /** Injects a parting/swirling ripple at normalized viewport coords (x: 0..1, y: 0..1 from bottom) */
  triggerPulse: (
    x: number,
    y: number,
    options?: { velX?: number; velY?: number; duration?: number }
  ) => void;
  /** Immediately clears active mouse/touch wake trails */
  clearWake: () => void;
  /** Switches to a built-in preset with optional overrides */
  setPreset: (preset: FogPresetName, overrides?: SefirahFogOptions) => void;
  /** Merges partial configuration changes live without recreating the WebGL context */
  updateConfig: (partial: SefirahFogOptions) => void;
  /** Pauses the animation loop */
  pause: () => void;
  /** Resumes the animation loop */
  resume: () => void;
}

export interface SefirahFogProps {
  /** Fog styling, multi-layer colors, animation, and mouse interaction options */
  options?: SefirahFogOptions;
  /** Optional CSS class for the wrapper container */
  className?: string;
  /** Optional inline styles for the wrapper container */
  style?: CSSProperties;
  /** Optional overlay content rendered cleanly above the fog canvas */
  children?: React.ReactNode;
  /** Optional fallback UI rendered if WebGL initialization fails */
  fallback?: React.ReactNode;
  /** Optional callback receiving the exact Error if WebGL initialization fails */
  onError?: (error: Error) => void;
}

/**
 * React component that renders customizable multi-layer volumetric fog.
 *
 * @example
 * ```tsx
 * import { SefirahFog } from 'sefirah-fog/react';
 *
 * export function Hero() {
 *   return (
 *     <SefirahFog
 *       options={{ preset: 'grayFog', opacity: 0.92, interaction: { mode: 'swirl', spread: 0.6, disappearance: 0.15 } }}
 *       style={{ height: '100vh' }}
 *     >
 *       <h1>Above the Gray Fog</h1>
 *     </SefirahFog>
 *   );
 * }
 * ```
 */
export const SefirahFog = forwardRef<SefirahFogRef, SefirahFogProps>(
  function SefirahFog(
    { options, className, style, children, fallback, onError },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<SefirahFogEngine | null>(null);
    const appliedOptionsRef = useRef<SefirahFogOptions | undefined>(undefined);
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      appliedOptionsRef.current = options;
      try {
        const engine = new SefirahFogEngine(container, options);
        engineRef.current = engine;
        setError(null);

        return () => {
          engine.destroy();
          engineRef.current = null;
        };
      } catch (cause) {
        const err = cause instanceof Error ? cause : new Error(String(cause));
        engineRef.current = null;
        setError(err);
        // SefirahFogEngine already calls options.onError; avoid double-invoking the same callback
        if (onErrorRef.current && onErrorRef.current !== options?.onError) {
          onErrorRef.current(err);
        }
        return undefined;
      }
      // Mount once; subsequent option changes flow through updateConfig() below
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (!engineRef.current || !options) return;
      if (deepEqual(appliedOptionsRef.current, options)) return;
      appliedOptionsRef.current = options;
      engineRef.current.updateConfig(options);
    }, [options]);

    useImperativeHandle(
      ref,
      () => ({
        get engine() {
          return engineRef.current;
        },
        triggerPulse(x, y, pulseOpts) {
          engineRef.current?.triggerPulse(x, y, pulseOpts);
        },
        clearWake() {
          engineRef.current?.clearWake();
        },
        setPreset(preset, overrides) {
          engineRef.current?.setPreset(preset, overrides);
        },
        updateConfig(partial) {
          engineRef.current?.updateConfig(partial);
        },
        pause() {
          engineRef.current?.pause();
        },
        resume() {
          engineRef.current?.resume();
        },
      }),
      []
    );

    const wrapperStyle: CSSProperties = {
      position: 'relative',
      overflow: 'hidden',
      ...style,
    };

    return (
      <div ref={containerRef} className={className} style={wrapperStyle}>
        {error && fallback !== undefined ? fallback : null}
        {children ? (
          <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
        ) : null}
      </div>
    );
  }
);

/**
 * Hook for attaching SefirahFog to an existing container ref.
 */
export function useSefirahFog(
  targetRef: RefObject<HTMLElement | null>,
  options?: SefirahFogOptions,
  onError?: (error: Error) => void
): RefObject<SefirahFogEngine | null> {
  const engineRef = useRef<SefirahFogEngine | null>(null);
  const appliedOptionsRef = useRef<SefirahFogOptions | undefined>(undefined);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    appliedOptionsRef.current = options;
    try {
      const engine = new SefirahFogEngine(el, options);
      engineRef.current = engine;

      return () => {
        engine.destroy();
        engineRef.current = null;
      };
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      engineRef.current = null;
      if (onErrorRef.current && onErrorRef.current !== options?.onError) {
        onErrorRef.current(err);
      }
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRef]);

  useEffect(() => {
    if (!engineRef.current || !options) return;
    if (deepEqual(appliedOptionsRef.current, options)) return;
    appliedOptionsRef.current = options;
    engineRef.current.updateConfig(options);
  }, [options]);

  return engineRef;
}
