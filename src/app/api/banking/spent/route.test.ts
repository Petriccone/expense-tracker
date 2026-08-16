// Route-level tests for GET /api/banking/spent — param validation. Guards
// against the item-6 bug where a missing `year`/`month` query param
// (Number(null) === 0, and Number.isInteger(0) is true) silently passed
// through as year=0/month=0 instead of 400ing. See
// docs/2026-08-15-agent-and-bank-automation-design.md (wave 2b).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET } from './route';

describe('GET /api/banking/spent — param validation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banking-spent-route-test-'));

  beforeAll(() => {
    process.env.PETRICCO_DATA_DIR = tmpDir;
  });

  afterAll(() => {
    delete process.env.PETRICCO_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('400s when year is missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/banking/spent?month=8'));
    expect(res.status).toBe(400);
  });

  it('400s when month is missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/banking/spent?year=2026'));
    expect(res.status).toBe(400);
  });

  it('400s when both are missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/banking/spent'));
    expect(res.status).toBe(400);
  });

  it('400s for a non-numeric month', async () => {
    const res = await GET(new NextRequest('http://localhost/api/banking/spent?year=2026&month=x'));
    expect(res.status).toBe(400);
  });

  it('200s for a valid year/month', async () => {
    const res = await GET(new NextRequest('http://localhost/api/banking/spent?year=2026&month=8'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});
