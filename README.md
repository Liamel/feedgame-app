# Feed Casino Demo Frontend

Simple React demo UI wired to the backend in `/Users/r.kazaishvili/Documents/FeedGame`.

It supports:

- issuing session tokens (`/v1/operator/session-token`)
- fetching feed games (`/v1/feed/next`)
- starting rounds (`/v1/rounds/start`)
- round actions (`/v1/rounds/:roundId/action`) for `higher_lower` and `mines`
- settling rounds (`/v1/rounds/:roundId/settle`)
- viewing player round history (`/v1/players/:playerId/rounds`)
- verifying round reveal payload (`/v1/rounds/:roundId/verify`)

## UI Stack

- Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`)
- shadcn/ui initialized (`components.json`, `src/components/ui/*`)
- PixiJS React renderer (`pixi.js`, `@pixi/react`) with live preview component at `src/components/pixi-preview.tsx`

You can add more shadcn components with:

```bash
pnpm dlx shadcn@latest add button card input select table
```

## Prerequisites

- backend running on `http://localhost:8080`
- Postgres/Redis up for backend (or backend running with in-memory persistence)

Backend quick start (from `/Users/r.kazaishvili/Documents/FeedGame`):

```bash
docker compose up -d postgres redis
pnpm --filter @feed-casino/server migrate
pnpm --filter @feed-casino/server dev
```

## Frontend Run

From `/Users/r.kazaishvili/Documents/FeedGameAPP/feedgame-app`:

```bash
pnpm install
pnpm dev
```

The frontend calls `/api/*`, and Vite proxies that to `http://localhost:8080`.

## Optional Env Vars

Create `.env.local` in this frontend project if needed:

```bash
VITE_API_BASE_URL=/api
VITE_OPERATOR_API_KEY=operator-dev-key
VITE_DEFAULT_STARTING_BALANCE=1000
```
