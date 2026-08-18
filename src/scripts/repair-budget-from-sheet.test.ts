// Tests for scripts/repair-budget-from-sheet.mjs — the one-shot budget repair
// that rebuilds months 2026-05..09 from the canonical Google-Sheet snapshot.
//
// The repo has no direct tests for the earlier one-off scripts
// (backfill-budget-months.mjs is covered indirectly via budget-store's
// createMonthFromTemplate); this script's logic lives in the script itself,
// so these tests drive it the way it actually runs — `node scripts/...mjs`
// against a temp SQLite DB (same PETRICCO_DATA_DIR pattern as
// attribution.test.ts / bank-store.test.ts) — and assert DB state through the
// app's own stores (budget-store, bank-store). Step 7 (the app's
// categorize/attribution recompute) is exercised against a local HTTP stub
// standing in for POST /api/banking/categorize; the DB-path tests use
// --skip-recompute so no app/server is needed.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { getDb } from '../lib/db';
import {
  initBankSchema,
  bankSpentByCategory,
  getTransactionById,
  setJointAccountUids,
} from '../lib/bank-store';
import { initBudgetSchema, getMonthByYM, getSettings } from '../lib/budget-store';

const SCRIPT = fileURLToPath(new URL('../../scripts/repair-budget-from-sheet.mjs', import.meta.url));
const REAL_SHEET = fileURLToPath(new URL('../../scripts/data/budget-sheet-2026-08-18.json', import.meta.url));
const JOINT = 'acc-joint';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-repair-test-'));
const DB_PATH = path.join(tmpDir, 'expense-tracker.db');

interface SheetCategory {
  group: 'fixed' | 'variable' | 'extra';
  name: string;
  planned: number;
  spent: number;
}
interface SheetMonth {
  year: number;
  month: number;
  save: number;
  incomes: Array<{ label: string; amount: number }>;
  categories: SheetCategory[];
}

let sheetCounter = 0;
function writeSheet(months: SheetMonth[], extra: Record<string, unknown> = {}): string {
  const file = path.join(tmpDir, `sheet-${sheetCounter++}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ source: 'test fixture', savingsOpeningBalance: 1772.79, months, ...extra }),
  );
  return file;
}

function runScript(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

// Async variant for tests that need the parent's event loop free while the
// script runs (e.g. a local HTTP stub answering the script's recompute POST —
// spawnSync would block the loop and deadlock the request).
function runScriptAsync(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function runRepair(sheetPath: string, extra: string[] = []) {
  return runScript(['--db', DB_PATH, '--sheet', sheetPath, ...extra]);
}

function seedMonth(opts: {
  year: number;
  month: number;
  save?: number;
  categories: Array<{ group: 'fixed' | 'variable' | 'extra'; name: string; planned?: number; spent?: number }>;
  incomes?: Array<{ label: string; amount: number; kind?: string }>;
}): string {
  const db = getDb();
  const monthId = crypto.randomUUID();
  db.prepare('INSERT INTO budget_months (id, year, month, save, note, created_at) VALUES (?, ?, ?, ?, NULL, ?)').run(
    monthId,
    opts.year,
    opts.month,
    opts.save ?? 0,
    new Date().toISOString(),
  );
  const cat = db.prepare(
    'INSERT INTO budget_categories (id, month_id, "group", name, planned, spent, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const counters: Record<string, number> = { fixed: 0, variable: 0, extra: 0 };
  for (const c of opts.categories) {
    cat.run(
      crypto.randomUUID(),
      monthId,
      c.group,
      c.name,
      c.planned ?? 0,
      c.spent ?? 0,
      counters[c.group]++,
    );
  }
  const inc = db.prepare(
    'INSERT INTO budget_incomes (id, month_id, label, amount, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  (opts.incomes ?? []).forEach((i, idx) => {
    inc.run(crypto.randomUUID(), monthId, i.label, i.amount, i.kind ?? 'salary', idx);
  });
  return monthId;
}

function seedTx(t: {
  id: string;
  categoryId?: string | null;
  amount?: number;
  bookingDate?: string;
  description?: string;
  counterparty?: string | null;
  counted?: number;
  budgetMonth?: string | null;
}): void {
  const booking = t.bookingDate ?? '2026-08-10';
  getDb()
    .prepare(
      `INSERT INTO bank_transactions
         (id, account_uid, amount, currency, credit_debit, booking_date, value_date,
          description, counterparty, status, category_id, confidence, ignored,
          budget_month, counted, dedup_group, move_reason, unallocated, created_at)
       VALUES (?, ?, ?, 'EUR', 'DBIT', ?, ?, ?, ?, 'BOOK', ?, NULL, 0, ?, ?, NULL, NULL, 0, ?)`,
    )
    .run(
      t.id,
      JOINT,
      t.amount ?? -10,
      booking,
      booking,
      t.description ?? 'Some transfer',
      t.counterparty ?? null,
      t.categoryId ?? null,
      t.budgetMonth ?? booking.slice(0, 7),
      t.counted ?? 0,
      new Date().toISOString(),
    );
}

beforeAll(() => {
  process.env.PETRICCO_DATA_DIR = tmpDir;
  initBankSchema();
  initBudgetSchema();
});

afterAll(() => {
  delete process.env.PETRICCO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec(
    'DELETE FROM bank_transactions;' +
      'DELETE FROM bank_sessions;' +
      'DELETE FROM bank_settings;' +
      'DELETE FROM budget_categories;' +
      'DELETE FROM budget_incomes;' +
      'DELETE FROM budget_months;' +
      'DELETE FROM budget_settings;',
  );
  // bank_settings was just wiped — (re)mark the joint account for every test.
  setJointAccountUids([JOINT]);
});

describe('repair-budget-from-sheet.mjs', () => {
  it('rename alias preserves the category id so bank spend still lands on it (2026-08 Insurance -> Insurance 1/12)', () => {
    seedMonth({
      year: 2026,
      month: 8,
      categories: [{ group: 'fixed', name: 'Insurance', planned: 100, spent: 55 }],
    });
    const before = getMonthByYM(2026, 8)!;
    expect(before.categories).toHaveLength(1);
    const insuranceId = before.categories[0].id;

    // A categorized, counted joint DBIT pointing at the insurance category.
    seedTx({
      id: 'tx-ins',
      categoryId: insuranceId,
      amount: -112.8,
      bookingDate: '2026-08-12',
      description: 'Car insurance',
      counterparty: 'Rafaela François',
      counted: 1,
      budgetMonth: '2026-08',
    });

    const sheet = writeSheet([
      {
        year: 2026,
        month: 8,
        save: 700,
        incomes: [
          { label: 'Rafaela', amount: 2855.83 },
          { label: 'Rafael', amount: 2942.31 },
        ],
        categories: [{ group: 'fixed', name: 'Insurance 1/12', planned: 150, spent: 112.8 }],
      },
    ]);

    const res = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(res.status).toBe(0);

    const after = getMonthByYM(2026, 8)!;
    expect(after.categories).toHaveLength(1);
    expect(after.categories[0].id).toBe(insuranceId); // id preserved by the rename
    expect(after.categories[0].name).toBe('Insurance 1/12');
    expect(after.categories[0].planned).toBe(150);
    expect(res.stdout).toContain('renamed (id kept)');

    // Bank spend still lands on the kept id (via the app's own reader), and
    // manual spent = sheet 112.80 - bank 112.80 = 0.
    expect(bankSpentByCategory(2026, 8)[insuranceId]).toBeCloseTo(112.8, 2);
    expect(after.categories[0].spent).toBe(0);
  });

  it('an orphan category referenced by a tx is deleted and the tx is returned to the review queue', () => {
    seedMonth({
      year: 2026,
      month: 8,
      categories: [
        { group: 'fixed', name: 'Phone', planned: 70 },
        { group: 'extra', name: 'Junk Thing', planned: 20, spent: 44.9 },
      ],
    });
    const m = getMonthByYM(2026, 8)!;
    const junk = m.categories.find((c) => c.name === 'Junk Thing')!;
    seedTx({
      id: 'tx-junk',
      categoryId: junk.id,
      amount: -44.9,
      bookingDate: '2026-08-14',
      description: 'Wrong-month junk',
      counterparty: 'Rafael Petriccone',
      counted: 1,
      budgetMonth: '2026-08',
    });

    const sheet = writeSheet([
      {
        year: 2026,
        month: 8,
        save: 0,
        incomes: [],
        categories: [{ group: 'fixed', name: 'Phone', planned: 70, spent: 0 }],
      },
    ]);

    const res = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(res.status).toBe(0);

    const after = getMonthByYM(2026, 8)!;
    expect(after.categories.map((c) => c.name)).toEqual(['Phone']); // orphan gone

    const tx = getTransactionById('tx-junk')!;
    expect(tx.category_id).toBeNull();
    expect(tx.counted).toBe(0);
    expect(tx.unallocated).toBe(1);

    expect(res.stdout).toContain('tx-junk');
    expect(res.stdout).toContain('review');
    expect(res.stdout).toContain('Junk Thing');
  });

  it('manual spent = round2(max(0, sheet.spent - bankSpent)) — never negative', () => {
    seedMonth({
      year: 2026,
      month: 8,
      categories: [
        { group: 'fixed', name: 'Alpha', planned: 100 },
        { group: 'fixed', name: 'Beta', planned: 100 },
      ],
    });
    const m = getMonthByYM(2026, 8)!;
    const alpha = m.categories.find((c) => c.name === 'Alpha')!;
    const beta = m.categories.find((c) => c.name === 'Beta')!;
    seedTx({ id: 'tx-a', categoryId: alpha.id, amount: -30, bookingDate: '2026-08-05', counted: 1 });
    seedTx({ id: 'tx-b', categoryId: beta.id, amount: -150, bookingDate: '2026-08-06', counted: 1 });

    const sheet = writeSheet([
      {
        year: 2026,
        month: 8,
        save: 0,
        incomes: [],
        categories: [
          { group: 'fixed', name: 'Alpha', planned: 100, spent: 100 },
          { group: 'fixed', name: 'Beta', planned: 100, spent: 100 },
        ],
      },
    ]);

    const res = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(res.status).toBe(0);

    const after = getMonthByYM(2026, 8)!;
    const spent = new Map(after.categories.map((c) => [c.name, c.spent]));
    expect(spent.get('Alpha')).toBe(70); // 100 - 30
    expect(spent.get('Beta')).toBe(0); // max(0, 100 - 150)
  });

  it('idempotent: a second --apply reports zero changes', () => {
    seedMonth({
      year: 2026,
      month: 8,
      save: 999,
      categories: [
        { group: 'fixed', name: 'Insurance', planned: 100, spent: 55 },
        { group: 'variable', name: 'Junk', planned: 10, spent: 10 },
      ],
      incomes: [{ label: 'El', amount: 1 }, { label: 'Deliveroo', amount: 2, kind: 'extra' }],
    });
    const sheet = writeSheet([
      {
        year: 2026,
        month: 8,
        save: 700,
        incomes: [{ label: 'Rafaela', amount: 2855.83 }],
        categories: [
          { group: 'fixed', name: 'Insurance 1/12', planned: 150, spent: 112.8 },
          { group: 'variable', name: 'Pay Later', planned: 253.65, spent: 0 },
        ],
      },
    ]);

    const first = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/changes: [1-9]/);

    const second = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('changes: 0');
  });

  it('incomes are replaced by exactly the canonical list (junk El/Ela/Deliveroo gone)', () => {
    seedMonth({
      year: 2026,
      month: 8,
      categories: [{ group: 'fixed', name: 'Phone', planned: 70 }],
      incomes: [
        { label: 'El', amount: 500 },
        { label: 'Ela', amount: 400 },
        { label: 'Deliveroo', amount: 20, kind: 'extra' },
      ],
    });
    const sheet = writeSheet([
      {
        year: 2026,
        month: 8,
        save: 0,
        incomes: [
          { label: 'Rafaela', amount: 2855.83 },
          { label: 'Rafael', amount: 2942.31 },
        ],
        categories: [{ group: 'fixed', name: 'Phone', planned: 70, spent: 0 }],
      },
    ]);

    const res = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(res.status).toBe(0);

    const after = getMonthByYM(2026, 8)!;
    expect(after.incomes.map((i) => `${i.label}:${i.amount}:${i.kind}`)).toEqual([
      'Rafaela:2855.83:salary',
      'Rafael:2942.31:salary',
    ]);
  });

  it('month.save and settings.savingsOpeningBalance are updated from the sheet', () => {
    seedMonth({
      year: 2026,
      month: 5,
      save: 999,
      categories: [],
      incomes: [],
    });
    const sheet = writeSheet([{ year: 2026, month: 5, save: 1600, incomes: [], categories: [] }]);

    expect(getSettings().savingsOpeningBalance).toBe(4072.79); // default, no row yet

    const res = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(res.status).toBe(0);

    expect(getMonthByYM(2026, 5)!.save).toBe(1600);
    expect(getSettings().savingsOpeningBalance).toBeCloseTo(1772.79, 2);
  });

  it('hard-errors when a canonical month is missing — and writes nothing', () => {
    seedMonth({
      year: 2026,
      month: 8,
      save: 123,
      categories: [{ group: 'fixed', name: 'Phone', planned: 70, spent: 12 }],
      incomes: [{ label: 'El', amount: 5 }],
    });
    const sheet = writeSheet([
      { year: 2026, month: 5, save: 1600, incomes: [], categories: [] },
      { year: 2026, month: 8, save: 700, incomes: [], categories: [] },
    ]);

    const res = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('missing');
    expect(res.stderr).toContain('2026-05');

    // Nothing was written.
    const m = getMonthByYM(2026, 8)!;
    expect(m.save).toBe(123);
    expect(m.categories).toHaveLength(1);
    expect(m.categories[0].spent).toBe(12);
    expect(m.incomes.map((i) => i.label)).toEqual(['El']);
    expect(getSettings().savingsOpeningBalance).toBe(4072.79);
  });

  it('dry-run writes nothing and makes no recompute call; --apply POSTs the app categorize endpoint with the cron secret', async () => {
    const requests: Array<{ method: string; url: string; secret: string | undefined }> = [];
    const server = http.createServer((req, res) => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        secret: (req.headers['x-cron-secret'] as string | undefined) ?? undefined,
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, months: 1, assigned: 0, needsReview: 0, attributedMoves: 0 }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      seedMonth({
        year: 2026,
        month: 8,
        save: 999,
        categories: [{ group: 'fixed', name: 'Insurance', planned: 100 }],
        incomes: [{ label: 'El', amount: 5 }],
      });
      const sheet = writeSheet([
        {
          year: 2026,
          month: 8,
          save: 700,
          incomes: [{ label: 'Rafaela', amount: 2855.83 }],
          categories: [{ group: 'fixed', name: 'Insurance 1/12', planned: 150, spent: 112.8 }],
        },
      ]);

      // Default mode: DRY-RUN — no writes, no HTTP.
      const dry = await runScriptAsync(['--db', DB_PATH, '--sheet', sheet]);
      expect(dry.status).toBe(0);
      expect(dry.stdout).toContain('DRY-RUN');
      expect(requests).toHaveLength(0);
      const unchanged = getMonthByYM(2026, 8)!;
      expect(unchanged.save).toBe(999);
      expect(unchanged.categories[0].name).toBe('Insurance');
      expect(unchanged.incomes.map((i) => i.label)).toEqual(['El']);

      // APPLY (no --skip-recompute): must POST the app's own categorize
      // endpoint with the cron secret.
      const applied = await runScriptAsync([
        '--db',
        DB_PATH,
        '--sheet',
        sheet,
        '--apply',
        '--app-url',
        `http://127.0.0.1:${port}`,
        '--cron-secret',
        'test-secret',
      ]);
      expect(applied.status).toBe(0);
      expect(applied.stdout).toContain('recompute ok');
      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe('POST');
      expect(requests[0].url).toBe('/api/banking/categorize');
      expect(requests[0].secret).toBe('test-secret');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('--apply writes a pre-repair backup snapshot next to the DB (valid SQLite, pre-repair state)', () => {
    seedMonth({
      year: 2026,
      month: 8,
      save: 999,
      categories: [{ group: 'fixed', name: 'Phone', planned: 70, spent: 12 }],
      incomes: [],
    });
    const sheet = writeSheet([
      {
        year: 2026,
        month: 8,
        save: 700,
        incomes: [],
        categories: [{ group: 'fixed', name: 'Phone', planned: 70, spent: 0 }],
      },
    ]);

    const res = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(res.status).toBe(0);

    const printed = res.stdout.match(/backup: (.+\.pre-repair-\d{8}-\d{6}(?:-\d+)?\.db)/);
    expect(printed).not.toBeNull();
    const backupPath = printed![1];
    expect(fs.existsSync(backupPath)).toBe(true);

    // The snapshot is a valid SQLite file with the PRE-repair state.
    const bdb = new DatabaseSync(backupPath);
    try {
      const row = bdb.prepare('SELECT COUNT(*) AS n FROM budget_months').get() as { n: number };
      expect(row.n).toBe(1);
    } finally {
      bdb.close();
    }
  });

  it('categorize endpoint HTTP 500 with --apply: non-zero exit, failure reported, phase-2 spent NOT written, backup kept', async () => {
    const server = http.createServer((req, res) => {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'stub failure' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      seedMonth({
        year: 2026,
        month: 8,
        save: 999,
        categories: [{ group: 'fixed', name: 'Insurance', planned: 100, spent: 55 }],
        incomes: [{ label: 'El', amount: 5 }],
      });
      const insuranceId = getMonthByYM(2026, 8)!.categories[0].id;

      const sheet = writeSheet([
        {
          year: 2026,
          month: 8,
          save: 700,
          incomes: [{ label: 'Rafaela', amount: 2855.83 }],
          // No bank txs exist, so bankSpent = 0 < canonical spent 112.8 —
          // phase 2 would write manual spent 112.80 if it ran.
          categories: [{ group: 'fixed', name: 'Insurance 1/12', planned: 150, spent: 112.8 }],
        },
      ]);

      const res = await runScriptAsync([
        '--db',
        DB_PATH,
        '--sheet',
        sheet,
        '--apply',
        '--app-url',
        `http://127.0.0.1:${port}`,
      ]);
      expect(res.status).not.toBe(0);
      expect(`${res.stdout}\n${res.stderr}`).toContain('HTTP 500');

      // Structural writes (steps 1-6) DID commit: rename kept the id and
      // save/incomes were mirrored...
      const after = getMonthByYM(2026, 8)!;
      expect(after.categories).toHaveLength(1);
      expect(after.categories[0].id).toBe(insuranceId);
      expect(after.categories[0].name).toBe('Insurance 1/12');
      expect(after.save).toBe(700);
      expect(after.incomes.map((i) => i.label)).toEqual(['Rafaela']);
      // ...but phase 2 never wrote: spent is still the pre-run 55.
      expect(after.categories[0].spent).toBe(55);

      // The pre-repair backup from the self-backup fix still exists.
      const printed = res.stdout.match(/backup: (.+\.pre-repair-\d{8}-\d{6}(?:-\d+)?\.db)/);
      expect(printed).not.toBeNull();
      expect(fs.existsSync(printed![1])).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('the REAL canonical sheet applies cleanly to empty seeded months and is idempotent', () => {
    for (const month of [5, 6, 7, 8, 9]) {
      seedMonth({ year: 2026, month, categories: [], incomes: [] });
    }

    // Dry-run first: all 156 categories are INSERTs against the empty months —
    // must not crash, must write nothing.
    const dry = runScript(['--db', DB_PATH, '--sheet', REAL_SHEET]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('DRY-RUN');
    expect(getMonthByYM(2026, 5)!.categories).toHaveLength(0);
    expect(getSettings().savingsOpeningBalance).toBe(4072.79);

    const first = runScript(['--db', DB_PATH, '--sheet', REAL_SHEET, '--apply', '--skip-recompute']);
    expect(first.status).toBe(0);

    const aug = getMonthByYM(2026, 8)!;
    expect(aug.categories.map((c) => c.name)).toContain('Insurance 1/12');
    expect(aug.save).toBe(700);
    const sep = getMonthByYM(2026, 9)!;
    expect(sep.categories.map((c) => c.name)).toContain('Insurance 2/12');
    expect(sep.save).toBe(800);
    const may = getMonthByYM(2026, 5)!;
    expect(may.categories).toHaveLength(37); // 37 sheet rows incl. the two "?"
    expect(may.incomes.map((i) => i.label)).toEqual(['Rafaela', 'Rafael']);
    expect(getSettings().savingsOpeningBalance).toBeCloseTo(1772.79, 2);
    // No bank txs exist — the whole sheet spend is manual.
    const lastMonth = may.categories.find((c) => c.name === 'Last Month')!;
    expect(lastMonth.spent).toBeCloseTo(95.47, 2);

    const second = runScript(['--db', DB_PATH, '--sheet', REAL_SHEET, '--apply', '--skip-recompute']);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('changes: 0');

    // NOTES must be printed verbatim on every run.
    for (const run of [first, second]) {
      expect(run.stdout).toContain(
        'AGOSTO: Total Saving da planilha (4757.17) é 15.62 menor que opening+Σsave (4772.79) — planilha internamente inconsistente; espelhamos a coluna Save.',
      );
      expect(run.stdout).toContain(
        'SETEMBRO: Save=800 mas Total Saving da planilha (4857.17) só avança 100 sobre agosto — mês em progresso; espelhamos a coluna Save (800).',
      );
    }
  });

  it('duplicate canonical names ("?") consume existing rows in sheet order — no spurious inserts', () => {
    seedMonth({
      year: 2026,
      month: 5,
      categories: [
        { group: 'extra', name: '?', planned: 999 },
        { group: 'extra', name: '?', planned: 888 },
      ],
    });
    const sheet = writeSheet([
      {
        year: 2026,
        month: 5,
        save: 0,
        incomes: [],
        categories: [
          { group: 'extra', name: '?', planned: 24, spent: 24 },
          { group: 'extra', name: '?', planned: 15, spent: 15 },
        ],
      },
    ]);

    const res = runRepair(sheet, ['--apply', '--skip-recompute']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/(^|[^0-9])0 inserted/);
    expect(res.stdout).toContain('0 orphan(s) deleted');

    const after = getMonthByYM(2026, 5)!.categories.sort((a, b) => a.sortOrder - b.sortOrder);
    expect(after).toHaveLength(2);
    expect(after.map((c) => c.planned)).toEqual([24, 15]); // first "?" <- first existing, in order
  });
});
