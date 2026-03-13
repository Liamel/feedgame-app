import { Application, useExtend } from "@pixi/react";
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

interface MinesBugHuntArenaProps {
  active: boolean;
  locked: boolean;
  totalTiles: number;
  bombCount: number;
  revealed: number[];
  bombs: number[];
  explodedAt: number | null;
  outcome: "win" | "loss" | null;
  onReveal: (tile: number) => void;
}

const STAGE_WIDTH = 340;
const STAGE_HEIGHT = 348;
const BOARD_COLS = 5;
const BOARD_ROWS = 5;
const TILE_SIZE = 56;
const TILE_GAP = 6;
const BOARD_WIDTH = BOARD_COLS * TILE_SIZE + (BOARD_COLS - 1) * TILE_GAP;
const BOARD_HEIGHT = BOARD_ROWS * TILE_SIZE + (BOARD_ROWS - 1) * TILE_GAP;
const BOARD_LEFT = (STAGE_WIDTH - BOARD_WIDTH) / 2;
const BOARD_TOP = 28;

interface TileGeometry {
  tile: number;
  x: number;
  y: number;
  centerX: number;
  centerY: number;
}

interface StrikeState {
  tile: number;
  progress: number;
}

interface MotionState {
  phase: number;
  flash: number;
}

function statusTone(status: "ready" | "hunting" | "win" | "loss"): string {
  if (status === "win") {
    return "arena-pill-win";
  }
  if (status === "loss") {
    return "arena-pill-loss";
  }
  if (status === "hunting") {
    return "arena-pill-live";
  }
  return "arena-pill-neutral";
}

export function MinesBugHuntArena({
  active,
  locked,
  totalTiles,
  bombCount,
  revealed,
  bombs,
  explodedAt,
  outcome,
  onReveal,
}: MinesBugHuntArenaProps) {
  useExtend({ Container, Graphics, Text });
  const { hostRef, isNearViewport, stageReady } = useArenaVisibility();
  const qualityProfile = useArenaQuality({ active: isNearViewport });
  const [motion, setMotion] = useState<MotionState>({
    phase: 0,
    flash: 0,
  });
  const [strike, setStrike] = useState<StrikeState | null>(null);

  const sceneLayerRef = useRef<Container | null>(null);
  const rewardSpriteLayerRef = useRef<Container | null>(null);
  const rewardSpritePoolRef = useRef<RewardSpritePool | null>(null);
  const previousRevealedRef = useRef<number[]>(revealed);
  const previousOutcomeRef = useRef<"win" | "loss" | null>(outcome);
  const pendingFlashRef = useRef(0);
  const motionCommitMsRef = useRef(0);
  const particlePoolRef = useRef(createParticlePool(128));
  const ringPulsePoolRef = useRef(createRingPulsePool(32));
  const screenShakeRef = useRef(createScreenShakeState());
  const ambientField = useMemo(
    () =>
      createAmbientField({
        seed: 5417,
        count: scaleCountByQuality(42, qualityProfile.tier, 24),
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        colors: [0xd1fae5, 0x99f6e4, 0xfef08a, 0xfda4af],
      }),
    [qualityProfile.tier],
  );

  useEffect(() => {
    const layer = rewardSpriteLayerRef.current;
    if (!layer) {
      return;
    }
    const pool = createRewardSpritePool(
      layer,
      scaleCountByQuality(36, qualityProfile.tier, 20),
      ["coin", "diamond", "shard"],
    );
    rewardSpritePoolRef.current = pool;
    return () => {
      destroyRewardSpritePool(pool);
      if (rewardSpritePoolRef.current === pool) {
        rewardSpritePoolRef.current = null;
      }
    };
  }, [qualityProfile.tier]);

  const revealedSet = useMemo(() => new Set(revealed), [revealed]);
  const bombSet = useMemo(() => new Set(bombs), [bombs]);
  const safeHits = revealed.filter((tile) => !bombSet.has(tile)).length;
  const status: "ready" | "hunting" | "win" | "loss" = active
    ? "hunting"
    : outcome === "win"
      ? "win"
      : outcome === "loss"
        ? "loss"
        : "ready";

  const tileGeometry = useMemo<TileGeometry[]>(
    () =>
      Array.from({ length: BOARD_COLS * BOARD_ROWS }, (_, tile) => {
        const row = Math.floor(tile / BOARD_COLS);
        const col = tile % BOARD_COLS;
        const x = BOARD_LEFT + col * (TILE_SIZE + TILE_GAP);
        const y = BOARD_TOP + row * (TILE_SIZE + TILE_GAP);
        return {
          tile,
          x,
          y,
          centerX: x + TILE_SIZE / 2,
          centerY: y + TILE_SIZE / 2,
        };
      }),
    [],
  );

  useEffect(() => {
    const previousSet = new Set(previousRevealedRef.current);
    const addedTile = revealed.find((tile) => !previousSet.has(tile));
    if (addedTile !== undefined) {
      const target = tileGeometry[addedTile];
      const bombHit = explodedAt !== null && addedTile === explodedAt;
      if (bombHit) {
        playGameSfx("mines-boom");
        pendingFlashRef.current = Math.max(pendingFlashRef.current, 1);
        if (target) {
          emitParticleBurst(particlePoolRef.current, {
            x: target.centerX,
            y: target.centerY,
            count: scaleCountByQuality(42, qualityProfile.tier, 20),
            colors: [0xfda4af, 0xfdba74, 0xfef2f2],
            speedMin: 2.6,
            speedMax: 13,
            lifeMinMs: 260,
            lifeMaxMs: 860,
            radiusMin: 1.4,
            radiusMax: 5.2,
            gravity: 0.11,
          });
          emitRingPulseBurst(ringPulsePoolRef.current, {
            x: target.centerX,
            y: target.centerY,
            count: scaleCountByQuality(5, qualityProfile.tier, 2),
            colors: [0xfdba74, 0xfda4af, 0xfef2f2],
            radiusMin: 20,
            radiusMax: 86,
            lifeMinMs: 280,
            lifeMaxMs: 820,
          });
          if (rewardSpritePoolRef.current) {
            emitRewardSpriteBurst(rewardSpritePoolRef.current, {
              x: target.centerX,
              y: target.centerY,
              count: scaleCountByQuality(16, qualityProfile.tier, 6),
              speedMin: 2.1,
              speedMax: 8.6,
              textureIds: ["shard", "diamond"],
              gravity: 0.12,
            });
          }
          addScreenShakeTrauma(screenShakeRef.current, 0.62);
          playGameSfx("impact-hit", { intensity: 1.04 });
        }
      } else {
        playGameSfx("mines-safe");
        pendingFlashRef.current = Math.max(pendingFlashRef.current, 0.45);
        if (target) {
          emitParticleBurst(particlePoolRef.current, {
            x: target.centerX,
            y: target.centerY,
            count: scaleCountByQuality(16, qualityProfile.tier, 8),
            colors: [0x86efac, 0xfef08a, 0xf8fafc],
            speedMin: 2.2,
            speedMax: 7.4,
            lifeMinMs: 200,
            lifeMaxMs: 560,
            radiusMin: 1.1,
            radiusMax: 3.2,
            gravity: 0.08,
          });
          emitRingPulseBurst(ringPulsePoolRef.current, {
            x: target.centerX,
            y: target.centerY,
            count: scaleCountByQuality(2, qualityProfile.tier, 1),
            colors: [0x86efac, 0xfef08a, 0xf8fafc],
            radiusMin: 16,
            radiusMax: 44,
            lifeMinMs: 220,
            lifeMaxMs: 560,
          });
          if (rewardSpritePoolRef.current) {
            emitRewardSpriteBurst(rewardSpritePoolRef.current, {
              x: target.centerX,
              y: target.centerY,
              count: scaleCountByQuality(8, qualityProfile.tier, 3),
              speedMin: 1.6,
              speedMax: 5.8,
              textureIds: ["coin", "diamond"],
              gravity: 0.08,
            });
          }
          addScreenShakeTrauma(screenShakeRef.current, 0.22);
          playGameSfx("impact-hit", { intensity: 0.62 });
        }
      }
    }
    previousRevealedRef.current = revealed;
  }, [explodedAt, qualityProfile.tier, revealed, tileGeometry]);

  useEffect(() => {
    if (outcome === "win" && previousOutcomeRef.current !== "win") {
      playGameSfx("reward-burst", { intensity: 1.1 });
      playGameSfx("reward-pop", { intensity: 0.96 });
      if (rewardSpritePoolRef.current) {
        emitRewardSpriteBurst(rewardSpritePoolRef.current, {
          x: STAGE_WIDTH / 2,
          y: STAGE_HEIGHT * 0.42,
          count: scaleCountByQuality(20, qualityProfile.tier, 10),
          speedMin: 2,
          speedMax: 7.2,
          textureIds: ["coin", "diamond"],
          gravity: 0.07,
        });
      }
      addScreenShakeTrauma(screenShakeRef.current, 0.28);
    }
    previousOutcomeRef.current = outcome;
  }, [outcome, qualityProfile.tier]);

  useEffect(() => {
    if (typeof window === "undefined" || !stageReady || !isNearViewport) {
      return;
    }

    let rafId = 0;
    let lastTime = window.performance.now();

    const tick = (now: number) => {
      const delta = Math.min(34, now - lastTime);
      lastTime = now;
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
      motionCommitMsRef.current += delta;
      const commitIntervalMs =
        qualityProfile.tier === "high" ? 16 : qualityProfile.tier === "medium" ? 22 : 32;
      if (motionCommitMsRef.current >= commitIntervalMs) {
        const commitDelta = motionCommitMsRef.current;
        motionCommitMsRef.current = 0;
        setMotion((previous) => {
          const boostedFlash = Math.max(previous.flash, pendingFlashRef.current);
          pendingFlashRef.current = 0;
          return {
            phase: previous.phase + commitDelta * 0.028,
            flash: Math.max(0, boostedFlash - commitDelta * 0.0019),
          };
        });
      }

      setStrike((current) => {
        if (!current) {
          return current;
        }
        const nextProgress = current.progress + delta * 0.0026;
        if (nextProgress > 1.2) {
          return null;
        }
        return {
          ...current,
          progress: nextProgress,
        };
      });

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [isNearViewport, qualityProfile.tier, stageReady]);

  const drawBackdrop = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0x07171a, alpha: 0.97 });
      graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
      graphics.fill();

      graphics.setFillStyle({ color: 0x0d3524, alpha: 0.42 });
      graphics.circle(58, 52, 95);
      graphics.fill();

      graphics.setFillStyle({ color: 0x14342f, alpha: 0.36 });
      graphics.circle(STAGE_WIDTH - 56, 58, 100);
      graphics.fill();

      drawLightBeams(
        graphics,
        motion.phase * (active ? 0.45 : 0.24),
        STAGE_WIDTH,
        STAGE_HEIGHT,
        [0x34d399, 0x10b981, 0xfef08a],
        scaleAlphaByQuality(active ? 0.94 : 0.64, qualityProfile.tier),
      );
      drawAmbientField(graphics, ambientField, motion.phase * 0.08, STAGE_WIDTH, STAGE_HEIGHT);
      drawVignetteFrame(graphics, STAGE_WIDTH, STAGE_HEIGHT, 0.1 + motion.flash * 0.1);

      if (motion.flash > 0) {
        graphics.setFillStyle({
          color: explodedAt !== null ? 0xf97316 : 0x10b981,
          alpha: Math.min(0.55, motion.flash * 0.4),
        });
        graphics.roundRect(6, 6, STAGE_WIDTH - 12, STAGE_HEIGHT - 12, 14);
        graphics.fill();
      }
    },
    [active, ambientField, explodedAt, motion.flash, motion.phase, qualityProfile.tier],
  );

  const drawGrid = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      for (const tile of tileGeometry) {
        const isRevealed = revealedSet.has(tile.tile);
        const isBomb = bombSet.has(tile.tile);
        const isExploded = explodedAt === tile.tile;
        const phaseScale = 1 + (isExploded ? motion.flash * 0.45 : 0);

        if (isExploded) {
          graphics.setFillStyle({ color: 0xb91c1c, alpha: 0.95 });
        } else if (isBomb) {
          graphics.setFillStyle({ color: 0x7f1d1d, alpha: 0.88 });
        } else if (isRevealed) {
          graphics.setFillStyle({ color: 0x14532d, alpha: 0.88 });
        } else {
          graphics.setFillStyle({ color: 0x12301f, alpha: 0.85 });
        }
        graphics.roundRect(tile.x, tile.y, TILE_SIZE, TILE_SIZE, 10);
        graphics.fill();

        graphics.setStrokeStyle({
          color: isRevealed ? 0x86efac : 0x2f4f3f,
          width: isExploded ? 3.4 : 1.7,
          alpha: isExploded ? 0.95 : 0.75,
        });
        graphics.roundRect(tile.x, tile.y, TILE_SIZE, TILE_SIZE, 10);
        graphics.stroke();

        const wobbleX = Math.sin(motion.phase * 0.18 + tile.tile * 0.7) * 5;
        const wobbleY = Math.cos(motion.phase * 0.14 + tile.tile * 1.15) * 4;
        const flyX = tile.centerX + wobbleX;
        const flyY = tile.centerY + wobbleY;

        if (!isRevealed) {
          graphics.setFillStyle({ color: 0xfcd34d, alpha: 0.55 });
          graphics.ellipse(flyX - 4.5, flyY - 1.2, 4.2, 2.3);
          graphics.fill();
          graphics.ellipse(flyX + 4.5, flyY - 1.2, 4.2, 2.3);
          graphics.fill();
          graphics.setFillStyle({ color: 0x111827, alpha: 0.93 });
          graphics.ellipse(flyX, flyY, 5.5, 4.2);
          graphics.fill();
          graphics.setFillStyle({ color: 0x6ee7b7, alpha: 0.32 });
          graphics.circle(flyX + 1.1, flyY - 1.1, 1.6);
          graphics.fill();
        } else if (isBomb) {
          graphics.setFillStyle({ color: 0x020617, alpha: 0.94 });
          graphics.circle(tile.centerX, tile.centerY, 8.5 * phaseScale);
          graphics.fill();
          graphics.setStrokeStyle({ color: 0xfca5a5, width: 1.5, alpha: 0.9 });
          for (let i = 0; i < 8; i += 1) {
            const angle = (i / 8) * Math.PI * 2;
            graphics.moveTo(
              tile.centerX + Math.cos(angle) * 10,
              tile.centerY + Math.sin(angle) * 10,
            );
            graphics.lineTo(
              tile.centerX + Math.cos(angle) * 14,
              tile.centerY + Math.sin(angle) * 14,
            );
          }
          graphics.stroke();
          if (isExploded) {
            graphics.setStrokeStyle({ color: 0xfdba74, width: 2.4, alpha: 0.92 });
            for (let i = 0; i < 10; i += 1) {
              const angle = (i / 10) * Math.PI * 2 + motion.phase * 0.06;
              graphics.moveTo(
                tile.centerX + Math.cos(angle) * 12,
                tile.centerY + Math.sin(angle) * 12,
              );
              graphics.lineTo(
                tile.centerX + Math.cos(angle) * (22 + motion.flash * 8),
                tile.centerY + Math.sin(angle) * (22 + motion.flash * 8),
              );
            }
            graphics.stroke();
          }
        } else {
          graphics.setFillStyle({ color: 0x7f1d1d, alpha: 0.9 });
          graphics.circle(tile.centerX - 4, tile.centerY - 1, 5.6);
          graphics.fill();
          graphics.circle(tile.centerX + 5, tile.centerY + 2, 4.2);
          graphics.fill();
          graphics.setStrokeStyle({ color: 0xfee2e2, width: 1.2, alpha: 0.92 });
          graphics.moveTo(tile.centerX - 8, tile.centerY - 7);
          graphics.lineTo(tile.centerX + 8, tile.centerY + 9);
          graphics.moveTo(tile.centerX + 8, tile.centerY - 7);
          graphics.lineTo(tile.centerX - 8, tile.centerY + 9);
          graphics.stroke();
        }
      }
    },
    [bombSet, explodedAt, motion.flash, motion.phase, revealedSet, tileGeometry],
  );

  const drawStrike = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (!strike) {
        return;
      }
      const target = tileGeometry[strike.tile];
      if (!target) {
        return;
      }

      const startX = STAGE_WIDTH - 20;
      const startY = 16;
      const downPhase = Math.min(1, strike.progress / 0.72);
      const upPhase =
        strike.progress > 0.72
          ? Math.min(1, (strike.progress - 0.72) / 0.48)
          : 0;
      const swing = upPhase > 0 ? 1 - upPhase : downPhase;

      const strikeX = startX + (target.centerX - startX) * (0.1 + swing * 0.9);
      const strikeY = startY + (target.centerY - startY) * (0.1 + swing * 0.9);
      const angle =
        Math.atan2(target.centerY - startY, target.centerX - startX) + 0.22;
      const handleX = strikeX - Math.cos(angle) * 72;
      const handleY = strikeY - Math.sin(angle) * 72;

      graphics.setStrokeStyle({ color: 0xf59e0b, width: 8.2, alpha: 0.95 });
      graphics.moveTo(handleX, handleY);
      graphics.lineTo(strikeX, strikeY);
      graphics.stroke();

      graphics.setFillStyle({ color: 0x78350f, alpha: 0.98 });
      graphics.circle(strikeX, strikeY, 9.5);
      graphics.fill();
      graphics.setStrokeStyle({ color: 0xfdba74, width: 1.6, alpha: 0.92 });
      graphics.circle(strikeX, strikeY, 9.5);
      graphics.stroke();

      if (strike.progress > 0.58 && strike.progress < 0.92) {
        graphics.setStrokeStyle({ color: 0xfef08a, width: 2.2, alpha: 0.75 });
        const impactRadius = 10 + (strike.progress - 0.58) * 70;
        graphics.circle(target.centerX, target.centerY, impactRadius);
        graphics.stroke();
      }
    },
    [strike, tileGeometry],
  );

  const drawParticles = useCallback((graphics: Graphics) => {
    graphics.clear();
    drawParticlePool(graphics, particlePoolRef.current);
  }, []);

  const drawRingBursts = useCallback((graphics: Graphics) => {
    graphics.clear();
    drawRingPulsePool(graphics, ringPulsePoolRef.current);
  }, []);

  const handleReveal = useCallback(
    (tile: number) => {
      if (!active || locked || revealedSet.has(tile) || strike !== null) {
        return;
      }
      setStrike({ tile, progress: 0 });
      playGameSfx("mines-swat");
      onReveal(tile);
    },
    [active, locked, onReveal, revealedSet, strike],
  );

  return (
    <div className="mines-hunt-shell arena-shell">
      <div className="mines-hunt-stage" ref={hostRef} style={{ height: STAGE_HEIGHT }}>
        {stageReady ? (
          <Application width={STAGE_WIDTH} height={STAGE_HEIGHT} antialias backgroundAlpha={0}>
            <pixiGraphics draw={drawBackdrop} />
            <pixiGraphics draw={drawRingBursts} />
            <pixiContainer ref={sceneLayerRef}>
              <pixiGraphics draw={drawGrid} />
              <pixiGraphics draw={drawStrike} />
            </pixiContainer>
            <pixiContainer ref={rewardSpriteLayerRef} />
            <pixiGraphics draw={drawParticles} />
            <pixiText
              x={16}
              y={12}
              text="BUG HUNT"
              style={{
                fill: "#d1fae5",
                fontFamily: "Space Grotesk",
                fontWeight: "700",
                fontSize: 13,
                letterSpacing: 1.4,
              }}
            />
            <pixiText
              x={STAGE_WIDTH - 16}
              y={12}
              anchor={{ x: 1, y: 0 }}
              text={`${safeHits}/${Math.max(0, totalTiles - bombCount)} SAFE`}
              style={{
                fill: "#99f6e4",
                fontFamily: "IBM Plex Mono",
                fontWeight: "700",
                fontSize: 11,
              }}
            />
          </Application>
        ) : (
          <div className="arena-canvas-fallback">HUNT LOADING...</div>
        )}
        <div
          className="mines-hit-grid"
          style={{
            left: BOARD_LEFT,
            top: BOARD_TOP,
            width: BOARD_WIDTH,
            height: BOARD_HEIGHT,
          }}
        >
          {tileGeometry.map((tile) => {
            const disabled =
              !stageReady ||
              !active ||
              locked ||
              revealedSet.has(tile.tile) ||
              strike !== null;
            return (
              <button
                key={tile.tile}
                type="button"
                className="mines-hit-btn"
                onClick={() => handleReveal(tile.tile)}
                disabled={disabled}
                aria-label={`Reveal tile ${tile.tile + 1}`}
              />
            );
          })}
        </div>
      </div>
      <div className="arena-hud arena-hud-mines">
        <span className="arena-pill arena-pill-info">{`${bombCount} BOMBS`}</span>
        <span className="arena-pill arena-pill-neutral">{`${safeHits} HITS`}</span>
        <span className={`arena-pill ${statusTone(status)}`}>
          {status.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
