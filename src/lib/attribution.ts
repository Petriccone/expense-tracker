// The intelligence layer for the couple's bank data — the accuracy core of
// their budget. The couple budget by MOVING labeled money out of their JOINT
// Revolut account: the LABELED transfer ("Shop €650", "Gym €138", ...) IS the
// expense, and everything is measured on the JOINT account alone.
//
// Model (confirmed 2026-08-16 — supersedes the internal-transfer de-dup model):
// per (category, budget_month) the bank spend is the NET SIGNED FLOW in the
// JOINT account only.
//
//   - Source of truth: the JOINT account uid(s) (bank_settings
//     `joint_account_uids`). Personal-account rows are the other side of a joint
//     move / personal money and are EXCLUDED from category spend entirely.
//   - A JOINT-account row COUNTS toward a category iff it is an INTERNAL labeled
//     transfer (counterparty is the couple, or a self-transfer like "Joint →
//     Personal") AND its label matched a budget category. Its SIGNED
//     contribution is: DBIT (money leaving the joint account) = +spend, CRDT
//     (money coming back — a return/refund) = −spend. Summing per category nets
//     a reversed allocation to zero and captures the real payment automatically,
//     so there is NO de-dup and NO reversal-detection machinery.
//   - EXCLUDED (neither + nor −): external merchant charges (Tesco, NETFLIX.COM,
//     ...) and any external-counterparty credit. An external inbound credit must
//     never subtract from a category — otherwise a stranger sending money
//     labeled like a category could hide real spend.
//
// Two transforms, both pure, behind a thin DB-bound orchestrator
// (runAttribution):
//
//   1. the joint/internal ALLOCATION gate (in runAttribution) — a row counts
//      (counted = 1) iff it is on the JOINT account AND internal AND its label
//      matched a budget category. A DBIT (outflow) always counts; a CRDT (return)
//      counts ONLY when it nets against a positive PRIOR counted-DBIT balance in
//      its category — an unmatched inbound credit must never auto-subtract (that
//      is how a spoofed-name credit would mask real spend), so it goes to review.
//      Joint external rows and joint internal rows that matched no category are
//      UNALLOCATED (counted = 0, unallocated = 1) and go to the review list.
//      Personal-account rows are excluded entirely (counted = 0, unallocated =
//      0). The signed sum itself lives in bankSpentByCategory (bank-store.ts).
//
//   2. attributeMonths — the month-end distribution happens WHEN THE SALARY
//      ARRIVES (end of month M) and it funds month M+1. So a counted row booked
//      on/after that month's salary day is attributed to M+1; one booked before
//      it stays in M (salaryDaysByMonth finds the day). Rows are then placed by
//      (category, base-month) BUCKET: returns net against the bucket's month
//      first, then the positive EXCESS of the bucket's outflows over `planned`
//      rolls to the next planned month. Netting the whole bucket before rolling
//      is what keeps a refund cancelling an outflow in its OWN month instead of
//      an unrelated same-month one after the reversed outflow rolled away.
//      Returns (CRDT) never roll forward.
//
// Design notes worth knowing:
//  - Categories are matched across months by NAME, not id: budget category ids
//    are per-month UUIDs (see budget-store.ts). runAttribution maps id -> name
//    for matching and re-points a moved transaction's category_id to the target
//    month's id.
//  - "Unsure -> review, never guess": no plan for the category in the
//    salary-adjusted target month (or nowhere planned to roll into) leaves
//    budget_month = booking month and records a review note rather than forcing
//    a move.

import {
  listAllBankTransactions,
  applyDedupDecisions,
  applyMonthAttributions,
  getAccountHolderNames,
  getAccountHolderTokens,
  getJointAccountUids,
  isInternalTransfer,
  listBankCategoryRules,
  matchBankCategoryRule,
  type BankCategoryRuleLike,
} from './bank-store';
import { listMonths, getMonth } from './budget-store';

// ----- shared helpers -----

// A cent, as a tolerance — the couple's real money is exact to the cent, so a
// month is "met" once cumulative spend is within a cent of planned.
const TOLERANCE = 0.01;
// Safety bound on the plan-aware roll-forward recursion.
const MAX_LOOKAHEAD = 24;
// When a month has NO detectable salary income, an allocation booked in its last
// N days is treated as the month-end distribution (funds next month). Only used
// as a fallback — a detected salary day is authoritative.
const FALLBACK_LAST_DAYS = 5;
// A CRDT below this magnitude is never treated as a salary candidate. Real
// salaries here are thousands of euros; the floor stops a tiny injected or
// mislabeled "salary" credit from shifting the detected payday, which would
// mis-attribute a whole month of allocations (review sec-1).
const MIN_SALARY_AMOUNT = 500;
// A detected salary day earlier than this is suspicious — the attribution model
// assumes an end-of-month payday that funds the NEXT month, so a mid-month
// "salary" is worth surfacing rather than trusting silently (review corr-3).
const EARLY_SALARY_DAY = 20;

const PT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function ymAbbr(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return PT_MONTHS[m - 1] ?? ym;
}

// 'YYYY-MM' + n whole months.
function addMonths(ym: string, n: number): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7)); // 1-12
  const idx = year * 12 + (month - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

// Case/accent-insensitive lowercasing — for the salary-income probe below.
function normalizeBasic(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Case/accent-insensitive EXACT equality of two category names (a rule's
// category_name vs the row's actual category name). No fuzzy — a rule must
// name the category it means, and a near-miss stays out of the gate.
function sameCategoryName(a: string, b: string): boolean {
  const fold = (s: string): string => normalizeBasic(s).replace(/\s+/g, ' ').trim();
  const fa = fold(a);
  return fa.length > 0 && fa === fold(b);
}

// Pure predicate for the allocation gate (below): does this row's counterparty
// match an explicit counterparty→category rule whose category_name IS the
// row's category? Such an external charge counts as spend in its own right —
// the couple explicitly declared this counterparty's charges to be that
// category's expense (e.g. "Clúid Housing Association" → Rental), so it needs
// no internal labeled transfer to front it.
function ruleMatchesCategory(
  counterparty: string | null,
  catName: string,
  holderTokens: readonly string[],
  rules: readonly BankCategoryRuleLike[],
): boolean {
  if (rules.length === 0 || !counterparty) return false;
  const rule = matchBankCategoryRule(counterparty, { holderTokens, rules });
  return rule != null && sameCategoryName(rule.category_name, catName);
}

// ----- salary-day detection (pure) -----

export interface SalaryProbeTx {
  credit_debit: string | null;
  booking_date: string | null;
  description: string;
  amount: number;
}

// For each month, the salary day = the LATEST booking_date carrying an income
// (CRDT) whose normalized label contains "salary" AND whose magnitude clears
// MIN_SALARY_AMOUNT (the floor keeps a tiny injected "salary" credit from
// moving the payday — review sec-1). That day is when the month-end
// distribution happens, and it funds the NEXT month (see attributeMonths).
// Returns 'YYYY-MM' -> 'YYYY-MM-DD'. Months with no detectable salary income
// are simply absent (attribution then uses the last-N-days fallback).
export function salaryDaysByMonth(txs: SalaryProbeTx[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of txs) {
    if (t.credit_debit !== 'CRDT' || !t.booking_date) continue;
    if (Math.abs(t.amount) < MIN_SALARY_AMOUNT) continue;
    if (!normalizeBasic(t.description).includes('salary')) continue;
    const month = t.booking_date.slice(0, 7);
    const current = out[month];
    if (!current || t.booking_date > current) out[month] = t.booking_date;
  }
  // An unusually early payday breaks the end-of-month assumption the whole
  // attribution rule rests on — warn so it's observable (review corr-3).
  for (const [month, day] of Object.entries(out)) {
    if (Number(day.slice(8, 10)) < EARLY_SALARY_DAY) {
      console.warn('[attribution] detected salary day is unusually early — the month-end payday assumption may not hold', {
        month,
        salary_day: day,
      });
    }
  }
  return out;
}

// Whole days in a 'YYYY-MM' month.
function daysInMonth(ym: string): number {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7)); // 1-12
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The month a counted row's spend is attributed to under the salary-day rule:
//  - salary day known for the booking month: booked on/after it -> next month
//    (payday distribution funds next month); before it -> the booking month.
//  - no salary day: booked in the last FALLBACK_LAST_DAYS of the month -> next
//    month; otherwise the booking month.
function salaryBudgetMonth(
  bookingMonth: string,
  bookingDate: string,
  salaryDayByMonth: Record<string, string>,
): string {
  const salaryDay = salaryDayByMonth[bookingMonth];
  if (salaryDay) {
    return bookingDate >= salaryDay ? addMonths(bookingMonth, 1) : bookingMonth;
  }
  const day = Number(bookingDate.slice(8, 10));
  if (day >= daysInMonth(bookingMonth) - FALLBACK_LAST_DAYS + 1) return addMonths(bookingMonth, 1);
  return bookingMonth;
}

// ----- plan-aware month attribution (pure) -----

export interface AttributionTxInput {
  id: string;
  category: string; // stable across months — the category NAME
  // SIGNED spend contribution: DBIT (outflow) = +amount, CRDT (return) =
  // −amount. The month placement and the plan-aware roll-forward both read the
  // sign (returns never roll forward).
  amount: number;
  bookingDate: string; // 'YYYY-MM-DD'
}

// category name -> ('YYYY-MM' -> planned amount for that category that month).
export type PlannedByCategoryMonth = Record<string, Record<string, number>>;

export interface AttributionResult {
  id: string;
  budgetMonth: string; // 'YYYY-MM'
  moveReason: string | null;
  review: boolean; // true = left in the booking month but flagged (no/zero plan)
}

export interface AttributeOpts {
  tolerance?: number;
  maxLookahead?: number;
  // 'YYYY-MM' -> 'YYYY-MM-DD' salary day (from salaryDaysByMonth). A row booked
  // on/after its month's salary day is attributed to the next month.
  salaryDayByMonth?: Record<string, string>;
}

function reviewNote(category: string, ym: string): string {
  return `Sem planejado para ${category} em ${ymAbbr(ym)} — revisar`;
}

function salaryMoveReason(from: string, to: string): string {
  return `Distribuição do salário de ${ymAbbr(from)} → ${ymAbbr(to)}`;
}

// For each category, place rows by (category, base-month) BUCKET, not by a
// per-transaction stream. Each row first gets a salary-day base month (booked
// on/after its month's salary day -> next month, the payday distribution; else
// its own month); rows with no positive plan in their base month stay in the
// BOOKING month, flagged for review. Then, per base-month bucket:
//   - RETURNS (amount <= 0) are applied to the bucket's month FIRST and never
//     roll forward — a refund belongs to the month it reverses. Netting the
//     whole bucket before deciding what rolls is what fixes cross-month phantom
//     netting (HIGH-1): a refund cancels an outflow in its OWN base month, so it
//     can't zero out an unrelated same-month outflow while the reversed one has
//     rolled into a later month.
//   - OUTFLOWS then land, in booking order, in the first month (base forward)
//     whose cumulative net is still below planned — i.e. only the positive
//     EXCESS over planned rolls to the next PLANNED month (recursing while that
//     one is also met). Because returns were already netted in, less (often
//     nothing) rolls.
// If there's no planned month to roll into, the outflow stays in its BOOKING
// month and is flagged for review — never guessed.
export function attributeMonths(
  txs: AttributionTxInput[],
  planned: PlannedByCategoryMonth,
  opts: AttributeOpts = {},
): AttributionResult[] {
  const tol = opts.tolerance ?? TOLERANCE;
  const maxLook = opts.maxLookahead ?? MAX_LOOKAHEAD;
  const salaryDayByMonth = opts.salaryDayByMonth ?? {};

  const byCategory = new Map<string, AttributionTxInput[]>();
  for (const t of txs) {
    const bucket = byCategory.get(t.category);
    if (bucket) bucket.push(t);
    else byCategory.set(t.category, [t]);
  }

  const results: AttributionResult[] = [];

  // A row that survives the plan gate, tagged with its salary-adjusted base
  // month and whether the salary rule moved it (for the reason chain).
  interface PlacedRow {
    t: AttributionTxInput;
    bookingMonth: string;
    salaryMoved: boolean;
  }

  for (const [category, list] of byCategory) {
    const plans = planned[category] ?? {};
    // cumulative attributed NET per target month, within this category.
    const cumulative = new Map<string, number>();

    const sorted = [...list].sort((a, b) =>
      a.bookingDate < b.bookingDate
        ? -1
        : a.bookingDate > b.bookingDate
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
    );

    // Bucket the surviving rows by salary-adjusted base month, splitting returns
    // from outflows. Booking order is preserved within each list by the sort.
    const buckets = new Map<string, { returns: PlacedRow[]; outflows: PlacedRow[] }>();
    for (const t of sorted) {
      const bookingMonth = t.bookingDate.slice(0, 7);
      const base = salaryBudgetMonth(bookingMonth, t.bookingDate, salaryDayByMonth);
      const plan = plans[base];
      // No positive plan for this category in the salary-adjusted base month
      // -> leave it in the booking month, flag for review.
      if (plan === undefined || plan <= tol) {
        results.push({ id: t.id, budgetMonth: bookingMonth, moveReason: reviewNote(category, base), review: true });
        continue;
      }
      let bucket = buckets.get(base);
      if (!bucket) {
        bucket = { returns: [], outflows: [] };
        buckets.set(base, bucket);
      }
      const row: PlacedRow = { t, bookingMonth, salaryMoved: base !== bookingMonth };
      if (t.amount <= 0) bucket.returns.push(row);
      else bucket.outflows.push(row);
    }

    // Process base months chronologically so a rolled-forward outflow reaches a
    // later bucket only after that bucket's own base month is established.
    for (const base of [...buckets.keys()].sort()) {
      const { returns, outflows } = buckets.get(base)!;

      // RETURNS first: net against the base month, never roll.
      for (const row of returns) {
        cumulative.set(base, (cumulative.get(base) ?? 0) + row.t.amount);
        results.push({
          id: row.t.id,
          budgetMonth: base,
          moveReason: row.salaryMoved ? salaryMoveReason(row.bookingMonth, base) : null,
          review: false,
        });
      }

      // OUTFLOWS: only the positive excess over planned rolls forward.
      for (const row of outflows) {
        const reasons: string[] = [];
        if (row.salaryMoved) reasons.push(salaryMoveReason(row.bookingMonth, base));

        let target = base;
        let curPlan = plans[base]!; // defined — bucket only holds has-plan rows
        let placed = false;
        for (let guard = 0; guard < maxLook; guard++) {
          const cum = cumulative.get(target) ?? 0;
          if (cum < curPlan - tol) {
            // Room left this month — land here.
            cumulative.set(target, cum + row.t.amount);
            results.push({
              id: row.t.id,
              budgetMonth: target,
              moveReason: reasons.length ? reasons.join('; ') : null,
              review: false,
            });
            placed = true;
            break;
          }
          // Month already met — roll forward, but only into a month that itself
          // has a positive plan for this category (never guess into the void).
          const next = addMonths(target, 1);
          const planNext = plans[next];
          if (planNext === undefined || planNext <= tol) {
            results.push({ id: row.t.id, budgetMonth: row.bookingMonth, moveReason: reviewNote(category, row.bookingMonth), review: true });
            placed = true;
            break;
          }
          reasons.push(`${ymAbbr(target)} já bateu o planejado de ${category} → ${ymAbbr(next)}`);
          target = next;
          curPlan = planNext;
        }

        if (!placed) {
          // Recursion bound hit (pathological) — don't move, flag for review.
          results.push({ id: row.t.id, budgetMonth: row.bookingMonth, moveReason: reviewNote(category, row.bookingMonth), review: true });
        }
      }
    }
  }

  return results;
}

// ----- orchestrator -----

export interface AttributionMove {
  id: string;
  category: string; // category name
  amount: number; // spend magnitude
  fromMonth: string; // 'YYYY-MM' booking month
  toMonth: string; // 'YYYY-MM' attributed month
  reason: string;
}

// Loads all transactions and the planned amount per category per month,
// computes the joint/internal allocation gate + salary-day attribution,
// PERSISTS counted / unallocated / budget_month / move_reason (re-pointing a
// moved transaction's category_id to the target month's id), and returns the
// list of month moves so the caller can notify (WhatsApp wiring lives at the
// call site).
//
// Full authoritative recompute — safe to run after every sync/categorize pass.
export function runAttribution(opts: { jointAccountUids?: string[] } = {}): AttributionMove[] {
  const all = listAllBankTransactions();

  // Each row's budget_month BEFORE this recompute — so `moves` reports a tx
  // only when its attribution actually CHANGES this run, not on every run
  // (review MED5). A row's stored budget_month defaults to its booking month at
  // insert, so an unchanged steady state produces no moves.
  const prevBudgetMonthById = new Map(all.map((t) => [t.id, t.budget_month]));

  const jointUids = opts.jointAccountUids ?? getJointAccountUids();
  const jointSet = new Set(jointUids);
  if (jointSet.size === 0) {
    // The whole model is joint-scoped — with no joint account known we can't
    // attribute joint-only spend, so nothing is counted. Warn rather than
    // silently fall back to counting personal-account rows (which would
    // double-count the other side of every move).
    console.warn(
      '[attribution] no joint_account_uids configured — no category spend will be attributed; set bank_settings.joint_account_uids',
    );
  }
  const holderNames = getAccountHolderNames();
  // Counterparty→category rules + the holder TOKENS (label stripping) for
  // matching them — see bank-store's bank_category_rules.
  const holderTokens = getAccountHolderTokens();
  const ruleRows = listBankCategoryRules();

  // Budget lookups: planned + category id, both keyed by (category name,
  // 'YYYY-MM'); and category id -> name for the tx rows.
  const planned: PlannedByCategoryMonth = {};
  const categoryIdByNameMonth: Record<string, Record<string, string>> = {};
  const nameById: Record<string, string> = {};
  for (const summary of listMonths()) {
    const month = getMonth(summary.id);
    if (!month) continue;
    const ym = `${month.year}-${String(month.month).padStart(2, '0')}`;
    for (const c of month.categories) {
      (planned[c.name] ??= {})[ym] = c.planned;
      (categoryIdByNameMonth[c.name] ??= {})[ym] = c.id;
      nameById[c.id] = c.name;
    }
  }

  // 1. The joint/internal ALLOCATION gate, per row, walked in BOOKING ORDER
  //    (listAllBankTransactions returns booking_date ASC, id ASC) so a return
  //    can be correlated with the prior counted-DBIT balance in its category:
  //    - PERSONAL (non-joint) row              -> counted 0, unallocated 0.
  //    - JOINT + internal + categorized DBIT   -> counted 1 (an outflow; it
  //      grows the category's nettable balance a later return may cancel).
  //    - JOINT + internal + categorized CRDT   -> counted 1 ONLY if it nets
  //      against a positive prior counted-DBIT balance for that category (by
  //      NAME). A CRDT with NO prior matching counted DBIT is NOT auto-
  //      subtracted — that is exactly how a spoofed-name inbound credit could
  //      silently reduce (mask) a category — so it goes to review instead
  //      (security HIGH-A/HIGH-B) -> counted 0, unallocated 1.
  //    - JOINT + rule-matched external + categorized DBIT -> counted 1. A
  //      counterparty→category rule (e.g. "Clúid Housing Association" →
  //      Rental) makes an EXTERNAL charge an expense in its own right when the
  //      row's category IS the rule's category — no internal transfer fronts
  //      it. Its CRDT side is symmetric with the internal case: nets against a
  //      positive prior counted balance in that category, else review.
  //    - JOINT, otherwise (external, or internal but no category) -> counted 0,
  //      unallocated 1 (review list). This keeps an external inbound credit out
  //      of the sum entirely, so it can never hide real spend.
  //    dedup_group is always null now — the de-dup machinery is gone.
  const nettableByCategory = new Map<string, number>();
  const decisions: Array<{ id: string; counted: 0 | 1; dedup_group: null; unallocated: number }> = [];
  for (const t of all) {
    if (!jointSet.has(t.account_uid)) {
      decisions.push({ id: t.id, counted: 0, dedup_group: null, unallocated: 0 });
      continue;
    }
    const internal = isInternalTransfer({ counterparty: t.counterparty, description: t.description }, holderNames);
    // The row's category NAME (join category_id → the budget month's category
    // name) — needed by both the rule gate and the nettable-balance bookkeeping.
    const catName = t.category_id != null ? nameById[t.category_id] : undefined;
    const ruleMatched =
      !internal && catName != null && ruleMatchesCategory(t.counterparty, catName, holderTokens, ruleRows);
    if ((!internal && !ruleMatched) || t.category_id == null || catName == null) {
      decisions.push({ id: t.id, counted: 0, dedup_group: null, unallocated: 1 });
      continue;
    }
    if (t.credit_debit === 'DBIT') {
      // A counted outflow — grows the balance a later same-category return nets.
      if (catName) nettableByCategory.set(catName, (nettableByCategory.get(catName) ?? 0) + Math.abs(t.amount));
      decisions.push({ id: t.id, counted: 1, dedup_group: null, unallocated: 0 });
      continue;
    }
    // A return (CRDT, or any non-DBIT — treated as −amount downstream): counts
    // only when a positive prior counted-DBIT balance exists in this category.
    const prior = catName ? (nettableByCategory.get(catName) ?? 0) : 0;
    if (catName && prior > TOLERANCE) {
      // Cap the subtraction to the prior balance — an over-refund (return
      // magnitude > what's owed) must not drive the in-memory nettable balance
      // negative, which would otherwise carry a phantom "debt" forward and wrongly
      // gate a LATER genuine return in this category out of netting (reviewer
      // nice-to-have). The row itself still counts; bankSpentByCategory's own
      // net-negative clamp + anomaly flag (bank-store.ts) is what surfaces the
      // over-refund for review.
      nettableByCategory.set(catName, prior - Math.min(prior, Math.abs(t.amount)));
      decisions.push({ id: t.id, counted: 1, dedup_group: null, unallocated: 0 });
    } else {
      decisions.push({ id: t.id, counted: 0, dedup_group: null, unallocated: 1 });
    }
  }
  applyDedupDecisions(decisions);
  const countedById = new Map(decisions.map((d) => [d.id, d.counted]));

  // 2. Salary day per month, from the actual salary CREDITS in the bank feed —
  //    the month-end distribution funds the next month (see attributeMonths).
  const salaryDayByMonth = salaryDaysByMonth(all);

  // 3. Attribution input: only counted allocations with a booking date and a
  //    resolvable category name. amount is the SIGNED spend (DBIT +, CRDT −).
  const input: AttributionTxInput[] = [];
  const metaById = new Map<string, { name: string; bookingMonth: string; amount: number }>();
  for (const t of all) {
    if (countedById.get(t.id) !== 1) continue;
    if (!t.category_id || !t.booking_date) continue;
    const name = nameById[t.category_id];
    if (!name) continue; // orphan category id (renamed/deleted) — leave as-is
    const signed = t.credit_debit === 'DBIT' ? Math.abs(t.amount) : -Math.abs(t.amount);
    input.push({ id: t.id, category: name, amount: signed, bookingDate: t.booking_date });
    metaById.set(t.id, { name, bookingMonth: t.booking_date.slice(0, 7), amount: signed });
  }

  const results = attributeMonths(input, planned, { salaryDayByMonth });

  // 4. Persist and collect moves.
  const updates: Array<{ id: string; budget_month: string; move_reason: string | null; categoryId?: string }> = [];
  const moves: AttributionMove[] = [];
  for (const r of results) {
    const meta = metaById.get(r.id);
    if (!meta) continue;
    // Keep category_id aligned to the ATTRIBUTED month's same-named category id
    // (category ids are per-month UUIDs). This runs whether or not the month
    // changed, so a re-run that moves a transaction BACK also resets its id.
    const categoryId = categoryIdByNameMonth[meta.name]?.[r.budgetMonth];
    // Report a move only when the attributed month CHANGED since the last run
    // (review MED5) — a tx already sitting in its attributed month is not a new
    // move, so the WhatsApp notification fires once per real move.
    const prev = prevBudgetMonthById.get(r.id) ?? meta.bookingMonth;
    if (r.budgetMonth !== prev) {
      moves.push({
        id: r.id,
        category: meta.name,
        amount: Math.abs(meta.amount),
        fromMonth: meta.bookingMonth,
        toMonth: r.budgetMonth,
        reason: r.moveReason ?? '',
      });
    }
    updates.push({ id: r.id, budget_month: r.budgetMonth, move_reason: r.moveReason, categoryId });
  }

  applyMonthAttributions(updates);

  return moves;
}
