import { Container, Sprite, Texture } from "pixi.js";

export type RewardSpriteTextureId = "coin" | "diamond" | "shard";

interface RewardSpriteParticle {
  active: boolean;
  sprite: Sprite;
  vx: number;
  vy: number;
  spin: number;
  drag: number;
  gravity: number;
  lifeMs: number;
  maxLifeMs: number;
}

export interface RewardSpritePool {
  particles: RewardSpriteParticle[];
  cursor: number;
  textureIds: RewardSpriteTextureId[];
}

export interface EmitRewardSpriteBurstOptions {
  x: number;
  y: number;
  count: number;
  speedMin?: number;
  speedMax?: number;
  lifeMinMs?: number;
  lifeMaxMs?: number;
  scaleMin?: number;
  scaleMax?: number;
  alphaMin?: number;
  alphaMax?: number;
  gravity?: number;
  drag?: number;
  textureIds?: RewardSpriteTextureId[];
}

const textureCache = new Map<RewardSpriteTextureId, Texture>();

const SVG_TEXTURES: Record<RewardSpriteTextureId, string> = {
  coin: `
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <defs>
        <radialGradient id="g" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#fef9c3" />
          <stop offset="52%" stop-color="#facc15" />
          <stop offset="100%" stop-color="#ca8a04" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="21" fill="url(#g)" />
      <circle cx="24" cy="24" r="18.5" fill="none" stroke="#fde68a" stroke-width="2" />
      <path d="M24 13 L27.8 21.2 L36.8 22 L30 28.2 L32 37 L24 32.6 L16 37 L18 28.2 L11.2 22 L20.2 21.2 Z" fill="#fef3c7" opacity="0.86" />
    </svg>
  `,
  diamond: `
    <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
      <defs>
        <linearGradient id="d" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ecfeff" />
          <stop offset="60%" stop-color="#38bdf8" />
          <stop offset="100%" stop-color="#2563eb" />
        </linearGradient>
      </defs>
      <path d="M22 4 L38 17 L30 38 L14 38 L6 17 Z" fill="url(#d)" />
      <path d="M22 8 L33 17 L28 33 L16 33 L11 17 Z" fill="#e0f2fe" opacity="0.35" />
    </svg>
  `,
  shard: `
    <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
      <defs>
        <linearGradient id="s" x1="0.15" y1="0" x2="0.95" y2="1">
          <stop offset="0%" stop-color="#ffe4e6" />
          <stop offset="55%" stop-color="#fb7185" />
          <stop offset="100%" stop-color="#be123c" />
        </linearGradient>
      </defs>
      <path d="M7 34 L20 5 L38 23 L22 40 Z" fill="url(#s)" />
      <path d="M19 10 L30 23 L22 35 L13 31 Z" fill="#fecdd3" opacity="0.36" />
    </svg>
  `,
};

function toDataUri(rawSvg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rawSvg)}`;
}

function textureFor(id: RewardSpriteTextureId): Texture {
  const cached = textureCache.get(id);
  if (cached) {
    return cached;
  }
  const texture = Texture.from(toDataUri(SVG_TEXTURES[id]));
  textureCache.set(id, texture);
  return texture;
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function nextParticle(pool: RewardSpritePool): RewardSpriteParticle {
  const particle = pool.particles[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.particles.length;
  return particle;
}

export function createRewardSpritePool(
  layer: Container,
  size: number,
  textureIds: RewardSpriteTextureId[],
): RewardSpritePool {
  const particles = Array.from({ length: size }, () => {
    const textureId =
      textureIds[Math.floor(Math.random() * textureIds.length)] ?? "diamond";
    const sprite = new Sprite(textureFor(textureId));
    sprite.anchor.set(0.5);
    sprite.visible = false;
    sprite.blendMode = "add";
    sprite.eventMode = "none";
    layer.addChild(sprite);
    return {
      active: false,
      sprite,
      vx: 0,
      vy: 0,
      spin: 0,
      drag: 0.94,
      gravity: 0.08,
      lifeMs: 0,
      maxLifeMs: 1,
    };
  });

  return {
    particles,
    cursor: 0,
    textureIds,
  };
}

export function emitRewardSpriteBurst(
  pool: RewardSpritePool,
  options: EmitRewardSpriteBurstOptions,
): void {
  const speedMin = options.speedMin ?? 1.8;
  const speedMax = options.speedMax ?? 7.4;
  const lifeMinMs = options.lifeMinMs ?? 260;
  const lifeMaxMs = options.lifeMaxMs ?? 780;
  const scaleMin = options.scaleMin ?? 0.24;
  const scaleMax = options.scaleMax ?? 0.78;
  const alphaMin = options.alphaMin ?? 0.45;
  const alphaMax = options.alphaMax ?? 0.95;
  const gravity = options.gravity ?? 0.1;
  const drag = options.drag ?? 0.93;
  const textureIds = options.textureIds ?? pool.textureIds;

  for (let index = 0; index < options.count; index += 1) {
    const particle = nextParticle(pool);
    const angle = Math.random() * Math.PI * 2;
    const speed = randomInRange(speedMin, speedMax);
    const lifeMs = randomInRange(lifeMinMs, lifeMaxMs);
    const scale = randomInRange(scaleMin, scaleMax);
    const alpha = randomInRange(alphaMin, alphaMax);
    const textureId =
      textureIds[Math.floor(Math.random() * textureIds.length)] ?? "diamond";

    particle.active = true;
    particle.vx = Math.cos(angle) * speed;
    particle.vy = Math.sin(angle) * speed;
    particle.spin = randomInRange(-0.18, 0.18);
    particle.drag = drag;
    particle.gravity = gravity;
    particle.lifeMs = lifeMs;
    particle.maxLifeMs = lifeMs;

    const sprite = particle.sprite;
    sprite.texture = textureFor(textureId);
    sprite.x = options.x;
    sprite.y = options.y;
    sprite.scale.set(scale);
    sprite.alpha = alpha;
    sprite.rotation = randomInRange(0, Math.PI * 2);
    sprite.visible = true;
  }
}

export function updateRewardSpritePool(
  pool: RewardSpritePool,
  deltaMs: number,
): void {
  const step = Math.min(3.2, deltaMs / 16.666);
  for (const particle of pool.particles) {
    if (!particle.active) {
      continue;
    }
    particle.lifeMs -= deltaMs;
    if (particle.lifeMs <= 0) {
      particle.active = false;
      particle.sprite.visible = false;
      continue;
    }

    particle.vx *= Math.pow(particle.drag, step);
    particle.vy =
      (particle.vy + particle.gravity * step) * Math.pow(particle.drag, step);
    const sprite = particle.sprite;
    sprite.x += particle.vx * step;
    sprite.y += particle.vy * step;
    sprite.rotation += particle.spin * step;

    const lifeRatio = Math.max(0, particle.lifeMs / particle.maxLifeMs);
    sprite.alpha = lifeRatio * lifeRatio;
    const scale = sprite.scale.x * (0.996 + lifeRatio * 0.004);
    sprite.scale.set(scale);
  }
}

export function destroyRewardSpritePool(pool: RewardSpritePool): void {
  for (const particle of pool.particles) {
    particle.sprite.destroy();
  }
  pool.particles.length = 0;
  pool.cursor = 0;
}
