// Server-side store for the couple's budget model. Reuses the shared
// node:sqlite connection from `./db` (same file-backed DB, /data volume) and
// leaves the truelayer_* / manual_transactions ledger tables untouched.
//
// Row convention: node:sqlite's .all()/.get() return plain objects keyed by
// column name (NOT positional arrays), so every read below indexes by name —
// same as read-store.ts. `"group"` is a SQL keyword, so it is always quoted
// in DDL/queries and aliased to `grp` on read.
//
// See docs/2026-08-15-budget-model-redesign-design.md.

import crypto from 'node:crypto';
import { getDb } from './db';
import type {
  BudgetGroup,
  IncomeKind,
  BudgetCategory,
  BudgetIncome,
  BudgetMonth,
  BudgetMonthRollups,
  BudgetMonthSummary,
  BudgetSettings,
} from '@/types/budget';

// ----- settings defaults + storage keys -----

const DEFAULT_SETTINGS: BudgetSettings = {
  savingsOpeningBalance: 4072.79,
  personALabel: 'Rafael',
  personBLabel: 'Rafaela',
  currency: 'EUR',
};

const SETTINGS_KEYS = {
  savingsOpeningBalance: 'savings_opening_balance',
  personALabel: 'person_a_label',
  personBLabel: 'person_b_label',
  currency: 'currency',
} as const;

// ----- money + validation helpers -----

// Round to cents. Half away from zero, with an epsilon nudge to defeat binary
// float artefacts (0.1 + 0.2 …) — this is the couple's real money, so the
// output must be exact to the cent. Applied on every value on the way OUT.
function round2(n: number): number {
  return (Math.sign(n) * Math.round(Math.abs(n) * 100 + Number.EPSILON)) / 100;
}

function assertFinite(n: number, field: string): void {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`budget: ${field} must be a finite number`);
  }
}

function assertFiniteNonNegative(n: number, field: string): void {
  assertFinite(n, field);
  if (n < 0) throw new Error(`budget: ${field} must be >= 0`);
}

function assertGroup(g: string): asserts g is BudgetGroup {
  if (g !== 'fixed' && g !== 'variable' && g !== 'extra') {
    throw new Error(`budget: invalid group "${g}"`);
  }
}

function assertKind(k: string): asserts k is IncomeKind {
  if (k !== 'salary' && k !== 'extra') {
    throw new Error(`budget: invalid income kind "${k}"`);
  }
}

function assertNonEmpty(s: string, field: string): void {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error(`budget: ${field} must be a non-empty string`);
  }
}

function assertMaxLength(s: string, field: string, max: number): void {
  if (typeof s === 'string' && s.length > max) {
    throw new Error(`budget: ${field} too long (max ${max} chars)`);
  }
}

// ----- schema -----

let _schemaReady = false;

export function initBudgetSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS budget_months (
      id         TEXT PRIMARY KEY,
      year       INTEGER NOT NULL,
      month      INTEGER NOT NULL,
      save       REAL NOT NULL DEFAULT 0,
      note       TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(year, month)
    );

    CREATE TABLE IF NOT EXISTS budget_categories (
      id         TEXT PRIMARY KEY,
      month_id   TEXT NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
      "group"    TEXT NOT NULL CHECK ("group" IN ('fixed','variable','extra')),
      name       TEXT NOT NULL,
      planned    REAL NOT NULL DEFAULT 0,
      spent      REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_budget_categories_month ON budget_categories(month_id);

    CREATE TABLE IF NOT EXISTS budget_incomes (
      id         TEXT PRIMARY KEY,
      month_id   TEXT NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
      label      TEXT NOT NULL,
      amount     REAL NOT NULL DEFAULT 0,
      kind       TEXT NOT NULL CHECK (kind IN ('salary','extra')),
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_budget_incomes_month ON budget_incomes(month_id);

    CREATE TABLE IF NOT EXISTS budget_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  _schemaReady = true;
}

function ready(): ReturnType<typeof getDb> {
  const db = getDb();
  if (!_schemaReady) initBudgetSchema();
  return db;
}

// ----- row shapes (as returned by node:sqlite, keyed by column name) -----

interface MonthRow {
  id: string;
  year: number;
  month: number;
  save: number;
  note: string | null;
  created_at: string;
}
interface CategoryRow {
  id: string;
  month_id: string;
  grp: string;
  name: string;
  planned: number;
  spent: number;
  sort_order: number;
}
interface IncomeRow {
  id: string;
  month_id: string;
  label: string;
  amount: number;
  kind: string;
  sort_order: number;
}

const CATEGORY_SELECT =
  'SELECT id, month_id, "group" AS grp, name, planned, spent, sort_order FROM budget_categories';
const INCOME_SELECT =
  'SELECT id, month_id, label, amount, kind, sort_order FROM budget_incomes';
const MONTH_SELECT =
  'SELECT id, year, month, save, note, created_at FROM budget_months';

function mapCategory(r: CategoryRow): BudgetCategory {
  return {
    id: r.id,
    monthId: r.month_id,
    group: r.grp as BudgetGroup,
    name: r.name,
    planned: round2(r.planned),
    spent: round2(r.spent),
    sortOrder: r.sort_order,
  };
}

function mapIncome(r: IncomeRow): BudgetIncome {
  return {
    id: r.id,
    monthId: r.month_id,
    label: r.label,
    amount: round2(r.amount),
    kind: r.kind as IncomeKind,
    sortOrder: r.sort_order,
  };
}

// ----- PURE money math (no DB) — this is what the unit tests hit -----

export function computeRollups(input: {
  categories: Pick<BudgetCategory, 'planned' | 'spent'>[];
  incomes: Pick<BudgetIncome, 'amount' | 'kind'>[];
  save: number;
  savingsOpeningBalance: number;
  cumulativeSaveThroughThisMonth: number;
}): BudgetMonthRollups {
  const totalPlanned = input.categories.reduce((s, c) => s + c.planned, 0);
  const totalSpent = input.categories.reduce((s, c) => s + c.spent, 0);
  const salaryTotal = input.incomes
    .filter((i) => i.kind === 'salary')
    .reduce((s, i) => s + i.amount, 0);
  const extraIncomeTotal = input.incomes
    .filter((i) => i.kind === 'extra')
    .reduce((s, i) => s + i.amount, 0);

  // Only the two salaries feed Net Worth — extra income is tracked but
  // excluded from the base (matches the sheet).
  const netWorth = salaryTotal - totalPlanned;
  const us = netWorth - input.save;
  // Split us 50/50: round el to the nearest cent, then derive ela as the
  // remainder of round2(us) so el + ela === round2(us) always, even when us
  // has an odd cent (round2(half) + round2(half) can be off by 0.01).
  const half = us / 2;
  const el = round2(half);
  const ela = round2(us) - el;
  const totalSaving =
    input.savingsOpeningBalance + input.cumulativeSaveThroughThisMonth;

  return {
    totalPlanned: round2(totalPlanned),
    totalSpent: round2(totalSpent),
    salaryTotal: round2(salaryTotal),
    extraIncomeTotal: round2(extraIncomeTotal),
    netWorth: round2(netWorth),
    save: round2(input.save),
    us: round2(us),
    el,
    ela,
    totalSaving: round2(totalSaving),
  };
}

function hydrateMonth(db: ReturnType<typeof getDb>, m: MonthRow): BudgetMonth {
  const catRows = db
    .prepare(`${CATEGORY_SELECT} WHERE month_id = ? ORDER BY "group" ASC, sort_order ASC`)
    .all(m.id) as unknown as CategoryRow[];
  const incRows = db
    .prepare(`${INCOME_SELECT} WHERE month_id = ? ORDER BY sort_order ASC`)
    .all(m.id) as unknown as IncomeRow[];
  const categories = catRows.map(mapCategory);
  const incomes = incRows.map(mapIncome);

  // Cumulative save over every month up to & including this one, ordered by
  // (year, month) — the running "Total Saving" base.
  const cum = db
    .prepare(
      'SELECT COALESCE(SUM(save), 0) AS s FROM budget_months WHERE (year < ?) OR (year = ? AND month <= ?)',
    )
    .get(m.year, m.year, m.month) as { s: number };

  const settings = getSettings();
  const rollups = computeRollups({
    categories,
    incomes,
    save: m.save,
    savingsOpeningBalance: settings.savingsOpeningBalance,
    cumulativeSaveThroughThisMonth: cum.s,
  });

  return {
    id: m.id,
    year: m.year,
    month: m.month,
    save: round2(m.save),
    note: m.note ?? undefined,
    categories,
    incomes,
    rollups,
  };
}

// ----- months -----

export function listMonths(): BudgetMonthSummary[] {
  const db = ready();
  const rows = db
    .prepare('SELECT id, year, month FROM budget_months ORDER BY year ASC, month ASC')
    .all() as unknown as BudgetMonthSummary[];
  return rows.map((r) => ({ id: r.id, year: r.year, month: r.month }));
}

export function getMonth(id: string): BudgetMonth | null {
  const db = ready();
  const m = db.prepare(`${MONTH_SELECT} WHERE id = ?`).get(id) as MonthRow | undefined;
  if (!m) return null;
  return hydrateMonth(db, m);
}

export function getCurrentMonth(): BudgetMonth | null {
  const db = ready();
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  // Exact match for current real-world calendar month
  const current = db
    .prepare(`${MONTH_SELECT} WHERE year = ? AND month = ?`)
    .get(curYear, curMonth) as MonthRow | undefined;
  if (current) return hydrateMonth(db, current);

  // Fallback: latest month <= current calendar date
  const latestPast = db
    .prepare(`${MONTH_SELECT} WHERE year < ? OR (year = ? AND month <= ?) ORDER BY year DESC, month DESC LIMIT 1`)
    .get(curYear, curYear, curMonth) as MonthRow | undefined;
  if (latestPast) return hydrateMonth(db, latestPast);

  // Fallback: overall latest month
  const latest = db
    .prepare(`${MONTH_SELECT} ORDER BY year DESC, month DESC LIMIT 1`)
    .get() as MonthRow | undefined;
  if (!latest) return null;
  return hydrateMonth(db, latest);
}

// A single month by (year, month), fully hydrated — the schema's
// UNIQUE(year, month) makes this a direct indexed lookup, not a scan.
// Used by the wave-2b bank-categorization fix: category ids are per-month
// UUIDs, so validating a bank transaction's categoryId requires the exact
// budget month that transaction was booked in, not just "the latest" or "any"
// month. See docs/2026-08-15-agent-and-bank-automation-design.md.
export function getMonthByYM(year: number, month: number): BudgetMonth | null {
  const db = ready();
  const m = db.prepare(`${MONTH_SELECT} WHERE year = ? AND month = ?`).get(year, month) as
    | MonthRow
    | undefined;
  if (!m) return null;
  return hydrateMonth(db, m);
}

const MAX_MONTHS = 600;

// Copy a template month's categories + incomes into an already-inserted target
// month: same names/groups/planned amounts and income labels/amounts/kinds, but
// FRESH per-month UUIDs (category ids are per-month — see the file header) and
// spent reset to 0. The caller owns the surrounding BEGIN/COMMIT.
function copyTemplateContents(
  db: ReturnType<typeof getDb>,
  templateMonthId: string,
  targetMonthId: string,
): void {
  const cats = db
    .prepare(`${CATEGORY_SELECT} WHERE month_id = ? ORDER BY "group" ASC, sort_order ASC`)
    .all(templateMonthId) as unknown as CategoryRow[];
  const catStmt = db.prepare(
    'INSERT INTO budget_categories (id, month_id, "group", name, planned, spent, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)',
  );
  for (const c of cats) {
    catStmt.run(crypto.randomUUID(), targetMonthId, c.grp, c.name, c.planned, c.sort_order);
  }

  const incs = db
    .prepare(`${INCOME_SELECT} WHERE month_id = ? ORDER BY sort_order ASC`)
    .all(templateMonthId) as unknown as IncomeRow[];
  const incStmt = db.prepare(
    'INSERT INTO budget_incomes (id, month_id, label, amount, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const i of incs) {
    incStmt.run(crypto.randomUUID(), targetMonthId, i.label, i.amount, i.kind, i.sort_order);
  }
}

// Create a specific (year, month) budget month, seeding its categories + incomes
// from an existing template month (fresh per-month UUIDs, spent reset to 0).
// `save` defaults to the TEMPLATE's save; pass { save: 0 } to start the month at
// zero (the carry-forward path does). Throws if (year, month) already exists or
// the MAX_MONTHS cap is reached — callers that backfill a range (the one-off
// backfill script) catch the "already exists" throw to stay idempotent.
//
// Unlike createNextMonth this can create a month BEFORE the earliest one, which
// is what the month backfill needs (POST /api/budget/months only goes forward).
export function createMonthFromTemplate(
  templateMonthId: string,
  year: number,
  month: number,
  opts: { save?: number } = {},
): BudgetMonth {
  const db = ready();
  const template = db.prepare(`${MONTH_SELECT} WHERE id = ?`).get(templateMonthId) as
    | MonthRow
    | undefined;
  if (!template) throw new Error(`budget: template month ${templateMonthId} not found`);

  const count = db.prepare('SELECT COUNT(*) AS n FROM budget_months').get() as { n: number };
  if (count.n >= MAX_MONTHS) throw new Error('budget: month limit reached');

  const clash = db
    .prepare('SELECT id FROM budget_months WHERE year = ? AND month = ?')
    .get(year, month);
  if (clash) {
    throw new Error(
      `budget: month ${year}-${String(month).padStart(2, '0')} already exists`,
    );
  }

  const save = round2(opts.save ?? template.save);
  const newId = crypto.randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO budget_months (id, year, month, save, note, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
    ).run(newId, year, month, save, new Date().toISOString());
    copyTemplateContents(db, templateMonthId, newId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const m = db.prepare(`${MONTH_SELECT} WHERE id = ?`).get(newId) as MonthRow;
  return hydrateMonth(db, m);
}

export function createNextMonth(): BudgetMonth {
  const db = ready();
  const latest = db
    .prepare(`${MONTH_SELECT} ORDER BY year DESC, month DESC LIMIT 1`)
    .get() as MonthRow | undefined;
  if (!latest) throw new Error('budget: no month to carry forward from');

  let year = latest.year;
  let month = latest.month + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }

  // Carry-forward starts the new month at save = 0 (the running "Total Saving"
  // is cumulative — a fresh month hasn't saved yet).
  return createMonthFromTemplate(latest.id, year, month, { save: 0 });
}

export function updateMonth(
  id: string,
  patch: { save?: number; note?: string | null },
): BudgetMonth {
  const db = ready();
  const existing = db.prepare(`${MONTH_SELECT} WHERE id = ?`).get(id) as
    | MonthRow
    | undefined;
  if (!existing) throw new Error(`budget: month ${id} not found`);

  let save = existing.save;
  if (patch.save !== undefined) {
    assertFiniteNonNegative(patch.save, 'save');
    save = round2(patch.save);
  }
  let note = existing.note;
  if (patch.note !== undefined) {
    if (patch.note !== null) assertMaxLength(patch.note, 'note', 2000);
    note = patch.note;
  }

  db.prepare('UPDATE budget_months SET save = ?, note = ? WHERE id = ?').run(save, note, id);
  const m = db.prepare(`${MONTH_SELECT} WHERE id = ?`).get(id) as MonthRow;
  return hydrateMonth(db, m);
}

// ----- categories -----

export function addCategory(
  monthId: string,
  input: { group: BudgetGroup; name: string; planned: number; spent?: number },
): BudgetCategory {
  const db = ready();
  assertGroup(input.group);
  assertNonEmpty(input.name, 'name');
  assertMaxLength(input.name, 'name', 200);
  assertFiniteNonNegative(input.planned, 'planned');
  const spent = input.spent ?? 0;
  assertFiniteNonNegative(spent, 'spent');

  const monthExists = db.prepare('SELECT id FROM budget_months WHERE id = ?').get(monthId);
  if (!monthExists) throw new Error(`budget: month ${monthId} not found`);

  const next = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM budget_categories WHERE month_id = ? AND "group" = ?',
    )
    .get(monthId, input.group) as { n: number };

  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO budget_categories (id, month_id, "group", name, planned, spent, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, monthId, input.group, input.name, input.planned, spent, next.n);

  const r = db.prepare(`${CATEGORY_SELECT} WHERE id = ?`).get(id) as CategoryRow;
  return mapCategory(r);
}

export function updateCategory(
  id: string,
  patch: { name?: string; group?: BudgetGroup; planned?: number; spent?: number },
): BudgetCategory {
  const db = ready();
  const existing = db.prepare(`${CATEGORY_SELECT} WHERE id = ?`).get(id) as
    | CategoryRow
    | undefined;
  if (!existing) throw new Error(`budget: category ${id} not found`);

  let name = existing.name;
  if (patch.name !== undefined) {
    assertNonEmpty(patch.name, 'name');
    assertMaxLength(patch.name, 'name', 200);
    name = patch.name;
  }
  let group = existing.grp;
  if (patch.group !== undefined) {
    assertGroup(patch.group);
    group = patch.group;
  }
  let planned = existing.planned;
  if (patch.planned !== undefined) {
    assertFiniteNonNegative(patch.planned, 'planned');
    planned = patch.planned;
  }
  let spent = existing.spent;
  if (patch.spent !== undefined) {
    assertFiniteNonNegative(patch.spent, 'spent');
    spent = patch.spent;
  }

  db.prepare(
    'UPDATE budget_categories SET name = ?, "group" = ?, planned = ?, spent = ? WHERE id = ?',
  ).run(name, group, planned, spent, id);

  const r = db.prepare(`${CATEGORY_SELECT} WHERE id = ?`).get(id) as CategoryRow;
  return mapCategory(r);
}

export function deleteCategory(id: string): void {
  const db = ready();
  db.prepare('DELETE FROM budget_categories WHERE id = ?').run(id);
}

// ----- incomes -----

export function addIncome(
  monthId: string,
  input: { label: string; amount: number; kind: IncomeKind },
): BudgetIncome {
  const db = ready();
  assertNonEmpty(input.label, 'label');
  assertMaxLength(input.label, 'label', 200);
  assertFiniteNonNegative(input.amount, 'amount');
  assertKind(input.kind);

  const monthExists = db.prepare('SELECT id FROM budget_months WHERE id = ?').get(monthId);
  if (!monthExists) throw new Error(`budget: month ${monthId} not found`);

  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM budget_incomes WHERE month_id = ?')
    .get(monthId) as { n: number };

  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO budget_incomes (id, month_id, label, amount, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, monthId, input.label, input.amount, input.kind, next.n);

  const r = db.prepare(`${INCOME_SELECT} WHERE id = ?`).get(id) as IncomeRow;
  return mapIncome(r);
}

export function updateIncome(
  id: string,
  patch: { label?: string; amount?: number; kind?: IncomeKind },
): BudgetIncome {
  const db = ready();
  const existing = db.prepare(`${INCOME_SELECT} WHERE id = ?`).get(id) as
    | IncomeRow
    | undefined;
  if (!existing) throw new Error(`budget: income ${id} not found`);

  let label = existing.label;
  if (patch.label !== undefined) {
    assertNonEmpty(patch.label, 'label');
    assertMaxLength(patch.label, 'label', 200);
    label = patch.label;
  }
  let amount = existing.amount;
  if (patch.amount !== undefined) {
    assertFiniteNonNegative(patch.amount, 'amount');
    amount = patch.amount;
  }
  let kind = existing.kind;
  if (patch.kind !== undefined) {
    assertKind(patch.kind);
    kind = patch.kind;
  }

  db.prepare('UPDATE budget_incomes SET label = ?, amount = ?, kind = ? WHERE id = ?').run(
    label,
    amount,
    kind,
    id,
  );

  const r = db.prepare(`${INCOME_SELECT} WHERE id = ?`).get(id) as IncomeRow;
  return mapIncome(r);
}

export function deleteIncome(id: string): void {
  const db = ready();
  db.prepare('DELETE FROM budget_incomes WHERE id = ?').run(id);
}

// ----- settings -----

export function getSettings(): BudgetSettings {
  const db = ready();
  const rows = db.prepare('SELECT key, value FROM budget_settings').all() as unknown as Array<{
    key: string;
    value: string;
  }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const rawOpening = map.get(SETTINGS_KEYS.savingsOpeningBalance);
  const opening = rawOpening !== undefined ? Number(rawOpening) : DEFAULT_SETTINGS.savingsOpeningBalance;

  return {
    savingsOpeningBalance: round2(
      Number.isFinite(opening) ? opening : DEFAULT_SETTINGS.savingsOpeningBalance,
    ),
    personALabel: map.get(SETTINGS_KEYS.personALabel) ?? DEFAULT_SETTINGS.personALabel,
    personBLabel: map.get(SETTINGS_KEYS.personBLabel) ?? DEFAULT_SETTINGS.personBLabel,
    currency: map.get(SETTINGS_KEYS.currency) ?? DEFAULT_SETTINGS.currency,
  };
}

export function updateSettings(patch: Partial<BudgetSettings>): BudgetSettings {
  const db = ready();
  const upsert = db.prepare(
    'INSERT INTO budget_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );

  if (patch.savingsOpeningBalance !== undefined) {
    assertFiniteNonNegative(patch.savingsOpeningBalance, 'savingsOpeningBalance');
    upsert.run(SETTINGS_KEYS.savingsOpeningBalance, String(patch.savingsOpeningBalance));
  }
  if (patch.personALabel !== undefined) {
    assertNonEmpty(patch.personALabel, 'personALabel');
    upsert.run(SETTINGS_KEYS.personALabel, patch.personALabel);
  }
  if (patch.personBLabel !== undefined) {
    assertNonEmpty(patch.personBLabel, 'personBLabel');
    upsert.run(SETTINGS_KEYS.personBLabel, patch.personBLabel);
  }
  if (patch.currency !== undefined) {
    assertNonEmpty(patch.currency, 'currency');
    upsert.run(SETTINGS_KEYS.currency, patch.currency);
  }

  return getSettings();
}

// ----- seed (idempotent) -----

// Aug/2026 template from the sheet's latest month (planned €, spent = 0).
// sort_order = insertion order within each group.
const SEED_FIXED: Array<[string, number]> = [
  ['Insurance', 150.0],
  ['Phone', 70.75],
  ['Shop', 650.0],
  ['Eletricity', 100.0],
  ['Youtube', 25.99],
  ['Loan', 109.26],
  ['Apple', 9.99],
  ['Amazon', 6.99],
  ['Spotify', 18.99],
  ['Wifi', 22.99],
  ['Leap Card', 30.0],
  ['Botfy', 200.0],
  ['Netflix', 17.0],
  ['Lashes', 85.0],
  ['Hair Cut', 20.0],
  ['Nail', 80.0],
  ['Pills', 16.0],
  ['Fuel', 150.0],
  ['Gym', 138.0],
  ['Cleaner', 50.0],
  ['Rental', 1397.0],
];
const SEED_VARIABLE: Array<[string, number]> = [
  ['Pay Later', 253.65],
  ['Credit Card', 366.67],
  ['Car Wash', 0.0],
  ['MacBook', 92.23],
];
const SEED_EXTRA: Array<[string, number]> = [['BCN', 14.2]];
const SEED_INCOMES: Array<[string, number, IncomeKind]> = [
  ['Rafael', 2942.31, 'salary'],
  ['Rafaela', 2855.83, 'salary'],
];

export function seedBudgetIfEmpty(): void {
  const db = ready();
  const count = db.prepare('SELECT COUNT(*) AS n FROM budget_months').get() as { n: number };
  if (count.n > 0) return; // already seeded — idempotent

  db.exec('BEGIN');
  try {
    updateSettings({
      savingsOpeningBalance: 4072.79,
      personALabel: 'Rafael',
      personBLabel: 'Rafaela',
      currency: 'EUR',
    });

    const monthId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO budget_months (id, year, month, save, note, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
    ).run(monthId, 2026, 8, 700.0, new Date().toISOString());

    const catStmt = db.prepare(
      'INSERT INTO budget_categories (id, month_id, "group", name, planned, spent, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)',
    );
    const seedGroup = (list: Array<[string, number]>, group: BudgetGroup): void => {
      list.forEach(([name, planned], i) => {
        catStmt.run(crypto.randomUUID(), monthId, group, name, planned, i);
      });
    };
    seedGroup(SEED_FIXED, 'fixed');
    seedGroup(SEED_VARIABLE, 'variable');
    seedGroup(SEED_EXTRA, 'extra');

    const incStmt = db.prepare(
      'INSERT INTO budget_incomes (id, month_id, label, amount, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    );
    SEED_INCOMES.forEach(([label, amount, kind], i) => {
      incStmt.run(crypto.randomUUID(), monthId, label, amount, kind, i);
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
