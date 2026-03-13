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
import {
  addScreenShakeTrauma,
  createAmbientField,
  createRingPulsePool,
  createScreenShakeState,
  drawAmbientField,
  drawLightBeams,
  drawRingPulsePool,
  drawVignetteFrame,
  emitRingPulseBurst,
  updateRingPulsePool,
  updateScreenShake,
} from "./shared/premium-vfx";
import {
  type ArenaQualityTier,
  scaleAlphaByQuality,
  scaleCountByQuality,
  useArenaQuality,
} from "./shared/perf-quality";
import {
  createRewardSpritePool,
  destroyRewardSpritePool,
  emitRewardSpriteBurst,
  updateRewardSpritePool,
  type RewardSpritePool,
} from "./shared/reward-sprites";
import { useArenaVisibility } from "./shared/use-arena-visibility";

interface CardPeekerArenaProps {
  currentCard: number | null;
  nextCard: number | null;
  revealing: boolean;
  guess: "higher" | "lower" | null;
  outcome: "win" | "loss" | null;
}

const STAGE_WIDTH = 340;
const STAGE_HEIGHT = 214;
const SUITS = ["♠", "♥", "♦", "♣"] as const;

interface CardFrame {
  flip: number;
  lift: number;
  pulse: number;
  impact: number;
  shimmer: number;
}

function rankLabel(card: number): string {
  if (card === 1) {
    return "A";
  }
  if (card === 11) {
    return "J";
  }
  if (card === 12) {
    return "Q";
  }
  if (card === 13) {
    return "K";
  }
  return String(card);
}

function suitByCard(card: number): (typeof SUITS)[number] {
  return SUITS[(card - 1 + SUITS.length) % SUITS.length];
}

function suitColor(suit: (typeof SUITS)[number]): string {
  return suit === "♥" || suit === "♦" ? "#ef4444" : "#0f172a";
}

function statusTone(status: "ready" | "revealing" | "win" | "loss"): string {
  if (status === "win") {
    return "arena-pill-win";
  }
  if (status === "loss") {
    return "arena-pill-loss";
  }
  if (status === "revealing") {
    return "arena-pill-live";
  }
  return "arena-pill-neutral";
}

export function CardPeekerArena({
  currentCard,
  nextCard,
  revealing,
  guess,
  outcome,
}: CardPeekerArenaProps) {
  useExtend({ Container, Graphics, Text });
  const { hostRef, isNearViewport, stageReady } = useArenaVisibility();
  const qualityProfile = useArenaQuality({ active: isNearViewport });
  const previousRevealingRef = useRef(revealing);

  useEffect(() => {
    if (revealing && !previousRevealingRef.current) {
      playGameSfx("card-deal");
      playGameSfx("anticipation-rise", { intensity: 0.82 });
    }
    if (!revealing && previousRevealingRef.current && outcome) {
      playGameSfx("card-reveal");
      if (outcome === "win") {
        playGameSfx("reward-burst", { intensity: 1.05 });
        playGameSfx("reward-pop", { intensity: 1.08 });
      }
    }
    previousRevealingRef.current = revealing;
  }, [outcome, revealing]);

  const status: "ready" | "revealing" | "win" | "loss" = revealing
    ? "revealing"
    : outcome === "win"
      ? "win"
      : outcome === "loss"
        ? "loss"
        : "ready";

  return (
    <div className="card-peeker-shell arena-shell">
      <div className="card-peeker-canvas" ref={hostRef}>
        {stageReady ? (
          <Application width={STAGE_WIDTH} height={STAGE_HEIGHT} antialias backgroundAlpha={0}>
            <CardPeekerScene
              animate={isNearViewport}
              currentCard={currentCard}
              nextCard={nextCard}
              revealing={revealing}
              guess={guess}
              outcome={outcome}
              qualityTier={qualityProfile.tier}
            />
          </Application>
        ) : (
          <div className="arena-canvas-fallback">CARD LOADING...</div>
        )}
      </div>
      <div className="arena-hud arena-hud-card">
        <span className="arena-pill arena-pill-info">CUR {currentCard ?? "--"}</span>
        <span className="arena-pill arena-pill-neutral">NXT {nextCard ?? "?"}</span>
        <span className="arena-pill arena-pill-neutral">
          GUESS {guess ? guess.toUpperCase() : "--"}
        </span>
        <span className={`arena-pill ${statusTone(status)}`}>
          {status.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

interface CardPeekerSceneProps {
  animate: boolean;
  currentCard: number | null;
  nextCard: number | null;
  revealing: boolean;
  guess: "higher" | "lower" | null;
  outcome: "win" | "loss" | null;
  qualityTier: ArenaQualityTier;
}

function CardPeekerScene({
  animate,
  currentCard,
  nextCard,
  revealing,
  guess,
  outcome,
  qualityTier,
}: CardPeekerSceneProps) {
  const [frame, setFrame] = useState<CardFrame>({
    flip: 0,
    lift: 0,
    pulse: 0,
    impact: 0,
    shimmer: 0,
  });
  const sceneLayerRef = useRef<Container | null>(null);
  const rewardSpriteLayerRef = useRef<Container | null>(null);
  const rewardSpritePoolRef = useRef<RewardSpritePool | null>(null);
  const particlePoolRef = useRef(createParticlePool(72));
  const ringPulsePoolRef = useRef(createRingPulsePool(16));
  const screenShakeRef = useRef(createScreenShakeState());
  const previousRevealingRef = useRef(revealing);
  const impactBoostRef = useRef(0);
  const frameCommitMsRef = useRef(0);
  const ambientField = useMemo(
    () =>
      createAmbientField({
        seed: 7621,
        count: scaleCountByQuality(28, qualityTier, 16),
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        colors: [0xf8fafc, 0xbfdbfe, 0xe9d5ff, 0xfda4af],
      }),
    [qualityTier],
  );

  useEffect(() => {
    const layer = rewardSpriteLayerRef.current;
    if (!layer) {
      return;
    }
    const pool = createRewardSpritePool(
      layer,
      scaleCountByQuality(28, qualityTier, 14),
      ["diamond", "shard", "coin"],
    );
    rewardSpritePoolRef.current = pool;
    return () => {
      destroyRewardSpritePool(pool);
      if (rewardSpritePoolRef.current === pool) {
        rewardSpritePoolRef.current = null;
      }
    };
  }, [qualityTier]);

  useEffect(() => {
    if (previousRevealingRef.current && !revealing && nextCard !== null) {
      emitParticleBurst(particlePoolRef.current, {
        x: 232,
        y: 112,
        count: scaleCountByQuality(outcome === "win" ? 20 : 14, qualityTier, 8),
        colors:
          outcome === "win"
            ? [0xa7f3d0, 0xfef08a, 0xf8fafc]
            : [0xfda4af, 0xf8fafc, 0xbfdbfe],
        speedMin: 2.2,
        speedMax: outcome === "win" ? 8.8 : 6.8,
        lifeMinMs: 220,
        lifeMaxMs: 620,
        radiusMin: 1.2,
        radiusMax: 3.2,
        gravity: 0.08,
      });
      emitRingPulseBurst(ringPulsePoolRef.current, {
        x: 232,
        y: 112,
        count: scaleCountByQuality(outcome === "win" ? 4 : 2, qualityTier, 2),
        colors:
          outcome === "win"
            ? [0xa7f3d0, 0xfef08a, 0xe9d5ff]
            : [0xfda4af, 0xfecaca, 0xbfdbfe],
        radiusMin: 24,
        radiusMax: 72,
        lifeMinMs: 280,
        lifeMaxMs: 680,
      });
      if (rewardSpritePoolRef.current) {
        emitRewardSpriteBurst(rewardSpritePoolRef.current, {
          x: 232,
          y: 112,
          count: scaleCountByQuality(outcome === "win" ? 12 : 7, qualityTier, 4),
          speedMin: 1.8,
          speedMax: outcome === "win" ? 7.4 : 5.4,
          textureIds: outcome === "win" ? ["coin", "diamond"] : ["diamond", "shard"],
          gravity: 0.08,
        });
      }
      impactBoostRef.current = 1;
      addScreenShakeTrauma(screenShakeRef.current, outcome === "win" ? 0.48 : 0.3);
      playGameSfx("impact-hit", { intensity: outcome === "win" ? 0.96 : 0.8 });
    }
    previousRevealingRef.current = revealing;
  }, [nextCard, outcome, qualityTier, revealing]);

  useTick((ticker) => {
    if (!animate) {
      return;
    }
    const delta = ticker.deltaMS;
    updateParticlePool(particlePoolRef.current, delta);
    updateRingPulsePool(ringPulsePoolRef.current, delta);
    if (rewardSpritePoolRef.current) {
      updateRewardSpritePool(rewardSpritePoolRef.current, delta);
    }
    updateScreenShake(screenShakeRef.current, delta);
    if (sceneLayerRef.current) {
      sceneLayerRef.current.position.set(
        screenShakeRef.current.x,
        screenShakeRef.current.y,
      );
    }
    frameCommitMsRef.current += delta;
    const commitIntervalMs =
      qualityTier === "high" ? 16 : qualityTier === "medium" ? 22 : 32;
    if (frameCommitMsRef.current < commitIntervalMs) {
      return;
    }
    const commitDelta = frameCommitMsRef.current;
    frameCommitMsRef.current = 0;
    setFrame((previous) => {
      const pulse = previous.pulse + commitDelta * 0.012;
      const shimmer = previous.shimmer + commitDelta * 0.018;
      let impact = previous.impact;

      if (impactBoostRef.current > 0) {
        impact = Math.max(impact, impactBoostRef.current);
        impactBoostRef.current *= 0.82;
        if (impactBoostRef.current < 0.02) {
          impactBoostRef.current = 0;
        }
      }

      if (revealing) {
        return {
          flip: previous.flip + commitDelta * 0.046,
          lift: Math.sin(pulse * 0.62) * 6.5,
          pulse,
          impact: Math.max(impact * 0.86, 0.18),
          shimmer,
        };
      }
      return {
        flip: previous.flip + (0 - previous.flip) * 0.16,
        lift: Math.sin(pulse * 0.3) * 2.2,
        pulse,
        impact: Math.max(0, impact - 0.06),
        shimmer,
      };
    });
  });

  const rightScaleX = revealing ? Math.max(0.12, Math.abs(Math.sin(frame.flip))) : 1;
  const showRightFace = nextCard !== null && !revealing;
  const accent =
    outcome === "win" ? 0x22c55e : outcome === "loss" ? 0xf43f5e : 0xa855f7;

  const leftCard = useMemo(() => {
    if (!currentCard) {
      return null;
    }
    const suit = suitByCard(currentCard);
    return {
      rank: rankLabel(currentCard),
      suit,
      color: suitColor(suit),
    };
  }, [currentCard]);

  const rightCard = useMemo(() => {
    if (!nextCard) {
      return null;
    }
    const suit = suitByCard(nextCard);
    return {
      rank: rankLabel(nextCard),
      suit,
      color: suitColor(suit),
    };
  }, [nextCard]);

  const drawBackdrop = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0x101024, alpha: 0.97 });
      graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
      graphics.fill();

      graphics.setFillStyle({ color: 0x2b1a57, alpha: 0.28 });
      graphics.circle(64, 46, 90);
      graphics.fill();

      graphics.setFillStyle({ color: 0x12334f, alpha: 0.24 });
      graphics.circle(STAGE_WIDTH - 56, 44, 90);
      graphics.fill();

      drawLightBeams(
        graphics,
        frame.shimmer * (revealing ? 1.2 : 0.8),
        STAGE_WIDTH,
        STAGE_HEIGHT,
        [accent, 0xe9d5ff, 0xbfdbfe],
        scaleAlphaByQuality(revealing ? 0.95 : 0.66, qualityTier),
      );
      drawAmbientField(graphics, ambientField, frame.pulse * 0.18, STAGE_WIDTH, STAGE_HEIGHT);
      drawVignetteFrame(graphics, STAGE_WIDTH, STAGE_HEIGHT, 0.08 + frame.impact * 0.08);
    },
    [accent, ambientField, frame.impact, frame.pulse, frame.shimmer, qualityTier, revealing],
  );

  const drawField = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0x131d33, alpha: 0.84 });
      graphics.roundRect(18, 34, STAGE_WIDTH - 36, STAGE_HEIGHT - 64, 16);
      graphics.fill();

      const sheenX = 16 + (frame.shimmer * 0.35) % (STAGE_WIDTH + 60);
      graphics.setFillStyle({ color: 0xe2e8f0, alpha: 0.07 + frame.impact * 0.08 });
      graphics.moveTo(sheenX - 28, 34);
      graphics.lineTo(sheenX + 18, 34);
      graphics.lineTo(sheenX - 42, STAGE_HEIGHT - 30);
      graphics.lineTo(sheenX - 88, STAGE_HEIGHT - 30);
      graphics.closePath();
      graphics.fill();
    },
    [frame.impact, frame.shimmer],
  );

  const drawArrow = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (!guess) {
        return;
      }
      const y = guess === "higher" ? 70 : 146;
      const sign = guess === "higher" ? -1 : 1;
      const base = STAGE_WIDTH / 2;
      graphics.setFillStyle({ color: accent, alpha: 0.84 + frame.impact * 0.12 });
      graphics.moveTo(base, y + sign * -14);
      graphics.lineTo(base - 14, y + sign * 12);
      graphics.lineTo(base + 14, y + sign * 12);
      graphics.closePath();
      graphics.fill();
    },
    [accent, frame.impact, guess],
  );

  const drawPulse = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const radius = 72 + Math.sin(frame.pulse * 0.12) * 7 + frame.impact * 9;
      graphics.setStrokeStyle({
        color: accent,
        width: 2.3 + frame.impact * 0.9,
        alpha: revealing ? 0.46 : 0.21 + frame.impact * 0.22,
      });
      graphics.circle(STAGE_WIDTH / 2, 106, radius);
      graphics.stroke();
    },
    [accent, frame.impact, frame.pulse, revealing],
  );

  const drawCardFront = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0xf8fafc, alpha: 0.98 });
      graphics.roundRect(-44, -60, 88, 120, 12);
      graphics.fill();

      graphics.setStrokeStyle({
        color: accent,
        width: 3 + frame.impact,
        alpha: 0.7 + frame.impact * 0.12,
      });
      graphics.roundRect(-44, -60, 88, 120, 12);
      graphics.stroke();

      graphics.setFillStyle({ color: 0xffffff, alpha: 0.14 });
      graphics.roundRect(-32, -48, 18, 94, 8);
      graphics.fill();
    },
    [accent, frame.impact],
  );

  const drawCardBack = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0x1d4ed8, alpha: 0.95 });
      graphics.roundRect(-44, -60, 88, 120, 12);
      graphics.fill();

      graphics.setStrokeStyle({ color: 0x93c5fd, width: 2, alpha: 0.85 });
      graphics.roundRect(-44, -60, 88, 120, 12);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0xbfdbfe, width: 1, alpha: 0.55 });
      for (let i = -36; i <= 36; i += 12) {
        graphics.moveTo(i, -52);
        graphics.lineTo(i + 28, 56);
      }
      graphics.stroke();
    },
    [],
  );

  const drawParticles = useCallback((graphics: Graphics) => {
    graphics.clear();
    drawParticlePool(graphics, particlePoolRef.current);
  }, []);

  const drawRingBursts = useCallback((graphics: Graphics) => {
    graphics.clear();
    drawRingPulsePool(graphics, ringPulsePoolRef.current);
  }, []);

  return (
    <>
      <pixiGraphics draw={drawBackdrop} />
      <pixiGraphics draw={drawRingBursts} />
      <pixiContainer ref={sceneLayerRef}>
        <pixiGraphics draw={drawField} />
        <pixiGraphics draw={drawPulse} />
        <pixiGraphics draw={drawArrow} />
        <pixiContainer x={108} y={112 + frame.lift}>
          {leftCard ? <pixiGraphics draw={drawCardFront} /> : <pixiGraphics draw={drawCardBack} />}
          {leftCard ? (
            <>
              <pixiText
                x={0}
                y={-6}
                anchor={0.5}
                text={leftCard.rank}
                style={{
                  fill: leftCard.color,
                  fontFamily: "Space Grotesk",
                  fontWeight: "800",
                  fontSize: 40,
                }}
              />
              <pixiText
                x={0}
                y={28}
                anchor={0.5}
                text={leftCard.suit}
                style={{
                  fill: leftCard.color,
                  fontFamily: "Space Grotesk",
                  fontWeight: "700",
                  fontSize: 25,
                }}
              />
            </>
          ) : null}
        </pixiContainer>

        <pixiContainer
          x={232}
          y={112 - frame.lift * 0.3}
          scale={{
            x: rightScaleX,
            y: 1 + frame.impact * 0.02,
          }}
        >
          {showRightFace ? <pixiGraphics draw={drawCardFront} /> : <pixiGraphics draw={drawCardBack} />}
          {showRightFace && rightCard ? (
            <>
              <pixiText
                x={0}
                y={-6}
                anchor={0.5}
                text={rightCard.rank}
                style={{
                  fill: rightCard.color,
                  fontFamily: "Space Grotesk",
                  fontWeight: "800",
                  fontSize: 40 + frame.impact * 4,
                }}
              />
              <pixiText
                x={0}
                y={28}
                anchor={0.5}
                text={rightCard.suit}
                style={{
                  fill: rightCard.color,
                  fontFamily: "Space Grotesk",
                  fontWeight: "700",
                  fontSize: 25,
                }}
              />
            </>
          ) : null}
        </pixiContainer>
      </pixiContainer>
      <pixiContainer ref={rewardSpriteLayerRef} />
      <pixiGraphics draw={drawParticles} />
    </>
  );
}
