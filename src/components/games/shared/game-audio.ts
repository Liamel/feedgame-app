import { useSyncExternalStore } from "react";

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export type GameSfxId =
  | "ui-hover"
  | "ui-click"
  | "coin-flip"
  | "coin-land-win"
  | "coin-land-loss"
  | "wheel-spin"
  | "wheel-stop"
  | "card-deal"
  | "card-reveal"
  | "dice-roll"
  | "dice-win"
  | "dice-loss"
  | "mines-swat"
  | "mines-safe"
  | "mines-boom"
  | "reward-pop";

interface GameAudioState {
  muted: boolean;
  volume: number;
}

interface PlaySfxOptions {
  intensity?: number;
  cooldownMs?: number;
}

interface ToneSpec {
  type: OscillatorType;
  startHz: number;
  endHz: number;
  attack: number;
  release: number;
  gain: number;
  delay?: number;
}

const STORAGE_KEY = "feedgame_audio_state_v1";
const DEFAULT_AUDIO_STATE: GameAudioState = {
  muted: false,
  volume: 0.72,
};

const DEFAULT_COOLDOWN_MS: Record<GameSfxId, number> = {
  "ui-hover": 120,
  "ui-click": 60,
  "coin-flip": 120,
  "coin-land-win": 200,
  "coin-land-loss": 200,
  "wheel-spin": 180,
  "wheel-stop": 240,
  "card-deal": 180,
  "card-reveal": 180,
  "dice-roll": 120,
  "dice-win": 220,
  "dice-loss": 220,
  "mines-swat": 90,
  "mines-safe": 130,
  "mines-boom": 300,
  "reward-pop": 110,
};

const audioListeners = new Set<() => void>();
const sfxLastPlayedAt = new Map<GameSfxId, number>();
let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let state: GameAudioState = readStateFromStorage();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readStateFromStorage(): GameAudioState {
  if (typeof window === "undefined") {
    return DEFAULT_AUDIO_STATE;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_AUDIO_STATE;
    }
    const parsed = JSON.parse(raw) as Partial<GameAudioState>;
    const muted = Boolean(parsed.muted);
    const volume = clamp(Number(parsed.volume ?? DEFAULT_AUDIO_STATE.volume), 0, 1);
    return { muted, volume };
  } catch {
    return DEFAULT_AUDIO_STATE;
  }
}

function writeStateToStorage(nextState: GameAudioState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // ignore storage errors
  }
}

function notifyAudioListeners(): void {
  for (const listener of audioListeners) {
    listener();
  }
}

function getNowMs(): number {
  if (typeof performance !== "undefined") {
    return performance.now();
  }
  return Date.now();
}

function canPlaySfx(eventId: GameSfxId, cooldownMs?: number): boolean {
  const now = getNowMs();
  const last = sfxLastPlayedAt.get(eventId) ?? -Infinity;
  const minDelay = cooldownMs ?? DEFAULT_COOLDOWN_MS[eventId];
  if (now - last < minDelay) {
    return false;
  }
  sfxLastPlayedAt.set(eventId, now);
  return true;
}

function syncMasterGain(): void {
  if (!masterGain) {
    return;
  }
  masterGain.gain.value = state.muted ? 0 : state.volume;
}

function ensureAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (!audioContext) {
    const AudioCtor =
      window.AudioContext ||
      (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioCtor) {
      return null;
    }
    audioContext = new AudioCtor();
  }

  if (!masterGain) {
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
  }

  syncMasterGain();
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return audioContext;
}

function playTone(
  context: AudioContext,
  output: AudioNode,
  now: number,
  spec: ToneSpec,
  intensity: number,
): void {
  const start = now + (spec.delay ?? 0);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = spec.type;
  oscillator.frequency.setValueAtTime(spec.startHz, start);
  oscillator.frequency.exponentialRampToValueAtTime(spec.endHz, start + spec.release);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, spec.gain * intensity),
    start + spec.attack,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.release);
  oscillator.connect(gain).connect(output);
  oscillator.start(start);
  oscillator.stop(start + spec.release + 0.02);
}

function playNoiseBurst(
  context: AudioContext,
  output: AudioNode,
  now: number,
  intensity: number,
): void {
  const duration = 0.2;
  const frames = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frames);
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1250, now);
  filter.frequency.exponentialRampToValueAtTime(280, now + duration);

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18 * intensity, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter).connect(gain).connect(output);
  source.start(now);
  source.stop(now + duration + 0.02);
}

function runSfxGraph(
  context: AudioContext,
  output: AudioNode,
  now: number,
  eventId: GameSfxId,
  intensity: number,
): void {
  switch (eventId) {
    case "ui-hover":
      playTone(context, output, now, {
        type: "sine",
        startHz: 420,
        endHz: 320,
        attack: 0.008,
        release: 0.08,
        gain: 0.03,
      }, intensity);
      break;
    case "ui-click":
      playTone(context, output, now, {
        type: "triangle",
        startHz: 320,
        endHz: 160,
        attack: 0.01,
        release: 0.12,
        gain: 0.055,
      }, intensity);
      break;
    case "coin-flip":
      playTone(context, output, now, {
        type: "sawtooth",
        startHz: 180,
        endHz: 420,
        attack: 0.02,
        release: 0.24,
        gain: 0.08,
      }, intensity);
      break;
    case "coin-land-win":
      playTone(context, output, now, {
        type: "triangle",
        startHz: 360,
        endHz: 820,
        attack: 0.018,
        release: 0.24,
        gain: 0.12,
      }, intensity);
      playTone(context, output, now, {
        type: "sine",
        startHz: 860,
        endHz: 1240,
        attack: 0.018,
        release: 0.18,
        gain: 0.07,
        delay: 0.04,
      }, intensity);
      break;
    case "coin-land-loss":
      playTone(context, output, now, {
        type: "square",
        startHz: 220,
        endHz: 90,
        attack: 0.01,
        release: 0.2,
        gain: 0.11,
      }, intensity);
      break;
    case "wheel-spin":
      playTone(context, output, now, {
        type: "sawtooth",
        startHz: 140,
        endHz: 260,
        attack: 0.015,
        release: 0.24,
        gain: 0.07,
      }, intensity);
      break;
    case "wheel-stop":
      playTone(context, output, now, {
        type: "triangle",
        startHz: 300,
        endHz: 160,
        attack: 0.012,
        release: 0.2,
        gain: 0.08,
      }, intensity);
      break;
    case "card-deal":
      playTone(context, output, now, {
        type: "sawtooth",
        startHz: 440,
        endHz: 260,
        attack: 0.008,
        release: 0.12,
        gain: 0.07,
      }, intensity);
      break;
    case "card-reveal":
      playTone(context, output, now, {
        type: "triangle",
        startHz: 320,
        endHz: 640,
        attack: 0.012,
        release: 0.18,
        gain: 0.1,
      }, intensity);
      break;
    case "dice-roll":
      playTone(context, output, now, {
        type: "sawtooth",
        startHz: 170,
        endHz: 300,
        attack: 0.016,
        release: 0.22,
        gain: 0.1,
      }, intensity);
      break;
    case "dice-win":
      playTone(context, output, now, {
        type: "triangle",
        startHz: 360,
        endHz: 820,
        attack: 0.015,
        release: 0.24,
        gain: 0.12,
      }, intensity);
      playTone(context, output, now, {
        type: "sine",
        startHz: 900,
        endHz: 1320,
        attack: 0.015,
        release: 0.16,
        gain: 0.07,
        delay: 0.05,
      }, intensity);
      break;
    case "dice-loss":
      playTone(context, output, now, {
        type: "square",
        startHz: 200,
        endHz: 80,
        attack: 0.01,
        release: 0.24,
        gain: 0.12,
      }, intensity);
      break;
    case "mines-swat":
      playTone(context, output, now, {
        type: "triangle",
        startHz: 460,
        endHz: 140,
        attack: 0.006,
        release: 0.12,
        gain: 0.1,
      }, intensity);
      break;
    case "mines-safe":
      playTone(context, output, now, {
        type: "triangle",
        startHz: 250,
        endHz: 520,
        attack: 0.008,
        release: 0.13,
        gain: 0.1,
      }, intensity);
      break;
    case "mines-boom":
      playNoiseBurst(context, output, now, intensity);
      break;
    case "reward-pop":
      playTone(context, output, now, {
        type: "sine",
        startHz: 520,
        endHz: 980,
        attack: 0.01,
        release: 0.14,
        gain: 0.08,
      }, intensity);
      break;
  }
}

export function playGameSfx(
  eventId: GameSfxId,
  options: PlaySfxOptions = {},
): void {
  if (state.muted) {
    return;
  }
  if (!canPlaySfx(eventId, options.cooldownMs)) {
    return;
  }

  const context = ensureAudioContext();
  if (!context || !masterGain) {
    return;
  }

  const intensity = clamp(options.intensity ?? 1, 0.2, 1.4);
  runSfxGraph(context, masterGain, context.currentTime, eventId, intensity);
}

export function setGameAudioMuted(muted: boolean): void {
  state = {
    ...state,
    muted,
  };
  syncMasterGain();
  writeStateToStorage(state);
  notifyAudioListeners();
}

export function toggleGameAudioMuted(): void {
  setGameAudioMuted(!state.muted);
}

export function setGameAudioVolume(volume: number): void {
  state = {
    ...state,
    volume: clamp(volume, 0, 1),
  };
  syncMasterGain();
  writeStateToStorage(state);
  notifyAudioListeners();
}

export function getGameAudioState(): GameAudioState {
  return state;
}

export function useGameAudioState(): GameAudioState {
  return useSyncExternalStore(
    (listener) => {
      audioListeners.add(listener);
      return () => {
        audioListeners.delete(listener);
      };
    },
    getGameAudioState,
    getGameAudioState,
  );
}
