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

interface DiceArenaProps {
  rolling: boolean;
  rollValue: number | null;
  threshold: number;
  direction: "over" | "under";
  outcome: "win" | "loss" | null;
}

const STAGE_WIDTH = 360;
const STAGE_HEIGHT = 392;
const GAUGE_LEFT = 24;
const GAUGE_RIGHT = STAGE_WIDTH - 24;
const GAUGE_WIDTH = GAUGE_RIGHT - GAUGE_LEFT;
const DIE_CENTER_X = STAGE_WIDTH / 2;
const DIE_CENTER_Y = 160;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

interface Spark {
  orbitX: number;
  orbitY: number;
  radius: number;
  drift: number;
  seed: number;
  hue: "cyan" | "amber" | "rose";
}

interface DiceFrame {
  rollingNumber: number;
  tilt: number;
  scale: number;
  spin: number;
  sparkPhase: number;
  shakeX: number;
  shakeY: number;
  burst: number;
  impactFlash: number;
  drift: number;
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

export function DiceArena({
  rolling,
  rollValue,
  threshold,
  direction,
  outcome,
}: DiceArenaProps) {
  useExtend({ Container, Graphics, Text });
  const { hostRef, isNearViewport, stageReady } = useArenaVisibility();
  const previousRollingRef = useRef(rolling);

  useEffect(() => {
    if (rolling && !previousRollingRef.current) {
      playGameSfx("dice-roll");
    }
    if (!rolling && previousRollingRef.current && outcome) {
      playGameSfx(outcome === "win" ? "dice-win" : "dice-loss");
    }
    previousRollingRef.current = rolling;
  }, [outcome, rolling]);

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
      <div className="dice-arena-canvas" ref={hostRef}>
        {stageReady ? (
          <Application width={STAGE_WIDTH} height={STAGE_HEIGHT} antialias backgroundAlpha={0}>
            <DiceArenaScene
              animate={isNearViewport}
              rolling={rolling}
              rollValue={rollValue}
              threshold={thresholdClamped}
              direction={direction}
              outcome={outcome}
            />
          </Application>
        ) : (
          <div className="arena-canvas-fallback">DICE LOADING...</div>
        )}
      </div>
      <div className="arena-hud arena-hud-dice">
        <span className="arena-pill arena-pill-info">
          {direction.toUpperCase()} {thresholdClamped}
        </span>
        <span className="arena-pill arena-pill-neutral">
          {effectiveRoll !== null ? `ROLL ${effectiveRoll}` : "ROLL --"}
        </span>
        <span className={`arena-pill ${statusTone(status)}`}>
          {status.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

interface DiceArenaSceneProps {
  animate: boolean;
  rolling: boolean;
  rollValue: number | null;
  threshold: number;
  direction: "over" | "under";
  outcome: "win" | "loss" | null;
}

function DiceArenaScene({
  animate,
  rolling,
  rollValue,
  threshold,
  direction,
  outcome,
}: DiceArenaSceneProps) {
  const [frame, setFrame] = useState<DiceFrame>({
    rollingNumber: 50,
    tilt: 0,
    scale: 1,
    spin: 0,
    sparkPhase: 0,
    shakeX: 0,
    shakeY: 0,
    burst: 0,
    impactFlash: 0,
    drift: 0,
  });

  const rollAccumulatorRef = useRef(0);
  const elapsedRef = useRef(0);
  const burstBoostRef = useRef(0);
  const impactBoostRef = useRef(0);
  const previousOutcomeRef = useRef<"win" | "loss" | null>(null);
  const particlePoolRef = useRef(createParticlePool(132));

  const sparks = useMemo<Spark[]>(
    () =>
      Array.from({ length: 54 }, (_, index) => ({
        orbitX: 18 + ((index * 11) % (STAGE_WIDTH - 36)),
        orbitY: 22 + ((index * 19) % (STAGE_HEIGHT - 84)),
        radius: 1.1 + (index % 4) * 0.9,
        drift: 3 + (index % 7),
        seed: index * 0.58,
        hue: index % 3 === 0 ? "cyan" : index % 3 === 1 ? "amber" : "rose",
      })),
    [],
  );

  useEffect(() => {
    if (!rolling && outcome && previousOutcomeRef.current !== outcome) {
      burstBoostRef.current = 1;
      impactBoostRef.current = 1;
      emitParticleBurst(particlePoolRef.current, {
        x: DIE_CENTER_X,
        y: DIE_CENTER_Y,
        count: outcome === "win" ? 40 : 24,
        colors:
          outcome === "win"
            ? [0x86efac, 0xfef08a, 0xf8fafc]
            : [0xfda4af, 0xfecaca, 0xf8fafc],
        speedMin: 2.8,
        speedMax: outcome === "win" ? 12.8 : 8.8,
        radiusMin: 1.2,
        radiusMax: 4.4,
        lifeMinMs: 260,
        lifeMaxMs: 880,
        gravity: 0.09,
      });
    }

    if (rolling) {
      previousOutcomeRef.current = null;
    } else {
      previousOutcomeRef.current = outcome;
    }
  }, [outcome, rolling]);

  useTick((ticker) => {
    if (!animate) {
      return;
    }
    const deltaMs = ticker.deltaMS;
    elapsedRef.current += deltaMs;
    rollAccumulatorRef.current += deltaMs;
    updateParticlePool(particlePoolRef.current, deltaMs);

    setFrame((previous) => {
      const time = elapsedRef.current / 1000;
      let rollingNumber = previous.rollingNumber;
      let tilt = previous.tilt;
      let spin = previous.spin;
      let scale = previous.scale;
      let sparkPhase = previous.sparkPhase;
      let shakeX = previous.shakeX;
      let shakeY = previous.shakeY;
      let burst = previous.burst;
      let impactFlash = previous.impactFlash;
      const drift = previous.drift + deltaMs * 0.0028;

      if (rolling && rollAccumulatorRef.current >= 44) {
        rollAccumulatorRef.current = 0;
        rollingNumber = Math.floor(Math.random() * 100);
      }

      if (rolling) {
        tilt = Math.sin(time * 13) * 0.5;
        spin += 0.37;
        scale = 1.1 + Math.sin(time * 22) * 0.1;
        sparkPhase = (sparkPhase + 1.7) % 4000;
        shakeX = (Math.random() - 0.5) * 12;
        shakeY = (Math.random() - 0.5) * 12;
      } else {
        const settleJitter = impactBoostRef.current * 12;
        tilt *= 0.78;
        spin *= 0.9;
        scale += (1 - scale) * 0.26;
        sparkPhase = (sparkPhase + 0.35) % 4000;
        shakeX = shakeX * 0.52 + (Math.random() - 0.5) * settleJitter;
        shakeY = shakeY * 0.52 + (Math.random() - 0.5) * settleJitter;
      }

      if (burstBoostRef.current > 0) {
        burst = Math.max(burst, burstBoostRef.current);
        burstBoostRef.current *= 0.84;
        if (burstBoostRef.current < 0.02) {
          burstBoostRef.current = 0;
        }
      }
      burst = rolling ? Math.max(burst, 0.2) : Math.max(0, burst - 0.034);

      if (impactBoostRef.current > 0) {
        impactFlash = Math.max(impactFlash, impactBoostRef.current);
        impactBoostRef.current *= 0.79;
        if (impactBoostRef.current < 0.02) {
          impactBoostRef.current = 0;
        }
      }
      impactFlash = rolling
        ? Math.max(impactFlash - 0.02, 0)
        : Math.max(impactFlash - 0.06, 0);

      return {
        rollingNumber,
        tilt,
        scale,
        spin,
        sparkPhase,
        shakeX,
        shakeY,
        burst,
        impactFlash,
        drift,
      };
    });
  });

  const effectiveRoll = clampInt(
    rolling ? frame.rollingNumber : (rollValue ?? frame.rollingNumber),
    0,
    99,
  );
  const thresholdX = GAUGE_LEFT + (threshold / 100) * GAUGE_WIDTH;
  const rollX = GAUGE_LEFT + (effectiveRoll / 100) * GAUGE_WIDTH;

  const accent =
    outcome === "win"
      ? 0x22c55e
      : outcome === "loss"
        ? 0xf43f5e
        : direction === "over"
          ? 0x38bdf8
          : 0xa78bfa;

  const drawBackdrop = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0x040e1b, alpha: 0.97 });
      graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
      graphics.fill();

      graphics.setFillStyle({ color: 0x0d2e4a, alpha: 0.28 });
      graphics.circle(66, 58, 112);
      graphics.fill();

      graphics.setFillStyle({ color: 0x2b123d, alpha: 0.24 });
      graphics.circle(STAGE_WIDTH - 52, 62, 116);
      graphics.fill();

      for (let index = 0; index < 22; index += 1) {
        const x = (index * 21 + frame.drift * (index % 2 === 0 ? 20 : 10)) % STAGE_WIDTH;
        const y = 18 + ((index * 17) % (STAGE_HEIGHT - 50));
        graphics.setFillStyle({
          color: 0xf8fafc,
          alpha: 0.03 + (index % 4) * 0.018,
        });
        graphics.circle(x, y, 0.8 + (index % 3) * 0.35);
        graphics.fill();
      }
    },
    [frame.drift],
  );

  const drawPulse = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const pulseRadius = 124 + Math.sin(frame.sparkPhase * 0.04) * 13;
      graphics.setStrokeStyle({
        color: accent,
        width: 3.2 + frame.impactFlash * 1.4,
        alpha: rolling ? 0.54 : 0.2 + frame.burst * 0.2,
      });
      graphics.circle(DIE_CENTER_X, DIE_CENTER_Y, pulseRadius + frame.impactFlash * 10);
      graphics.stroke();
    },
    [accent, frame.burst, frame.impactFlash, frame.sparkPhase, rolling],
  );

  const drawShockwave = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (frame.burst <= 0.08) {
        return;
      }
      const loop = (frame.sparkPhase * 0.006) % 1;
      for (let index = 0; index < 3; index += 1) {
        const progress = (loop + index * 0.33) % 1;
        const alpha = Math.max(0, (1 - progress) * (0.15 + frame.burst * 0.54));
        graphics.setStrokeStyle({
          color: accent,
          width: 2.1 + frame.impactFlash * 2.6,
          alpha,
        });
        graphics.circle(DIE_CENTER_X, DIE_CENTER_Y, 92 + progress * 230);
        graphics.stroke();
      }
    },
    [accent, frame.burst, frame.impactFlash, frame.sparkPhase],
  );

  const drawScanner = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const speed = rolling ? 1 : 0.35;
      for (let index = 0; index < 8; index += 1) {
        const offset = (frame.sparkPhase * speed + index * 17) % 32;
        const laneY = 16 + index * 38 + offset;
        const alpha = rolling ? 0.08 : 0.045;
        graphics.setFillStyle({ color: accent, alpha });
        graphics.roundRect(10, laneY, STAGE_WIDTH - 20, 8, 5);
        graphics.fill();
      }
    },
    [accent, frame.sparkPhase, rolling],
  );

  const drawSparkles = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      for (const spark of sparks) {
        const wobble = Math.sin(spark.seed + frame.sparkPhase * 0.05);
        const float = Math.cos(spark.seed * 1.7 + frame.sparkPhase * 0.04);
        const alpha =
          (rolling ? 0.16 : 0.07) + Math.abs(wobble) * (rolling ? 0.26 : 0.08);
        const color =
          spark.hue === "cyan"
            ? 0x67e8f9
            : spark.hue === "amber"
              ? 0xfde68a
              : 0xfda4af;

        graphics.setFillStyle({ color, alpha });
        graphics.circle(
          spark.orbitX + wobble * spark.drift * 2.2,
          spark.orbitY + float * spark.drift * 1.7,
          spark.radius + Math.abs(float) * 1.2,
        );
        graphics.fill();
      }
    },
    [frame.sparkPhase, rolling, sparks],
  );

  const drawGauge = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setFillStyle({ color: 0x07152a, alpha: 0.94 });
      graphics.roundRect(GAUGE_LEFT - 12, STAGE_HEIGHT - 66, GAUGE_WIDTH + 24, 42, 15);
      graphics.fill();

      graphics.setStrokeStyle({ color: 0x365073, width: 1.2, alpha: 0.74 });
      graphics.roundRect(GAUGE_LEFT - 12, STAGE_HEIGHT - 66, GAUGE_WIDTH + 24, 42, 15);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0x4e6889, width: 4, alpha: 0.6 });
      graphics.moveTo(GAUGE_LEFT, STAGE_HEIGHT - 46);
      graphics.lineTo(GAUGE_RIGHT, STAGE_HEIGHT - 46);
      graphics.stroke();

      graphics.setStrokeStyle({
        color: accent,
        width: 3.4 + frame.impactFlash * 1.2,
        alpha: 0.98,
      });
      graphics.moveTo(thresholdX, STAGE_HEIGHT - 62);
      graphics.lineTo(thresholdX, STAGE_HEIGHT - 30);
      graphics.stroke();

      graphics.setFillStyle({ color: 0xf8fafc, alpha: 0.98 });
      graphics.circle(rollX, STAGE_HEIGHT - 46, 7.2 + frame.impactFlash * 1.1);
      graphics.fill();

      graphics.setStrokeStyle({ color: 0x0f172a, width: 1.5, alpha: 0.9 });
      graphics.circle(rollX, STAGE_HEIGHT - 46, 7.2 + frame.impactFlash * 1.1);
      graphics.stroke();
    },
    [accent, frame.impactFlash, rollX, thresholdX],
  );

  const drawGlow = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({
        color: accent,
        alpha: rolling ? 0.42 : 0.16 + frame.burst * 0.16,
      });
      graphics.circle(0, 0, 122 + frame.impactFlash * 8);
      graphics.fill();
    },
    [accent, frame.burst, frame.impactFlash, rolling],
  );

  const drawTrail = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (!rolling) {
        return;
      }
      for (let index = 0; index < 4; index += 1) {
        const distance = (index + 1) * 9;
        const angle = frame.spin * 0.9 + index * 0.7;
        graphics.setStrokeStyle({
          color: accent,
          width: 2,
          alpha: 0.2 - index * 0.04,
        });
        graphics.roundRect(
          -78 + Math.cos(angle) * distance,
          -78 + Math.sin(angle * 0.9) * distance * 0.8,
          156,
          156,
          28,
        );
        graphics.stroke();
      }
    },
    [accent, frame.spin, rolling],
  );

  const drawDie = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setFillStyle({ color: 0xf8fafc, alpha: 0.98 });
      graphics.roundRect(-78, -78, 156, 156, 28);
      graphics.fill();

      graphics.setStrokeStyle({
        color: accent,
        width: 5.2 + frame.impactFlash * 1.3,
        alpha: 0.9,
      });
      graphics.roundRect(-78, -78, 156, 156, 28);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0x0f172a, width: 1.4, alpha: 0.26 });
      graphics.roundRect(-66, -66, 132, 132, 22);
      graphics.stroke();
    },
    [accent, frame.impactFlash],
  );

  const drawFlash = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (!outcome || frame.burst <= 0) {
        return;
      }
      graphics.setFillStyle({
        color: outcome === "win" ? 0x22c55e : 0xf43f5e,
        alpha: Math.min(0.45, frame.burst * 0.3 + frame.impactFlash * 0.24),
      });
      graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
      graphics.fill();
    },
    [frame.burst, frame.impactFlash, outcome],
  );

  const drawParticles = useCallback((graphics: Graphics) => {
    graphics.clear();
    drawParticlePool(graphics, particlePoolRef.current);
  }, []);

  const bannerText = rolling
    ? "ROLLING"
    : outcome === "win"
      ? "CRITICAL WIN"
      : outcome === "loss"
        ? "BUSTED"
        : direction === "over"
          ? "SHOOT HIGH"
          : "PLAY LOW";

  const bannerColor = rolling
    ? "#fde68a"
    : outcome === "win"
      ? "#86efac"
      : outcome === "loss"
        ? "#fecdd3"
        : "#bae6fd";
  const bannerScale = rolling
    ? 1 + Math.sin(frame.sparkPhase * 0.09) * 0.03
    : 1 + frame.impactFlash * 0.08;

  return (
    <>
      <pixiGraphics draw={drawBackdrop} />
      <pixiGraphics draw={drawScanner} />
      <pixiGraphics draw={drawSparkles} />
      <pixiGraphics draw={drawPulse} />
      <pixiGraphics draw={drawShockwave} />
      <pixiGraphics draw={drawGauge} />
      <pixiContainer
        x={DIE_CENTER_X + frame.shakeX}
        y={DIE_CENTER_Y + frame.shakeY}
        rotation={frame.tilt + frame.spin * 0.05}
        scale={frame.scale}
      >
        <pixiGraphics draw={drawTrail} />
        <pixiGraphics draw={drawGlow} />
        <pixiGraphics draw={drawDie} />
        <pixiText
          x={0}
          y={8}
          anchor={0.5}
          text={String(effectiveRoll)}
          style={{
            fill: "#0f172a",
            fontFamily: "Space Grotesk",
            fontWeight: "800",
            fontSize: 84,
            stroke: { color: "#e2e8f0", width: 1 },
          }}
        />
      </pixiContainer>
      <pixiContainer x={DIE_CENTER_X} y={40} scale={bannerScale}>
        <pixiText
          anchor={0.5}
          text={bannerText}
          style={{
            fill: bannerColor,
            fontFamily: "IBM Plex Mono",
            fontWeight: "700",
            fontSize: 22,
            letterSpacing: 2,
            stroke: { color: "#020617", width: 2 },
          }}
        />
      </pixiContainer>
      <pixiText
        x={thresholdX}
        y={STAGE_HEIGHT - 85}
        anchor={0.5}
        text={`TARGET ${threshold}`}
        style={{
          fill: "#bae6fd",
          fontFamily: "IBM Plex Mono",
          fontWeight: "700",
          fontSize: 11,
          letterSpacing: 1.2,
          stroke: { color: "#020617", width: 1.8 },
        }}
      />
      <pixiText
        x={rollX}
        y={STAGE_HEIGHT - 17}
        anchor={0.5}
        text={`ROLL ${effectiveRoll}`}
        style={{
          fill: "#f8fafc",
          fontFamily: "IBM Plex Mono",
          fontWeight: "700",
          fontSize: 10,
          letterSpacing: 1.1,
          stroke: { color: "#020617", width: 1.8 },
        }}
      />
      <pixiGraphics draw={drawParticles} />
      <pixiGraphics draw={drawFlash} />
    </>
  );
}
