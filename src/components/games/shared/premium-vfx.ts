import type { Graphics } from "pixi.js";

interface Rng {
  next: () => number;
}

export interface AmbientOrb {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: number;
  driftX: number;
  driftY: number;
  wobble: number;
  phase: number;
  depth: number;
}

interface AmbientFieldOptions {
  seed: number;
  count: number;
  width: number;
  height: number;
  colors: number[];
  radiusMin?: number;
  radiusMax?: number;
  alphaMin?: number;
  alphaMax?: number;
}

export interface RingPulse {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  growth: number;
  lifeMs: number;
  maxLifeMs: number;
  color: number;
  alpha: number;
  width: number;
}

export interface RingPulsePool {
  pulses: RingPulse[];
  cursor: number;
}

export interface EmitRingBurstOptions {
  x: number;
  y: number;
  count: number;
  colors: number[];
  radiusMin?: number;
  radiusMax?: number;
  growthMin?: number;
  growthMax?: number;
  lifeMinMs?: number;
  lifeMaxMs?: number;
  alphaMin?: number;
  alphaMax?: number;
  widthMin?: number;
  widthMax?: number;
}

export interface ScreenShakeState {
  x: number;
  y: number;
  trauma: number;
  phase: number;
}

function createRng(seed: number): Rng {
  let value = seed >>> 0;
  return {
    next: () => {
      value += 0x6d2b79f5;
      let next = value;
      next = Math.imul(next ^ (next >>> 15), next | 1);
      next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function randomInRange(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

export function createAmbientField(options: AmbientFieldOptions): AmbientOrb[] {
  const rng = createRng(options.seed);
  const radiusMin = options.radiusMin ?? 0.8;
  const radiusMax = options.radiusMax ?? 3.8;
  const alphaMin = options.alphaMin ?? 0.02;
  const alphaMax = options.alphaMax ?? 0.16;

  return Array.from({ length: options.count }, () => {
    const depth = randomInRange(rng, 0.55, 1.55);
    return {
      x: randomInRange(rng, 0, options.width),
      y: randomInRange(rng, 0, options.height),
      radius: randomInRange(rng, radiusMin, radiusMax),
      alpha: randomInRange(rng, alphaMin, alphaMax),
      color:
        options.colors[Math.floor(rng.next() * options.colors.length)] ??
        0xffffff,
      driftX: randomInRange(rng, -0.46, 0.46),
      driftY: randomInRange(rng, -0.34, 0.34),
      wobble: randomInRange(rng, 0.38, 1.24),
      phase: randomInRange(rng, 0, Math.PI * 2),
      depth,
    };
  });
}

export function drawAmbientField(
  graphics: Graphics,
  field: AmbientOrb[],
  phase: number,
  width: number,
  height: number,
): void {
  const paddedWidth = width + 52;
  const paddedHeight = height + 52;
  for (const orb of field) {
    const xRaw =
      orb.x +
      phase * orb.driftX * 26 * orb.depth +
      Math.sin(phase * orb.wobble + orb.phase) * 14 * orb.depth;
    const yRaw =
      orb.y +
      phase * orb.driftY * 22 * orb.depth +
      Math.cos(phase * orb.wobble * 0.84 + orb.phase) * 10 * orb.depth;

    const x = ((xRaw + 26) % paddedWidth + paddedWidth) % paddedWidth - 26;
    const y = ((yRaw + 26) % paddedHeight + paddedHeight) % paddedHeight - 26;
    const pulse =
      0.72 + Math.abs(Math.sin(phase * (0.92 + orb.depth * 0.18) + orb.phase)) * 0.48;

    graphics.setFillStyle({
      color: orb.color,
      alpha: orb.alpha * (0.5 + orb.depth * 0.24),
    });
    graphics.circle(x, y, orb.radius * pulse);
    graphics.fill();
  }
}

export function drawLightBeams(
  graphics: Graphics,
  phase: number,
  width: number,
  height: number,
  colors: number[],
  alphaScale: number,
): void {
  const beamCount = 4;
  for (let index = 0; index < beamCount; index += 1) {
    const progress = (phase * 0.021 + index / beamCount) % 1;
    const beamWidth = 30 + index * 12;
    const x = progress * (width + beamWidth * 2) - beamWidth;
    const color = colors[index % colors.length] ?? 0xffffff;
    const alpha = (0.05 + (index % 2) * 0.03) * alphaScale;

    graphics.setFillStyle({ color, alpha });
    graphics.moveTo(x - beamWidth, -20);
    graphics.lineTo(x + beamWidth * 0.45, -20);
    graphics.lineTo(x + beamWidth * 1.25, height + 20);
    graphics.lineTo(x - beamWidth * 0.2, height + 20);
    graphics.closePath();
    graphics.fill();
  }
}

export function drawVignetteFrame(
  graphics: Graphics,
  width: number,
  height: number,
  alpha: number,
): void {
  const clamped = Math.max(0, Math.min(0.85, alpha));
  const radius = Math.max(width, height) * 0.6;
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ];
  for (const corner of corners) {
    graphics.setFillStyle({ color: 0x020617, alpha: clamped });
    graphics.circle(corner.x, corner.y, radius);
    graphics.fill();
  }
}

function nextRingPulse(pool: RingPulsePool): RingPulse {
  const pulse = pool.pulses[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.pulses.length;
  return pulse;
}

export function createRingPulsePool(size: number): RingPulsePool {
  return {
    pulses: Array.from({ length: size }, () => ({
      active: false,
      x: 0,
      y: 0,
      radius: 0,
      growth: 1,
      lifeMs: 0,
      maxLifeMs: 1,
      color: 0xffffff,
      alpha: 0.6,
      width: 2,
    })),
    cursor: 0,
  };
}

export function emitRingPulseBurst(
  pool: RingPulsePool,
  options: EmitRingBurstOptions,
): void {
  const radiusMin = options.radiusMin ?? 30;
  const radiusMax = options.radiusMax ?? 78;
  const growthMin = options.growthMin ?? 1.5;
  const growthMax = options.growthMax ?? 3.7;
  const lifeMinMs = options.lifeMinMs ?? 320;
  const lifeMaxMs = options.lifeMaxMs ?? 780;
  const alphaMin = options.alphaMin ?? 0.22;
  const alphaMax = options.alphaMax ?? 0.68;
  const widthMin = options.widthMin ?? 1.5;
  const widthMax = options.widthMax ?? 4.2;

  for (let index = 0; index < options.count; index += 1) {
    const pulse = nextRingPulse(pool);
    const lifeMs = lifeMinMs + Math.random() * (lifeMaxMs - lifeMinMs);
    pulse.active = true;
    pulse.x = options.x;
    pulse.y = options.y;
    pulse.radius = radiusMin + Math.random() * (radiusMax - radiusMin);
    pulse.growth = growthMin + Math.random() * (growthMax - growthMin);
    pulse.lifeMs = lifeMs;
    pulse.maxLifeMs = lifeMs;
    pulse.color =
      options.colors[Math.floor(Math.random() * options.colors.length)] ??
      0xffffff;
    pulse.alpha = alphaMin + Math.random() * (alphaMax - alphaMin);
    pulse.width = widthMin + Math.random() * (widthMax - widthMin);
  }
}

export function updateRingPulsePool(pool: RingPulsePool, deltaMs: number): void {
  const step = Math.min(3.2, deltaMs / 16.666);
  for (const pulse of pool.pulses) {
    if (!pulse.active) {
      continue;
    }
    pulse.lifeMs -= deltaMs;
    if (pulse.lifeMs <= 0) {
      pulse.active = false;
      continue;
    }
    pulse.radius += pulse.growth * step;
  }
}

export function drawRingPulsePool(
  graphics: Graphics,
  pool: RingPulsePool,
): void {
  for (const pulse of pool.pulses) {
    if (!pulse.active) {
      continue;
    }
    const lifeRatio = Math.max(0, pulse.lifeMs / pulse.maxLifeMs);
    graphics.setStrokeStyle({
      color: pulse.color,
      alpha: pulse.alpha * lifeRatio,
      width: pulse.width * (0.55 + lifeRatio),
    });
    graphics.circle(pulse.x, pulse.y, pulse.radius * (1 + (1 - lifeRatio) * 0.22));
    graphics.stroke();
  }
}

export function createScreenShakeState(): ScreenShakeState {
  return {
    x: 0,
    y: 0,
    trauma: 0,
    phase: Math.random() * Math.PI * 2,
  };
}

export function addScreenShakeTrauma(
  state: ScreenShakeState,
  amount: number,
): void {
  state.trauma = Math.max(0, Math.min(1, state.trauma + amount));
}

export function updateScreenShake(
  state: ScreenShakeState,
  deltaMs: number,
): void {
  if (state.trauma <= 0.0001) {
    state.trauma = 0;
    state.x = 0;
    state.y = 0;
    return;
  }

  const decay = deltaMs * 0.0017;
  state.trauma = Math.max(0, state.trauma - decay);
  state.phase += deltaMs * 0.03;
  const amplitude = state.trauma * state.trauma * 8.4;
  state.x = Math.sin(state.phase * 1.73) * amplitude;
  state.y = Math.cos(state.phase * 2.14) * amplitude;
}
