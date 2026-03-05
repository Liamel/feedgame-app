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

export function DiceArena({ rolling, rollValue, threshold, direction, outcome }: DiceArenaProps) {
  useExtend({ Container, Graphics, Text });

  const thresholdClamped = clamp(Math.floor(threshold), 2, 98);
  const effectiveRoll = rollValue !== null ? clampInt(rollValue, 0, 99) : null;

  return (
    <div className="dice-arena-shell">
      <div className="dice-arena-overlay">
        <span>
          {direction.toUpperCase()} {thresholdClamped}
        </span>
        <span>ROLL {effectiveRoll !== null ? effectiveRoll : "--"}</span>
      </div>
      <div className="dice-arena-overlay dice-arena-bottom">
        <span>
          Target {direction === "over" ? ">" : "<"} {thresholdClamped}
        </span>
        <span>{rolling ? "Rolling..." : outcome === "win" ? "Win" : outcome === "loss" ? "Loss" : "Ready"}</span>
      </div>
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
      Array.from({ length: 18 }, (_, index) => ({
        x: 30 + ((index * 17) % (STAGE_WIDTH - 60)),
        y: 24 + ((index * 31) % (STAGE_HEIGHT - 72)),
        size: 1.5 + (index % 3),
        seed: index * 0.73,
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

    if (rolling && rollAccumulator.current >= 64) {
      rollAccumulator.current = 0;
      setRollingNumber(Math.floor(Math.random() * 100));
    }

    const time = elapsed.current / 1000;
    if (rolling) {
      setTilt(Math.sin(time * 17) * 0.28);
      setScale(1 + Math.sin(time * 24) * 0.06);
      setSparkPhase((previous) => (previous + 0.7) % 1000);
      return;
    }

    setTilt((previous) => previous * 0.76);
    setScale((previous) => previous + (1 - previous) * 0.26);
    setSparkPhase((previous) => (previous + 0.18) % 1000);
  });

  const effectiveRoll = clampInt(rolling ? rollingNumber : (rollValue ?? rollingNumber), 0, 99);
  const thresholdX = GAUGE_LEFT + (threshold / 100) * GAUGE_WIDTH;
  const rollX = GAUGE_LEFT + (effectiveRoll / 100) * GAUGE_WIDTH;

  const accent =
    outcome === "win" ? 0x22c55e : outcome === "loss" ? 0xf43f5e : direction === "over" ? 0x38bdf8 : 0xa78bfa;

  const drawBackdrop = useCallback((graphics: Graphics) => {
    graphics.clear();
    graphics.setFillStyle({ color: 0x05101d, alpha: 0.92 });
    graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
    graphics.fill();

    graphics.setStrokeStyle({ color: 0x334155, width: 1.5, alpha: 0.55 });
    graphics.roundRect(1, 1, STAGE_WIDTH - 2, STAGE_HEIGHT - 2, 15);
    graphics.stroke();
  }, []);

  const drawSparkles = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      for (const spark of sparks) {
        const wobble = Math.sin(spark.seed + sparkPhase * 0.08);
        const float = Math.cos(spark.seed * 1.4 + sparkPhase * 0.06);
        const alpha = (rolling ? 0.18 : 0.09) + Math.abs(wobble) * (rolling ? 0.32 : 0.14);
        const color = spark.hue === "cool" ? 0x67e8f9 : 0xfcd34d;

        graphics.setFillStyle({ color, alpha });
        graphics.circle(spark.x + wobble * 8, spark.y + float * 6, spark.size + Math.abs(float) * 1.8);
        graphics.fill();
      }
    },
    [rolling, sparkPhase, sparks],
  );

  const drawGauge = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setFillStyle({ color: 0x0b1728, alpha: 0.95 });
      graphics.roundRect(GAUGE_LEFT - 8, STAGE_HEIGHT - 56, GAUGE_WIDTH + 16, 28, 12);
      graphics.fill();

      graphics.setStrokeStyle({ color: 0x334155, width: 1.2, alpha: 0.7 });
      graphics.roundRect(GAUGE_LEFT - 8, STAGE_HEIGHT - 56, GAUGE_WIDTH + 16, 28, 12);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0x475569, width: 3, alpha: 0.65 });
      graphics.moveTo(GAUGE_LEFT, STAGE_HEIGHT - 42);
      graphics.lineTo(GAUGE_RIGHT, STAGE_HEIGHT - 42);
      graphics.stroke();

      graphics.setStrokeStyle({ color: accent, width: 2.8, alpha: 0.95 });
      graphics.moveTo(thresholdX, STAGE_HEIGHT - 52);
      graphics.lineTo(thresholdX, STAGE_HEIGHT - 32);
      graphics.stroke();

      graphics.setFillStyle({ color: 0xe2e8f0, alpha: 0.95 });
      graphics.circle(rollX, STAGE_HEIGHT - 42, 5.5);
      graphics.fill();

      graphics.setStrokeStyle({ color: 0x0f172a, width: 1.4, alpha: 0.8 });
      graphics.circle(rollX, STAGE_HEIGHT - 42, 5.5);
      graphics.stroke();
    },
    [accent, rollX, thresholdX],
  );

  const drawGlow = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: accent, alpha: rolling ? 0.24 : 0.16 });
      graphics.circle(0, 0, 74);
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

      graphics.setStrokeStyle({ color: accent, width: 4, alpha: 0.84 });
      graphics.roundRect(-52, -52, 104, 104, 19);
      graphics.stroke();
    },
    [accent],
  );

  return (
    <>
      <pixiGraphics draw={drawBackdrop} />
      <pixiGraphics draw={drawSparkles} />
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
      <pixiText
        x={14}
        y={12}
        text="DICE ARENA"
        style={{
          fill: "#cbd5e1",
          fontFamily: "IBM Plex Mono",
          fontWeight: "600",
          fontSize: 11,
          letterSpacing: 2,
        }}
      />
    </>
  );
}
