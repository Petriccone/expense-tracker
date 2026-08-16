# Budget-model redesign — expense-tracker

**Date:** 2026-08-15
**Status:** spec for review (Rafa approved direction + 4 product decisions on 2026-08-15)
**Supersedes the framing of:** `2026-08-14-m1-real-bank-autosync-design.md` (that milestone built a transaction ledger; this reshapes the app around the couple's budget model. Bank auto-import stays a later milestone.)

## Goal
Turn expense-tracker into the couple's monthly budgeting tool that mirrors Rafa's spreadsheet: per-category **planned vs spent that zeros out**, grouped Fixos/Variáveis/Extras, the two salaries → month surplus → savings → 50/50 personal allowance. Manual entry now; the bank feed (Enable Banking) auto-fills the "spent" column in a later milestone.

## The model (learned from the sheet, verified with real numbers)
Per month, per category two columns:
- **Planejado** (sheet "Value") — the budget for that category this month.
- **Gasto** (sheet "Spent") — filled as they actually spend. The remaining (Planejado − Gasto) shrinks toward zero ("vai zerando"); overspent goes negative.

Categories live in three groups: **Fixos** (Fixes), **Variáveis** (Variables), **Extras**.

Month close (verified against the sheet):
- `total_planned` = Σ category.planned ; `total_spent` = Σ category.spent
- **Net Worth (month)** = (salary_A + salary_B) − total_planned. *Verified: Dec 2.579,91 + 3.185,00 − 4.395,07 = 1.369,84 ✓*
- **Save** = amount saved that month (chosen). **Total Saving** = savings_opening_balance + Σ save up to this month. *Verified: Jun 3.372,79 + 700 = 4.072,79 ✓*
- **Us** = Net Worth − Save. *Verified: Jan 1.298,86 − 300 = 998,86 ✓*
- **El / Ela** = Us / 2 each (always 50/50). *Verified: Jan 499,43 each ✓*

Only the two salaries feed Net Worth. Extra income (Deliveroo, Cash, "Last Month" rollover) is tracked but excluded from the Net Worth base — matches the sheet.

## Product decisions (confirmed by Rafa, 2026-08-15)
| # | Decision | Value | Source |
|---|----------|-------|--------|
| 1 | New-month categories | Carry forward previous month's categories + planned; spent resets to 0 | confirmed |
| 2 | Seed | Pre-load app from the sheet's latest month; current month = **Aug/2026** | confirmed |
| 3 | Scope | Budget model only; bank auto-import later; manual entry now | confirmed |
| 4 | Old ledger | Kept as a secondary "Transações" tab | confirmed |
| 5 | Groups | Fixos / Variáveis / Extras | derived |
| 6 | Net Worth base | Σ salary incomes only (extras excluded) | derived+verified |
| 7 | Split | 50/50 Us→El/Ela, always | derived+verified |
| 8 | "Restante" column | planned − spent; red when negative (overspent) | derived (label flip from sheet's spent−planned for readability) |
| 9 | Currency | EUR | derived |
| 10 | Persistence | SQLite + `/data` volume; **budget state moves server-side** (today it's localStorage — wrong for a shared couple tool) | derived |
| 11 | Auth / multi-user | Existing basic-auth stays; single login models the couple (no separate Rafaela login this build) | default |

## Current-state problems this fixes
- `/budget` today is the wrong model (single `monthlyBudget` + per-category limit derived from transactions). Rewritten to planned/spent/remaining.
- Categories, settings, and category budgets live in **localStorage** (per-browser, not shared, not server-persisted). Moved to SQLite so both partners/devices see the same numbers.
- `defaultCategories` are generic placeholders (Food & Dining, Transport…). Replaced by Rafa's real categories via seed.

## Architecture

### Data layer (SQLite, `/data` volume, reuse `src/lib/db.ts`)
New tables (new `src/lib/budget-store.ts`; leave `truelayer_*` / `manual_transactions` tables intact for the ledger tab):
- `budget_months(id, year, month, save REAL, note, created_at)` — one row per month (unique year+month).
- `budget_categories(id, month_id FK, group TEXT CHECK in ('fixed','variable','extra'), name, planned REAL, spent REAL, sort_order, INDEX on month_id)`.
- `budget_incomes(id, month_id FK, label, amount REAL, kind TEXT CHECK in ('salary','extra'), sort_order)`.
- `budget_settings(key, value)` — `savings_opening_balance`, `person_a_label`='Rafael', `person_b_label`='Rafaela', `currency`='EUR'.

Computed (in the store, not stored): total_planned, total_spent, net_worth, us, el, ela, total_saving (opening + cumulative save ≤ month). All money as REAL rounded to cents on read.

### API (`src/app/api/budget/*`) — same node runtime, JSON
- `GET /api/budget/months` → list (year, month, id).
- `GET /api/budget/current` and `GET /api/budget/months/:id` → full month: categories grouped, incomes, save, and all computed rollups.
- `POST /api/budget/months` → create the next month by carrying forward the latest month's categories+incomes (planned/salary copied, spent=0). Refuses to duplicate an existing month.
- `PATCH /api/budget/months/:id` → edit `save`, note.
- `POST/PATCH/DELETE /api/budget/categories(/:id)` → add/edit (name, group, planned, spent)/remove a category.
- `POST/PATCH/DELETE /api/budget/incomes(/:id)`.
- `GET/PATCH /api/budget/settings`.

Writes gated the same way the app already gates mutations (behind basic-auth; no `x-cron-secret` needed — these are user actions, not the sync cron). Validate: numbers finite ≥ 0 (spent may exceed planned; planned ≥ 0), group in the allowed set, month uniqueness.

### UI
- **`/budget` = the home of the app** (also make it the default route). Sections:
  - Month switcher (‹ Aug 2026 ›) + a "novo mês" action (carry-forward) when the next month doesn't exist.
  - Three group cards (Fixos / Variáveis / Extras). Each row: name · **Planejado** (inline-edit) · **Gasto** (inline-edit) · **Restante** (computed, red if overspent) · a progress bar (gasto/planejado, amber ≥80%, red >100%). "+ categoria" per group.
  - Income block: salaries (2) + extras, inline-editable, "+ renda".
  - Month-close card: Net Worth · Save (inline-edit) · Total Saving (running) · **Us** · **El / Ela**.
- Reuse the existing `/budget` visual shell (glass cards, progress bars, month nav, inline-edit pattern) — rewrite its data source from AppContext/localStorage to the budget API.
- **`/transactions`** stays as the secondary ledger tab (the M1 read API + manual entries). Nav reordered so Budget is primary. `AppContext` keeps serving the ledger only; budget state uses its own hooks hitting the budget API (server as source of truth, no localStorage for budget).

### Seed (idempotent; runs on first boot when `budget_months` is empty)
Seed **Aug/2026** from the sheet's Aug template (planned values below), spent = 0, salaries as shown, `savings_opening_balance` = 4072.79 (sheet Total Saving through Jul; editable in settings).

Fixos (planned €): Insurance 150.00, Phone 70.75, Shop 650.00, Eletricity 100.00, Youtube 25.99, Loan 109.26, Apple 9.99, Amazon 6.99, Spotify 18.99, Wifi 22.99, Leap Card 30.00, Botfy 200.00, Netflix 17.00, Lashes 85.00, Hair Cut 20.00, Nail 80.00, Pills 16.00, Fuel 150.00, Gym 138.00, Cleaner 50.00, Rental 1397.00.
Variáveis: Pay Later 253.65, Credit Card 366.67, Car Wash 0.00, MacBook 92.23.
Extras: BCN 14.20.
Salaries: Rafael 2942.31, Rafaela 2855.83. Save (default) 700.00.

(Old `public/seed-budgets.json` / `seed-categories.json` become obsolete — remove their use in AppContext.)

## Data flow
manual edit of Gasto (or later: bank sync writes category.spent) → SQLite → `GET /api/budget/current` → UI renders planned/gasto/restante + rollups. Next month: POST carry-forward → adjust planned → track.

## Error handling
- Empty DB → seed runs → Aug/2026 present. If seed somehow skipped, `/budget` shows an onboarding "criar mês" state instead of crashing.
- Carry-forward when the target month already exists → 409, UI just switches to it.
- Inline-edit invalid number → rejected client + server; value unchanged.

## Testing
- Store math unit tests: net_worth, us, el/ela, total_saving cumulative — asserted against the sheet's real numbers (Dec/Jan/Jun above).
- Carry-forward copies categories+incomes, resets spent, refuses duplicate month.
- API round-trips (create month, edit planned/spent/save, add/delete category).
- UI renders seeded Aug/2026; editing Gasto updates Restante + rollups live.
- Basic-auth still enforced on budget routes (unauth → 401).

## Build plan (orchestrated, file-disjoint waves)
1. **Data layer** — `budget-store.ts` + schema + seed + store unit tests (developer + tester).
2. **API** — `/api/budget/*` routes (developer; depends on 1).
3. **UI** — rewrite `/budget` to the model, move ledger to `/transactions`, reorder nav, drop localStorage-as-source for budget (developer; depends on 2).
4. **Verify** — reviewer + security (auth on new routes, input validation, no secret/PII leakage) + full build + suite. HIGH findings block.
5. Deploy to OCI Dokploy is **GO-GATE 2** (needs Rafa's explicit go).

## Out of scope (later milestones)
Enable Banking auto-fill of Gasto + auto-categorization; separate Rafaela login / real multi-user; Postgres; historical import of every past month; reports redesign.
