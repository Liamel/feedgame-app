import { Application, useExtend, useTick } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useCallback, useState } from "react";

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

export function CoinFlipArena({ flipping, choice, landed, outcome }: CoinFlipArenaProps) {
  useExtend({ Container, Graphics, Text });

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
      <div className="coin-arena-canvas">
        <Application width={STAGE_WIDTH} height={STAGE_HEIGHT} antialias backgroundAlpha={0}>
          <CoinFlipScene
            flipping={flipping}
            landed={landedSide}
            choice={choice}
            outcome={outcome}
          />
        </Application>
      </div>
      <div className="arena-hud arena-hud-coin">
        <span className="arena-pill arena-pill-info">{choice.toUpperCase()}</span>
        <span className="arena-pill arena-pill-neutral">
          {landedSide ? `LANDED ${landedSide.toUpperCase()}` : "LANDED --"}
        </span>
        <span className={`arena-pill ${statusTone(status)}`}>{status.toUpperCase()}</span>
      </div>
    </div>
  );
}

interface CoinFlipSceneProps {
  flipping: boolean;
  landed: "heads" | "tails" | null;
  choice: "heads" | "tails";
  outcome: "win" | "loss" | null;
}

function CoinFlipScene({ flipping, landed, choice, outcome }: CoinFlipSceneProps) {
  const [frame, setFrame] = useState<CoinFrame>({
    spin: 0,
    flatten: 1,
    bob: 0,
    glow: 0,
  });

  useTick((ticker) => {
    const delta = ticker.deltaMS;
    setFrame((previous) => {
      let spin = previous.spin;
      let bob = previous.bob;
      let glow = previous.glow;

      if (flipping) {
        spin += 0.52 + Math.sin(glow * 0.12) * 0.03;
        bob = Math.sin(glow * 0.22) * 7;
        glow += delta * 0.06;
      } else {
        if (landed) {
          const target = landed === "tails" ? Math.PI : 0;
          const diff = ((((target - spin) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          spin += diff * 0.22;
        } else {
          spin += 0.024;
        }
        bob += (0 - bob) * 0.18;
        glow += delta * 0.015;
      }

      return {
        spin,
        flatten: Math.max(0.12, Math.abs(Math.cos(spin))),
        bob,
        glow,
      };
    });
  });

  const visibleSide =
    landed && !flipping
      ? landed
      : Math.cos(frame.spin) >= 0
        ? "heads"
        : "tails";

  const accent =
    outcome === "win" ? 0x22c55e : outcome === "loss" ? 0xf43f5e : choice === "heads" ? 0xf59e0b : 0x38bdf8;

  const drawBackdrop = useCallback((graphics: Graphics) => {
    graphics.clear();
    graphics.setFillStyle({ color: 0x091522, alpha: 0.95 });
    graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
    graphics.fill();

    graphics.setFillStyle({ color: 0x3b1f08, alpha: 0.26 });
    graphics.circle(58, 48, 92);
    graphics.fill();

    graphics.setFillStyle({ color: 0x0f2e54, alpha: 0.22 });
    graphics.circle(STAGE_WIDTH - 56, 42, 88);
    graphics.fill();
  }, []);

  const drawOrbit = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      for (let i = 0; i < 28; i += 1) {
        const theta = frame.glow * 0.045 + i * 0.42;
        const radius = 66 + Math.sin(theta * 2.4) * 9;
        const x = Math.cos(theta) * radius;
        const y = Math.sin(theta) * 32;
        graphics.setFillStyle({ color: i % 2 === 0 ? accent : 0x93c5fd, alpha: 0.09 + (i % 4) * 0.03 });
        graphics.circle(x, y, 1.6 + (i % 3));
        graphics.fill();
      }
    },
    [accent, frame.glow],
  );

  const drawCoinCore = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: 0xf8fafc, alpha: 0.98 });
      graphics.circle(0, 0, 52);
      graphics.fill();

      graphics.setStrokeStyle({ color: accent, width: 6, alpha: 0.82 });
      graphics.circle(0, 0, 52);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0x0f172a, width: 2, alpha: 0.65 });
      graphics.circle(0, 0, 42);
      graphics.stroke();
    },
    [accent],
  );

  const drawPulse = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const radius = 70 + Math.sin(frame.glow * 0.09) * 9;
      graphics.setStrokeStyle({ color: accent, width: 2.2, alpha: flipping ? 0.45 : 0.22 });
      graphics.circle(STAGE_WIDTH / 2, 100 + frame.bob, radius);
      graphics.stroke();
    },
    [accent, flipping, frame.bob, frame.glow],
  );

  return (
    <>
      <pixiGraphics draw={drawBackdrop} />
      <pixiGraphics draw={drawPulse} />
      <pixiContainer x={STAGE_WIDTH / 2} y={96 + frame.bob}>
        <pixiGraphics draw={drawOrbit} />
      </pixiContainer>
      <pixiContainer x={STAGE_WIDTH / 2} y={100 + frame.bob} scale={{ x: frame.flatten, y: 1 }}>
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
          fontSize: 52,
        }}
      />
    </>
  );
}
