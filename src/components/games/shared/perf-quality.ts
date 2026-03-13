import { useCallback, useEffect, useMemo, useState } from "react";

export type ArenaQualityTier = "low" | "medium" | "high";

const QUALITY_ORDER: ArenaQualityTier[] = ["low", "medium", "high"];
const QUALITY_SCALE: Record<ArenaQualityTier, number> = {
  low: 0.58,
  medium: 0.8,
  high: 1,
};

function nextLowerTier(tier: ArenaQualityTier): ArenaQualityTier {
  const currentIndex = QUALITY_ORDER.indexOf(tier);
  return QUALITY_ORDER[Math.max(0, currentIndex - 1)] ?? "low";
}

function nextHigherTier(tier: ArenaQualityTier): ArenaQualityTier {
  const currentIndex = QUALITY_ORDER.indexOf(tier);
  return QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, currentIndex + 1)] ?? "high";
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function initialQualityFromDevice(): ArenaQualityTier {
  if (typeof navigator === "undefined") {
    return "high";
  }

  const cores = navigator.hardwareConcurrency ?? 4;
  const navWithMemory = navigator as Navigator & { deviceMemory?: number };
  const memory = navWithMemory.deviceMemory ?? 4;
  if (prefersReducedMotion()) {
    return "low";
  }
  if (cores <= 4 || memory <= 4) {
    return "medium";
  }
  return "high";
}

function tierIndex(tier: ArenaQualityTier): number {
  return QUALITY_ORDER.indexOf(tier);
}

interface UseArenaQualityOptions {
  active: boolean;
  sampleMs?: number;
}

export interface ArenaQualityProfile {
  tier: ArenaQualityTier;
  qualityScale: number;
  scaleCount: (count: number, minimum?: number) => number;
  scaleAlpha: (alpha: number) => number;
}

export function scaleCountByQuality(
  count: number,
  tier: ArenaQualityTier,
  minimum = 1,
): number {
  return Math.max(minimum, Math.round(count * QUALITY_SCALE[tier]));
}

export function scaleAlphaByQuality(alpha: number, tier: ArenaQualityTier): number {
  return alpha * (0.72 + QUALITY_SCALE[tier] * 0.34);
}

export function useArenaQuality(
  options: UseArenaQualityOptions,
): ArenaQualityProfile {
  const { active, sampleMs = 1200 } = options;
  const detectedMaxTier = useMemo(() => initialQualityFromDevice(), []);
  const [tier, setTier] = useState<ArenaQualityTier>(detectedMaxTier);

  useEffect(() => {
    if (!active || typeof window === "undefined" || prefersReducedMotion()) {
      return;
    }

    let rafId = 0;
    let start = window.performance.now();
    let frameCount = 0;

    const tick = (now: number) => {
      frameCount += 1;
      const elapsed = now - start;
      if (elapsed >= sampleMs) {
        const fps = (frameCount * 1000) / elapsed;
        setTier((previous) => {
          const maxTier = detectedMaxTier;
          if (fps < 44) {
            return nextLowerTier(previous);
          }
          if (fps > 57 && tierIndex(previous) < tierIndex(maxTier)) {
            return nextHigherTier(previous);
          }
          return previous;
        });
        start = now;
        frameCount = 0;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [active, detectedMaxTier, sampleMs]);

  const scaleCount = useCallback(
    (count: number, minimum = 1) => scaleCountByQuality(count, tier, minimum),
    [tier],
  );
  const scaleAlpha = useCallback((alpha: number) => scaleAlphaByQuality(alpha, tier), [tier]);

  return useMemo(
    () => ({
      tier,
      qualityScale: QUALITY_SCALE[tier],
      scaleCount,
      scaleAlpha,
    }),
    [scaleAlpha, scaleCount, tier],
  );
}
