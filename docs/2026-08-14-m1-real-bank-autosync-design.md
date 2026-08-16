# M1 — Real bank → app, automatic (expense-tracker)

**Date:** 2026-08-14
**Status:** approved (Rafa: bank-real path, approach A = SQLite + read API, basic-auth gate)

## Goal
Rafa connects his REAL bank (TrueLayer production) once, and his real card transactions flow into the expense-tracker app automatically and stay visible + auto-updating. Nothing else (categorization intelligence, the couple/budget layer, conversational agent) is in M1 — those are later milestones.

## Context (current reality)
The app (`~/dev/expense-tracker`, Next.js 16, deployed on OCI Dokploy as `expense-tracker-quantify`) has 3 disconnected data layers: browser localStorage+seed (what the UI shows today), a dead Supabase/Telegram path (unconfigured), and SQLite (`/data/expense-tracker.db`, tables `truelayer_connections/accounts/transactions`) which the TrueLayer pipeline writes to. The TrueLayer OAuth flow (connect → callback → `syncAll` → SQLite) is coded but: never proven working (0 rows), sandbox-only (`TRUELAYER_ENV=sandbox`, mock bank `uk-cs-mock`), tokens stored PLAINTEXT, single-user (`user_id='default'`), and **no UI page reads the SQLite bank data**. Auth is fake (client-side localStorage). The app is public over HTTPS.

## Approach A (chosen): SQLite is the store; add a read API + bridge the UI to it
Keep SQLite (the bank pipeline already targets it). Add a read API, wire the UI to it, retire localStorage-as-source and the dead Supabase path. Single container, fast. Postgres migration is a future option if multi-device is needed.

## M1 workstreams

### Code (in `~/dev/expense-tracker`)
1. **Read API** — `GET /api/transactions` reading `truelayer_transactions` JOIN `truelayer_accounts`, returning the app's unified `Transaction` shape (map `posted_at` epoch-ms → date; expose amount/currency/description/account; carry TrueLayer's `category` as a raw hint, real categorization is a later milestone). Support pagination/date-range + a `?since=` param. Add a small `GET /api/accounts` too.
2. **UI bridge** — dashboard, transactions list, and reports read from the read API instead of `AppContext`'s localStorage/seed. Manual entries keep working (persist to SQLite via a small write path or a dedicated `manual_transactions` table merged into the read API). Remove/park the Supabase 15s poll. localStorage stays only for UI prefs, not as the transaction source of truth.
3. **Token encryption at rest** — re-enable the removed encryption: encrypt TrueLayer `access_token`/`refresh_token` before writing to `truelayer_connections`, decrypt on read. Key from env `TRUELAYER_TOKEN_ENC_KEY` (32-byte, in Dokploy secrets, 600). Never log tokens.

### Infra / config (OCI VM + Dokploy + TrueLayer console)
4. **Production TrueLayer** — set `TRUELAYER_ENV=production` (or the code's live value) + real `TRUELAYER_CLIENT_ID`/`TRUELAYER_CLIENT_SECRET` in the `expense-tracker-quantify` Dokploy env; register the redirect URI `https://<app-domain>/api/truelayer/callback` in the TrueLayer PRODUCTION app; point at Rafa's real Irish bank (not the mock provider). Verify the code's provider/scope config works for production (not hardcoded to `uk-cs-mock`).
5. **Auto-sync** — a scheduled trigger of `GET /api/truelayer/sync` every N hours (default 6h) with token refresh (code has refresh logic). Mechanism: a cron on the VM (or a Dokploy scheduled task) hitting the endpoint. Guard: only one in-flight sync; log outcomes.
6. **Persistence** — confirm the Dokploy volume mounting `/data` persists across redeploys (so connection + transactions survive).
7. **Access gate (security, required)** — the app has fake auth + is public; real bank data must not sit on a public URL. Add HTTP basic-auth via Traefik middleware on the app's router (same pattern as `botfywebscraper`). (Full in-app auth is a later option.)

## Data flow
real card spend → TrueLayer records it → cron hits `/api/truelayer/sync` → `syncAll` pulls accounts+transactions → SQLite (dedup on transaction_id) → `GET /api/transactions` → UI renders. Latency = sync interval (bank data isn't real-time push).

## Error handling
- Token refresh (exists, 60s early). Consent expiry (~90 days) → surface a "reconnect bank" state on `/connections`.
- Sync failure → logged, non-fatal, retried next interval. Dedup on `transaction_id` (INSERT OR IGNORE, exists).
- Read API tolerates empty DB (no bank connected yet) → returns empty list, UI shows an empty/onboarding state.

## Security
- Encrypt tokens at rest (WS3). Basic-auth gate (WS7). App stays HTTPS-only (Traefik). Tokens/secret never logged. The TrueLayer client_secret + enc key live in Dokploy secrets (600), never in the repo.

## Testing
- Read API returns correctly-shaped transactions from seeded SQLite rows (unit).
- UI renders from the API (empty + populated).
- Token encryption round-trips; DB never contains plaintext tokens.
- End-to-end (the real unknown): connect Rafa's real bank via the production OAuth flow → a real transaction appears in SQLite and then in the UI; a subsequently-made transaction shows up after the next auto-sync.
- App requires basic-auth (unauthenticated request → 401).

## Out of scope (later milestones)
Real categorization engine (TrueLayer category → Rafa's taxonomy), the couple/budget layer (planned-vs-actual, Fixes/Variables/Extras, 50/50 split, savings), conversational agent capture/queries, multi-user, Postgres migration.
