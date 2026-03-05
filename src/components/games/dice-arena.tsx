import { Application, useExtend, useTick } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useCallback, useMemo, useRef, useState } from "react";

interface DiceArenaProps {
  rolling: boolean;
  rollValue: number | null;
  threshold: number;
  direction: "over" | "under";
  outcome: "win" | "loss" | null;
}

const STAGE_WIDTH = 340;
const STAGE_HEIGHT = 214;
const GAUGE_LEFT = 26;
const GAUGE_RIGHT = STAGE_WIDTH - 26;
const GAUGE_WIDTH = GAUGE_RIGHT - GAUGE_LEFT;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

interface Spark {
  x: number;
  y: number;
  size: number;
  seed: number;
  hue: "cool" | "warm";
}

function statusTone(status: "ready" | "rolling" | "win" | "loss"): string {
  if (status === "win") {
    return "arena-pill-win";
  }
  if (status === "loss") {
    return "arena-pill-loss";
  }
  if (status === "rolling") {
    return "arena-pill-live";
  }
  return "arena-pill-neutral";
}

export function DiceArena({ rolling, rollValue, threshold, direction, outcome }: DiceArenaProps) {
  useExtend({ Container, Graphics, Text });

  const thresholdClamped = clamp(Math.floor(threshold), 2, 98);
  const effectiveRoll = rollValue !== null ? clampInt(rollValue, 0, 99) : null;
  const status: "ready" | "rolling" | "win" | "loss" = rolling
    ? "rolling"
    : outcome === "win"
      ? "win"
      : outcome === "loss"
        ? "loss"
        : "ready";

  return (
    <div className="dice-arena-shell arena-shell">
      <div className="dice-arena-canvas">
        <Application width={STAGE_WIDTH} height={STAGE_HEIGHT} antialias backgroundAlpha={0}>
          <DiceArenaScene
            rolling={rolling}
            rollValue={rollValue}
            threshold={thresholdClamped}
            direction={direction}
            outcome={outcome}
          />
        </Application>
      </div>
      <div className="arena-hud arena-hud-dice">
        <span className="arena-pill arena-pill-info">
          {direction.toUpperCase()} {thresholdClamped}
        </span>
        <span className="arena-pill arena-pill-neutral">
          {effectiveRoll !== null ? `ROLL ${effectiveRoll}` : "ROLL --"}
        </span>
        <span className={`arena-pill ${statusTone(status)}`}>{status.toUpperCase()}</span>
      </div>
    </div>
  );
}

interface DiceArenaSceneProps {
  rolling: boolean;
  rollValue: number | null;
  threshold: number;
  direction: "over" | "under";
  outcome: "win" | "loss" | null;
}

function DiceArenaScene({ rolling, rollValue, threshold, direction, outcome }: DiceArenaSceneProps) {
  const [rollingNumber, setRollingNumber] = useState(50);
  const [tilt, setTilt] = useState(0);
  const [scale, setScale] = useState(1);
  const [sparkPhase, setSparkPhase] = useState(0);

  const rollAccumulator = useRef(0);
  const frameAccumulator = useRef(0);
  const elapsed = useRef(0);

  const sparks = useMemo<Spark[]>(
    () =>
      Array.from({ length: 20 }, (_, index) => ({
        x: 24 + ((index * 17) % (STAGE_WIDTH - 48)),
        y: 16 + ((index * 29) % (STAGE_HEIGHT - 48)),
        size: 1.4 + (index % 3),
        seed: index * 0.71,
        hue: index % 2 === 0 ? "cool" : "warm",
      })),
    [],
  );

  useTick((ticker) => {
    const deltaMs = ticker.deltaMS;
    elapsed.current += deltaMs;
    frameAccumulator.current += deltaMs;
    rollAccumulator.current += deltaMs;

    if (frameAccumulator.current < 32) {
      return;
    }
    frameAccumulator.current = 0;

    if (rolling && rollAccumulator.current >= 60) {
      rollAccumulator.current = 0;
      setRollingNumber(Math.floor(Math.random() * 100));
    }

    const time = elapsed.current / 1000;
    if (rolling) {
      setTilt(Math.sin(time * 17) * 0.28);
      setScale(1 + Math.sin(time * 24) * 0.06);
      setSparkPhase((previous) => (previous + 0.85) % 1000);
      return;
    }

    setTilt((previous) => previous * 0.76);
    setScale((previous) => previous + (1 - previous) * 0.26);
    setSparkPhase((previous) => (previous + 0.2) % 1000);
  });

  const effectiveRoll = clampInt(rolling ? rollingNumber : (rollValue ?? rollingNumber), 0, 99);
  const thresholdX = GAUGE_LEFT + (threshold / 100) * GAUGE_WIDTH;
  const rollX = GAUGE_LEFT + (effectiveRoll / 100) * GAUGE_WIDTH;

  const accent =
    outcome === "win" ? 0x22c55e : outcome === "loss" ? 0xf43f5e : direction === "over" ? 0x38bdf8 : 0xa78bfa;

  const drawBackdrop = useCallback((graphics: Graphics) => {
    graphics.clear();
    graphics.setFillStyle({ color: 0x05101d, alpha: 0.95 });
    graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
    graphics.fill();

    graphics.setFillStyle({ color: 0x0e2238, alpha: 0.34 });
    graphics.circle(70, 48, 86);
    graphics.fill();

    graphics.setFillStyle({ color: 0x21103e, alpha: 0.3 });
    graphics.circle(STAGE_WIDTH - 54, 44, 92);
    graphics.fill();
  }, []);

  const drawPulse = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const pulseRadius = 74 + Math.sin(sparkPhase * 0.08) * 8;
      graphics.setStrokeStyle({
        color: accent,
        width: 2.6,
        alpha: rolling ? 0.48 : 0.24,
      });
      graphics.circle(STAGE_WIDTH / 2, 88, pulseRadius);
      graphics.stroke();
    },
    [accent, rolling, sparkPhase],
  );

  const drawSparkles = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      for (const spark of sparks) {
        const wobble = Math.sin(spark.seed + sparkPhase * 0.08);
        const float = Math.cos(spark.seed * 1.4 + sparkPhase * 0.06);
        const alpha = (rolling ? 0.2 : 0.1) + Math.abs(wobble) * (rolling ? 0.32 : 0.12);
        const color = spark.hue === "cool" ? 0x67e8f9 : 0xfcd34d;

        graphics.setFillStyle({ color, alpha });
        graphics.circle(spark.x + wobble * 9, spark.y + float * 6, spark.size + Math.abs(float) * 1.8);
        graphics.fill();
      }
    },
    [rolling, sparkPhase, sparks],
  );

  const drawGauge = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setFillStyle({ color: 0x0b1728, alpha: 0.94 });
      graphics.roundRect(GAUGE_LEFT - 10, STAGE_HEIGHT - 56, GAUGE_WIDTH + 20, 30, 13);
      graphics.fill();

      graphics.setStrokeStyle({ color: 0x334155, width: 1.2, alpha: 0.7 });
      graphics.roundRect(GAUGE_LEFT - 10, STAGE_HEIGHT - 56, GAUGE_WIDTH + 20, 30, 13);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0x475569, width: 3, alpha: 0.65 });
      graphics.moveTo(GAUGE_LEFT, STAGE_HEIGHT - 41);
      graphics.lineTo(GAUGE_RIGHT, STAGE_HEIGHT - 41);
      graphics.stroke();

      graphics.setStrokeStyle({ color: accent, width: 2.8, alpha: 0.95 });
      graphics.moveTo(thresholdX, STAGE_HEIGHT - 52);
      graphics.lineTo(thresholdX, STAGE_HEIGHT - 30);
      graphics.stroke();

      graphics.setFillStyle({ color: 0xe2e8f0, alpha: 0.98 });
      graphics.circle(rollX, STAGE_HEIGHT - 41, 5.8);
      graphics.fill();

      graphics.setStrokeStyle({ color: 0x0f172a, width: 1.2, alpha: 0.85 });
      graphics.circle(rollX, STAGE_HEIGHT - 41, 5.8);
      graphics.stroke();
    },
    [accent, rollX, thresholdX],
  );

  const drawGlow = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: accent, alpha: rolling ? 0.28 : 0.16 });
      graphics.circle(0, 0, 78);
      graphics.fill();
    },
    [accent, rolling],
  );

  const drawDie = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setFillStyle({ color: 0xf8fafc, alpha: 0.98 });
      graphics.roundRect(-52, -52, 104, 104, 19);
      graphics.fill();

      graphics.setStrokeStyle({ color: accent, width: 4, alpha: 0.88 });
      graphics.roundRect(-52, -52, 104, 104, 19);
      graphics.stroke();
    },
    [accent],
  );

  return (
    <>
      <pixiGraphics draw={drawBackdrop} />
      <pixiGraphics draw={drawSparkles} />
      <pixiGraphics draw={drawPulse} />
      <pixiGraphics draw={drawGauge} />
      <pixiContainer x={STAGE_WIDTH / 2} y={88} rotation={tilt} scale={scale}>
        <pixiGraphics draw={drawGlow} />
        <pixiGraphics draw={drawDie} />
        <pixiText
          x={0}
          y={6}
          anchor={0.5}
          text={String(effectiveRoll)}
          style={{
            fill: "#0f172a",
            fontFamily: "Space Grotesk",
            fontWeight: "800",
            fontSize: 48,
          }}
        />
      </pixiContainer>
    </>
  );
}
