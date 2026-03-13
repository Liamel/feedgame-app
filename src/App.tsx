import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { Dice1, LoaderCircle, TrendingUp, Zap } from "lucide-react";
import "./App.css";
import { BetControls } from "@/components/bet/bet-controls";
import { Button } from "@/components/ui/button";
import { CardPeekerArena } from "@/components/games/card-peeker-arena";
import { CoinFlipArena } from "@/components/games/coin-flip-arena";
import { DiceArena } from "@/components/games/dice-arena";
import { MinesBugHuntArena } from "@/components/games/mines-bug-hunt-arena";
import { WheelArena } from "@/components/games/wheel-arena";
import {
  playGameSfx,
  setGameAudioMuted,
  setGameAudioVolume,
  useGameAudioState,
} from "@/components/games/shared/game-audio";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  actionRound,
  ApiError,
  issueSessionToken,
  listPlayerRounds,
  settleRound,
  startRound,
  type GameId,
  type RoundHistoryItem,
  type SessionTokenResponse,
  verifyRound,
} from "./api";

const DEFAULT_OPERATOR_API_KEY =
  (import.meta.env.VITE_OPERATOR_API_KEY as string | undefined) ?? "operator-dev-key";
const DEFAULT_STARTING_BALANCE = Number(
  (import.meta.env.VITE_DEFAULT_STARTING_BALANCE as string | undefined) ?? 1000,
);
const STANDARD_HOUSE_EDGE = 0.045;
const COIN_WIN_MULTIPLIER = 1.92;
const QUICK_BETS = [1, 5, 10, 15, 20];
const STAKE_LIMITS = {
  coin_flip: { min: 0.1, max: 500 },
  dice_over_under: { min: 0.1, max: 500 },
  higher_lower: { min: 0.1, max: 150 },
  wheel: { min: 0.1, max: 250 },
  mines: { min: 0.1, max: 100 },
} as const;
const WHEEL_SEGMENTS = [
  { weight: 40, multiplier: 0, label: "LOSE" },
  { weight: 25, multiplier: 1.1, label: "1.1x" },
  { weight: 15, multiplier: 1.4, label: "1.4x" },
  { weight: 12, multiplier: 1.8, label: "1.8x" },
  { weight: 6, multiplier: 2.5, label: "2.5x" },
  { weight: 2, multiplier: 5, label: "5.0x" },
] as const;
const WHEEL_TOTAL_WEIGHT = WHEEL_SEGMENTS.reduce((sum, segment) => sum + segment.weight, 0);
const WHEEL_WIN_CHANCE =
  WHEEL_SEGMENTS.filter((segment) => segment.multiplier > 0).reduce(
    (sum, segment) => sum + segment.weight,
    0,
  ) / WHEEL_TOTAL_WEIGHT;
const WHEEL_EXPECTED_MULTIPLIER =
  WHEEL_SEGMENTS.reduce((sum, segment) => sum + (segment.weight / WHEEL_TOTAL_WEIGHT) * segment.multiplier, 0);
const WHEEL_MAX_MULTIPLIER = Math.max(...WHEEL_SEGMENTS.map((segment) => segment.multiplier));
const MINES_TOTAL_TILES = 25;
const MINES_HOUSE_EDGE = 0.05;

interface CoinRoundResult {
  roundId: string;
  choice: "heads" | "tails";
  landed: string;
  outcome: "win" | "loss";
  payout: number;
  multiplier: number;
}

interface DiceRoundResult {
  roundId: string;
  direction: "over" | "under";
  threshold: number;
  roll: number;
  outcome: "win" | "loss";
  payout: number;
  multiplier: number;
}

interface HigherLowerRoundResult {
  roundId: string;
  guess: "higher" | "lower";
  currentCard: number;
  nextCard: number;
  outcome: "win" | "loss";
  payout: number;
  multiplier: number;
}

interface WheelRoundResult {
  roundId: string;
  segmentIndex: number;
  label: string;
  outcome: "win" | "loss";
  payout: number;
  multiplier: number;
}

interface MinesRoundState {
  roundId: string;
  stake: number;
  totalTiles: number;
  bombCount: number;
  revealed: number[];
  currentMultiplier: number;
  ended: boolean;
  explodedAt: number | null;
}

interface MinesRoundResult {
  roundId: string;
  stake: number;
  bombCount: number;
  revealed: number[];
  bombs: number[];
  explodedAt: number | null;
  outcome: "win" | "loss";
  payout: number;
  multiplier: number;
}

interface ActivityEntry {
  id: string;
  title: string;
  gameId: GameId;
  outcome: "win" | "loss";
  payout: number;
  balance: number;
  at: number;
}

function createIdempotencyKey(scope: string): string {
  return `${scope}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function toIndexes(value: unknown, maxExclusive: number): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<number>();
  for (const entry of value) {
    const parsed = Number(entry);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < maxExclusive) {
      unique.add(parsed);
    }
  }
  return [...unique.values()].sort((a, b) => a - b);
}

function combination(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0;
  }
  const m = Math.min(k, n - k);
  if (m === 0) {
    return 1;
  }

  let result = 1;
  for (let i = 1; i <= m; i += 1) {
    result = (result * (n - m + i)) / i;
  }
  return result;
}

function minesProjectedMultiplier(revealedCount: number, bombCount: number): number {
  if (revealedCount <= 0) {
    return 1;
  }
  const numerator = combination(MINES_TOTAL_TILES, revealedCount);
  const denominator = combination(MINES_TOTAL_TILES - bombCount, revealedCount);
  if (denominator <= 0) {
    return 0;
  }
  return (numerator / denominator) * (1 - MINES_HOUSE_EDGE);
}

function readMinesState(
  roundId: string,
  stake: number,
  gameState: Record<string, unknown>,
): MinesRoundState {
  const totalTiles = clampInt(Number(gameState.totalTiles ?? MINES_TOTAL_TILES), 1, MINES_TOTAL_TILES);
  const bombCount = clampInt(Number(gameState.bombCount ?? 3), 1, totalTiles - 1);
  const revealed = toIndexes(gameState.revealed, totalTiles);
  const currentMultiplier = Math.max(0, Number(gameState.currentMultiplier ?? 1));
  const ended = Boolean(gameState.ended);
  const explodedAtRaw = Number(gameState.explodedAt);
  const explodedAt = Number.isInteger(explodedAtRaw) && explodedAtRaw >= 0 && explodedAtRaw < totalTiles
    ? explodedAtRaw
    : null;

  return {
    roundId,
    stake,
    totalTiles,
    bombCount,
    revealed,
    currentMultiplier,
    ended,
    explodedAt,
  };
}

function payoutFromWinProbability(winProbability: number, houseEdge: number): number {
  if (winProbability <= 0 || winProbability >= 1) {
    return 0;
  }
  return (1 / winProbability) * (1 - houseEdge);
}

function App() {
  const [operatorApiKey, setOperatorApiKey] = useState(DEFAULT_OPERATOR_API_KEY);
  const [playerId, setPlayerId] = useState("player-reels-1");
  const [currency, setCurrency] = useState("EUR");
  const [locale, setLocale] = useState("en");
  const [jurisdictionProfile, setJurisdictionProfile] = useState<"MALTA_BASELINE" | "SE_STRICT">(
    "MALTA_BASELINE",
  );
  const [channel, setChannel] = useState<"iframe" | "sdk">("sdk");
  const [startingBalance, setStartingBalance] = useState(String(DEFAULT_STARTING_BALANCE));

  const [session, setSession] = useState<SessionTokenResponse | null>(null);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [history, setHistory] = useState<RoundHistoryItem[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [coinStake, setCoinStake] = useState("1");
  const [coinChoice, setCoinChoice] = useState<"heads" | "tails">("heads");
  const [coinBusy, setCoinBusy] = useState(false);
  const [coinResult, setCoinResult] = useState<CoinRoundResult | null>(null);

  const [diceStake, setDiceStake] = useState("1");
  const [diceDirection, setDiceDirection] = useState<"over" | "under">("over");
  const [diceThreshold, setDiceThreshold] = useState("50");
  const [diceBusy, setDiceBusy] = useState(false);
  const [diceResult, setDiceResult] = useState<DiceRoundResult | null>(null);
  const [diceScreenFlash, setDiceScreenFlash] = useState<"win" | "loss" | null>(null);
  const diceFlashTimerRef = useRef<number | null>(null);

  const [higherLowerStake, setHigherLowerStake] = useState("1");
  const [higherLowerRoundId, setHigherLowerRoundId] = useState<string | null>(null);
  const [higherLowerCurrentCard, setHigherLowerCurrentCard] = useState<number | null>(null);
  const [higherLowerGuessPreview, setHigherLowerGuessPreview] = useState<"higher" | "lower" | null>(
    null,
  );
  const [higherLowerBusy, setHigherLowerBusy] = useState(false);
  const [higherLowerResult, setHigherLowerResult] = useState<HigherLowerRoundResult | null>(null);

  const [wheelStake, setWheelStake] = useState("1");
  const [wheelBusy, setWheelBusy] = useState(false);
  const [wheelResult, setWheelResult] = useState<WheelRoundResult | null>(null);

  const [minesStake, setMinesStake] = useState("1");
  const [minesBombCount, setMinesBombCount] = useState("3");
  const [minesBusy, setMinesBusy] = useState(false);
  const [minesRound, setMinesRound] = useState<MinesRoundState | null>(null);
  const [minesResult, setMinesResult] = useState<MinesRoundResult | null>(null);

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const audioState = useGameAudioState();
  const hoverInteractiveRef = useRef<HTMLElement | null>(null);
  const previousVisibleBalanceRef = useRef<number | null>(null);
  const [balancePulseKey, setBalancePulseKey] = useState(0);

  const parsedStartingBalance = useMemo(() => {
    const parsed = Number(startingBalance);
    return Number.isFinite(parsed) ? parsed : DEFAULT_STARTING_BALANCE;
  }, [startingBalance]);

  const currencyFormatter = useMemo(() => {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      });
    } catch {
      return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  }, [currency, locale]);

  const derivedBalance = useMemo(() => {
    const delta = history.reduce((acc, round) => acc + (round.payout - round.stake), 0);
    return Number((parsedStartingBalance + delta).toFixed(2));
  }, [history, parsedStartingBalance]);

  const visibleBalance = balance ?? derivedBalance;
  const connected = Boolean(session && activePlayerId);
  const anyBusy = connecting || coinBusy || diceBusy || higherLowerBusy || wheelBusy || minesBusy;
  const cardPeekerCurrentCard = higherLowerRoundId
    ? higherLowerCurrentCard
    : (higherLowerResult?.currentCard ?? null);
  const cardPeekerNextCard = higherLowerRoundId ? null : (higherLowerResult?.nextCard ?? null);
  const cardPeekerGuess = higherLowerRoundId
    ? higherLowerGuessPreview
    : (higherLowerResult?.guess ?? null);
  const cardPeekerOutcome = higherLowerRoundId ? null : (higherLowerResult?.outcome ?? null);
  const cardPeekerRevealing = higherLowerBusy && higherLowerRoundId !== null;
  const coinPreview = useMemo(() => {
    const stake = Math.max(0, toNumber(coinStake));
    const winProbability = 0.5;
    const multiplier = COIN_WIN_MULTIPLIER;
    const payout = stake * multiplier;
    const houseEdge = 1 - winProbability * multiplier;
    return {
      stake,
      winProbability,
      multiplier,
      payout,
      houseEdge,
    };
  }, [coinStake]);
  const dicePreview = useMemo(() => {
    const threshold = clampInt(toNumber(diceThreshold), 2, 98);
    const stake = Math.max(0, toNumber(diceStake));
    const winProbability =
      diceDirection === "over" ? (100 - threshold) / 100 : threshold / 100;
    const multiplier = payoutFromWinProbability(winProbability, STANDARD_HOUSE_EDGE);
    const payout = stake * multiplier;
    return {
      threshold,
      stake,
      winProbability,
      multiplier,
      payout,
    };
  }, [diceDirection, diceStake, diceThreshold]);
  const wheelPreview = useMemo(() => {
    const stake = Math.max(0, toNumber(wheelStake));
    return {
      stake,
      winProbability: WHEEL_WIN_CHANCE,
      expectedMultiplier: WHEEL_EXPECTED_MULTIPLIER,
      expectedReturn: stake * WHEEL_EXPECTED_MULTIPLIER,
      maxMultiplier: WHEEL_MAX_MULTIPLIER,
      maxPayout: stake * WHEEL_MAX_MULTIPLIER,
    };
  }, [wheelStake]);
  const minesPreview = useMemo(() => {
    const stake = Math.max(0, toNumber(minesStake));
    const bombCount = clampInt(toNumber(minesBombCount), 1, 24);
    const firstSafeMultiplier = minesProjectedMultiplier(1, bombCount);
    return {
      stake,
      bombCount,
      firstSafeMultiplier,
      firstSafePayout: stake * firstSafeMultiplier,
    };
  }, [minesBombCount, minesStake]);
  const higherLowerQuote = useMemo(() => {
    if (!higherLowerRoundId || higherLowerCurrentCard === null) {
      return null;
    }
    const stake = Math.max(0, toNumber(higherLowerStake));

    const buildQuote = (winProbability: number) => {
      if (winProbability <= 0 || winProbability >= 1) {
        return {
          available: false,
          winProbability: 0,
          multiplier: 0,
          payout: 0,
        };
      }
      const multiplier = payoutFromWinProbability(winProbability, STANDARD_HOUSE_EDGE);
      return {
        available: true,
        winProbability,
        multiplier,
        payout: stake * multiplier,
      };
    };

    return {
      currentCard: higherLowerCurrentCard,
      higher: buildQuote((13 - higherLowerCurrentCard) / 13),
      lower: buildQuote((higherLowerCurrentCard - 1) / 13),
    };
  }, [higherLowerCurrentCard, higherLowerRoundId, higherLowerStake]);
  const coinResultToneClass = coinResult
    ? coinResult.outcome === "win"
      ? "result-box-win"
      : "result-box-loss"
    : "result-box-neutral";
  const diceResultToneClass = diceResult
    ? diceResult.outcome === "win"
      ? "result-box-win"
      : "result-box-loss"
    : "result-box-neutral";
  const wheelResultToneClass = wheelResult
    ? wheelResult.outcome === "win"
      ? "result-box-win"
      : "result-box-loss"
    : "result-box-neutral";
  const minesResultToneClass = minesResult
    ? minesResult.outcome === "win"
      ? "result-box-win"
      : "result-box-loss"
    : "result-box-neutral";
  const minesDisplayRevealed = minesRound ? minesRound.revealed : (minesResult?.revealed ?? []);
  const minesDisplayBombs = minesRound ? [] : (minesResult?.bombs ?? []);
  const minesDisplayExplodedAt = minesRound?.explodedAt ?? minesResult?.explodedAt ?? null;
  const minesLiveMultiplier = minesRound?.currentMultiplier ?? 1;
  const minesCashoutPayout = minesRound ? minesRound.stake * minesLiveMultiplier : 0;
  const wheelVisualSpinning = wheelBusy && wheelResult === null;
  const minesBombCountValue = clampInt(toNumber(minesBombCount), 1, 24);

  useEffect(() => {
    if (previousVisibleBalanceRef.current !== null && previousVisibleBalanceRef.current !== visibleBalance) {
      setBalancePulseKey((previous) => previous + 1);
    }
    previousVisibleBalanceRef.current = visibleBalance;
  }, [visibleBalance]);

  function setMinesBombCountValue(next: number): void {
    const clamped = clampInt(next, 1, 24);
    setMinesBombCount(String(clamped));
    setMinesResult(null);
  }

  function interactiveTargetFromEvent(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    return target.closest<HTMLElement>(
      "button,[role='button'],[data-slot='select-trigger'],input[type='range'],.mines-hit-btn",
    );
  }

  function handleUiHoverCapture(event: MouseEvent<HTMLDivElement>): void {
    const interactive = interactiveTargetFromEvent(event.target);
    if (!interactive || interactive.hasAttribute("disabled")) {
      return;
    }
    if (hoverInteractiveRef.current === interactive) {
      return;
    }
    hoverInteractiveRef.current = interactive;
    playGameSfx("ui-hover");
  }

  function handleUiLeaveCapture(): void {
    hoverInteractiveRef.current = null;
  }

  function handleUiClickCapture(event: MouseEvent<HTMLDivElement>): void {
    const interactive = interactiveTargetFromEvent(event.target);
    if (!interactive || interactive.hasAttribute("disabled")) {
      return;
    }
    playGameSfx("ui-click");
  }

  function handleAudioToggle(): void {
    const nextMuted = !audioState.muted;
    setGameAudioMuted(nextMuted);
    if (!nextMuted) {
      playGameSfx("ui-click", { cooldownMs: 0 });
    }
  }

  function handleAudioVolumeChange(nextValue: string): void {
    const nextVolume = Math.max(0, Math.min(1, Number(nextValue) / 100));
    setGameAudioVolume(nextVolume);
    if (!audioState.muted) {
      playGameSfx("ui-hover", { cooldownMs: 50, intensity: 0.62 });
    }
  }

  useEffect(
    () => () => {
      if (diceFlashTimerRef.current !== null) {
        window.clearTimeout(diceFlashTimerRef.current);
      }
    },
    [],
  );

  async function refreshHistory(token: string, currentPlayerId: string): Promise<RoundHistoryItem[]> {
    const rounds = await listPlayerRounds(token, currentPlayerId);
    setHistory(rounds.items);
    return rounds.items;
  }

  function pushActivity(entry: Omit<ActivityEntry, "id" | "at">): void {
    setActivity((previous) => [
      {
        ...entry,
        id: crypto.randomUUID(),
        at: Date.now(),
      },
      ...previous,
    ].slice(0, 20));
  }

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPlayerId = playerId.trim();
    if (!trimmedPlayerId) {
      setError("Player ID is required.");
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const nextSession = await issueSessionToken(
        {
          operatorPlayerId: trimmedPlayerId,
          currency,
          locale,
          jurisdictionProfile,
          channel,
        },
        operatorApiKey.trim(),
      );

      setSession(nextSession);
      setActivePlayerId(trimmedPlayerId);
      setPlayerId(trimmedPlayerId);
      setCoinResult(null);
      setDiceResult(null);
      setHigherLowerResult(null);
      setHigherLowerRoundId(null);
      setHigherLowerCurrentCard(null);
      setHigherLowerGuessPreview(null);
      setWheelResult(null);
      setMinesRound(null);
      setMinesResult(null);
      setDiceScreenFlash(null);
      if (diceFlashTimerRef.current !== null) {
        window.clearTimeout(diceFlashTimerRef.current);
        diceFlashTimerRef.current = null;
      }
      setActivity([]);

      const rounds = await refreshHistory(nextSession.token, trimmedPlayerId);
      const delta = rounds.reduce((acc, round) => acc + (round.payout - round.stake), 0);
      setBalance(Number((parsedStartingBalance + delta).toFixed(2)));
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setConnecting(false);
    }
  }

  async function playCoinFlip() {
    if (!session || !activePlayerId) {
      return;
    }

    const stake = toNumber(coinStake);
    if (stake <= 0) {
      setError("Coin Flip stake must be positive.");
      return;
    }

    setCoinBusy(true);
    setError(null);
    setCoinResult(null);

    try {
      const animationFloor = new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 900);
      });

      const start = await startRound(session.token, {
        sessionId: session.sessionId,
        gameId: "coin_flip",
        stake,
        clientSeed: `coin-${crypto.randomUUID()}`,
        idempotencyKey: createIdempotencyKey("coin-start"),
        gameInput: { choice: coinChoice },
      });

      const settlePromise = settleRound(session.token, start.roundId, {
        idempotencyKey: createIdempotencyKey("coin-settle"),
      });
      const [settle] = await Promise.all([settlePromise, animationFloor]);

      const landed = typeof start.gameState.landed === "string" ? start.gameState.landed : "unknown";

      setCoinResult({
        roundId: start.roundId,
        choice: coinChoice,
        landed,
        outcome: settle.outcome,
        payout: settle.payout,
        multiplier: settle.multiplier,
      });
      setBalance(settle.balance);
      pushActivity({
        title: `Coin: ${coinChoice} -> ${landed}`,
        gameId: "coin_flip",
        outcome: settle.outcome,
        payout: settle.payout,
        balance: settle.balance,
      });
      await refreshHistory(session.token, activePlayerId);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setCoinBusy(false);
    }
  }

  async function playDiceOverUnder() {
    if (!session || !activePlayerId) {
      return;
    }

    const stake = toNumber(diceStake);
    if (stake <= 0) {
      setError("Dice stake must be positive.");
      return;
    }

    const threshold = clampInt(toNumber(diceThreshold), 2, 98);
    setDiceThreshold(String(threshold));
    setDiceBusy(true);
    setError(null);

    try {
      const animationFloor = new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 1050);
      });

      const start = await startRound(session.token, {
        sessionId: session.sessionId,
        gameId: "dice_over_under",
        stake,
        clientSeed: `dice-${crypto.randomUUID()}`,
        idempotencyKey: createIdempotencyKey("dice-start"),
        gameInput: { direction: diceDirection, threshold },
      });

      const settlePromise = settleRound(session.token, start.roundId, {
        idempotencyKey: createIdempotencyKey("dice-settle"),
      });
      const [settle] = await Promise.all([settlePromise, animationFloor]);

      const roll = clampInt(Number(start.gameState.roll ?? 0), 0, 99);

      setDiceResult({
        roundId: start.roundId,
        direction: diceDirection,
        threshold,
        roll,
        outcome: settle.outcome,
        payout: settle.payout,
        multiplier: settle.multiplier,
      });
      if (diceFlashTimerRef.current !== null) {
        window.clearTimeout(diceFlashTimerRef.current);
      }
      setDiceScreenFlash(settle.outcome);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(settle.outcome === "win" ? [44, 22, 34] : [22, 24, 22, 24, 20]);
      }
      diceFlashTimerRef.current = window.setTimeout(() => {
        setDiceScreenFlash(null);
        diceFlashTimerRef.current = null;
      }, 420);
      setBalance(settle.balance);
      pushActivity({
        title: `Dice: ${diceDirection} ${threshold}, roll ${roll}`,
        gameId: "dice_over_under",
        outcome: settle.outcome,
        payout: settle.payout,
        balance: settle.balance,
      });
      await refreshHistory(session.token, activePlayerId);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setDiceBusy(false);
    }
  }

  async function playWheel() {
    if (!session || !activePlayerId) {
      return;
    }

    const stake = toNumber(wheelStake);
    if (stake <= 0) {
      setError("Wheel stake must be positive.");
      return;
    }

    setWheelBusy(true);
    setError(null);
    setWheelResult(null);

    try {
      const animationFloor = new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 900);
      });

      const start = await startRound(session.token, {
        sessionId: session.sessionId,
        gameId: "wheel",
        stake,
        clientSeed: `wheel-${crypto.randomUUID()}`,
        idempotencyKey: createIdempotencyKey("wheel-start"),
      });

      const settlePromise = settleRound(session.token, start.roundId, {
        idempotencyKey: createIdempotencyKey("wheel-settle"),
      });
      const [settle] = await Promise.all([settlePromise, animationFloor]);

      const segmentIndex = clampInt(Number(start.gameState.segmentIndex ?? 0), 0, WHEEL_SEGMENTS.length - 1);
      const label =
        typeof start.gameState.label === "string"
          ? start.gameState.label
          : WHEEL_SEGMENTS[segmentIndex]?.label ?? "UNKNOWN";

      setWheelResult({
        roundId: start.roundId,
        segmentIndex,
        label,
        outcome: settle.outcome,
        payout: settle.payout,
        multiplier: settle.multiplier,
      });
      setBalance(settle.balance);
      pushActivity({
        title: `Wheel: ${label}`,
        gameId: "wheel",
        outcome: settle.outcome,
        payout: settle.payout,
        balance: settle.balance,
      });
      await refreshHistory(session.token, activePlayerId);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setWheelBusy(false);
    }
  }

  async function settleMinesRound(round: MinesRoundState, settleAction?: "cashout") {
    if (!session || !activePlayerId) {
      return;
    }

    const settle = await settleRound(session.token, round.roundId, {
      idempotencyKey: createIdempotencyKey("mines-settle"),
      ...(settleAction ? { settleAction } : {}),
    });

    const verify = await verifyRound(session.token, round.roundId);
    const verifiedState =
      (verify.reproducibleResult.gameState as Record<string, unknown> | undefined) ?? {};
    const totalTiles = clampInt(Number(verifiedState.totalTiles ?? round.totalTiles), 1, MINES_TOTAL_TILES);
    const bombCount = clampInt(Number(verifiedState.bombCount ?? round.bombCount), 1, totalTiles - 1);
    const revealed = toIndexes(verifiedState.revealed, totalTiles);
    const bombs = toIndexes(verifiedState.bombs, totalTiles);
    const explodedAtRaw = Number(verifiedState.explodedAt);
    const explodedAt =
      Number.isInteger(explodedAtRaw) && explodedAtRaw >= 0 && explodedAtRaw < totalTiles
        ? explodedAtRaw
        : null;

    setMinesResult({
      roundId: round.roundId,
      stake: round.stake,
      bombCount,
      revealed,
      bombs,
      explodedAt,
      outcome: settle.outcome,
      payout: settle.payout,
      multiplier: settle.multiplier,
    });
    setMinesRound(null);
    setBalance(settle.balance);
    pushActivity({
      title: `Mines: ${settle.outcome.toUpperCase()} (${revealed.length} picks, ${bombCount} bombs)`,
      gameId: "mines",
      outcome: settle.outcome,
      payout: settle.payout,
      balance: settle.balance,
    });
    await refreshHistory(session.token, activePlayerId);
  }

  async function startMinesRound() {
    if (!session) {
      return;
    }

    const stake = toNumber(minesStake);
    if (stake <= 0) {
      setError("Mines stake must be positive.");
      return;
    }

    const bombCount = clampInt(toNumber(minesBombCount), 1, 24);
    setMinesBombCount(String(bombCount));
    setMinesBusy(true);
    setError(null);
    setMinesRound(null);
    setMinesResult(null);

    try {
      const start = await startRound(session.token, {
        sessionId: session.sessionId,
        gameId: "mines",
        stake,
        clientSeed: `mines-${crypto.randomUUID()}`,
        idempotencyKey: createIdempotencyKey("mines-start"),
        gameInput: { bombCount },
      });

      setMinesRound(readMinesState(start.roundId, stake, start.gameState));
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setMinesBusy(false);
    }
  }

  async function revealMinesTile(tile: number) {
    if (!session || !minesRound || minesBusy || minesRound.ended) {
      return;
    }
    if (minesRound.revealed.includes(tile)) {
      return;
    }

    setMinesBusy(true);
    setError(null);

    try {
      const action = await actionRound(session.token, minesRound.roundId, {
        idempotencyKey: createIdempotencyKey("mines-reveal"),
        action: "reveal",
        payload: { tile },
      });

      const nextState = readMinesState(minesRound.roundId, minesRound.stake, action.gameState);
      setMinesRound(nextState);

      if (action.readyToSettle || nextState.ended) {
        await settleMinesRound(nextState);
      }
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setMinesBusy(false);
    }
  }

  async function cashoutMinesRound() {
    if (!minesRound || !session || minesBusy) {
      return;
    }

    setMinesBusy(true);
    setError(null);

    try {
      await settleMinesRound(minesRound, "cashout");
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setMinesBusy(false);
    }
  }

  async function dealHigherLower() {
    if (!session) {
      return;
    }

    const stake = toNumber(higherLowerStake);
    if (stake <= 0) {
      setError("Higher/Lower stake must be positive.");
      return;
    }

    setHigherLowerBusy(true);
    setError(null);
    setHigherLowerGuessPreview(null);
    setHigherLowerResult(null);

    try {
      const animationFloor = new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 650);
      });

      const startPromise = startRound(session.token, {
        sessionId: session.sessionId,
        gameId: "higher_lower",
        stake,
        clientSeed: `hl-${crypto.randomUUID()}`,
        idempotencyKey: createIdempotencyKey("hl-start"),
      });
      const [start] = await Promise.all([startPromise, animationFloor]);

      const currentCard = Number(start.gameState.currentCard);
      if (!Number.isInteger(currentCard)) {
        throw new Error("Server did not return a valid current card.");
      }

      setHigherLowerRoundId(start.roundId);
      setHigherLowerCurrentCard(currentCard);
      setHigherLowerResult(null);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setHigherLowerBusy(false);
    }
  }

  async function resolveHigherLower(guess: "higher" | "lower") {
    if (!session || !activePlayerId || !higherLowerRoundId || higherLowerCurrentCard === null) {
      return;
    }

    setHigherLowerBusy(true);
    setError(null);
    setHigherLowerGuessPreview(guess);

    try {
      const revealFloor = new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 1150);
      });

      const action = await actionRound(session.token, higherLowerRoundId, {
        idempotencyKey: createIdempotencyKey("hl-action"),
        action: "guess",
        payload: { guess },
      });

      const settle = await settleRound(session.token, higherLowerRoundId, {
        idempotencyKey: createIdempotencyKey("hl-settle"),
      });

      const [verify] = await Promise.all([
        verifyRound(session.token, higherLowerRoundId),
        revealFloor,
      ]);
      const verifiedState = verify.reproducibleResult.gameState as Record<string, unknown> | undefined;
      const nextCard = Number(verifiedState?.nextCard ?? action.gameState.nextCard ?? 0);

      setHigherLowerResult({
        roundId: higherLowerRoundId,
        guess,
        currentCard: higherLowerCurrentCard,
        nextCard: Number.isInteger(nextCard) ? nextCard : 0,
        outcome: settle.outcome,
        payout: settle.payout,
        multiplier: settle.multiplier,
      });
      setBalance(settle.balance);
      pushActivity({
        title: `Higher/Lower: ${guess} (${higherLowerCurrentCard} -> ${Number.isInteger(nextCard) ? nextCard : "?"})`,
        gameId: "higher_lower",
        outcome: settle.outcome,
        payout: settle.payout,
        balance: settle.balance,
      });
      setHigherLowerRoundId(null);
      setHigherLowerCurrentCard(null);
      setHigherLowerGuessPreview(null);
      await refreshHistory(session.token, activePlayerId);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setHigherLowerBusy(false);
    }
  }

  async function handleHistoryRefresh() {
    if (!session || !activePlayerId) {
      return;
    }
    setError(null);
    try {
      await refreshHistory(session.token, activePlayerId);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    }
  }

  if (!connected) {
    return (
      <div className="app-backdrop">
        <div className="mx-auto flex min-h-dvh max-w-md items-center px-4 py-8">
          <Card className="w-full border-border/70 bg-card/95 shadow-xl">
            <CardHeader>
              <CardTitle className="text-2xl">FeedGame Reels Demo</CardTitle>
              <CardDescription>
                Mobile-first stack connected to your backend. Start a player session to enter the feed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={handleConnect}>
                <div className="grid gap-1.5">
                  <label className="text-sm text-muted-foreground">Operator API Key</label>
                  <Input
                    value={operatorApiKey}
                    onChange={(event) => setOperatorApiKey(event.target.value)}
                    placeholder="operator-dev-key"
                    disabled={connecting}
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm text-muted-foreground">Player ID</label>
                  <Input
                    value={playerId}
                    onChange={(event) => setPlayerId(event.target.value)}
                    placeholder="player-reels-1"
                    disabled={connecting}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <label className="text-sm text-muted-foreground">Currency</label>
                    <Input
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                      maxLength={3}
                      disabled={connecting}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-sm text-muted-foreground">Locale</label>
                    <Input
                      value={locale}
                      onChange={(event) => setLocale(event.target.value)}
                      disabled={connecting}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <label className="text-sm text-muted-foreground">Jurisdiction</label>
                    <Select
                      value={jurisdictionProfile}
                      onValueChange={(value) =>
                        setJurisdictionProfile(value as "MALTA_BASELINE" | "SE_STRICT")
                      }
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="Jurisdiction" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MALTA_BASELINE">MALTA_BASELINE</SelectItem>
                        <SelectItem value="SE_STRICT">SE_STRICT</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-sm text-muted-foreground">Channel</label>
                    <Select
                      value={channel}
                      onValueChange={(value) => setChannel(value as "iframe" | "sdk")}
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="Channel" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sdk">sdk</SelectItem>
                        <SelectItem value="iframe">iframe</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm text-muted-foreground">Starting Balance Assumption</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={startingBalance}
                    onChange={(event) => setStartingBalance(event.target.value)}
                    disabled={connecting}
                  />
                </div>
                <Button type="submit" disabled={connecting}>
                  {connecting ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    "Enter Feed"
                  )}
                </Button>
              </form>
            </CardContent>
            {error ? (
              <CardFooter>
                <p className="text-sm text-destructive">{error}</p>
              </CardFooter>
            ) : null}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="app-backdrop">
      {diceScreenFlash ? <div className={`dice-screen-flash dice-screen-flash-${diceScreenFlash}`} /> : null}
      <div
        className="phone-shell"
        onMouseOverCapture={handleUiHoverCapture}
        onMouseLeave={handleUiLeaveCapture}
        onClickCapture={handleUiClickCapture}
      >
        <header className="top-bar">
          <div className="top-ident">
            <p className="top-brand">FeedGame Reels</p>
            <span className="top-ident-dot">•</span>
            <p className="top-player">{activePlayerId}</p>
          </div>
          <div className="top-actions">
            <p className="top-balance-label">Balance</p>
            <p key={balancePulseKey} className="top-balance">
              {currencyFormatter.format(visibleBalance)}
            </p>
            <div className="audio-controls">
              <button
                type="button"
                className={`audio-toggle ${audioState.muted ? "audio-toggle-muted" : ""}`}
                onClick={handleAudioToggle}
              >
                {audioState.muted ? "SFX OFF" : "SFX ON"}
              </button>
              <input
                className="audio-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(audioState.volume * 100)}
                onChange={(event) => handleAudioVolumeChange(event.target.value)}
                aria-label="Sound volume"
              />
            </div>
          </div>
        </header>

        {error ? <div className="error-inline">{error}</div> : null}

        <main className="feed-scroll">
          <section className="feed-slide reel-coin">
            <Card className="reel-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="size-4 text-amber-400" />
                  Coin Flip
                </CardTitle>
                <CardDescription>Quick round. Choose heads or tails.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <CoinFlipArena
                  flipping={coinBusy}
                  choice={coinChoice}
                  landed={coinResult?.landed ?? null}
                  outcome={coinResult?.outcome ?? null}
                />
                <BetControls
                  value={coinStake}
                  onValueChange={(value) => {
                    setCoinStake(value);
                    setCoinResult(null);
                  }}
                  min={STAKE_LIMITS.coin_flip.min}
                  max={STAKE_LIMITS.coin_flip.max}
                  step={0.1}
                  quickBets={QUICK_BETS}
                  currency={currency}
                  disabled={coinBusy || anyBusy}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <label className="text-sm text-muted-foreground">Choice</label>
                    <Select
                      value={coinChoice}
                      onValueChange={(value) => {
                        setCoinChoice(value as "heads" | "tails");
                        setCoinResult(null);
                      }}
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="Choice" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="heads">heads</SelectItem>
                        <SelectItem value="tails">tails</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className={`result-box ${coinResultToneClass}`}>
                  <p>
                    If win: {coinPreview.multiplier.toFixed(3)}x |{" "}
                    {currencyFormatter.format(coinPreview.payout)}
                  </p>
                  <p>
                    Win chance: {(coinPreview.winProbability * 100).toFixed(2)}% | House edge:{" "}
                    {(coinPreview.houseEdge * 100).toFixed(2)}%
                  </p>
                  {coinResult ? (
                    <p>
                      <strong>{coinResult.outcome.toUpperCase()}</strong> | picked {coinResult.choice}, landed{" "}
                      {coinResult.landed} | payout {currencyFormatter.format(coinResult.payout)}
                    </p>
                  ) : null}
                </div>
                <Button onClick={playCoinFlip} disabled={coinBusy || anyBusy}>
                  {coinBusy ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Settling...
                    </>
                  ) : (
                    "Flip Coin"
                  )}
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="feed-slide reel-dice">
            <Card className="reel-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Dice1 className="size-4 text-cyan-300" />
                  Dice Over/Under
                </CardTitle>
                <CardDescription className="text-xs">Pick side, slide target, and send the cube.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-1.5">
                <DiceArena
                  rolling={diceBusy}
                  rollValue={diceBusy ? null : (diceResult?.roll ?? null)}
                  threshold={dicePreview.threshold}
                  direction={diceDirection}
                  outcome={diceResult?.outcome ?? null}
                />
                <BetControls
                  value={diceStake}
                  onValueChange={(value) => {
                    setDiceStake(value);
                    setDiceResult(null);
                  }}
                  min={STAKE_LIMITS.dice_over_under.min}
                  max={STAKE_LIMITS.dice_over_under.max}
                  step={0.1}
                  quickBets={QUICK_BETS}
                  currency={currency}
                  className="bet-controls-dice"
                  showManualInput={false}
                  disabled={diceBusy || anyBusy}
                />
                <div className="dice-direction-toggle">
                  <button
                    type="button"
                    className={`dice-direction-btn ${diceDirection === "under" ? "dice-direction-btn-active" : ""}`}
                    onClick={() => {
                      setDiceDirection("under");
                      setDiceResult(null);
                    }}
                    disabled={diceBusy || anyBusy}
                  >
                    {"UNDER <"}
                  </button>
                  <button
                    type="button"
                    className={`dice-direction-btn ${diceDirection === "over" ? "dice-direction-btn-active" : ""}`}
                    onClick={() => {
                      setDiceDirection("over");
                      setDiceResult(null);
                    }}
                    disabled={diceBusy || anyBusy}
                  >
                    {"OVER >"}
                  </button>
                </div>
                <div className="dice-threshold-controls">
                  <div className="dice-threshold-head">
                    <p>Target</p>
                    <p className="dice-threshold-value">{dicePreview.threshold}</p>
                    <p>{(dicePreview.winProbability * 100).toFixed(1)}% hit</p>
                  </div>
                  <input
                    className="dice-threshold-slider"
                    type="range"
                    min={2}
                    max={98}
                    step={1}
                    value={dicePreview.threshold}
                    onChange={(event) => {
                      setDiceThreshold(event.target.value);
                      setDiceResult(null);
                    }}
                    disabled={diceBusy || anyBusy}
                  />
                  <div className="dice-threshold-scale">
                    <span>2</span>
                    <span>50</span>
                    <span>98</span>
                  </div>
                </div>
                <div className={`result-box dice-result-box ${diceResultToneClass}`}>
                  <p>
                    {dicePreview.multiplier.toFixed(3)}x if {diceDirection.toUpperCase()} {dicePreview.threshold} |{" "}
                    {currencyFormatter.format(dicePreview.payout)}
                  </p>
                  {diceResult ? (
                    <p>
                      <strong>{diceResult.outcome.toUpperCase()}</strong> | roll {diceResult.roll} | payout{" "}
                      {currencyFormatter.format(diceResult.payout)}
                    </p>
                  ) : null}
                </div>
                <Button className="dice-roll-btn" onClick={playDiceOverUnder} disabled={diceBusy || anyBusy}>
                  {diceBusy ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Rolling...
                    </>
                  ) : (
                    "Roll Dice"
                  )}
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="feed-slide reel-wheel">
            <Card className="reel-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="size-4 text-rose-300" />
                  Lucky Wheel
                </CardTitle>
                <CardDescription>Single spin against weighted segments.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <WheelArena
                  spinning={wheelVisualSpinning}
                  segmentIndex={wheelResult?.segmentIndex ?? null}
                  label={wheelResult?.label ?? null}
                  outcome={wheelResult?.outcome ?? null}
                  multiplier={wheelResult?.multiplier ?? null}
                  payout={wheelResult?.payout ?? null}
                />
                <BetControls
                  value={wheelStake}
                  onValueChange={(value) => {
                    setWheelStake(value);
                    setWheelResult(null);
                  }}
                  min={STAKE_LIMITS.wheel.min}
                  max={STAKE_LIMITS.wheel.max}
                  step={0.1}
                  quickBets={QUICK_BETS}
                  currency={currency}
                  disabled={wheelBusy || anyBusy}
                />
                <div className={`result-box ${wheelResultToneClass}`}>
                  <p>
                    Max win: {wheelPreview.maxMultiplier.toFixed(1)}x |{" "}
                    {currencyFormatter.format(wheelPreview.maxPayout)}
                  </p>
                  <p>
                    Win chance: {(wheelPreview.winProbability * 100).toFixed(2)}% | RTP:{" "}
                    {(wheelPreview.expectedMultiplier * 100).toFixed(2)}%
                  </p>
                  {wheelResult ? (
                    <p>
                      <strong>{wheelResult.outcome.toUpperCase()}</strong> | segment {wheelResult.label} | payout{" "}
                      {currencyFormatter.format(wheelResult.payout)}
                    </p>
                  ) : null}
                </div>
                <Button onClick={playWheel} disabled={wheelBusy || anyBusy}>
                  {wheelBusy ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Spinning...
                    </>
                  ) : (
                    "Spin Wheel"
                  )}
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="feed-slide reel-mines">
            <Card className="reel-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Dice1 className="size-4 text-emerald-300" />
                  Mines
                </CardTitle>
                <CardDescription className="text-xs">Swat flies, avoid mines, cash out fast.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                <BetControls
                  value={minesStake}
                  onValueChange={(value) => {
                    setMinesStake(value);
                    setMinesResult(null);
                  }}
                  min={STAKE_LIMITS.mines.min}
                  max={STAKE_LIMITS.mines.max}
                  step={0.1}
                  quickBets={QUICK_BETS}
                  currency={currency}
                  className="bet-controls-mines"
                  showManualInput={false}
                  disabled={minesBusy || anyBusy || minesRound !== null}
                />
                <div className="mines-bomb-compact">
                  <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Bombs</p>
                  <div className="mines-bomb-controls">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setMinesBombCountValue(minesBombCountValue - 1)}
                      disabled={minesBusy || anyBusy || minesRound !== null}
                    >
                      -
                    </Button>
                    <span>{minesBombCountValue}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setMinesBombCountValue(minesBombCountValue + 1)}
                      disabled={minesBusy || anyBusy || minesRound !== null}
                    >
                      +
                    </Button>
                    {[3, 5, 10].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`mines-bomb-chip ${minesBombCountValue === preset ? "mines-bomb-chip-active" : ""}`}
                        onClick={() => setMinesBombCountValue(preset)}
                        disabled={minesBusy || anyBusy || minesRound !== null}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={`result-box mines-result-box ${minesResultToneClass}`}>
                  {minesRound ? (
                    <p>
                      Live {minesRound.revealed.length}/{minesRound.totalTiles - minesRound.bombCount} safe | bombs{" "}
                      {minesRound.bombCount} | cashout {minesLiveMultiplier.toFixed(3)}x (
                      {currencyFormatter.format(minesCashoutPayout)})
                    </p>
                  ) : (
                    <p>
                      First safe hit {minesPreview.firstSafeMultiplier.toFixed(3)}x (
                      {currencyFormatter.format(minesPreview.firstSafePayout)}) | bombs {minesPreview.bombCount}
                    </p>
                  )}
                  {minesResult ? (
                    <p>
                      <strong>{minesResult.outcome.toUpperCase()}</strong> | {minesResult.revealed.length} picks | payout{" "}
                      {currencyFormatter.format(minesResult.payout)}
                    </p>
                  ) : null}
                </div>
                <MinesBugHuntArena
                  key={minesRound?.roundId ?? minesResult?.roundId ?? "mines-idle"}
                  active={Boolean(minesRound)}
                  locked={minesBusy || anyBusy}
                  totalTiles={MINES_TOTAL_TILES}
                  bombCount={minesRound?.bombCount ?? minesPreview.bombCount}
                  revealed={minesDisplayRevealed}
                  bombs={minesDisplayBombs}
                  explodedAt={minesDisplayExplodedAt}
                  outcome={minesResult?.outcome ?? null}
                  onReveal={revealMinesTile}
                />
                {!minesRound ? (
                  <Button onClick={startMinesRound} disabled={minesBusy || anyBusy}>
                    {minesBusy ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      "Start Mines"
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={cashoutMinesRound}
                    disabled={minesBusy || anyBusy || minesRound.revealed.length === 0}
                  >
                    {minesBusy ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        Settling...
                      </>
                    ) : (
                      "Cash Out"
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="feed-slide reel-higher-lower">
            <Card className="reel-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="size-4 text-fuchsia-300" />
                  Higher / Lower
                </CardTitle>
                <CardDescription>Deal first card, then guess if next is higher or lower.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <CardPeekerArena
                  currentCard={cardPeekerCurrentCard}
                  nextCard={cardPeekerNextCard}
                  revealing={cardPeekerRevealing}
                  guess={cardPeekerGuess}
                  outcome={cardPeekerOutcome}
                />
                {!higherLowerRoundId ? (
                  <>
                    <BetControls
                      value={higherLowerStake}
                      onValueChange={setHigherLowerStake}
                      min={STAKE_LIMITS.higher_lower.min}
                      max={STAKE_LIMITS.higher_lower.max}
                      step={0.1}
                      quickBets={QUICK_BETS}
                      currency={currency}
                      disabled={higherLowerBusy || anyBusy}
                    />
                    <div className="result-box">
                      <p>Deal card to reveal exact Higher/Lower odds and projected payout.</p>
                      <p>House edge: {(STANDARD_HOUSE_EDGE * 100).toFixed(2)}%</p>
                    </div>
                    <Button onClick={dealHigherLower} disabled={higherLowerBusy || anyBusy}>
                      {higherLowerBusy ? (
                        <>
                          <LoaderCircle className="size-4 animate-spin" />
                          Dealing...
                        </>
                      ) : (
                        "Deal Card"
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="result-box">
                      <p>Current card: <strong>{higherLowerCurrentCard}</strong></p>
                      <p>Pick your direction.</p>
                    </div>
                    {higherLowerQuote ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="result-box">
                          <p><strong>Lower Quote</strong></p>
                          {higherLowerQuote.lower.available ? (
                            <>
                              <p>
                                {(higherLowerQuote.lower.winProbability * 100).toFixed(2)}% |{" "}
                                {higherLowerQuote.lower.multiplier.toFixed(3)}x
                              </p>
                              <p>If win: {currencyFormatter.format(higherLowerQuote.lower.payout)}</p>
                            </>
                          ) : (
                            <p>Unavailable on this card.</p>
                          )}
                        </div>
                        <div className="result-box">
                          <p><strong>Higher Quote</strong></p>
                          {higherLowerQuote.higher.available ? (
                            <>
                              <p>
                                {(higherLowerQuote.higher.winProbability * 100).toFixed(2)}% |{" "}
                                {higherLowerQuote.higher.multiplier.toFixed(3)}x
                              </p>
                              <p>If win: {currencyFormatter.format(higherLowerQuote.higher.payout)}</p>
                            </>
                          ) : (
                            <p>Unavailable on this card.</p>
                          )}
                        </div>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        variant="secondary"
                        onClick={() => resolveHigherLower("lower")}
                        disabled={higherLowerBusy || anyBusy || !higherLowerQuote?.lower.available}
                      >
                        Lower
                      </Button>
                      <Button
                        onClick={() => resolveHigherLower("higher")}
                        disabled={higherLowerBusy || anyBusy || !higherLowerQuote?.higher.available}
                      >
                        Higher
                      </Button>
                    </div>
                  </>
                )}
                {higherLowerResult ? (
                  <div className="result-box">
                    <p>
                      <strong>{higherLowerResult.outcome.toUpperCase()}</strong> | {higherLowerResult.currentCard} to{" "}
                      {higherLowerResult.nextCard} ({higherLowerResult.guess})
                    </p>
                    <p>
                      Payout: {currencyFormatter.format(higherLowerResult.payout)} | Multiplier:{" "}
                      {higherLowerResult.multiplier.toFixed(3)}x
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>

          <section className="feed-slide reel-history">
            <Card className="reel-card">
              <CardHeader>
                <CardTitle>Live Session Feed</CardTitle>
                <CardDescription>Recent outcomes and settled round history.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Button variant="secondary" onClick={handleHistoryRefresh} disabled={anyBusy}>
                  Refresh History
                </Button>
                <div className="activity-list">
                  {activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No rounds played in this session yet.</p>
                  ) : (
                    activity.map((entry) => (
                      <div key={entry.id} className="activity-item">
                        <p className="font-medium">{entry.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.outcome.toUpperCase()} | payout {currencyFormatter.format(entry.payout)} | balance{" "}
                          {currencyFormatter.format(entry.balance)} | {new Date(entry.at).toLocaleTimeString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
                <div className="history-table-wrap">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Game</TableHead>
                        <TableHead>Stake</TableHead>
                        <TableHead>Payout</TableHead>
                        <TableHead>Outcome</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-muted-foreground">
                            No settled rounds yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        history.slice(0, 12).map((round) => (
                          <TableRow key={round.roundId}>
                            <TableCell>{round.gameId}</TableCell>
                            <TableCell>{currencyFormatter.format(round.stake)}</TableCell>
                            <TableCell>{currencyFormatter.format(round.payout)}</TableCell>
                            <TableCell>{round.outcome}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
              <CardFooter>
                <p className="text-xs text-muted-foreground">
                  Session expires: {new Date((session?.expiresAt ?? 0) * 1000).toLocaleString()}
                </p>
              </CardFooter>
            </Card>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
