import { Application, useExtend } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const [stageReady, setStageReady] = useState(
    () => typeof window !== "undefined" && typeof window.IntersectionObserver === "undefined",
  );

  const [phase, setPhase] = useState(0);
  const [flash, setFlash] = useState(0);
  const [strike, setStrike] = useState<StrikeState | null>(null);

  const previousRevealedRef = useRef<number[]>(revealed);
  const pendingFlashRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const host = stageHostRef.current;
    if (!host || stageReady || typeof window === "undefined" || typeof window.IntersectionObserver === "undefined") {
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStageReady(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: "220px" },
    );

    observer.observe(host);
    return () => observer.disconnect();
  }, [stageReady]);

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

  const getAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") {
      return null;
    }
    if (!audioContextRef.current) {
      const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) {
        return null;
      }
      audioContextRef.current = new AudioCtor();
    }
    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const playSwatSfx = useCallback(() => {
    const context = getAudioContext();
    if (!context) {
      return;
    }
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(460, now);
    oscillator.frequency.exponentialRampToValueAtTime(140, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
  }, [getAudioContext]);

  const playHitSfx = useCallback(() => {
    const context = getAudioContext();
    if (!context) {
      return;
    }
    const now = context.currentTime;

    const pop = context.createOscillator();
    const popGain = context.createGain();
    pop.type = "square";
    pop.frequency.setValueAtTime(210, now);
    pop.frequency.exponentialRampToValueAtTime(120, now + 0.1);
    popGain.gain.setValueAtTime(0.0001, now);
    popGain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    pop.connect(popGain).connect(context.destination);
    pop.start(now);
    pop.stop(now + 0.13);

    const sparkle = context.createOscillator();
    const sparkleGain = context.createGain();
    sparkle.type = "triangle";
    sparkle.frequency.setValueAtTime(680, now + 0.02);
    sparkle.frequency.exponentialRampToValueAtTime(980, now + 0.09);
    sparkleGain.gain.setValueAtTime(0.0001, now + 0.02);
    sparkleGain.gain.exponentialRampToValueAtTime(0.08, now + 0.035);
    sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    sparkle.connect(sparkleGain).connect(context.destination);
    sparkle.start(now + 0.02);
    sparkle.stop(now + 0.12);
  }, [getAudioContext]);

  const playBoomSfx = useCallback(() => {
    const context = getAudioContext();
    if (!context) {
      return;
    }
    const now = context.currentTime;
    const burstDuration = 0.24;

    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * burstDuration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1100, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + burstDuration);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + burstDuration);

    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now);
    source.stop(now + burstDuration);
  }, [getAudioContext]);

  useEffect(() => {
    const previousSet = new Set(previousRevealedRef.current);
    const addedTile = revealed.find((tile) => !previousSet.has(tile));
    if (addedTile !== undefined) {
      const bombHit = explodedAt !== null && addedTile === explodedAt;
      if (bombHit) {
        playBoomSfx();
        pendingFlashRef.current = Math.max(pendingFlashRef.current, 1);
      } else {
        playHitSfx();
        pendingFlashRef.current = Math.max(pendingFlashRef.current, 0.45);
      }
    }
    previousRevealedRef.current = revealed;
  }, [explodedAt, playBoomSfx, playHitSfx, revealed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let rafId = 0;
    let lastTime = window.performance.now();

    const tick = (now: number) => {
      const delta = Math.min(34, now - lastTime);
      lastTime = now;

      setPhase((value) => value + delta * 0.028);
      setFlash((value) => {
        const boosted = Math.max(value, pendingFlashRef.current);
        pendingFlashRef.current = 0;
        return Math.max(0, boosted - delta * 0.0019);
      });
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
  }, []);

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

      if (flash > 0) {
        graphics.setFillStyle({ color: explodedAt !== null ? 0xf97316 : 0x10b981, alpha: Math.min(0.55, flash * 0.4) });
        graphics.roundRect(6, 6, STAGE_WIDTH - 12, STAGE_HEIGHT - 12, 14);
        graphics.fill();
      }
    },
    [explodedAt, flash],
  );

  const drawGrid = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      for (const tile of tileGeometry) {
        const isRevealed = revealedSet.has(tile.tile);
        const isBomb = bombSet.has(tile.tile);
        const isExploded = explodedAt === tile.tile;

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

        const wobbleX = Math.sin(phase * 0.18 + tile.tile * 0.7) * 5;
        const wobbleY = Math.cos(phase * 0.14 + tile.tile * 1.15) * 4;
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
          graphics.circle(tile.centerX, tile.centerY, 8.5);
          graphics.fill();
          graphics.setStrokeStyle({ color: 0xfca5a5, width: 1.5, alpha: 0.9 });
          for (let i = 0; i < 8; i += 1) {
            const angle = (i / 8) * Math.PI * 2;
            graphics.moveTo(tile.centerX + Math.cos(angle) * 10, tile.centerY + Math.sin(angle) * 10);
            graphics.lineTo(tile.centerX + Math.cos(angle) * 14, tile.centerY + Math.sin(angle) * 14);
          }
          graphics.stroke();
          if (isExploded) {
            graphics.setStrokeStyle({ color: 0xfdba74, width: 2.4, alpha: 0.92 });
            for (let i = 0; i < 10; i += 1) {
              const angle = (i / 10) * Math.PI * 2 + phase * 0.06;
              graphics.moveTo(tile.centerX + Math.cos(angle) * 12, tile.centerY + Math.sin(angle) * 12);
              graphics.lineTo(tile.centerX + Math.cos(angle) * 22, tile.centerY + Math.sin(angle) * 22);
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
    [bombSet, explodedAt, phase, revealedSet, tileGeometry],
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
      const upPhase = strike.progress > 0.72 ? Math.min(1, (strike.progress - 0.72) / 0.48) : 0;
      const swing = upPhase > 0 ? 1 - upPhase : downPhase;

      const strikeX = startX + (target.centerX - startX) * (0.1 + swing * 0.9);
      const strikeY = startY + (target.centerY - startY) * (0.1 + swing * 0.9);
      const angle = Math.atan2(target.centerY - startY, target.centerX - startX) + 0.22;
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

  const handleReveal = useCallback(
    (tile: number) => {
      if (!active || locked || revealedSet.has(tile) || strike !== null) {
        return;
      }
      setStrike({ tile, progress: 0 });
      playSwatSfx();
      onReveal(tile);
    },
    [active, locked, onReveal, playSwatSfx, revealedSet, strike],
  );

  return (
    <div className="mines-hunt-shell arena-shell">
      <div className="mines-hunt-stage" ref={stageHostRef} style={{ height: STAGE_HEIGHT }}>
        {stageReady ? (
          <Application width={STAGE_WIDTH} height={STAGE_HEIGHT} antialias backgroundAlpha={0}>
            <pixiGraphics draw={drawBackdrop} />
            <pixiGraphics draw={drawGrid} />
            <pixiGraphics draw={drawStrike} />
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
            const disabled = !stageReady || !active || locked || revealedSet.has(tile.tile) || strike !== null;
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
        <span className={`arena-pill ${statusTone(status)}`}>{status.toUpperCase()}</span>
      </div>
    </div>
  );
}
