// One-off: backfill earlier budget months by carrying a template month backward.
//
// The couple's budget model needs a budget month to exist for each real bank
// month before that month's transactions can be categorized/attributed. The
// app only ever created one month (2026-08); POST /api/budget/months carries the
// LATEST month FORWARD and cannot create a month before the earliest. This seeds
// the missing earlier months (default 2026-05, 2026-06, 2026-07) from the current
// template month: same categories (names/groups/planned, spent = 0) and incomes
// (labels/amounts/kinds), with FRESH per-month UUIDs, and save carried from the
// template. Idempotent — a month that already exists is skipped.
//
// This mirrors src/lib/budget-store.ts `createMonthFromTemplate` byte-for-byte
// (same SQL). It is deliberately self-contained (only node builtins) so it runs
// with plain `node` — locally against a COPY of the prod DB, and inside the
// Dokploy container against live /data, where only the compiled app (not the TS
// source) exists. The store function is the canonical implementation and is unit
// tested (budget-store.test.ts); keep the two in sync if the schema changes.
//
// Usage:
//   node scripts/backfill-budget-months.mjs [--db <path>] [--template YYYY-MM]
//                                           [--dry-run] [YYYY-MM ...]
//   DB path resolution: --db <file>  >  $PETRICCO_DATA_DIR/expense-tracker.db
//                       >  /data/expense-tracker.db (prod default)
//   Template: --template YYYY-MM, else the latest existing month.
//   Targets:  positional YYYY-MM args, else 2026-05 2026-06 2026-07.

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';

const DEFAULT_TARGETS = ['2026-05', '2026-06', '2026-07'];

function parseArgs(argv) {
  const opts = { db: null, template: null, dryRun: false, targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') opts.db = argv[++i];
    else if (a === '--template') opts.template = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (/^\d{4}-\d{2}$/.test(a)) opts.targets.push(a);
    else throw new Error(`unrecognized argument: ${a}`);
  }
  if (opts.targets.length === 0) opts.targets = DEFAULT_TARGETS;
  return opts;
}

function resolveDbPath(explicit) {
  if (explicit) return explicit;
  if (process.env.PETRICCO_DATA_DIR) {
    return path.join(process.env.PETRICCO_DATA_DIR, 'expense-tracker.db');
  }
  return '/data/expense-tracker.db';
}

function ymParts(ym) {
  return { year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(opts.db);
  console.log(`[backfill] db=${dbPath}${opts.dryRun ? '  (DRY RUN — no writes)' : ''}`);

  const db = new DatabaseSync(dbPath);
  // Play nice with the live app's connection on the same WAL DB.
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Template month: explicit --template, else the latest existing month.
  let template;
  if (opts.template) {
    const { year, month } = ymParts(opts.template);
    template = db
      .prepare('SELECT id, year, month, save FROM budget_months WHERE year = ? AND month = ?')
      .get(year, month);
    if (!template) throw new Error(`template month ${opts.template} does not exist`);
  } else {
    template = db
      .prepare('SELECT id, year, month, save FROM budget_months ORDER BY year DESC, month DESC LIMIT 1')
      .get();
    if (!template) throw new Error('no budget month exists to use as a template');
  }
  const templateYm = `${template.year}-${String(template.month).padStart(2, '0')}`;
  const catCount = db
    .prepare('SELECT COUNT(*) AS n FROM budget_categories WHERE month_id = ?')
    .get(template.id).n;
  const incCount = db
    .prepare('SELECT COUNT(*) AS n FROM budget_incomes WHERE month_id = ?')
    .get(template.id).n;
  console.log(
    `[backfill] template=${templateYm} (save=${template.save}, categories=${catCount}, incomes=${incCount})`,
  );

  const catSelect = db.prepare(
    'SELECT id, "group" AS grp, name, planned, sort_order FROM budget_categories WHERE month_id = ? ORDER BY "group" ASC, sort_order ASC',
  );
  const incSelect = db.prepare(
    'SELECT id, label, amount, kind, sort_order FROM budget_incomes WHERE month_id = ? ORDER BY sort_order ASC',
  );
  const insMonth = db.prepare(
    'INSERT INTO budget_months (id, year, month, save, note, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
  );
  const insCat = db.prepare(
    'INSERT INTO budget_categories (id, month_id, "group", name, planned, spent, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)',
  );
  const insInc = db.prepare(
    'INSERT INTO budget_incomes (id, month_id, label, amount, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const summary = [];
  for (const ym of opts.targets) {
    const { year, month } = ymParts(ym);
    if (ym === templateYm) {
      console.log(`[backfill] ${ym}: is the template month — skip`);
      summary.push({ ym, action: 'skip (template)' });
      continue;
    }
    const exists = db
      .prepare('SELECT id FROM budget_months WHERE year = ? AND month = ?')
      .get(year, month);
    if (exists) {
      console.log(`[backfill] ${ym}: already exists — skip`);
      summary.push({ ym, action: 'skip (exists)' });
      continue;
    }
    if (opts.dryRun) {
      console.log(`[backfill] ${ym}: WOULD create from ${templateYm} (${catCount} categories, ${incCount} incomes, save=${template.save})`);
      summary.push({ ym, action: 'would-create' });
      continue;
    }

    const newId = crypto.randomUUID();
    db.exec('BEGIN');
    try {
      insMonth.run(newId, year, month, template.save, new Date().toISOString());
      for (const c of catSelect.all(template.id)) {
        insCat.run(crypto.randomUUID(), newId, c.grp, c.name, c.planned, c.sort_order);
      }
      for (const i of incSelect.all(template.id)) {
        insInc.run(crypto.randomUUID(), newId, i.label, i.amount, i.kind, i.sort_order);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    console.log(`[backfill] ${ym}: created (id=${newId})`);
    summary.push({ ym, action: 'created', id: newId });
  }

  db.close();

  console.log('\n[backfill] summary:');
  for (const s of summary) console.log(`  ${s.ym}: ${s.action}${s.id ? ` (${s.id})` : ''}`);
  const created = summary.filter((s) => s.action === 'created').length;
  console.log(`[backfill] done — ${created} month(s) created.`);
}

main();
