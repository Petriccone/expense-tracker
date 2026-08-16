// Round-trips TrueLayer token encryption through the real src/lib/db.ts
// code path (saveConnection -> raw SQLite row -> getConnection) so we're
// verifying the actual implementation, not a re-implementation of it.
//
// Runs three isolated node subprocesses (fresh module/env state each time):
//   1. key set                -> row is encrypted, decrypt round-trips
//   2. no key, dev            -> falls back to plaintext, warns once
//   3. no key, NODE_ENV=prod  -> saveConnection throws (hard error)
//
// Usage: node scripts/check-token-encryption.mjs

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);

const WORKER_SRC = `
import { saveConnection, getConnection, getDb } from '${pathToDbTs()}';

const PLAIN_ACCESS = 'access-token-secret-value';
const PLAIN_REFRESH = 'refresh-token-secret-value';

async function main() {
  const mode = process.env.CHECK_MODE;

  if (mode === 'hard-error-prod') {
    try {
      saveConnection({
        user_id: 'default',
        provider_id: 'uk-cs-mock',
        access_token: PLAIN_ACCESS,
        refresh_token: PLAIN_REFRESH,
        expires_at: Date.now() + 3600_000,
      });
      console.log('FAIL: expected saveConnection to throw with no key set in production');
      process.exit(1);
    } catch (err) {
      console.log('OK: saveConnection threw in production without a key:', err.message);
      process.exit(0);
    }
  }

  // key-set and no-key-dev modes both round-trip.
  saveConnection({
    user_id: 'default',
    provider_id: 'uk-cs-mock',
    access_token: PLAIN_ACCESS,
    refresh_token: PLAIN_REFRESH,
    expires_at: Date.now() + 3600_000,
  });

  const db = getDb();
  const raw = db.prepare(
    'SELECT access_token, refresh_token FROM truelayer_connections WHERE user_id = ? AND provider_id = ?'
  ).get('default', 'uk-cs-mock');

  if (mode === 'key-set') {
    if (raw.access_token === PLAIN_ACCESS || raw.refresh_token === PLAIN_REFRESH) {
      console.log('FAIL: raw SQLite row still holds a plaintext token');
      process.exit(1);
    }
    if (raw.access_token.split(':').length !== 3) {
      console.log('FAIL: stored access_token is not in iv:tag:ciphertext form');
      process.exit(1);
    }
  }

  if (mode === 'no-key-dev') {
    if (raw.access_token !== PLAIN_ACCESS) {
      console.log('FAIL: dev fallback (no key) should store plaintext as-is');
      process.exit(1);
    }
  }

  const conn = getConnection('default', 'uk-cs-mock');
  if (conn.access_token !== PLAIN_ACCESS || conn.refresh_token !== PLAIN_REFRESH) {
    console.log('FAIL: decrypted round-trip did not match original tokens');
    process.exit(1);
  }

  console.log('OK: round-trip matched (mode=' + mode + ')');
  process.exit(0);
}

main();
`;

function pathToDbTs() {
  const repoRoot = path.resolve(path.dirname(__filename), '..');
  return path.join(repoRoot, 'src', 'lib', 'db.ts').split(path.sep).join('/');
}

function runWorker(mode, extraEnv) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'tl-enc-check-'));
  const workerFile = path.join(tmpDir, 'worker.mjs');
  writeFileSync(workerFile, WORKER_SRC);
  try {
    const out = execFileSync(process.execPath, [workerFile], {
      env: {
        ...process.env,
        CHECK_MODE: mode,
        PETRICCO_DATA_DIR: tmpDir,
        ...extraEnv,
      },
      encoding: 'utf8',
    });
    process.stdout.write(out);
    return true;
  } catch (err) {
    process.stdout.write((err.stdout || '') + (err.stderr || ''));
    return false;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

import crypto from 'node:crypto';

const key = crypto.randomBytes(32).toString('base64');

const results = [
  runWorker('key-set', { TRUELAYER_TOKEN_ENC_KEY: key, NODE_ENV: 'development' }),
  runWorker('no-key-dev', { TRUELAYER_TOKEN_ENC_KEY: '', NODE_ENV: 'development' }),
  runWorker('hard-error-prod', { TRUELAYER_TOKEN_ENC_KEY: '', NODE_ENV: 'production' }),
];

if (results.every(Boolean)) {
  console.log('\nAll token encryption checks passed.');
  process.exit(0);
} else {
  console.log('\nToken encryption checks FAILED.');
  process.exit(1);
}
