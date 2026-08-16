// Seed the explicit counterparty → category rules (bank_category_rules, see
// src/lib/bank-store.ts). First rule: "Clúid Housing Association" → "Rental" —
// the rent is paid by direct debit from the joint account, so no labeled
// transfer fronts it; the rule makes that external charge count as Rental
// spend with the same payday roll-forward attribution as internal moves.
//
// Idempotent: a rule is inserted only when no rule already exists for the same
// (match_field, normalized pattern); re-running is a no-op. The pattern is
// stored PRE-NORMALIZED — this script mirrors bank-store.ts's normalizeLabel
// (accent/case fold, punctuation → space, transfer/person/holder-token strip)
// and must stay in sync with it, same as backfill-budget-months.mjs mirrors
// budget-store's SQL. Self-contained (node builtins only) so it runs with
// plain `node` — locally against a COPY of prod, and inside the Dokploy
// container against live /data. It also CREATE TABLE IF NOT EXISTS
// bank_category_rules defensively (initBankSchema creates the same table; on
// an already-booted app DB this is a no-op).
//
// Usage:
//   node scripts/seed-bank-category-rules.mjs [--db <path>] [--dry-run]
//   DB path resolution: --db <file>  >  $PETRICCO_DATA_DIR/expense-tracker.db
//                       >  /data/expense-tracker.db (prod default)

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';

// Keep in sync with DEFAULT_HOLDER_TOKENS / DIRECTIONAL_TAGS / PERSON_TAGS in
// src/lib/bank-store.ts.
const DIRECTIONAL_TAGS = ['to', 'from'];
const PERSON_TAGS = ['el', 'ela'];
const DEFAULT_HOLDER_TOKENS = [
  'rafael',
  'rafaela',
  'petriccone',
  'dos',
  'santos',
  'maciel',
  'varolo',
  'francois',
];

// Mirror of bank-store.ts's normalizeLabel — see the header note.
function normalizeBasic(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function normalizeToken(t) {
  return normalizeBasic(t).replace(/[^a-z0-9]+/g, '');
}

function normalizeLabel(raw) {
  const strip = new Set([...DIRECTIONAL_TAGS, ...PERSON_TAGS, ...DEFAULT_HOLDER_TOKENS.map(normalizeToken)]);
  return normalizeBasic(raw)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !strip.has(w))
    .join(' ')
    .trim();
}

const SEED_RULES = [
  { pattern: 'Clúid Housing Association', category_name: 'Rental' },
];

function parseArgs(argv) {
  const opts = { db: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') opts.db = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`unrecognized argument: ${a}`);
  }
  return opts;
}

function resolveDbPath(explicit) {
  if (explicit) return explicit;
  if (process.env.PETRICCO_DATA_DIR) {
    return path.join(process.env.PETRICCO_DATA_DIR, 'expense-tracker.db');
  }
  return '/data/expense-tracker.db';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(opts.db);
  console.log(`[seed-rules] db=${dbPath}${opts.dryRun ? '  (DRY RUN — no writes)' : ''}`);

  const db = new DatabaseSync(dbPath);
  // Play nice with the live app's connection on the same WAL DB.
  db.exec('PRAGMA busy_timeout = 5000;');
  // Same DDL as initBankSchema's bank_category_rules (defensive — no-op there).
  // Skipped under --dry-run so a dry pass is truly read-only — no schema
  // writes, not even CREATE TABLE IF NOT EXISTS.
  if (!opts.dryRun) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bank_category_rules (
        id            TEXT PRIMARY KEY,
        match_field   TEXT NOT NULL DEFAULT 'counterparty',
        pattern       TEXT NOT NULL,
        category_name TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
    `);
  }

  // Read-only idempotency check (stays before the would-insert/insert branch).
  // On a never-booted DB under --dry-run the table doesn't exist yet — treat
  // every rule as not-present instead of failing the SELECT.
  const tableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='bank_category_rules'",
  ).get();
  const exists = tableExists
    ? db.prepare(
        "SELECT id FROM bank_category_rules WHERE match_field = 'counterparty' AND pattern = ?",
      )
    : null;
  // Prepared only for a real run — a dry pass never inserts, and preparing
  // against a table that may not exist (fresh DB, DDL skipped) would fail.
  const ins = opts.dryRun
    ? null
    : db.prepare(
        "INSERT INTO bank_category_rules (id, match_field, pattern, category_name, created_at) VALUES (?, 'counterparty', ?, ?, ?)",
      );

  const summary = [];
  for (const rule of SEED_RULES) {
    const pattern = normalizeLabel(rule.pattern);
    if (!pattern) throw new Error(`rule pattern ${JSON.stringify(rule.pattern)} normalizes to empty`);
    if (pattern.length < 3) {
      throw new Error(`rule pattern ${JSON.stringify(rule.pattern)} normalizes to fewer than 3 characters`);
    }
    const tag = `${pattern} -> ${rule.category_name}`;
    if (exists?.get(pattern)) {
      console.log(`[seed-rules] ${tag}: already present — skip`);
      summary.push({ tag, action: 'skip (exists)' });
      continue;
    }
    if (opts.dryRun) {
      console.log(`[seed-rules] ${tag}: WOULD insert`);
      summary.push({ tag, action: 'would-insert' });
      continue;
    }
    const id = crypto.randomUUID();
    ins.run(id, pattern, rule.category_name, new Date().toISOString());
    console.log(`[seed-rules] ${tag}: inserted (id=${id})`);
    summary.push({ tag, action: 'inserted', id });
  }

  db.close();

  console.log('\n[seed-rules] summary:');
  for (const s of summary) console.log(`  ${s.tag}: ${s.action}`);
  const inserted = summary.filter((s) => s.action === 'inserted').length;
  console.log(`[seed-rules] done — ${inserted} rule(s) inserted.`);
}

main();
