import { Application, useExtend, useTick } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

export function DiceArena({ rolling, rollValue, threshold, direction, outcome }: DiceArenaProps) {
  useExtend({ Container, Graphics, Text });

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
      <div className="arena-hud arena-hud-dice">
        <span className="arena-pill arena-pill-info">
          {direction.toUpperCase()} {thresholdClamped}
        </span>
        <span className="arena-pill arena-pill-neutral">
          {effectiveRoll !== null ? `ROLL ${effectiveRoll}` : "ROLL --"}
        </span>
        <span className={`arena-pill ${statusTone(status)}`}>{status.toUpperCase()}</span>
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
  const [spin, setSpin] = useState(0);
  const [sparkPhase, setSparkPhase] = useState(0);
  const [shakeX, setShakeX] = useState(0);
  const [shakeY, setShakeY] = useState(0);
  const [burst, setBurst] = useState(0);
  const [impactFlash, setImpactFlash] = useState(0);

  const rollAccumulator = useRef(0);
  const elapsed = useRef(0);
  const burstBoostRef = useRef(0);
  const impactBoostRef = useRef(0);
  const prevOutcomeRef = useRef<"win" | "loss" | null>(null);
  const prevRollingRef = useRef(rolling);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rollOscRef = useRef<OscillatorNode | null>(null);
  const rollGainRef = useRef<GainNode | null>(null);

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

  const stopRollLoop = useCallback(() => {
    if (rollOscRef.current) {
      try {
        rollOscRef.current.stop();
      } catch {
        // ignore repeated stop calls
      }
      rollOscRef.current.disconnect();
    }
    rollOscRef.current = null;
    if (rollGainRef.current) {
      rollGainRef.current.gain.value = 0;
      rollGainRef.current.disconnect();
    }
    rollGainRef.current = null;
  }, []);

  const startRollLoop = useCallback(() => {
    const context = getAudioContext();
    if (!context || rollOscRef.current) {
      return;
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(160, now);
    oscillator.frequency.linearRampToValueAtTime(280, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.05);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    rollOscRef.current = oscillator;
    rollGainRef.current = gain;
  }, [getAudioContext]);

  const playOutcomeSfx = useCallback(
    (result: "win" | "loss") => {
      const context = getAudioContext();
      if (!context) {
        return;
      }
      const now = context.currentTime;

      const tone = context.createOscillator();
      const toneGain = context.createGain();
      tone.type = result === "win" ? "triangle" : "square";
      tone.frequency.setValueAtTime(result === "win" ? 360 : 190, now);
      tone.frequency.exponentialRampToValueAtTime(result === "win" ? 780 : 95, now + 0.24);
      toneGain.gain.setValueAtTime(0.0001, now);
      toneGain.gain.exponentialRampToValueAtTime(0.2, now + 0.035);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      tone.connect(toneGain).connect(context.destination);
      tone.start(now);
      tone.stop(now + 0.28);

      if (result === "win") {
        const sparkle = context.createOscillator();
        const sparkleGain = context.createGain();
        sparkle.type = "sine";
        sparkle.frequency.setValueAtTime(850, now + 0.04);
        sparkle.frequency.exponentialRampToValueAtTime(1320, now + 0.18);
        sparkleGain.gain.setValueAtTime(0.0001, now + 0.04);
        sparkleGain.gain.exponentialRampToValueAtTime(0.08, now + 0.08);
        sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        sparkle.connect(sparkleGain).connect(context.destination);
        sparkle.start(now + 0.04);
        sparkle.stop(now + 0.21);
      }
    },
    [getAudioContext],
  );

  useEffect(() => {
    if (rolling && !prevRollingRef.current) {
      startRollLoop();
    }
    if (!rolling && prevRollingRef.current) {
      stopRollLoop();
    }
    prevRollingRef.current = rolling;
  }, [rolling, startRollLoop, stopRollLoop]);

  useEffect(() => {
    if (!rolling && outcome && prevOutcomeRef.current !== outcome) {
      burstBoostRef.current = 1;
      impactBoostRef.current = 1;
      playOutcomeSfx(outcome);
    }
    if (rolling) {
      prevOutcomeRef.current = null;
    } else {
      prevOutcomeRef.current = outcome;
    }
  }, [outcome, playOutcomeSfx, rolling]);

  useEffect(
    () => () => {
      stopRollLoop();
    },
    [stopRollLoop],
  );

  useTick((ticker) => {
    const deltaMs = ticker.deltaMS;
    elapsed.current += deltaMs;
    rollAccumulator.current += deltaMs;

    if (rolling && rollAccumulator.current >= 44) {
      rollAccumulator.current = 0;
      setRollingNumber(Math.floor(Math.random() * 100));
    }

    const time = elapsed.current / 1000;
    if (rolling) {
      setTilt(Math.sin(time * 13) * 0.5);
      setSpin((previous) => previous + 0.37);
      setScale(1.1 + Math.sin(time * 22) * 0.1);
      setSparkPhase((previous) => (previous + 1.7) % 4000);
      setShakeX((Math.random() - 0.5) * 12);
      setShakeY((Math.random() - 0.5) * 12);
    } else {
      const settleJitter = impactBoostRef.current * 12;
      setTilt((previous) => previous * 0.78);
      setSpin((previous) => previous * 0.9);
      setScale((previous) => previous + (1 - previous) * 0.26);
      setSparkPhase((previous) => (previous + 0.35) % 4000);
      setShakeX((previous) => previous * 0.52 + (Math.random() - 0.5) * settleJitter);
      setShakeY((previous) => previous * 0.52 + (Math.random() - 0.5) * settleJitter);
    }

    setBurst((previous) => {
      let next = previous;
      if (burstBoostRef.current > 0) {
        next = Math.max(next, burstBoostRef.current);
        burstBoostRef.current *= 0.84;
        if (burstBoostRef.current < 0.02) {
          burstBoostRef.current = 0;
        }
      }
      if (rolling) {
        next = Math.max(next, 0.18);
      } else {
        next = Math.max(0, next - 0.034);
      }
      return next;
    });

    setImpactFlash((previous) => {
      let next = previous;
      if (impactBoostRef.current > 0) {
        next = Math.max(next, impactBoostRef.current);
        impactBoostRef.current *= 0.79;
        if (impactBoostRef.current < 0.02) {
          impactBoostRef.current = 0;
        }
      }
      if (rolling) {
        next = Math.max(next - 0.02, 0);
      } else {
        next = Math.max(next - 0.06, 0);
      }
      return next;
    });
  });

  const effectiveRoll = clampInt(rolling ? rollingNumber : (rollValue ?? rollingNumber), 0, 99);
  const thresholdX = GAUGE_LEFT + (threshold / 100) * GAUGE_WIDTH;
  const rollX = GAUGE_LEFT + (effectiveRoll / 100) * GAUGE_WIDTH;

  const accent =
    outcome === "win" ? 0x22c55e : outcome === "loss" ? 0xf43f5e : direction === "over" ? 0x38bdf8 : 0xa78bfa;

  const drawBackdrop = useCallback((graphics: Graphics) => {
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
  }, []);

  const drawPulse = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const pulseRadius = 124 + Math.sin(sparkPhase * 0.04) * 13;
      graphics.setStrokeStyle({
        color: accent,
        width: 3.2,
        alpha: rolling ? 0.54 : 0.2 + burst * 0.2,
      });
      graphics.circle(DIE_CENTER_X, DIE_CENTER_Y, pulseRadius);
      graphics.stroke();
    },
    [accent, burst, rolling, sparkPhase],
  );

  const drawShockwave = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (burst <= 0.08) {
        return;
      }
      const loop = (sparkPhase * 0.006) % 1;
      for (let index = 0; index < 3; index += 1) {
        const progress = (loop + index * 0.33) % 1;
        const alpha = Math.max(0, (1 - progress) * (0.15 + burst * 0.54));
        graphics.setStrokeStyle({
          color: accent,
          width: 2.1 + impactFlash * 2.6,
          alpha,
        });
        graphics.circle(DIE_CENTER_X, DIE_CENTER_Y, 92 + progress * 230);
        graphics.stroke();
      }
    },
    [accent, burst, impactFlash, sparkPhase],
  );

  const drawScanner = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const speed = rolling ? 1 : 0.35;
      for (let index = 0; index < 8; index += 1) {
        const offset = (sparkPhase * speed + index * 17) % 32;
        const laneY = 16 + index * 38 + offset;
        const alpha = rolling ? 0.08 : 0.045;
        graphics.setFillStyle({ color: accent, alpha });
        graphics.roundRect(10, laneY, STAGE_WIDTH - 20, 8, 5);
        graphics.fill();
      }
    },
    [accent, rolling, sparkPhase],
  );

  const drawSparkles = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      for (const spark of sparks) {
        const wobble = Math.sin(spark.seed + sparkPhase * 0.05);
        const float = Math.cos(spark.seed * 1.7 + sparkPhase * 0.04);
        const alpha = (rolling ? 0.16 : 0.07) + Math.abs(wobble) * (rolling ? 0.26 : 0.08);
        const color = spark.hue === "cyan" ? 0x67e8f9 : spark.hue === "amber" ? 0xfde68a : 0xfda4af;

        graphics.setFillStyle({ color, alpha });
        graphics.circle(
          spark.orbitX + wobble * spark.drift * 2.2,
          spark.orbitY + float * spark.drift * 1.7,
          spark.radius + Math.abs(float) * 1.2,
        );
        graphics.fill();
      }
    },
    [rolling, sparkPhase, sparks],
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

      graphics.setStrokeStyle({ color: accent, width: 3.4, alpha: 0.98 });
      graphics.moveTo(thresholdX, STAGE_HEIGHT - 62);
      graphics.lineTo(thresholdX, STAGE_HEIGHT - 30);
      graphics.stroke();

      graphics.setFillStyle({ color: 0xf8fafc, alpha: 0.98 });
      graphics.circle(rollX, STAGE_HEIGHT - 46, 7.2);
      graphics.fill();

      graphics.setStrokeStyle({ color: 0x0f172a, width: 1.5, alpha: 0.9 });
      graphics.circle(rollX, STAGE_HEIGHT - 46, 7.2);
      graphics.stroke();
    },
    [accent, rollX, thresholdX],
  );

  const drawGlow = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: accent, alpha: rolling ? 0.42 : 0.16 + burst * 0.16 });
      graphics.circle(0, 0, 122);
      graphics.fill();
    },
    [accent, burst, rolling],
  );

  const drawTrail = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (!rolling) {
        return;
      }
      for (let index = 0; index < 4; index += 1) {
        const distance = (index + 1) * 9;
        const angle = spin * 0.9 + index * 0.7;
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
    [accent, rolling, spin],
  );

  const drawDie = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setFillStyle({ color: 0xf8fafc, alpha: 0.98 });
      graphics.roundRect(-78, -78, 156, 156, 28);
      graphics.fill();

      graphics.setStrokeStyle({ color: accent, width: 5.2, alpha: 0.9 });
      graphics.roundRect(-78, -78, 156, 156, 28);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0x0f172a, width: 1.4, alpha: 0.26 });
      graphics.roundRect(-66, -66, 132, 132, 22);
      graphics.stroke();
    },
    [accent],
  );

  const drawFlash = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (!outcome || burst <= 0) {
        return;
      }
      graphics.setFillStyle({
        color: outcome === "win" ? 0x22c55e : 0xf43f5e,
        alpha: Math.min(0.45, burst * 0.3 + impactFlash * 0.24),
      });
      graphics.roundRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 16);
      graphics.fill();
    },
    [burst, impactFlash, outcome],
  );

  const bannerText = rolling
    ? "ROLLING"
    : outcome === "win"
      ? "CRITICAL WIN"
      : outcome === "loss"
        ? "BUSTED"
        : direction === "over"
          ? "SHOOT HIGH"
          : "PLAY LOW";

  const bannerColor = rolling ? "#fde68a" : outcome === "win" ? "#86efac" : outcome === "loss" ? "#fecdd3" : "#bae6fd";
  const bannerScale = rolling ? 1 + Math.sin(sparkPhase * 0.09) * 0.03 : 1 + impactFlash * 0.08;

  return (
    <>
      <pixiGraphics draw={drawBackdrop} />
      <pixiGraphics draw={drawScanner} />
      <pixiGraphics draw={drawSparkles} />
      <pixiGraphics draw={drawPulse} />
      <pixiGraphics draw={drawShockwave} />
      <pixiGraphics draw={drawGauge} />
      <pixiContainer
        x={DIE_CENTER_X + shakeX}
        y={DIE_CENTER_Y + shakeY}
        rotation={tilt + spin * 0.05}
        scale={scale}
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
      <pixiGraphics draw={drawFlash} />
    </>
  );
}
