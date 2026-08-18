// One-off: rebuild budget months 2026-05..09 from the canonical Google-Sheet
// snapshot (scripts/data/budget-sheet-2026-08-18.json).
//
// A WhatsApp agent copied WRONG sheet months into 2026-05..09 (junk
// categories, junk incomes like El/Ela/Deliveroo, wrong save values). The
// sheet is truth, so this script mirrors it back into the DB:
//   - categories: name/group/planned/sort_order (sheet index) per month,
//     matched by normalized name IN SHEET ORDER (consumption queues handle
//     duplicate names like the two "?" rows). An explicit alias keeps the
//     EXISTING row id for renamed insurance rows (2026-08 "Insurance" ->
//     "Insurance 1/12", 2026-09 -> "Insurance 2/12") because
//     bank_transactions.category_id points at those ids — losing one loses
//     its bank spend. Unmatched canonical rows are INSERTed; existing
//     categories with no canonical match are ORPHANS: their bank txs get
//     category_id=NULL, counted=0, unallocated=1 (back to the review queue)
//     and the category row is deleted.
//   - incomes: replaced by exactly the canonical list (kind 'salary', per
//     the seed precedent in budget-store.ts — the sheet lists the salaries).
//   - month.save from the sheet; settings savings_opening_balance once.
//   - then the app's OWN categorization + attribution passes are re-run by
//     POSTing the running app's cron endpoint /api/banking/categorize (same
//     runCategorization + runAttribution the daily sync cron calls — see
//     src/app/api/banking/sync/route.ts). This hooks newly-created
//     categories to matching transactions deterministically. The POST also
//     triggers runAskReview(): it may send up to 10 WhatsApp questions to
//     both partners — the daily sync cron does the same within a day, so
//     this only accelerates it.
//   - phase 2 (after the recompute): manual spent per category =
//     round2(max(0, sheet.spent - bankSpent(cat, month))) where bankSpent
//     mirrors bank-store.ts's bankSpentByCategory SQL (joint-only signed
//     net, counted=1, budget_month, negatives clamped to 0). Displayed gasto
//     = manual + bank, so it equals the sheet wherever bank <= sheet and
//     shows the bank figure where it exceeds it.
//
// Idempotent: --apply twice reports zero changes. Default is DRY-RUN (no
// writes, no recompute POST). Exits non-zero when a canonical month is
// missing from budget_months (months are never created here — use
// scripts/backfill-budget-months.mjs first) or the canonical JSON is invalid.
//
// Self-contained (node builtins only), same as backfill-budget-months.mjs,
// so it runs with plain `node` locally against a COPY of prod and inside the
// Dokploy container against live /data (Node 22 there needs
// --experimental-sqlite, same as the server entrypoint; Node >= 23 doesn't).
//
// Usage (runbook lines must carry --experimental-sqlite on Node 22, e.g.
//        `node --experimental-sqlite scripts/repair-budget-from-sheet.mjs …`;
//        Node >= 23 doesn't):
//   node scripts/repair-budget-from-sheet.mjs [--db <path>] [--sheet <path>]
//       [--apply] [--skip-recompute] [--app-url <url>] [--cron-secret <s>]
//   DB path resolution: --db <file>  >  $PETRICCO_DATA_DIR/expense-tracker.db
//                       >  /data/expense-tracker.db (prod default)
//   Sheet: --sheet <file>, else scripts/data/budget-sheet-2026-08-18.json
//          (resolved relative to THIS file, not the CWD).
//   Dry-run opens the DB READ-ONLY, so a wrong --db path cannot create a
//          stray empty file. Caveat: a read-only open of a DB with a hot
//          WAL may throw — dry-run against a live WAL DB should use a
//          checkpointed copy.
//   Recompute: --app-url (default http://127.0.0.1:3000) + --cron-secret
//          (default $INTERNAL_API_SECRET) — the app must be running.
//          Preferred secret channel is the INTERNAL_API_SECRET env var
//          (--cron-secret argv is visible in `ps` output).
//          --skip-recompute skips step 7 (tests / app down; phase 2 then
//          uses the CURRENT attribution state).

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SHEET = path.join(SCRIPT_DIR, 'data', 'budget-sheet-2026-08-18.json');

// Sheet inconsistencies we mirror rather than "fix" — printed verbatim in the
// report's NOTES section so the couple sees them on every run.
const NOTES = [
  'AGOSTO: Total Saving da planilha (4757.17) é 15.62 menor que opening+Σsave (4772.79) — planilha internamente inconsistente; espelhamos a coluna Save.',
  'SETEMBRO: Save=800 mas Total Saving da planilha (4857.17) só avança 100 sobre agosto — mês em progresso; espelhamos a coluna Save (800).',
];

// Renames that must PRESERVE the row id (bank_transactions.category_id points
// at it). Keyed by 'YYYY-MM'; values are normalized (see normalizeName)
// canonical -> existing names.
const MONTH_ALIASES = {
  '2026-08': { canonical: 'insurance 1 12', existing: 'insurance' },
  '2026-09': { canonical: 'insurance 2 12', existing: 'insurance' },
};

const SETTINGS_OPENING_KEY = 'savings_opening_balance';
const JOINT_ACCOUNT_UIDS_KEY = 'joint_account_uids';

// ----- helpers (mirror the repo's conventions) -----

// Round to cents, half away from zero, epsilon-nudged — same as round2 in
// budget-store.ts / bank-store.ts.
function round2(n) {
  return (Math.sign(n) * Math.round(Math.abs(n) * 100 + Number.EPSILON)) / 100;
}

// Comparison key for category names: accent/case fold, punctuation (incl.
// "/") -> space, collapse whitespace. "Insurance 1/12" -> "insurance 1 12",
// "?" -> "" (so duplicate "?" rows share a key and consume in sheet order).
function normalizeName(raw) {
  return String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function ymOf(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function fmt(n) {
  return Number(n).toFixed(2);
}

// ----- self-backup (review F1) -----

// Timestamp for the snapshot filename: YYYYMMDD-HHMMSS, local time.
function backupStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// Consistent pre-repair snapshot via VACUUM INTO, taken BEFORE any
// structural write. VACUUM INTO cannot run inside a transaction — call
// before applyStructural's BEGIN. Any failure throws, aborting the run
// with zero writes and a non-zero exit. Same-second collisions bump a -N
// suffix so a re-run within one second still succeeds.
function vacuumIntoBackup(db, dbPath) {
  const stamp = backupStamp();
  let target = `${dbPath}.pre-repair-${stamp}.db`;
  for (let n = 1; fs.existsSync(target); n++) {
    target = `${dbPath}.pre-repair-${stamp}-${n}.db`;
  }
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

// ----- canonical validation -----

// Returns null when valid, else a human-readable error string.
export function validateCanonical(sheet) {
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
    return 'canonical: top-level JSON object required';
  }
  if (typeof sheet.source !== 'string' || sheet.source.trim() === '') {
    return 'canonical: source must be a non-empty string';
  }
  if (!Number.isFinite(sheet.savingsOpeningBalance)) {
    return 'canonical: savingsOpeningBalance must be a finite number';
  }
  if (!Array.isArray(sheet.months) || sheet.months.length === 0) {
    return 'canonical: months must be a non-empty array';
  }
  const seen = new Set();
  for (const [i, m] of sheet.months.entries()) {
    const w = `canonical: months[${i}]`;
    if (!m || typeof m !== 'object') return `${w} must be an object`;
    if (!Number.isInteger(m.year) || m.year < 2000 || m.year > 9999) return `${w}.year must be a 4-digit integer`;
    if (!Number.isInteger(m.month) || m.month < 1 || m.month > 12) return `${w}.month must be 1..12`;
    const ym = ymOf(m.year, m.month);
    if (seen.has(ym)) return `${w}: duplicate month ${ym}`;
    seen.add(ym);
    if (!Number.isFinite(m.save) || m.save < 0) return `${w}.save must be a finite number >= 0`;
    if (!Array.isArray(m.incomes)) return `${w}.incomes must be an array`;
    for (const [j, inc] of m.incomes.entries()) {
      if (!inc || typeof inc !== 'object') return `${w}.incomes[${j}] must be an object`;
      if (typeof inc.label !== 'string' || inc.label.trim() === '') {
        return `${w}.incomes[${j}].label must be a non-empty string`;
      }
      if (!Number.isFinite(inc.amount) || inc.amount < 0) {
        return `${w}.incomes[${j}].amount must be a finite number >= 0`;
      }
    }
    if (!Array.isArray(m.categories)) return `${w}.categories must be an array`;
    for (const [k, c] of m.categories.entries()) {
      const cw = `${w}.categories[${k}]`;
      if (!c || typeof c !== 'object') return `${cw} must be an object`;
      if (c.group !== 'fixed' && c.group !== 'variable' && c.group !== 'extra') {
        return `${cw}.group must be fixed|variable|extra`;
      }
      if (typeof c.name !== 'string' || c.name.trim() === '') return `${cw}.name must be a non-empty string`;
      if (!Number.isFinite(c.planned) || c.planned < 0) return `${cw}.planned must be a finite number >= 0`;
      if (!Number.isFinite(c.spent)) return `${cw}.spent must be a finite number`;
    }
  }
  return null;
}

// ----- planning (pure reads — no writes) -----

// Resolve every canonical month's budget_months row. Returns
// { rows: Map<'YYYY-MM', monthRow>, missing: ['YYYY-MM', ...] }.
function resolveMonths(db, sheet) {
  const rows = new Map();
  const missing = [];
  for (const m of sheet.months) {
    const ym = ymOf(m.year, m.month);
    const row = db
      .prepare('SELECT id, year, month, save FROM budget_months WHERE year = ? AND month = ?')
      .get(m.year, m.month);
    if (!row) missing.push(ym);
    else rows.set(ym, row);
  }
  return { rows, missing };
}

// Match canonical categories to the month's existing rows by normalized name,
// consuming matches in sheet order (duplicate names like "?" pair up in
// order). Alias renames keep the existing row id.
function matchCategories(monthId, ym, canonicalCategories, db) {
  const existing = db
    .prepare(
      'SELECT id, "group" AS grp, name, planned, spent, sort_order FROM budget_categories WHERE month_id = ? ORDER BY "group" ASC, sort_order ASC, name ASC',
    )
    .all(monthId);

  const queues = new Map();
  for (const row of existing) {
    const key = normalizeName(row.name);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(row);
  }

  const alias = MONTH_ALIASES[ym];
  const matched = [];
  const inserts = [];
  for (const [sheetIndex, c] of canonicalCategories.entries()) {
    const norm = normalizeName(c.name);
    let row = null;
    const q = queues.get(norm);
    if (q && q.length > 0) {
      row = q.shift();
    } else if (alias && norm === alias.canonical) {
      const qa = queues.get(alias.existing);
      if (qa && qa.length > 0) row = qa.shift();
    }
    if (row) {
      const target = { name: c.name, group: c.group, planned: round2(c.planned), sortOrder: sheetIndex };
      matched.push({
        id: row.id,
        before: {
          name: row.name,
          group: row.grp,
          planned: round2(row.planned),
          sortOrder: row.sort_order,
          spent: round2(row.spent),
        },
        target,
        canonical: { name: c.name, group: c.group, planned: round2(c.planned), spent: round2(c.spent) },
        renamed: normalizeName(row.name) !== norm,
        changed:
          row.name !== target.name ||
          row.grp !== target.group ||
          round2(row.planned) !== target.planned ||
          row.sort_order !== sheetIndex,
      });
    } else {
      inserts.push({
        id: crypto.randomUUID(),
        canonical: { name: c.name, group: c.group, planned: round2(c.planned), spent: round2(c.spent) },
        sortOrder: sheetIndex,
      });
    }
  }

  const orphans = [...queues.values()].flat().map((row) => ({
    id: row.id,
    name: row.name,
    group: row.grp,
    planned: round2(row.planned),
    spent: round2(row.spent),
    txs: db
      .prepare(
        'SELECT id, booking_date, amount, description FROM bank_transactions WHERE category_id = ? ORDER BY booking_date ASC, id ASC',
      )
      .all(row.id),
  }));

  return { matched, inserts, orphans };
}

function planIncomes(monthId, canonicalIncomes, db) {
  const existing = db
    .prepare('SELECT id, label, amount, kind, sort_order FROM budget_incomes WHERE month_id = ? ORDER BY sort_order ASC')
    .all(monthId);
  const after = canonicalIncomes.map((inc, i) => ({
    label: inc.label,
    amount: round2(inc.amount),
    kind: 'salary',
    sortOrder: i,
  }));
  const unchanged =
    existing.length === after.length &&
    after.every(
      (t, i) =>
        existing[i].label === t.label &&
        round2(existing[i].amount) === t.amount &&
        existing[i].kind === t.kind &&
        existing[i].sort_order === t.sortOrder,
    );
  return {
    replace: !unchanged,
    before: existing.map((r) => ({ label: r.label, amount: round2(r.amount), kind: r.kind })),
    after,
  };
}

// Build the full structural plan (steps 1-6) against the CURRENT DB state.
// Pure — performs no writes. Throws when a canonical month is missing.
export function planRepair(db, sheet) {
  const invalid = validateCanonical(sheet);
  if (invalid) throw new Error(invalid);

  const { rows: monthRows, missing } = resolveMonths(db, sheet);
  if (missing.length > 0) {
    throw new Error(
      `canonical month(s) missing from budget_months (this script never creates months — run scripts/backfill-budget-months.mjs first): ${missing.join(', ')}`,
    );
  }

  const months = [];
  for (const cm of sheet.months) {
    const ym = ymOf(cm.year, cm.month);
    const monthRow = monthRows.get(ym);
    const { matched, inserts, orphans } = matchCategories(monthRow.id, ym, cm.categories, db);
    const incomeChange = planIncomes(monthRow.id, cm.incomes, db);
    const saveAfter = round2(cm.save);
    months.push({
      ym,
      year: cm.year,
      month: cm.month,
      monthId: monthRow.id,
      saveBefore: round2(monthRow.save),
      saveAfter,
      saveChanged: round2(monthRow.save) !== saveAfter,
      matched,
      inserts,
      orphans,
      incomeChange,
    });
  }

  const openingRow = db.prepare('SELECT value FROM budget_settings WHERE key = ?').get(SETTINGS_OPENING_KEY);
  const openingAfter = round2(sheet.savingsOpeningBalance);
  const openingBefore = openingRow ? round2(Number(openingRow.value)) : null;
  const settingsChange = {
    key: SETTINGS_OPENING_KEY,
    before: openingBefore,
    after: openingAfter,
    changed: openingBefore !== openingAfter,
  };

  return { months, settingsChange };
}

export function countChanges(plan, spentRows) {
  let n = 0;
  for (const m of plan.months) {
    n += m.matched.filter((x) => x.changed).length;
    n += m.inserts.length;
    n += m.orphans.length;
    n += m.orphans.reduce((s, o) => s + o.txs.length, 0);
    if (m.incomeChange.replace) n += 1;
    if (m.saveChanged) n += 1;
  }
  if (plan.settingsChange.changed) n += 1;
  if (spentRows) n += spentRows.filter((r) => r.changed).length;
  return n;
}

// ----- apply -----

// Steps 1-6 in ONE transaction (all structural writes incl. orphan tx
// returns). Phase-2 spent writes are separate (they must run after the
// app's recompute).
export function applyStructural(db, plan) {
  db.exec('BEGIN');
  try {
    const updCat = db.prepare(
      'UPDATE budget_categories SET name = ?, "group" = ?, planned = ?, sort_order = ? WHERE id = ?',
    );
    const insCat = db.prepare(
      'INSERT INTO budget_categories (id, month_id, "group", name, planned, spent, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)',
    );
    const delCat = db.prepare('DELETE FROM budget_categories WHERE id = ?');
    const orphanTx = db.prepare(
      'UPDATE bank_transactions SET category_id = NULL, counted = 0, unallocated = 1 WHERE id = ?',
    );
    const delInc = db.prepare('DELETE FROM budget_incomes WHERE month_id = ?');
    const insInc = db.prepare(
      'INSERT INTO budget_incomes (id, month_id, label, amount, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const updSave = db.prepare('UPDATE budget_months SET save = ? WHERE id = ?');
    const updSetting = db.prepare(
      'INSERT INTO budget_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );

    for (const m of plan.months) {
      for (const mt of m.matched) {
        if (mt.changed) {
          updCat.run(mt.target.name, mt.target.group, mt.target.planned, mt.target.sortOrder, mt.id);
        }
      }
      for (const ins of m.inserts) {
        insCat.run(ins.id, m.monthId, ins.canonical.group, ins.canonical.name, ins.canonical.planned, ins.sortOrder);
      }
      for (const o of m.orphans) {
        for (const t of o.txs) orphanTx.run(t.id);
        delCat.run(o.id);
      }
      if (m.incomeChange.replace) {
        delInc.run(m.monthId);
        for (const inc of m.incomeChange.after) {
          insInc.run(crypto.randomUUID(), m.monthId, inc.label, inc.amount, inc.kind, inc.sortOrder);
        }
      }
      if (m.saveChanged) updSave.run(m.saveAfter, m.monthId);
    }
    if (plan.settingsChange.changed) {
      updSetting.run(plan.settingsChange.key, String(plan.settingsChange.after));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Mirror of bank-store.ts computeBankSpend: joint-only signed net per
// category for the ATTRIBUTED month (budget_month), counted=1 rows only,
// negative nets clamped to 0. Keep in sync with bankSpentByCategory.
export function computeBankSpentMap(db, year, month) {
  const raw = db.prepare('SELECT value FROM bank_settings WHERE key = ?').get(JOINT_ACCOUNT_UIDS_KEY);
  let joint = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw.value);
      if (Array.isArray(parsed)) joint = parsed.filter((x) => typeof x === 'string' && x.length > 0);
    } catch {
      // corrupt setting — treat as unset
    }
  }
  if (joint.length === 0) {
    console.warn(
      '[repair] joint_account_uids not configured — bankSpent is empty (phase 2 treats all sheet spend as manual; set it in bank_settings to attribute bank spend)',
    );
    return {};
  }
  const placeholders = joint.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT category_id,
              SUM(CASE WHEN credit_debit = 'DBIT' THEN ABS(amount) ELSE -ABS(amount) END) AS net
       FROM bank_transactions
       WHERE counted = 1 AND category_id IS NOT NULL AND budget_month = ?
         AND account_uid IN (${placeholders})
       GROUP BY category_id`,
    )
    .all(ymOf(year, month), ...joint);
  const out = {};
  for (const r of rows) {
    const net = round2(r.net);
    out[r.category_id] = net < 0 ? 0 : net;
  }
  return out;
}

// Phase 2: manual spent per category = round2(max(0, sheet.spent - bank)).
// Computes rows for the report; writes only when `apply` (and only the
// rows whose value actually changes — keeps the second run at zero).
export function phase2ManualSpent(db, plan, apply) {
  const rows = [];
  const cur = db.prepare('SELECT spent FROM budget_categories WHERE id = ?');
  const upd = db.prepare('UPDATE budget_categories SET spent = ? WHERE id = ?');
  if (apply) db.exec('BEGIN');
  try {
    for (const m of plan.months) {
      const bank = computeBankSpentMap(db, m.year, m.month);
      const entries = [
        ...m.matched.map((x) => ({ id: x.id, canonical: x.canonical })),
        ...m.inserts.map((x) => ({ id: x.id, canonical: x.canonical })),
      ];
      for (const e of entries) {
        const bankSpent = round2(bank[e.id] ?? 0);
        const manual = round2(Math.max(0, e.canonical.spent - bankSpent));
        // Inserted rows don't exist yet in a dry-run — their "before" is 0.
        const row = cur.get(e.id);
        const before = row ? round2(row.spent) : 0;
        const changed = before !== manual;
        if (apply && changed) upd.run(manual, e.id);
        rows.push({
          ym: m.ym,
          categoryId: e.id,
          name: e.canonical.name,
          group: e.canonical.group,
          planned: e.canonical.planned,
          isNew: m.inserts.some((i) => i.id === e.id),
          isRenamed: m.matched.some((x) => x.id === e.id && x.renamed),
          bank: bankSpent,
          sheet: e.canonical.spent,
          manualBefore: before,
          manualAfter: manual,
          changed,
        });
      }
    }
    if (apply) db.exec('COMMIT');
  } catch (err) {
    if (apply) db.exec('ROLLBACK');
    throw err;
  }
  return rows;
}

// ----- step 7: the app's own categorization + attribution passes -----

// POST the running app's cron endpoint — the same runCategorization +
// runAttribution the daily sync cron runs after each sync (see
// src/app/api/banking/sync/route.ts and /api/banking/categorize/route.ts).
// Reusing the endpoint (instead of re-implementing) means zero logic drift.
export async function triggerRecompute(appUrl, secret) {
  const base = appUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/banking/categorize`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-cron-secret': secret } : {}),
    },
    body: '{}',
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body — reported below
  }
  if (!res.ok || !json || json.ok !== true) {
    throw new Error(`categorize endpoint failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return json;
}

// ----- report -----

function reportLines({ mode, dbPath, sheetPath, backupPath, plan, phase2, recomputeNote, changes }) {
  const lines = [];
  lines.push(`db=${dbPath}`);
  lines.push(`sheet=${sheetPath}`);
  lines.push(`mode=${mode}`);
  if (backupPath) lines.push(`backup: ${backupPath}`);
  lines.push('----------------------------------------------------------------');
  const phase2ByMonth = new Map();
  for (const r of phase2) {
    if (!phase2ByMonth.has(r.ym)) phase2ByMonth.set(r.ym, []);
    phase2ByMonth.get(r.ym).push(r);
  }
  for (const m of plan.months) {
    const updated = m.matched.filter((x) => x.changed).length;
    const renamed = m.matched.filter((x) => x.renamed).length;
    const orphanTxCount = m.orphans.reduce((s, o) => s + o.txs.length, 0);
    lines.push(`${m.ym} (month id ${m.monthId}):`);
    lines.push(
      `  categories: ${m.matched.length} matched (${updated} updated${renamed > 0 ? `, ${renamed} renamed (id kept)` : ''}), ${m.inserts.length} inserted, ${m.orphans.length} orphan(s) deleted`,
    );
    for (const o of m.orphans) {
      lines.push(`  orphan deleted: "${o.name}" (${o.group}, planned ${fmt(o.planned)}, spent ${fmt(o.spent)})`);
    }
    if (orphanTxCount > 0) {
      lines.push(`  orphan tx returned to review queue (${orphanTxCount}):`);
      for (const o of m.orphans) {
        for (const t of o.txs) {
          lines.push(`    - id=${t.id} ${t.booking_date ?? '?'} ${fmt(t.amount)} "${t.description}"`);
        }
      }
    }
    if (m.incomeChange.replace) {
      lines.push(
        `  incomes: REPLACED ${m.incomeChange.before.length} -> ${m.incomeChange.after.length} (${m.incomeChange.after.map((i) => `${i.label} ${fmt(i.amount)}`).join(', ')})`,
      );
    } else {
      lines.push('  incomes: unchanged (already canonical)');
    }
    lines.push(`  save: ${fmt(m.saveBefore)} -> ${fmt(m.saveAfter)}${m.saveChanged ? '' : ' (no change)'}`);
    const rows = phase2ByMonth.get(m.ym) ?? [];
    if (rows.length > 0) {
      lines.push('  # name                                 group      planned  spent before->after    bank     sheet    manual');
      for (const r of rows) {
        const tag = r.isNew ? ' (new)' : r.isRenamed ? ' (renamed)' : '';
        lines.push(
          `    ${(r.name + tag).padEnd(38)}${r.group.padEnd(10)}${fmt(r.planned).padStart(8)}` +
            `${`${fmt(r.manualBefore)} -> ${fmt(r.manualAfter)}`.padStart(20)}` +
            `${fmt(r.bank).padStart(9)}${fmt(r.sheet).padStart(9)}${fmt(r.manualAfter).padStart(9)}`,
        );
      }
    }
  }
  lines.push('----------------------------------------------------------------');
  const sc = plan.settingsChange;
  lines.push(
    `settings: ${sc.key} ${sc.before === null ? 'unset' : fmt(sc.before)} -> ${fmt(sc.after)}${sc.changed ? '' : ' (no change)'}`,
  );
  lines.push(`recompute: ${recomputeNote}`);
  lines.push(`changes: ${changes}`);
  lines.push('NOTES:');
  for (const n of NOTES) lines.push(`  ${n}`);
  return lines;
}

// ----- CLI -----

function parseArgs(argv) {
  const opts = {
    db: null,
    sheet: null,
    apply: false,
    skipRecompute: false,
    appUrl: 'http://127.0.0.1:3000',
    cronSecret: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') opts.db = argv[++i];
    else if (a === '--sheet') opts.sheet = argv[++i];
    else if (a === '--apply') opts.apply = true;
    else if (a === '--skip-recompute') opts.skipRecompute = true;
    else if (a === '--app-url') opts.appUrl = argv[++i];
    else if (a === '--cron-secret') opts.cronSecret = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
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

function requireTables(db) {
  const need = ['budget_months', 'budget_categories', 'budget_incomes', 'budget_settings', 'bank_transactions'];
  const have = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name),
  );
  const missing = need.filter((t) => !have.has(t));
  if (missing.length > 0) {
    throw new Error(`db is missing required table(s): ${missing.join(', ')} (is this an app database?)`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('See the header comment of scripts/repair-budget-from-sheet.mjs for usage.');
    return;
  }
  const dbPath = resolveDbPath(opts.db);
  const sheetPath = opts.sheet ?? DEFAULT_SHEET;

  let sheet;
  try {
    sheet = JSON.parse(fs.readFileSync(sheetPath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read canonical sheet ${sheetPath}: ${err.message}`);
  }
  const invalid = validateCanonical(sheet);
  if (invalid) throw new Error(invalid);

  // Dry-run opens READ-ONLY (review F2): a wrong --db path can't create a
  // stray empty file. A read-only open of a DB with a hot WAL may throw —
  // dry-run against a live WAL DB should use a checkpointed copy (header).
  const db = opts.apply ? new DatabaseSync(dbPath) : new DatabaseSync(dbPath, { readOnly: true });
  // Play nice with the live app's connection on the same WAL DB.
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  requireTables(db);

  const mode = opts.apply ? `APPLY${opts.skipRecompute ? ' (recompute SKIPPED)' : ''}` : 'DRY-RUN (no writes)';
  const secret = opts.cronSecret ?? process.env.INTERNAL_API_SECRET ?? null;

  // DRY-RUN: plan + phase-2 estimates against the current attribution state.
  if (!opts.apply) {
    const plan = planRepair(db, sheet);
    const phase2 = phase2ManualSpent(db, plan, false);
    const changes = countChanges(plan, phase2);
    const lines = reportLines({
      mode,
      dbPath,
      sheetPath,
      backupPath: null,
      plan,
      phase2,
      recomputeNote: 'not run (dry-run) — bank figures reflect the CURRENT attribution state',
      changes,
    });
    for (const l of lines) console.log(`[repair] ${l}`);
    db.close();
    return;
  }

  // APPLY: steps 1-6, then the app's recompute, then phase 2.
  const plan = planRepair(db, sheet);
  // Self-backup (review F1): consistent snapshot BEFORE any structural
  // write, outside any transaction (VACUUM INTO can't run inside one).
  // Failure throws here — nothing has been written yet.
  const backupPath = vacuumIntoBackup(db, dbPath);
  applyStructural(db, plan);
  console.log(`[repair] structural writes applied (steps 1-6) for ${plan.months.length} month(s)`);

  if (!opts.skipRecompute) {
    let recompute;
    try {
      recompute = await triggerRecompute(opts.appUrl, secret);
    } catch (err) {
      const lines = reportLines({
        mode: `${mode} — INCOMPLETE`,
        dbPath,
        sheetPath,
        backupPath,
        plan,
        phase2: [],
        recomputeNote: `FAILED: ${err.message} — phase 2 (manual spent) NOT written; fix the app and re-run --apply (idempotent)`,
        changes: countChanges(plan, null),
      });
      for (const l of lines) console.log(`[repair] ${l}`);
      db.close();
      throw err;
    }
    console.log(
      `[repair] recompute ok: months=${recompute.months} assigned=${recompute.assigned} needsReview=${recompute.needsReview} attributedMoves=${recompute.attributedMoves}`,
    );
  } else {
    console.log(
      '[repair] --skip-recompute: phase 2 uses the CURRENT attribution state (no categorize/attribution pass ran)',
    );
  }

  const phase2 = phase2ManualSpent(db, plan, true);
  const changes = countChanges(plan, phase2);
  const lines = reportLines({
    mode,
    dbPath,
    sheetPath,
    backupPath,
    plan,
    phase2,
    recomputeNote: opts.skipRecompute
      ? 'SKIPPED (--skip-recompute) — phase 2 used the current attribution state'
      : `POST ${opts.appUrl.replace(/\/+$/, '')}/api/banking/categorize (runCategorization + runAttribution, same pass as the daily sync cron)`,
    changes,
  });
  for (const l of lines) console.log(`[repair] ${l}`);
  db.close();
}

const invokedAsScript =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  main().catch((err) => {
    console.error(`[repair] ERROR: ${err.message}`);
    process.exit(1);
  });
}
