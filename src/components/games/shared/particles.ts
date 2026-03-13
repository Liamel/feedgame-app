import type { Graphics } from "pixi.js";

export interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
  maxLifeMs: number;
  radius: number;
  color: number;
  alpha: number;
  drag: number;
  gravity: number;
}

export interface ParticlePool {
  particles: PooledParticle[];
  cursor: number;
}

export interface EmitBurstOptions {
  x: number;
  y: number;
  count: number;
  colors: number[];
  speedMin?: number;
  speedMax?: number;
  radiusMin?: number;
  radiusMax?: number;
  lifeMinMs?: number;
  lifeMaxMs?: number;
  alphaMin?: number;
  alphaMax?: number;
  drag?: number;
  gravity?: number;
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function nextParticle(pool: ParticlePool): PooledParticle {
  const particle = pool.particles[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.particles.length;
  return particle;
}

export function createParticlePool(size: number): ParticlePool {
  return {
    particles: Array.from({ length: size }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      lifeMs: 0,
      maxLifeMs: 1,
      radius: 1,
      color: 0xffffff,
      alpha: 1,
      drag: 0.96,
      gravity: 0,
    })),
    cursor: 0,
  };
}

export function emitParticleBurst(
  pool: ParticlePool,
  options: EmitBurstOptions,
): void {
  const speedMin = options.speedMin ?? 2.4;
  const speedMax = options.speedMax ?? 8.8;
  const radiusMin = options.radiusMin ?? 1.3;
  const radiusMax = options.radiusMax ?? 3.6;
  const lifeMinMs = options.lifeMinMs ?? 220;
  const lifeMaxMs = options.lifeMaxMs ?? 700;
  const alphaMin = options.alphaMin ?? 0.45;
  const alphaMax = options.alphaMax ?? 0.95;
  const drag = options.drag ?? 0.94;
  const gravity = options.gravity ?? 0.06;

  for (let index = 0; index < options.count; index += 1) {
    const particle = nextParticle(pool);
    const angle = Math.random() * Math.PI * 2;
    const speed = randomInRange(speedMin, speedMax);
    const lifeMs = randomInRange(lifeMinMs, lifeMaxMs);
    const color =
      options.colors[Math.floor(Math.random() * options.colors.length)] ??
      0xffffff;

    particle.active = true;
    particle.x = options.x;
    particle.y = options.y;
    particle.vx = Math.cos(angle) * speed;
    particle.vy = Math.sin(angle) * speed;
    particle.lifeMs = lifeMs;
    particle.maxLifeMs = lifeMs;
    particle.radius = randomInRange(radiusMin, radiusMax);
    particle.color = color;
    particle.alpha = randomInRange(alphaMin, alphaMax);
    particle.drag = drag;
    particle.gravity = gravity;
  }
}

export function updateParticlePool(pool: ParticlePool, deltaMs: number): void {
  const deltaScale = Math.min(3.2, deltaMs / 16.666);
  for (const particle of pool.particles) {
    if (!particle.active) {
      continue;
    }
    particle.lifeMs -= deltaMs;
    if (particle.lifeMs <= 0) {
      particle.active = false;
      continue;
    }

    particle.vx *= Math.pow(particle.drag, deltaScale);
    particle.vy =
      (particle.vy + particle.gravity * deltaScale) *
      Math.pow(particle.drag, deltaScale);
    particle.x += particle.vx * deltaScale;
    particle.y += particle.vy * deltaScale;
  }
}

export function drawParticlePool(
  graphics: Graphics,
  pool: ParticlePool,
): void {
  for (const particle of pool.particles) {
    if (!particle.active) {
      continue;
    }
    const lifeRatio = Math.max(0, particle.lifeMs / particle.maxLifeMs);
    const alpha = particle.alpha * lifeRatio;
    graphics.setFillStyle({ color: particle.color, alpha });
    graphics.circle(
      particle.x,
      particle.y,
      particle.radius * (0.72 + lifeRatio * 0.45),
    );
    graphics.fill();
  }
}
