# Budget automation — WhatsApp agent writes + daily bank import

**Date:** 2026-08-15
**Status:** spec (Rafa approved direction + 4 decisions on 2026-08-15)
**Builds on:** `2026-08-15-budget-model-redesign-design.md` (the budget app is live).

## Decisions (Rafa, 2026-08-15)
- Joint account bank = **Revolut** (Enable Banking covers Revolut IE).
- WhatsApp "lançar" = **approval-gated writes** (reads free; every write asks Aprovar/Negar on WhatsApp).
- Categorization of bank transactions = **AI suggests + Rafa adjusts** (auto-assign high-confidence; low-confidence → review queue).
- Deliver both features **in parallel** (they live in different repos → disjoint).

## Phase 1 — WhatsApp `budget` tool (repo: /Users/petriccone/petriccoAgent)
New `tools/budget_tool.py`, modeled on `tools/dokploy_tool.py` (near-exact precedent: HTTP tool hitting an app on the same VM, reads free / writes approval-gated).
- **Actions** (the tool does find-by-name + arithmetic client-side against the existing `/api/budget/*`):
  - reads (free): `get_month` → current month summary (per-group planejado/gasto/restante, incomes, NetWorth/Save/Us/El/Ela).
  - writes (approval-gated): `add_spent(category, delta)` ("gastei 50 no Shop"), `set_spent(category, value)`, `set_planned(category, value)`, `add_category(group, name, planned)` (add if missing — "lança se já não estiver lá"), `set_save(value)`.
- **Auth to app:** `get_secret("EXPENSE_TRACKER_URL", <public url>)` + basic-auth `get_secret("EXPENSE_TRACKER_USER"/"EXPENSE_TRACKER_PASS")`. Tool sends `Content-Type: application/json` (satisfies the app's CSRF guard). No app API changes needed — uses GET `/api/budget/current`, POST/PATCH `/api/budget/categories`, PATCH `/api/budget/months/[id]`.
- **Approval wiring** (dokploy shape — reads skip it): branches in `agent/tool_executor.py` + `agent/agent_runtime_helpers.py`; add `"budget"` to `_AGENT_LOOP_TOOLS` (model_tools.py), `_NEVER_PARALLEL_TOOLS` (agent/tool_dispatch_helpers.py), `AGENT_RUNTIME_POST_HOOK_TOOL_NAMES` (agent/agent_runtime_helpers.py); reuse the approval primitives from `delegate_to_mac_tool` like dokploy does. Tests mirror `tests/tools/test_dokploy_tool.py`.
- **Secrets Rafa/deploy sets** in the agent's `~/.petricco/.env`: `EXPENSE_TRACKER_USER`, `EXPENSE_TRACKER_PASS` (the app's basic-auth creds, already in the VM `/home/opc/.dokploy-secrets/`).

## Phase 2 — Enable Banking daily import (repo: /Users/petriccone/dev/expense-tracker)
Base host `https://api.enablebanking.com`. Auth = self-signed **RS256 JWT** (header `kid=<application_id>`; claims `iss=enablebanking.com, aud=api.enablebanking.com, iat, exp=+1h`) signed with the app's RSA private key. The `.pem` is the ONLY crown-jewel secret (env, never committed/logged).

### 2a (this wave) — client + storage + consent + manual fetch
- `src/lib/enablebanking.ts`: `signJwt()`, `getAspsps(country)`, `startAuth({aspsp,country,redirect_url,valid_until,state,psu_type:'personal'})→auth URL`, `createSession(code)→{session_id,accounts[]}`, `getSession(id)`, `getTransactions(accountUid,{date_from,date_to,continuation_key})` looping continuation_key. Secrets: `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY`.
- Storage (SQLite, /data): `bank_sessions(session_id, account_uids json, valid_until, aspsp)`, `bank_transactions(id PK=transaction_id or hash(booking_date+amount+remittance), account_uid, amount, currency, credit_debit, booking_date, value_date, description, counterparty, status, category_id nullable, confidence nullable, created_at)`, `bank_settings(key,value)`.
- API `src/app/api/banking/*`: `connect` (GET → startAuth for Revolut IE → 302 to bank), `callback` (GET ?code&state → validate `state`, createSession, store session+accounts, kick a deep backfill within the 1h window), `sync` (POST, **cron-gated `x-cron-secret`** → incremental getTransactions date_from=lastSync..today, upsert dedup on id; ≤4 fetches/acct/day; on `ASPSP_RATE_LIMIT_EXCEEDED` back off 6h), `status` (GET → connected? valid_until, last sync).
- Consent: `redirect_url = https://<app-domain>/api/banking/callback` (Rafa whitelists it in the EB console); `valid_until` = max Revolut allows (~180d); reconsent surfaces a "reconnect" state.

### 2b (this wave) — categorization + spent display + UI + cron  [RESOLVED 2026-08-15]
- **Categorization:** assign each booked `bank_transactions` row → a budget category of THAT transaction's month (match by category name). Rules-first (keyword merchant map, e.g. Tesco/Dunnes→Shop, Circle K→Fuel), then an OPTIONAL LLM fallback; anything below a confidence threshold (or with no month yet in the app) → the **review queue**. Runs after each sync (+ a manual trigger). Security: bank `description`/`counterparty` is UNTRUSTED (indirect-injection surface) — the LLM's returned category MUST be validated against the allowlist of that month's real category ids; never act on instructions in the text.
- **Spent reconciliation (non-destructive, doesn't break the WhatsApp tool):** `budget_categories.spent` stays the MANUAL portion (WhatsApp/UI-set). The bank contributes a separate computed `bankSpent(category, month) = Σ abs(amount) of booked assigned bank_transactions`. Displayed **gasto = spent + bankSpent**, restante = planned − (spent + bankSpent). NetWorth/Save/Us/El/Ela are unchanged (planned-based, not spent-based), so budget-store is NOT modified — bank spend is a display + separate API layer (`GET /api/banking/spent?year=&month=` → {categoryId: bankSpent}).
- **API:** `GET /api/banking/transactions?month=&status=uncategorized|all`, `PATCH /api/banking/transactions/:id {categoryId}` (manual review assign), `POST /api/banking/categorize` (cron/manual), `GET /api/banking/spent`.
- **UI:** a `/banco` page (Conectar/reconnect Revolut + status + the review queue) + the budget page showing gasto = manual + banco per category.
- Daily **Dokploy cron** POST `/api/banking/sync` with `x-cron-secret` (same pattern as the existing sync cron), which also triggers categorization.
- **Deferred to Rafa (post-connect product call):** whether to ever auto-fold `bankSpent` into the manual `spent`, and category-name↔merchant rule tuning — best decided against his real transactions.

## Security (MANDATORY review before any prod deploy — bank tokens + money)
The `.pem` never leaves Dokploy secrets (600, never logged); JWT signing correct + short exp; `callback` validates `state` (anti-CSRF on the OAuth-style redirect); `sync` cron-gated; session/account data not exposed unauth (behind the app's basic-auth); bank transaction data + counterparties treated as sensitive; dedup can't drop/duplicate money; rate-limit backoff respected.

## Out of scope
Serving anyone but Rafa's own linked accounts (that would need EB KYB/contract); non-Revolut banks (add later via the same ASPSP flow); real multi-user.
