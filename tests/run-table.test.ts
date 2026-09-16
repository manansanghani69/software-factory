import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RunTableError, readRunTable } from '../src/run-table.ts'

function tempDb(): { dbPath: string; clean: () => void; db: DatabaseSync } {
  const dir = mkdtempSync(join(tmpdir(), 'factory-runs-'))
  const dbPath = join(dir, 'workflows.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS factory_runs (
      run_id TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      stage TEXT NOT NULL,
      suspension TEXT,
      issue_number INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  return { dbPath, clean: () => rmSync(dir, { recursive: true, force: true }), db }
}

test('readRunTable returns no runs when the database file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-runs-'))
  try {
    assert.deepEqual(readRunTable(join(dir, 'workflows.db')), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readRunTable returns no runs when the run table has not been written yet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-runs-'))
  const dbPath = join(dir, 'workflows.db')
  const db = new DatabaseSync(dbPath)
  db.close()
  try {
    assert.deepEqual(readRunTable(dbPath), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readRunTable reads the live run’s suspension point from the envelope', () => {
  const { dbPath, clean, db } = tempDb()
  try {
    db.prepare(
      `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
       VALUES ('r-spec', 'my-app', 'my-app-line', 'spec', 'spec-gate', 12, '2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z')`,
    ).run()
    db.prepare(
      `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
       VALUES ('r-ship', 'notes', 'notes-line', 'ship', NULL, 7, '2026-09-10T00:00:00Z', '2026-09-11T00:00:00Z')`,
    ).run()

    const runs = readRunTable(dbPath)
    assert.equal(runs.length, 2)
    assert.deepEqual(runs[0], {
      runId: 'r-ship',
      product: 'notes',
      workflowName: 'notes-line',
      stage: 'ship',
      suspension: null,
      issueNumber: 7,
      updatedAt: '2026-09-11T00:00:00Z',
    })
    assert.deepEqual(runs[1], {
      runId: 'r-spec',
      product: 'my-app',
      workflowName: 'my-app-line',
      stage: 'spec',
      suspension: 'spec-gate',
      issueNumber: 12,
      updatedAt: '2026-09-15T00:00:00Z',
    })
  } finally {
    db.close()
    clean()
  }
})

test('readRunTable fails loud on a run row with an unknown stage', () => {
  const { dbPath, clean, db } = tempDb()
  try {
    db.prepare(
      `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, created_at, updated_at)
       VALUES ('r-bad', 'my-app', 'my-app-line', 'banana', NULL, '2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z')`,
    ).run()
    assert.throws(() => readRunTable(dbPath), RunTableError)
  } finally {
    db.close()
    clean()
  }
})