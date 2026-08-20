# Budget spent-total adjustment

**Date:** 2026-08-20  
**Status:** approved by Rafa

## Goal

On `/budget`, editing `Gasto` must edit the total shown to the user. Entering
`0` must make that total `€0,00`, including when the displayed amount came from
bank categorization, while preserving the raw bank transactions.

## Current behavior and diagnosis

The budget page renders `gasto = category.spent + bankSpent[category.id]`, but
`InlineMoneyEdit` receives `value={category.spent}` and therefore opens with
the manual portion instead of the displayed total. In September 2026, `Shop`
shows `€123.96` while its breakdown is `manual €0.00 · banco €123.96`; the
editor opens with `0`, and saving a new manual value cannot reduce the bank
portion.

## Behavior decisions

| Decision | Status/source |
|---|---|
| The edit draft starts with the displayed total. | `[derived]` confirmed by Rafa on 2026-08-20 |
| The number entered is the desired final displayed total, not only the manual portion. | `[derived]` confirmed by Rafa on 2026-08-20 |
| A signed per-category adjustment is stored separately from manual `spent`. | `[derived]` preserves the existing computed bank contribution and raw bank rows; additive migration is the smallest compatible model |
| Displayed total is `manual spent + computed bank spend + signed adjustment`. | `[derived]` keeps bank data auditable while allowing a correction such as `€123.96 → €0.00` |
| The adjustment may be negative; the UI only accepts a desired total >= 0. | `[derived]` a zero total with a positive bank contribution requires a negative adjustment |
| Existing rows and carried-forward months start with adjustment `0`. | `[derived]` avoids changing current totals and prevents corrections leaking into a new month |
| PATCH keeps `spent` as the manual field and accepts `spentAdjustment` separately. | `[derived]` preserves the existing API and WhatsApp `set_spent` contract |
| Raw bank transactions are not deleted, reclassified, or mutated by budget editing. | `[derived]` user requested correction in `/budget`; audit/reclassification remains available in `/banco` |
| The breakdown shows manual, bank, and adjustment amounts when bank data or an adjustment exists. | `[derived]` makes a corrected total explainable |
| A database migration adds `spent_adjustment REAL NOT NULL DEFAULT 0` to existing `budget_categories`. | `[derived]` production uses a persistent SQLite volume and must upgrade without reseeding or data loss |

## Design

### Data layer

`budget_categories.spent_adjustment` stores the signed correction in euros.
`BudgetCategory.spentAdjustment` exposes the rounded value. New tables create
the column with a zero default; existing tables receive it through an
idempotent `ALTER TABLE` check in `initBudgetSchema`. Category carry-forward
and backfill explicitly write zero.

`updateCategory` validates `spentAdjustment` as a finite number but does not
apply the non-negative check used by manual `spent`. The UI computes the
adjustment as:

```text
desiredTotal - manualSpent - bankSpent
```

### API

`PATCH /api/budget/categories/:id` accepts the existing fields plus optional
`spentAdjustment`. Omitting it preserves the current adjustment, so existing
manual callers remain compatible. The response includes the persisted rounded
adjustment through the normal `BudgetCategory` shape.

### UI

`CategoryRow` calculates the displayed total with the adjustment and passes
that total to `InlineMoneyEdit.value`. Saving `Gasto` sends only the computed
`spentAdjustment`; manual `spent` is left unchanged. For the September Shop
example, entering `0` sends `spentAdjustment: -123.96` and the next render
shows `€0.00` while retaining `banco €123.96` in the breakdown.

The group header uses the same total formula as each row. Planned, income, and
month-save editors keep their existing behavior.

## Error and edge behavior

- Non-finite or negative desired totals are rejected client-side as today.
- A negative adjustment is valid because it represents a correction against a
  computed bank amount.
- A later bank-sync change is reflected through the same formula; the stored
  adjustment remains explicit until the user edits the total again.
- A failed PATCH leaves the editor open and surfaces the existing page-level
  error banner.

## Verification

- Store tests cover schema migration/defaults, round-tripping a signed
  adjustment, and zero adjustment in a carried-forward month.
- Pure money tests cover manual + bank + adjustment and the September-style
  zeroing calculation.
- Typecheck/lint and the relevant Vitest tests must pass.
- An independent reviewer checks that the migration is additive, the raw bank
  rows remain untouched, and the old `spent` API contract is preserved.
