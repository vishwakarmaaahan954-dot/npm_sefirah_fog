import { describe, expect, it } from 'vitest';
import { FOG_PRESETS, resolveConfig } from '../src/presets';

describe('presets and resolveConfig', () => {
  it('caps all built-in presets to 30 FPS and disables stars on subtleMist', () => {
    for (const [name, preset] of Object.entries(FOG_PRESETS)) {
      expect(preset.targetFps, `${name}.targetFps`).toBe(30);
      expect(preset.layers.length).toBeGreaterThanOrEqual(1);
      expect(preset.layers.length).toBeLessThanOrEqual(6);
      expect(preset.interaction, `${name}.interaction`).toEqual(
        FOG_PRESETS.grayFog.interaction
      );
      if (name !== 'grayFog') {
        expect(preset.interaction).not.toBe(FOG_PRESETS.grayFog.interaction);
      }
    }
    expect(FOG_PRESETS.subtleMist.stars.enabled).toBe(false);
    expect(FOG_PRESETS.grayFog.stars.enabled).toBe(true);
    expect(FOG_PRESETS.sefirahThrone.stars.enabled).toBe(true);
    expect(FOG_PRESETS.crimsonAbyss.stars.enabled).toBe(true);
    expect(FOG_PRESETS.emeraldNebula.stars.enabled).toBe(true);
  });

  it('deeply merges overrides onto base preset without mutating presets', () => {
    const originalSpeed = FOG_PRESETS.grayFog.animation.speed;
    const cfg = resolveConfig({
      preset: 'grayFog',
      opacity: 0.5,
      animation: { speed: 1.5, direction: undefined },
      stars: { count: undefined },
    });

    expect(cfg.opacity).toBe(0.5);
    expect(cfg.animation.speed).toBe(1.5);
    expect(cfg.animation.direction).toBe(FOG_PRESETS.grayFog.animation.direction);
    expect(cfg.stars.count).toBe(FOG_PRESETS.grayFog.stars.count);
    expect(FOG_PRESETS.grayFog.animation.speed).toBe(originalSpeed);
  });

  it('replaces layers cleanly when custom layers array is passed', () => {
    const cfg = resolveConfig({
      layers: [
        {
          color: '#112233',
          opacity: 0.7,
          scale: 1.2,
          thickness: 1.1,
          speedMultiplier: 0.8,
        },
      ],
    });
    expect(cfg.layers).toHaveLength(1);
    expect(cfg.layers[0].color).toBe('#112233');
  });
});
