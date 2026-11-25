import { describe, expect, it, vi } from 'vitest';
import { InteractionManager } from '../src/core/InteractionManager';
import { FOG_PRESETS } from '../src/presets';

function makeCanvas(rect = { left: 100, top: 50, width: 200, height: 100 }) {
  const canvas = document.createElement('canvas');
  const spy = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  });
  return { canvas, spy };
}

describe('InteractionManager', () => {
  it('caches bounding rect across pointer moves and invalidates on scroll', () => {
    const { canvas, spy } = makeCanvas();
    const onActivity = vi.fn();
    const manager = new InteractionManager(
      canvas,
      { ...FOG_PRESETS.grayFog.interaction, globalEvents: true },
      onActivity
    );

    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 200, clientY: 75 }) as Event
    );
    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 250, clientY: 100 }) as Event
    );
    expect(onActivity).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(0);

    const snap1 = manager.step(1 / 60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(snap1.active).toBe(true);
    expect(snap1.x).toBeCloseTo(0.75);
    expect(snap1.y).toBeCloseTo(0.5);

    // Subsequent pointermove reuses cached rect without calling getBoundingClientRect
    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 150, clientY: 125 }) as Event
    );
    manager.step(1 / 60);
    expect(spy).toHaveBeenCalledTimes(1);

    // Scroll invalidates cached rect, refreshing lazily on next step with pending move
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 200, clientY: 100 }) as Event
    );
    manager.step(1 / 60);
    expect(spy).toHaveBeenCalledTimes(2);

    manager.dispose();
  });

  it('deactivates on documentElement mouseleave and supports triggerPulse', () => {
    const { canvas } = makeCanvas();
    const onActivity = vi.fn();
    const manager = new InteractionManager(
      canvas,
      { ...FOG_PRESETS.grayFog.interaction, globalEvents: true },
      onActivity
    );

    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 200, clientY: 100 }) as Event
    );
    expect(manager.step(1 / 60).active).toBe(true);

    document.documentElement.dispatchEvent(new MouseEvent('mouseleave'));
    expect(manager.step(1 / 60).active).toBe(false);

    manager.triggerPulse(0.25, 0.75, { velX: 1.0, velY: -0.5, duration: 0.2 });
    const pulseSnap = manager.step(1 / 60);
    expect(pulseSnap.active).toBe(true);
    expect(pulseSnap.x).toBe(0.25);
    expect(pulseSnap.y).toBe(0.75);

    manager.dispose();
  });

  it('routes canvas-local events to container when globalEvents is false', () => {
    const container = document.createElement('div');
    const { canvas } = makeCanvas({ left: 0, top: 0, width: 100, height: 100 });
    canvas.style.pointerEvents = 'none';
    container.appendChild(canvas);

    const manager = new InteractionManager(
      canvas,
      { ...FOG_PRESETS.grayFog.interaction, globalEvents: false },
      undefined,
      container
    );

    container.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 50, clientY: 25 }) as Event
    );
    const snap = manager.step(1 / 60);
    expect(snap.active).toBe(true);
    expect(snap.x).toBeCloseTo(0.5);
    expect(snap.y).toBeCloseTo(0.75);

    container.dispatchEvent(new MouseEvent('pointerleave'));
    expect(manager.step(1 / 60).active).toBe(false);

    manager.dispose();
  });
});
