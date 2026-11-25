import { SefirahFogEngine } from './core/SefirahFogEngine';
import type { SefirahFogOptions } from './types';

export { SefirahFogEngine } from './core/SefirahFogEngine';
export {
  MAX_FOG_LAYERS,
  deriveHighlightColor,
  normalizeDirection,
  parseColor,
  resolveLayers,
} from './core/glUtils';
export { FOG_PRESETS, resolveConfig } from './presets';
export type {
  ColorInput,
  DeepPartial,
  DirectionInput,
  FogAnimationConfig,
  FogBacklightConfig,
  FogInteractionConfig,
  FogLayerConfig,
  FogPresetName,
  FogStarsConfig,
  InteractionMode,
  ResolvedFogLayer,
  RGBTuple,
  SefirahFogConfig,
  SefirahFogOptions,
} from './types';

/**
 * Convenience factory function to mount SefirahFog onto a <canvas> or container element.
 *
 * @example
 * ```ts
 * import { createSefirahFog } from 'sefirah-fog';
 *
 * const fog = createSefirahFog('#hero-section', {
 *   preset: 'grayFog',
 *   transparentBackground: true,
 *   interaction: { mode: 'swirl', spread: 0.65, disappearance: 0.16 }
 * });
 * ```
 */
export function createSefirahFog(
  target: string | HTMLCanvasElement | HTMLElement,
  options: SefirahFogOptions = {}
): SefirahFogEngine {
  const element =
    typeof target === 'string'
      ? document.querySelector<HTMLElement>(target)
      : target;

  if (!element) {
    const err = new Error(
      `[sefirah-fog] Target element not found: "${String(target)}"`
    );
    options.onError?.(err);
    if (options.alertOnError && typeof window !== 'undefined') {
      window.alert(err.message);
    }
    throw err;
  }

  return new SefirahFogEngine(element, options);
}