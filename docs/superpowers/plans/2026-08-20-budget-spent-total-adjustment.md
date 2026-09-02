# Editable Budget Spent Totals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `/budget` save the final displayed `Gasto` total, including a persistent correction for bank-derived spend.

**Architecture:** Add a signed `spent_adjustment` column to each budget category. The displayed row total becomes `manual spent + bankSpent + spentAdjustment`; the UI sends only the adjustment when editing Gasto, so raw bank transactions remain unchanged and existing manual/API callers keep their meaning.

**Tech Stack:** Next.js App Router, React/TypeScript, SQLite via Node `node:sqlite`, Vitest, ESLint.

---

### Task 1: Extend the budget model and migrate existing SQLite data

**Files:**
- Modify: `src/types/budget.ts`
- Modify: `src/lib/budget-store.ts`
- Test: `src/lib/budget-store.test.ts`

- [x] Add the optional `spentAdjustment` field to `BudgetCategory` for compatibility with existing fixtures.
- [x] Add `spent_adjustment REAL NOT NULL DEFAULT 0` to the `budget_categories` CREATE TABLE definition.
- [x] Make `initBudgetSchema()` idempotently add the column to an existing table by checking `PRAGMA table_info(budget_categories)` and running `ALTER TABLE budget_categories ADD COLUMN spent_adjustment REAL NOT NULL DEFAULT 0` only when absent.
- [x] Add `spent_adjustment` to category reads, updates, seed/default handling, and carry-forward/backfill behavior; new copied categories start at `0`.
- [x] Validate a supplied `spentAdjustment` with the finite-number validator, allowing negative values; preserve the existing non-negative validation for manual `spent`.
- [x] Extend DB-backed tests to cover zero defaults, a `-123.96` correction, and repeat schema initialization.
- [x] Run the focused budget-store tests successfully.

### Task 2: Preserve the API contract while accepting corrections

**Files:**
- Modify: `src/app/api/budget/categories/[id]/route.ts`

- [x] Read `spentAdjustment` from the PATCH JSON body and pass it to `updateCategory` without changing the meaning of the existing `spent` field.
- [x] Keep omitted `spentAdjustment` unchanged in the store, so existing callers that send only `{spent}` remain compatible.
- [x] Keep the route’s existing JSON/error behavior and response shape.
- [x] Feature-file lint and focused tests pass; the repository-wide lint still reports unrelated pre-existing errors.

### Task 3: Make the UI edit and render the same total

**Files:**
- Modify: `src/lib/groupSpent.ts`
- Modify: `src/lib/groupSpent.test.ts`
- Modify: `src/components/budget/CategoryGroupCard.tsx`

- [x] Add pure helpers in `groupSpent.ts` for one category’s displayed total and for calculating `desiredTotal - manualSpent - bankSpent`; treat missing `spentAdjustment` as zero for compatibility with existing test fixtures.
- [x] Update `groupSpentSum()` to include each category’s adjustment so card headers match row totals.
- [x] In `CategoryRow`, compute `gasto` with the shared helper and pass `value={gasto}` to the Gasto `InlineMoneyEdit`.
- [x] On Gasto save, send `{ spentAdjustment: desiredTotal - category.spent - bankSpent }` and leave `spent` untouched. Planned editing remains unchanged.
- [x] Show `manual`, `banco`, and `ajuste` in the breakdown when bank spend or a non-zero adjustment exists.
- [x] Track whether the viewed month’s bank-spend snapshot is ready; retain the last successful snapshot on transient failure and disable only the Gasto editor until a valid snapshot is available.
- [x] Add pure tests for manual-only totals, bank totals, signed adjustments, group totals, and the September Shop case.
- [x] Run the focused group-spend and budget-store tests successfully.

### Task 4: Validate the complete change

**Files:**
- No new source files.

- [x] Run `npm test` from `/Users/petriccone/dev/expense-tracker` (203 tests passed).
- [x] Run feature-file lint and record the repository-wide lint result (10 unrelated existing errors).
- [x] Run `npm run build` to verify the Next.js production bundle and schema/types compile together.
- [x] Review the diff and preserve the pre-existing concurrent changes; the feature does not modify bank transaction tables/routes.
- [x] After deployment approval, inspect the public page and the September Shop scenario without changing production data; confirmed the editor opens at `123.96` and closed it without saving.
