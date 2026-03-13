import { Application, useExtend, useTick } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playGameSfx } from "./shared/game-audio";
import {
  createParticlePool,
  drawParticlePool,
  emitParticleBurst,
  updateParticlePool,
} from "./shared/particles";
import { useArenaVisibility } from "./shared/use-arena-visibility";

interface WheelArenaProps {
  spinning: boolean;
  segmentIndex: number | null;
  label: string | null;
  outcome: "win" | "loss" | null;
  multiplier: number | null;
  payout: number | null;
}

const STAGE_WIDTH = 340;
const STAGE_HEIGHT = 224;
const CENTER_X = STAGE_WIDTH / 2;
const CENTER_Y = 114;
const WHEEL_RADIUS = 84;
const TAU = Math.PI * 2;

const SEGMENTS = [
  { weight: 40, multiplier: 0, label: "LOSE", color: 0x7f1d1d },
  { weight: 25, multiplier: 1.1, label: "1.1x", color: 0x1e3a8a },
  { weight: 15, multiplier: 1.4, label: "1.4x", color: 0x0369a1 },
  { weight: 12, multiplier: 1.8, label: "1.8x", color: 0x0f766e },
  { weight: 6, multiplier: 2.5, label: "2.5x", color: 0x92400e },
  { weight: 2, multiplier: 5, label: "5.0x", color: 0x7c2d12 },
] as const;

const TOTAL_WEIGHT = SEGMENTS.reduce((sum, segment) => sum + segment.weight, 0);

interface WheelLayout {
  index: number;
  label: string;
  start: number;
  end: number;
  mid: number;
  color: number;
}

interface WheelFrame {
  rotation: number;
  velocity: number;
  pulse: number;
  glow: number;
  impact: number;
  drift: number;
}

function normalizeAngle(value: number): number {
  let angle = value % TAU;
  if (angle > Math.PI) {
    angle -= TAU;
  } else if (angle < -Math.PI) {
    angle += TAU;
  }
  return angle;
}

function statusTone(status: "ready" | "spinning" | "win" | "loss"): string {
  if (status === "win") {
    return "arena-pill-win";
  }
  if (status === "loss") {
    return "arena-pill-loss";
  }
  if (status === "spinning") {
    return "arena-pill-live";
  }
  return "arena-pill-neutral";
}

export function WheelArena({
  spinning,
  segmentIndex,
  label,
  outcome,
  multiplier,
  payout,
}: WheelArenaProps) {
  useExtend({ Container, Graphics, Text });
  const { hostRef, isNearViewport, stageReady } = useArenaVisibility();
  const previousSpinningRef = useRef(spinning);

  useEffect(() => {
    if (spinning && !previousSpinningRef.current) {
      playGameSfx("wheel-spin");
    }
    if (!spinning && previousSpinningRef.current && outcome) {
      playGameSfx("wheel-stop");
      if (outcome === "win") {
        playGameSfx("reward-pop", { intensity: 1.14 });
      }
    }
    previousSpinningRef.current = spinning;
  }, [outcome, spinning]);

  const status: "ready" | "spinning" | "win" | "loss" = spinning
    ? "spinning"
    : outcome === "win"
      ? "win"
      : outcome === "loss"
        ? "loss"
        : "ready";

  return (
    <div className="wheel-arena-shell arena-shell">
      <div className="wheel-arena-canvas" ref={hostRef}>
        {stageReady ? (
          <Application width={STAGE_WIDTH} height={STAGE_HEIGHT} antialias backgroundAlpha={0}>
            <WheelArenaScene
              animate={isNearViewport}
              spinning={spinning}
              segmentIndex={segmentIndex}
              label={label}
              outcome={outcome}
              multiplier={multiplier}
            />
          </Application>
        ) : (
          <div className="arena-canvas-fallback">WHEEL LOADING...</div>
        )}
      </div>
      <div className="arena-hud arena-hud-wheel">
        <span className="arena-pill arena-pill-info">
          {label ? `LANDED ${label}` : "LANDED --"}
        </span>
        <span className="arena-pill arena-pill-neutral">
          {multiplier !== null ? `MULT ${multiplier.toFixed(2)}x` : "MULT --"}
        </span>
        <span className="arena-pill arena-pill-neutral">
          {payout !== null ? `PAYOUT ${payout.toFixed(2)}` : "PAYOUT --"}
        </span>
        <span className={`arena-pill ${statusTone(status)}`}>
          {status.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

interface WheelArenaSceneProps {
  animate: boolean;
  spinning: boolean;
  segmentIndex: number | null;
  label: string | null;
  outcome: "win" | "loss" | null;
  multiplier: number | null;
}

function WheelArenaScene({
  animate,
  spinning,
  segmentIndex,
  label,
  outcome,
  multiplier,
}: WheelArenaSceneProps) {
  const [frame, setFrame] = useState<WheelFrame>({
    rotation: 0,
    velocity: 0.1,
    pulse: 0,
    glow: 0,
    impact: 0,
    drift: 0,
  });
  const previousSpinningRef = useRef(spinning);
  const particlePoolRef = useRef(createParticlePool(120));
  const impactBoostRef = useRef(0);

  const wheelLayout = useMemo<WheelLayout[]>(() => {
    const spans = SEGMENTS.map((segment) => (segment.weight / TOTAL_WEIGHT) * TAU);
    return SEGMENTS.map((segment, index) => {
      const start =
        -Math.PI / 2 +
        spans.slice(0, index).reduce((total, current) => total + current, 0);
      const end = start + spans[index];
      const mid = (start + end) / 2;
      return {
        index,
        label: segment.label,
        start,
        end,
        mid,
        color: segment.color,
      };
    });
  }, []);

  useEffect(() => {
    if (
      previousSpinningRef.current &&
      !spinning &&
      segmentIndex !== null &&
      wheelLayout[segmentIndex]
    ) {
      const target = wheelLayout[segmentIndex];
      const x = CENTER_X + Math.cos(target.mid + frame.rotation) * 88;
      const y = CENTER_Y + Math.sin(target.mid + frame.rotation) * 88;
      emitParticleBurst(particlePoolRef.current, {
        x,
        y,
        count: outcome === "win" ? 32 : 18,
        colors:
          outcome === "win"
            ? [0x86efac, 0xfef08a, 0xf8fafc]
            : [0xfda4af, 0xf8fafc, 0xfcd34d],
        speedMin: 2.7,
        speedMax: outcome === "win" ? 11.8 : 8.5,
        radiusMin: 1.4,
        radiusMax: 4.6,
        lifeMinMs: 220,
        lifeMaxMs: 820,
        gravity: 0.1,
      });
      impactBoostRef.current = 1;
    }
    previousSpinningRef.current = spinning;
  }, [frame.rotation, outcome, segmentIndex, spinning, wheelLayout]);

  useTick((ticker) => {
    if (!animate) {
      return;
    }
    const step = Math.min(2.4, ticker.deltaMS / 16.666);
    const justStartedSpinning = spinning && !previousSpinningRef.current;
    updateParticlePool(particlePoolRef.current, ticker.deltaMS);

    setFrame((previous) => {
      let rotation = previous.rotation;
      let velocity = justStartedSpinning
        ? 0.34 + Math.random() * 0.08
        : previous.velocity;
      let impact = previous.impact;
      const pulse = previous.pulse + ticker.deltaMS * 0.012;
      const glow = previous.glow + ticker.deltaMS * 0.02;
      const drift = previous.drift + ticker.deltaMS * 0.003;

      if (impactBoostRef.current > 0) {
        impact = Math.max(impact, impactBoostRef.current);
        impactBoostRef.current *= 0.82;
        if (impactBoostRef.current < 0.02) {
          impactBoostRef.current = 0;
        }
      }

      if (spinning) {
        velocity = Math.min(0.66, velocity + 0.006 * step);
        rotation += velocity * step;
        impact = Math.max(0.15, impact * 0.84);
      } else if (segmentIndex !== null && wheelLayout[segmentIndex]) {
        const targetSegment = wheelLayout[segmentIndex];
        const desiredRotation = -Math.PI / 2 - targetSegment.mid;
        const diff = normalizeAngle(desiredRotation - rotation);
        velocity *= 0.85;
        rotation += diff * (0.18 * step) + velocity * 0.1 * step;
        impact = Math.max(0, impact - 0.05);
      } else {
        velocity *= 0.93;
        rotation += 0.01 * step;
        impact = Math.max(0, impact - 0.03);
      }

      return {
        rotation,
        velocity,
        pulse,
        glow,
        impact,
        drift,
      };
    });

    previousSpinningRef.current = spinning;
  });

  const accent =
    outcome === "win" ? 0x22c55e : outcome === "loss" ? 0xf43f5e : 0xf97316;
  const centerMain = spinning ? "SPIN..." : (label ?? "READY");
  const centerSub =
    multiplier !== null ? `${multiplier.toFixed(2)}x` : spinning ? "HOLD" : "TAP SPIN";

  const labelPositions = useMemo(
    () =>
      wheelLayout.map((segment) => {
        const angle = segment.mid + frame.rotation;
        return {
          key: `${segment.index}-${segment.label}`,
          x: Math.cos(angle) * 56,
          y: Math.sin(angle) * 56,
          text: segment.label,
        };
      }),
    [frame.rotation, wheelLayout],
  );

  const drawBackdrop = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0x0d1022, alpha: 0.96 });
      graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
      graphics.fill();

      graphics.setFillStyle({ color: 0x39142f, alpha: 0.3 });
      graphics.circle(52, 48, 94);
      graphics.fill();

      graphics.setFillStyle({ color: 0x102c47, alpha: 0.26 });
      graphics.circle(STAGE_WIDTH - 56, 52, 92);
      graphics.fill();

      for (let index = 0; index < 18; index += 1) {
        const x =
          (index * 29 + frame.drift * (index % 3 === 0 ? 24 : 12)) % STAGE_WIDTH;
        const y = 20 + ((index * 13) % (STAGE_HEIGHT - 40));
        graphics.setFillStyle({
          color: 0xf8fafc,
          alpha: 0.03 + (index % 4) * 0.015,
        });
        graphics.circle(x, y, 0.8 + (index % 2));
        graphics.fill();
      }
    },
    [frame.drift],
  );

  const drawPulse = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const radius = 90 + Math.sin(frame.pulse * 0.12) * 8 + frame.impact * 12;
      graphics.setStrokeStyle({
        color: accent,
        width: 2.6 + frame.impact * 1.2,
        alpha: spinning ? 0.52 : 0.24 + frame.impact * 0.2,
      });
      graphics.circle(CENTER_X, CENTER_Y, radius);
      graphics.stroke();
    },
    [accent, frame.impact, frame.pulse, spinning],
  );

  const drawWheel = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      for (const segment of wheelLayout) {
        const start = segment.start + frame.rotation;
        const end = segment.end + frame.rotation;

        graphics.setFillStyle({ color: segment.color, alpha: 0.92 });
        graphics.moveTo(0, 0);
        graphics.arc(0, 0, WHEEL_RADIUS, start, end);
        graphics.closePath();
        graphics.fill();

        graphics.setStrokeStyle({ color: 0x020617, width: 2, alpha: 0.86 });
        graphics.moveTo(0, 0);
        graphics.arc(0, 0, WHEEL_RADIUS, start, end);
        graphics.closePath();
        graphics.stroke();
      }

      graphics.setStrokeStyle({
        color: 0xe2e8f0,
        width: 4 + frame.impact * 2,
        alpha: 0.92,
      });
      graphics.circle(0, 0, WHEEL_RADIUS + 2);
      graphics.stroke();

      if (segmentIndex !== null && wheelLayout[segmentIndex]) {
        const chosen = wheelLayout[segmentIndex];
        const start = chosen.start + frame.rotation;
        const end = chosen.end + frame.rotation;
        graphics.setStrokeStyle({
          color:
            outcome === "win"
              ? 0x22c55e
              : outcome === "loss"
                ? 0xf43f5e
                : 0xfbbf24,
          width: 6 + frame.impact * 2.2,
          alpha: 0.92,
        });
        graphics.arc(0, 0, WHEEL_RADIUS + 6, start, end);
        graphics.stroke();
      }
    },
    [frame.impact, frame.rotation, outcome, segmentIndex, wheelLayout],
  );

  const drawCenter = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0x020617, alpha: 0.94 });
      graphics.circle(0, 0, 33 + frame.impact * 1.8);
      graphics.fill();

      graphics.setStrokeStyle({
        color: 0xe2e8f0,
        width: 2.6 + frame.impact,
        alpha: 0.78 + frame.impact * 0.1,
      });
      graphics.circle(0, 0, 33 + frame.impact * 1.8);
      graphics.stroke();
    },
    [frame.impact],
  );

  const drawPointer = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const pointerY = 16 - frame.impact * 2.4;
      graphics.setFillStyle({ color: accent, alpha: 0.95 });
      graphics.moveTo(CENTER_X, pointerY);
      graphics.lineTo(CENTER_X - 12, pointerY + 24);
      graphics.lineTo(CENTER_X + 12, pointerY + 24);
      graphics.closePath();
      graphics.fill();

      graphics.setFillStyle({ color: 0xf8fafc, alpha: 0.95 });
      graphics.circle(CENTER_X, pointerY + 24, 5.5 + frame.impact * 1.4);
      graphics.fill();
    },
    [accent, frame.impact],
  );

  const drawParticles = useCallback((graphics: Graphics) => {
    graphics.clear();
    drawParticlePool(graphics, particlePoolRef.current);
  }, []);

  return (
    <>
      <pixiGraphics draw={drawBackdrop} />
      <pixiGraphics draw={drawPulse} />
      <pixiContainer x={CENTER_X} y={CENTER_Y} scale={1 + frame.impact * 0.02}>
        <pixiGraphics draw={drawWheel} />
        {labelPositions.map((entry) => (
          <pixiText
            key={entry.key}
            x={entry.x}
            y={entry.y}
            anchor={0.5}
            text={entry.text}
            style={{
              fill: "#f8fafc",
              fontFamily: "Space Grotesk",
              fontWeight: "700",
              fontSize: 12,
            }}
          />
        ))}
        <pixiGraphics draw={drawCenter} />
        <pixiText
          x={0}
          y={-7}
          anchor={0.5}
          text={centerMain}
          style={{
            fill: "#f8fafc",
            fontFamily: "Space Grotesk",
            fontWeight: "800",
            fontSize: 13 + frame.impact * 1.4,
            align: "center",
          }}
        />
        <pixiText
          x={0}
          y={13}
          anchor={0.5}
          text={centerSub}
          style={{
            fill: "#cbd5e1",
            fontFamily: "IBM Plex Mono",
            fontWeight: "600",
            fontSize: 11,
            align: "center",
          }}
        />
      </pixiContainer>
      <pixiGraphics draw={drawPointer} />
      <pixiGraphics draw={drawParticles} />
    </>
  );
}
