# instaleads

Autonomous Instagram prospecting system for **Mozart Consultoria em TI**. A local
modular monolith that runs the loop **Observe → Decide → Act → Measure → Learn →
Adapt** across two funnels (customers and affiliates), within the limits set in
`.env` and the panel. Beyond those limits it pauses and calls the operator.

> Developer documentation is in English. The operator guide is in Portuguese:
> see [`SETUP.md`](./SETUP.md).

## Stack

Next.js (App Router) · React · TypeScript `strict` · Tailwind · SQLite · Drizzle
ORM (migrations) · Node.js ≥ 22 · pnpm · Playwright (CDP) · official OpenAI SDK.
SQLite is the single source of truth. No PostgreSQL/Redis/queue service.

## Quick start (one command)

```bash
pnpm install
cp .env.example .env                       # fill in real values (see SETUP.md)
cp config/business.example.json config/business.json  # already provided for Mozart
pnpm db:migrate                            # create the SQLite schema
pnpm dev                                   # runs the panel + worker together
```

Panel: <http://localhost:3000>. The worker starts alongside it.

For production: `pnpm build && pnpm start` (also runs panel + worker).

### Run without credentials (offline demo)

Everything except live Instagram/OpenAI calls runs with fakes:

```bash
pnpm e2e     # end-to-end simulation with printed evidence of every critical flow
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Panel + worker (development) |
| `pnpm build` / `pnpm start` | Production build / run panel + worker |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm lint` | ESLint (flat config) |
| `pnpm test` | Vitest unit/integration tests |
| `pnpm db:generate` | Generate a Drizzle migration from the schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:backup` | Online SQLite backup to `backups/` |
| `pnpm e2e` | Offline end-to-end simulation |

## Architecture

```
config/business.json         identity, offer, ICP, claims (gitignored)
src/app                      Next.js panel (Server Components + Server Actions)
src/app/api/webhooks         Instagram webhook (Route Handler)
src/features/leads           discovery, dedupe, scoring, state transitions
src/features/conversations   messages (dedupe + channel-ownership lock), handoff, policy
src/features/experiments     A/B assignment + analysis
src/features/system          pause switch, circuit breaker, counters, exceptions
src/features/dashboard       read models for the panel
src/integrations/instagram   official API + webhook (signature + idempotency)
src/integrations/browser     Playwright via CDP (+ fake), pacing, mutex
src/integrations/openai      engine interface + OpenAI impl + fake, budget guard
src/db                       schema, migrations, client, audit
src/worker                   durable jobs, handlers, circuit breaker, recovery
src/lib                      env, config, claims guard, states, crypto, time
```

### Channel architecture

1. **Browser (first contact).** The first DM is sent through the operator's real,
   logged-in Chrome via CDP (`chromium.connectOverCDP`). A dedicated tab, restricted
   to Instagram, never taking mouse/keyboard, one job at a time (mutex), paced like a
   real SDR. If CDP is unreachable it does **not** launch a new Chrome — it pauses.
2. **Official API (continuation).** When the lead replies, the Meta webhook matches
   the message to the lead, **channel ownership transfers to the API**, and the AI
   continues there. A channel-ownership lock + a unique per-message dedupe key
   guarantee zero duplicate sends between browser and API.
3. **WhatsApp.** Interested customers are routed to the WhatsApp link; affiliates to
   the group link (blocked until one exists).

### Safety rails

- **Claims guard**: only `VERIFIED_CLAIMS` may be sent; unverified claims, fabricated
  rates/guarantees/superlatives and financial/approval promises are blocked on every
  outbound message, on every channel.
- **Budget guard**: every AI call is priced and logged in `ai_calls`; the system
  pauses at `OPENAI_MONTHLY_BUDGET_USD`.
- **Circuit breaker + global pause**: abnormal error growth, browser unavailable,
  closed API window, opt-out, and budget overrun all pause the system.
- **Idempotency**: unique constraints on lead handle, Meta message id, message dedupe
  key, webhook delivery id, and job idempotency key.
- **Restart recovery**: jobs left in-flight are requeued on worker startup.

## Testing

`pnpm test` covers: lead dedupe, pipeline/channel transitions, browser first contact,
browser → webhook → API handoff, duplicate-send lock, webhook idempotency, follow-up,
experiment assignment, restart recovery, API-window expiry, do-not-contact list,
circuit breaker, and budget cut-off.

Browser testing has three levels: (1) local with simulated pages/APIs (fake client),
(2) real dry-run with the final send blocked (`BROWSER_DRY_RUN=1`), (3) a limited real
smoke test — **only after explicit operator authorization**.
