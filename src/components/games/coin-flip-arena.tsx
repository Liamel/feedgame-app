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

export function CoinFlipArena({ flipping, choice, landed, outcome }: CoinFlipArenaProps) {
  useExtend({ Container, Graphics, Text });

  const landedSide = landed === "heads" || landed === "tails" ? landed : null;
  const status = flipping ? "Flipping..." : outcome === "win" ? "Win" : outcome === "loss" ? "Loss" : "Ready";

  return (
    <div className="coin-arena-shell">
      <div className="coin-arena-overlay">
        <span>PICK {choice.toUpperCase()}</span>
        <span>{landedSide ? `LANDED ${landedSide.toUpperCase()}` : "LANDED --"}</span>
      </div>
      <div className="coin-arena-overlay coin-arena-bottom">
        <span>TAP TO FLIP</span>
        <span>{status}</span>
      </div>
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
    graphics.setFillStyle({ color: 0x091522, alpha: 0.94 });
    graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
    graphics.fill();

    graphics.setStrokeStyle({ color: 0x334155, width: 1.5, alpha: 0.6 });
    graphics.roundRect(1, 1, STAGE_WIDTH - 2, STAGE_HEIGHT - 2, 15);
    graphics.stroke();
  }, []);

  const drawOrbit = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      for (let i = 0; i < 24; i += 1) {
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

  return (
    <>
      <pixiGraphics draw={drawBackdrop} />
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
      <pixiText
        x={14}
        y={14}
        text="COIN FLIP ARENA"
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
