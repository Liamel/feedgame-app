import { Application, useExtend, useTick } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { playGameSfx } from "./shared/game-audio";
import {
  createParticlePool,
  drawParticlePool,
  emitParticleBurst,
  updateParticlePool,
} from "./shared/particles";
import { useArenaVisibility } from "./shared/use-arena-visibility";

interface CoinFlipArenaProps {
  flipping: boolean;
  choice: "heads" | "tails";
  landed: string | null;
  outcome: "win" | "loss" | null;
}

const STAGE_WIDTH = 340;
const STAGE_HEIGHT = 204;

interface CoinFrame {
  spin: number;
  flatten: number;
  bob: number;
  glow: number;
  impact: number;
  drift: number;
}

function statusTone(status: "ready" | "flipping" | "win" | "loss"): string {
  if (status === "win") {
    return "arena-pill-win";
  }
  if (status === "loss") {
    return "arena-pill-loss";
  }
  if (status === "flipping") {
    return "arena-pill-live";
  }
  return "arena-pill-neutral";
}

export function CoinFlipArena({
  flipping,
  choice,
  landed,
  outcome,
}: CoinFlipArenaProps) {
  useExtend({ Container, Graphics, Text });
  const { hostRef, isNearViewport, stageReady } = useArenaVisibility();
  const previousFlippingRef = useRef(flipping);

  useEffect(() => {
    if (flipping && !previousFlippingRef.current) {
      playGameSfx("coin-flip");
    }
    if (!flipping && previousFlippingRef.current && outcome) {
      playGameSfx(outcome === "win" ? "coin-land-win" : "coin-land-loss");
    }
    previousFlippingRef.current = flipping;
  }, [flipping, outcome]);

  const landedSide = landed === "heads" || landed === "tails" ? landed : null;
  const status: "ready" | "flipping" | "win" | "loss" = flipping
    ? "flipping"
    : outcome === "win"
      ? "win"
      : outcome === "loss"
        ? "loss"
        : "ready";

  return (
    <div className="coin-arena-shell arena-shell">
      <div className="coin-arena-canvas" ref={hostRef}>
        {stageReady ? (
          <Application
            width={STAGE_WIDTH}
            height={STAGE_HEIGHT}
            antialias
            backgroundAlpha={0}
          >
            <CoinFlipScene
              animate={isNearViewport}
              flipping={flipping}
              landed={landedSide}
              choice={choice}
              outcome={outcome}
            />
          </Application>
        ) : (
          <div className="arena-canvas-fallback">COIN LOADING...</div>
        )}
      </div>
      <div className="arena-hud arena-hud-coin">
        <span className="arena-pill arena-pill-info">{choice.toUpperCase()}</span>
        <span className="arena-pill arena-pill-neutral">
          {landedSide ? `LANDED ${landedSide.toUpperCase()}` : "LANDED --"}
        </span>
        <span className={`arena-pill ${statusTone(status)}`}>
          {status.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

interface CoinFlipSceneProps {
  animate: boolean;
  flipping: boolean;
  landed: "heads" | "tails" | null;
  choice: "heads" | "tails";
  outcome: "win" | "loss" | null;
}

function CoinFlipScene({
  animate,
  flipping,
  landed,
  choice,
  outcome,
}: CoinFlipSceneProps) {
  const [frame, setFrame] = useState<CoinFrame>({
    spin: 0,
    flatten: 1,
    bob: 0,
    glow: 0,
    impact: 0,
    drift: 0,
  });
  const previousFlippingRef = useRef(flipping);
  const particlePoolRef = useRef(createParticlePool(96));
  const impactBoostRef = useRef(0);

  useEffect(() => {
    if (previousFlippingRef.current && !flipping && landed) {
      const burstColor =
        outcome === "win" ? 0x86efac : outcome === "loss" ? 0xfda4af : 0xfde68a;
      emitParticleBurst(particlePoolRef.current, {
        x: STAGE_WIDTH / 2,
        y: 100,
        count: outcome === "win" ? 26 : 18,
        colors: [burstColor, 0xf8fafc, 0x93c5fd],
        speedMin: 2.8,
        speedMax: outcome === "win" ? 10.5 : 8.4,
        lifeMinMs: 240,
        lifeMaxMs: 760,
        radiusMin: 1.6,
        radiusMax: 4.2,
        gravity: 0.09,
      });
      impactBoostRef.current = 1;
      if (outcome === "win") {
        playGameSfx("reward-pop", { intensity: 1.08 });
      }
    }
    previousFlippingRef.current = flipping;
  }, [flipping, landed, outcome]);

  useTick((ticker) => {
    if (!animate) {
      return;
    }
    const delta = ticker.deltaMS;
    updateParticlePool(particlePoolRef.current, delta);
    setFrame((previous) => {
      let spin = previous.spin;
      let bob = previous.bob;
      let glow = previous.glow;
      let impact = previous.impact;
      let drift = previous.drift;

      if (impactBoostRef.current > 0) {
        impact = Math.max(impact, impactBoostRef.current);
        impactBoostRef.current *= 0.82;
        if (impactBoostRef.current < 0.02) {
          impactBoostRef.current = 0;
        }
      }

      if (flipping) {
        spin += 0.5 + Math.sin(glow * 0.14) * 0.05;
        bob = Math.sin(glow * 0.25) * 8;
        glow += delta * 0.08;
        drift += delta * 0.006;
        impact = Math.max(impact * 0.88, 0.2);
      } else {
        if (landed) {
          const target = landed === "tails" ? Math.PI : 0;
          const diff =
            ((((target - spin) % (Math.PI * 2)) + Math.PI * 3) %
              (Math.PI * 2)) -
            Math.PI;
          spin += diff * 0.22;
        } else {
          spin += 0.024;
        }
        bob += (0 - bob) * 0.16;
        glow += delta * 0.02;
        drift += delta * 0.0024;
        impact = Math.max(0, impact - 0.06);
      }

      return {
        spin,
        flatten: Math.max(0.12, Math.abs(Math.cos(spin))),
        bob,
        glow,
        impact,
        drift,
      };
    });
  });

  const visibleSide =
    landed && !flipping ? landed : Math.cos(frame.spin) >= 0 ? "heads" : "tails";

  const accent =
    outcome === "win"
      ? 0x22c55e
      : outcome === "loss"
        ? 0xf43f5e
        : choice === "heads"
          ? 0xf59e0b
          : 0x38bdf8;

  const drawBackdrop = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0x081422, alpha: 0.98 });
      graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
      graphics.fill();

      graphics.setFillStyle({ color: 0x47200a, alpha: 0.32 });
      graphics.circle(58, 48, 94);
      graphics.fill();

      graphics.setFillStyle({ color: 0x12345c, alpha: 0.28 });
      graphics.circle(STAGE_WIDTH - 56, 42, 92);
      graphics.fill();

      for (let index = 0; index < 20; index += 1) {
        const x =
          (index * 23 + (frame.drift * (index % 3 === 0 ? 36 : 14))) %
          STAGE_WIDTH;
        const y = 20 + ((index * 17) % (STAGE_HEIGHT - 40));
        graphics.setFillStyle({
          color: index % 2 === 0 ? 0xcbd5e1 : 0xfde68a,
          alpha: 0.05 + (index % 4) * 0.02,
        });
        graphics.circle(x, y, 0.9 + (index % 3) * 0.45);
        graphics.fill();
      }
    },
    [frame.drift],
  );

  const drawOrbit = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      for (let index = 0; index < 28; index += 1) {
        const theta = frame.glow * 0.05 + index * 0.42;
        const radius = 66 + Math.sin(theta * 2.2) * 8;
        const x = Math.cos(theta) * radius;
        const y = Math.sin(theta) * 32;
        graphics.setFillStyle({
          color: index % 2 === 0 ? accent : 0x93c5fd,
          alpha: 0.08 + (index % 4) * 0.03,
        });
        graphics.circle(x, y, 1.6 + (index % 3));
        graphics.fill();
      }
    },
    [accent, frame.glow],
  );

  const drawCoinShadow = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({
        color: 0x020617,
        alpha: 0.34 + frame.impact * 0.24,
      });
      graphics.ellipse(
        STAGE_WIDTH / 2,
        144 + frame.bob * 0.32,
        58 + frame.impact * 14,
        14 + frame.impact * 3,
      );
      graphics.fill();
    },
    [frame.bob, frame.impact],
  );

  const drawCoinCore = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0xf8fafc, alpha: 0.98 });
      graphics.circle(0, 0, 52 + frame.impact * 2.4);
      graphics.fill();

      graphics.setStrokeStyle({
        color: accent,
        width: 6 + frame.impact * 2,
        alpha: 0.82 + frame.impact * 0.12,
      });
      graphics.circle(0, 0, 52 + frame.impact * 2.4);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0x0f172a, width: 2, alpha: 0.65 });
      graphics.circle(0, 0, 42);
      graphics.stroke();

      graphics.setFillStyle({ color: 0xffffff, alpha: 0.17 });
      graphics.ellipse(-12, -16, 18, 10);
      graphics.fill();
    },
    [accent, frame.impact],
  );

  const drawPulse = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const radius = 70 + Math.sin(frame.glow * 0.09) * 9 + frame.impact * 14;
      graphics.setStrokeStyle({
        color: accent,
        width: 2.2 + frame.impact * 0.8,
        alpha: flipping ? 0.45 : 0.22 + frame.impact * 0.22,
      });
      graphics.circle(STAGE_WIDTH / 2, 100 + frame.bob, radius);
      graphics.stroke();
    },
    [accent, flipping, frame.bob, frame.glow, frame.impact],
  );

  const drawParticles = useCallback((graphics: Graphics) => {
    graphics.clear();
    drawParticlePool(graphics, particlePoolRef.current);
  }, []);

  return (
    <>
      <pixiGraphics draw={drawBackdrop} />
      <pixiGraphics draw={drawCoinShadow} />
      <pixiGraphics draw={drawPulse} />
      <pixiContainer x={STAGE_WIDTH / 2} y={96 + frame.bob}>
        <pixiGraphics draw={drawOrbit} />
      </pixiContainer>
      <pixiContainer
        x={STAGE_WIDTH / 2}
        y={100 + frame.bob}
        scale={{ x: frame.flatten, y: 1 + frame.impact * 0.03 }}
      >
        <pixiGraphics draw={drawCoinCore} />
      </pixiContainer>
      <pixiText
        x={STAGE_WIDTH / 2}
        y={104 + frame.bob}
        anchor={0.5}
        text={visibleSide === "heads" ? "H" : "T"}
        style={{
          fill: "#0f172a",
          fontFamily: "Space Grotesk",
          fontWeight: "800",
          fontSize: 52 + frame.impact * 8,
        }}
      />
      <pixiGraphics draw={drawParticles} />
    </>
  );
}
