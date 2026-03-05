import { Application, useExtend } from "@pixi/react";
import type { Graphics as PixiGraphics } from "pixi.js";
import { Container, Graphics } from "pixi.js";
import { useCallback } from "react";

interface PixiPreviewProps {
  width?: number;
  height?: number;
}

function CoinGraphic() {
  useExtend({ Container, Graphics });

  const drawCoin = useCallback((graphics: PixiGraphics) => {
    graphics.clear();

    graphics.setFillStyle({ color: 0xf59e0b });
    graphics.circle(0, 0, 52);
    graphics.fill();

    graphics.setStrokeStyle({ color: 0x5b3415, width: 4 });
    graphics.circle(0, 0, 52);
    graphics.stroke();

    graphics.setFillStyle({ color: 0x7a4a1f });
    graphics.roundRect(-30, -18, 60, 36, 8);
    graphics.fill();
  }, []);

  const drawGlow = useCallback((graphics: PixiGraphics) => {
    graphics.clear();
    graphics.setFillStyle({ color: 0xffd899, alpha: 0.25 });
    graphics.circle(0, 0, 64);
    graphics.fill();
  }, []);

  return (
    <pixiContainer x={120} y={84}>
      <pixiGraphics draw={drawGlow} />
      <pixiGraphics draw={drawCoin} />
    </pixiContainer>
  );
}

export function PixiPreview({ width = 240, height = 168 }: PixiPreviewProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-[#0f2a2a]">
      <Application width={width} height={height} backgroundAlpha={0} antialias>
        <CoinGraphic />
      </Application>
    </div>
  );
}
