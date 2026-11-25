import type { FogInteractionConfig } from '../types';

export interface InteractionSnapshot {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  velX: number;
  velY: number;
  active: boolean;
}

interface ProgrammaticPulse {
  x: number;
  y: number;
  velX: number;
  velY: number;
  remaining: number;
}

interface CachedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class InteractionManager {
  private canvas: HTMLCanvasElement;
  private localTarget: HTMLElement;
  private config: FogInteractionConfig;
  private onActivity?: () => void;

  private currX = 0.5;
  private currY = 0.5;
  private prevX = 0.5;
  private prevY = 0.5;
  private targetX = 0.5;
  private targetY = 0.5;
  private velX = 0;
  private velY = 0;

  private isInside = false;
  private lastMoveTimestamp = 0;
  private attachedTarget: Window | HTMLElement | null = null;
  private pulse: ProgrammaticPulse | null = null;

  private cachedRect: CachedRect | null = null;
  private pendingClientX = 0;
  private pendingClientY = 0;
  private hasPendingMove = false;

  constructor(
    canvas: HTMLCanvasElement,
    config: FogInteractionConfig,
    onActivity?: () => void,
    localTarget?: HTMLElement
  ) {
    this.canvas = canvas;
    this.localTarget = localTarget ?? canvas;
    this.config = { ...config };
    this.onActivity = onActivity;
    this.attach();
  }

  public updateConfig(next: FogInteractionConfig): void {
    const targetChanged =
      this.config.globalEvents !== next.globalEvents ||
      this.config.touchEnabled !== next.touchEnabled ||
      this.config.enabled !== next.enabled;

    this.config = { ...next };

    if (targetChanged) {
      this.detach();
      if (this.config.enabled) {
        this.attach();
      } else {
        this.isInside = false;
        this.hasPendingMove = false;
      }
    }
  }

  /** Invalidates cached canvas rect after resize or scroll; refreshed lazily on next pointer step. */
  public invalidateRect = (): void => {
    this.cachedRect = null;
  };

  /**
   * Injects a synthetic fog disturbance at normalized viewport coordinates (x: 0..1, y: 0..1 from bottom).
   */
  public triggerPulse(
    x: number,
    y: number,
    options: { velX?: number; velY?: number; duration?: number } = {}
  ): void {
    this.pulse = {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      velX: options.velX ?? 0.65,
      velY: options.velY ?? 0.25,
      remaining: Math.max(0.05, options.duration ?? 0.22),
    };
    this.onActivity?.();
  }

  /**
   * Advances pointer interpolation and returns the current frame's wake injection state.
   */
  public step(dt: number): InteractionSnapshot {
    const safeDt = Math.max(0.001, Math.min(dt, 0.05));

    if (this.hasPendingMove) {
      this.hasPendingMove = false;
      if (!this.cachedRect) {
        const r = this.canvas.getBoundingClientRect();
        this.cachedRect = {
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        };
      }
      this.applyClientCoords(
        this.pendingClientX,
        this.pendingClientY,
        this.cachedRect
      );
    }

    // Programmatic pulse takes priority while active
    if (this.pulse) {
      this.pulse.remaining -= safeDt;
      const snapshot: InteractionSnapshot = {
        x: this.pulse.x,
        y: this.pulse.y,
        prevX: this.pulse.x - this.pulse.velX * safeDt * 0.25,
        prevY: this.pulse.y - this.pulse.velY * safeDt * 0.25,
        velX: this.pulse.velX,
        velY: this.pulse.velY,
        active: true,
      };
      if (this.pulse.remaining <= 0) {
        this.pulse = null;
      }
      return snapshot;
    }

    if (!this.config.enabled || !this.isInside) {
      this.velX *= 0.8;
      this.velY *= 0.8;
      return {
        x: this.currX,
        y: this.currY,
        prevX: this.currX,
        prevY: this.currY,
        velX: 0,
        velY: 0,
        active: false,
      };
    }

    // Store previous frame coordinates for continuous ribbon segment stamping
    this.prevX = this.currX;
    this.prevY = this.currY;

    // Frame-rate independent exponential smoothing
    const smooth = 1 - Math.exp(-safeDt * 34);
    this.currX += (this.targetX - this.currX) * smooth;
    this.currY += (this.targetY - this.currY) * smooth;

    const rawVx = (this.currX - this.prevX) / safeDt;
    const rawVy = (this.currY - this.prevY) / safeDt;

    // Clamp spikes on fast flicks
    this.velX = Math.max(-4.0, Math.min(4.0, this.velX * 0.35 + rawVx * 0.65));
    this.velY = Math.max(-4.0, Math.min(4.0, this.velY * 0.35 + rawVy * 0.65));

    // If pointer has stopped moving and velocityInfluence is high, let the wake heal naturally
    const idleMs = performance.now() - this.lastMoveTimestamp;
    const isMoving = Math.hypot(this.velX, this.velY) > 0.015 || idleMs < 90;
    const hoverStillActive = this.config.velocityInfluence < 0.92;

    return {
      x: this.currX,
      y: this.currY,
      prevX: this.prevX,
      prevY: this.prevY,
      velX: this.velX,
      velY: this.velY,
      active: isMoving || hoverStillActive,
    };
  }

  public dispose(): void {
    this.detach();
    this.pulse = null;
    this.cachedRect = null;
  }

  private attach(): void {
    if (!this.config.enabled || typeof window === 'undefined') return;

    const target: Window | HTMLElement = this.config.globalEvents
      ? window
      : this.localTarget;

    this.attachedTarget = target;
    target.addEventListener('pointermove', this.onPointerMove as EventListener, {
      passive: true,
    });
    target.addEventListener('pointerdown', this.onPointerMove as EventListener, {
      passive: true,
    });
    window.addEventListener('scroll', this.invalidateRect, {
      passive: true,
      capture: true,
    });

    if (this.config.globalEvents) {
      window.addEventListener('pointerleave', this.onPointerLeave, {
        passive: true,
      });
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.addEventListener(
          'mouseleave',
          this.onPointerLeave,
          { passive: true }
        );
      }
      window.addEventListener('blur', this.onPointerLeave, { passive: true });
    } else {
      this.localTarget.addEventListener('pointerleave', this.onPointerLeave, {
        passive: true,
      });
    }

    if (this.config.touchEnabled) {
      target.addEventListener('touchstart', this.onTouchMove as EventListener, {
        passive: true,
      });
      target.addEventListener('touchmove', this.onTouchMove as EventListener, {
        passive: true,
      });
      target.addEventListener('touchend', this.onPointerLeave, { passive: true });
      target.addEventListener('touchcancel', this.onPointerLeave, {
        passive: true,
      });
    }
  }

  private detach(): void {
    if (!this.attachedTarget) return;

    const target = this.attachedTarget;
    target.removeEventListener('pointermove', this.onPointerMove as EventListener);
    target.removeEventListener('pointerdown', this.onPointerMove as EventListener);
    target.removeEventListener('touchstart', this.onTouchMove as EventListener);
    target.removeEventListener('touchmove', this.onTouchMove as EventListener);
    target.removeEventListener('touchend', this.onPointerLeave);
    target.removeEventListener('touchcancel', this.onPointerLeave);

    window.removeEventListener('scroll', this.invalidateRect, true);
    window.removeEventListener('pointerleave', this.onPointerLeave);
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.removeEventListener(
        'mouseleave',
        this.onPointerLeave
      );
    }
    window.removeEventListener('blur', this.onPointerLeave);
    this.localTarget.removeEventListener('pointerleave', this.onPointerLeave);

    this.attachedTarget = null;
  }

  private applyClientCoords(
    clientX: number,
    clientY: number,
    rect: CachedRect
  ): void {
    if (rect.width <= 0 || rect.height <= 0) return;

    const u = (clientX - rect.left) / rect.width;
    // Invert Y so 0 = bottom, 1 = top (matching WebGL v_uv)
    const v = 1 - (clientY - rect.top) / rect.height;

    const inBounds = u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05;
    if (!inBounds) {
      this.isInside = false;
      return;
    }

    const clampedU = Math.min(1, Math.max(0, u));
    const clampedV = Math.min(1, Math.max(0, v));

    if (!this.isInside) {
      // Snap prev/curr on fresh entry so we don't draw a giant streak across the screen
      this.currX = clampedU;
      this.currY = clampedV;
      this.prevX = clampedU;
      this.prevY = clampedV;
    }

    this.targetX = clampedU;
    this.targetY = clampedV;
    this.isInside = true;
    this.lastMoveTimestamp = performance.now();
  }

  private queueClientCoords(clientX: number, clientY: number): void {
    this.pendingClientX = clientX;
    this.pendingClientY = clientY;
    this.hasPendingMove = true;
    this.onActivity?.();
  }

  private onPointerMove = (e: PointerEvent): void => {
    // Touch events are handled by touchstart/touchmove listeners to avoid double-processing
    if (e.pointerType === 'touch') return;
    this.queueClientCoords(e.clientX, e.clientY);
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (!this.config.touchEnabled || e.touches.length === 0) return;
    const touch = e.touches[0];
    this.queueClientCoords(touch.clientX, touch.clientY);
  };

  private onPointerLeave = (): void => {
    this.isInside = false;
    this.hasPendingMove = false;
  };
}
