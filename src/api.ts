export type GameId =
  | "coin_flip"
  | "dice_over_under"
  | "wheel"
  | "higher_lower"
  | "mines";

export interface SessionTokenRequest {
  operatorPlayerId: string;
  currency: string;
  locale: string;
  jurisdictionProfile: "MALTA_BASELINE" | "SE_STRICT";
  channel: "iframe" | "sdk";
}

export interface SessionTokenResponse {
  token: string;
  sessionId: string;
  expiresAt: number;
  featureFlags: {
    autoplayEnabled: boolean;
    requireExplicitRoundAction: boolean;
    showRtpBeforeBet: boolean;
  };
}

export interface FeedItem {
  cursor: string;
  gameId: GameId;
  variantId: string;
  minBet: number;
  maxBet: number;
  rtpDisplayed: number;
  jurisdictionFlags: string[];
  uiHints: {
    title: string;
    teaser: string;
    expectedRoundMs: number;
  };
  rulesUrl: string;
  hashCommit: string;
}

export interface StartRoundRequest {
  sessionId: string;
  gameId: GameId;
  stake: number;
  clientSeed: string;
  idempotencyKey: string;
  gameInput?: Record<string, unknown>;
}

export interface StartRoundResponse {
  roundId: string;
  acceptedStake: number;
  serverCommitHash: string;
  state: "started" | "in_progress" | "settled";
  gameState: Record<string, unknown>;
}

export interface RoundActionRequest {
  idempotencyKey: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface RoundActionResponse {
  roundId: string;
  state: "started" | "in_progress" | "settled";
  gameState: Record<string, unknown>;
  readyToSettle: boolean;
}

export interface RoundSettleResponse {
  roundId: string;
  status: "settled";
  outcome: "win" | "loss";
  payout: number;
  multiplier: number;
  settlementRef: string;
  balance: number;
}

export interface RoundHistoryItem {
  roundId: string;
  gameId: GameId;
  stake: number;
  payout: number;
  outcome: "win" | "loss" | "open";
  createdAt: number;
  settledAt: number | null;
}

export interface VerifyRoundResponse {
  roundId: string;
  serverSeedReveal: string;
  clientSeed: string;
  nonce: number;
  algorithmVersion: string;
  reproducibleResult: Record<string, unknown>;
}

interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

function createHeaders(token?: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return headers;
}

async function request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: createHeaders(token, init.headers),
  });

  if (!response.ok) {
    let payload: ApiErrorResponse | null = null;
    try {
      payload = (await response.json()) as ApiErrorResponse;
    } catch {
      payload = null;
    }

    throw new ApiError(
      response.status,
      payload?.error?.code ?? "UNKNOWN_ERROR",
      payload?.error?.message ?? `Request failed with status ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

export async function issueSessionToken(
  body: SessionTokenRequest,
  operatorApiKey: string,
): Promise<SessionTokenResponse> {
  return request<SessionTokenResponse>(
    "/v1/operator/session-token",
    {
      method: "POST",
      headers: {
        "x-operator-api-key": operatorApiKey,
      },
      body: JSON.stringify(body),
    },
  );
}

export async function getNextFeed(token: string, cursor?: string): Promise<FeedItem> {
  const params = new URLSearchParams();
  if (cursor) {
    params.set("cursor", cursor);
  }
  const query = params.toString();
  return request<FeedItem>(`/v1/feed/next${query ? `?${query}` : ""}`, { method: "GET" }, token);
}

export async function startRound(
  token: string,
  body: StartRoundRequest,
): Promise<StartRoundResponse> {
  return request<StartRoundResponse>(
    "/v1/rounds/start",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function actionRound(
  token: string,
  roundId: string,
  body: RoundActionRequest,
): Promise<RoundActionResponse> {
  return request<RoundActionResponse>(
    `/v1/rounds/${roundId}/action`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function settleRound(
  token: string,
  roundId: string,
  body: { idempotencyKey: string; settleAction?: string },
): Promise<RoundSettleResponse> {
  return request<RoundSettleResponse>(
    `/v1/rounds/${roundId}/settle`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function listPlayerRounds(
  token: string,
  playerId: string,
): Promise<{ items: RoundHistoryItem[] }> {
  return request<{ items: RoundHistoryItem[] }>(
    `/v1/players/${playerId}/rounds`,
    {
      method: "GET",
    },
    token,
  );
}

export async function verifyRound(
  token: string,
  roundId: string,
): Promise<VerifyRoundResponse> {
  return request<VerifyRoundResponse>(
    `/v1/rounds/${roundId}/verify`,
    {
      method: "GET",
    },
    token,
  );
}
