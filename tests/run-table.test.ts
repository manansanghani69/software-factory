import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RunTableError, forkRun, latestRunForProduct, readRunTable, resumeRunAlongPick, updateRunSuspension, type RunRecord } from '../src/run-table.ts'

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
      fork_pick INTEGER,
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
      forkPick: null,
      updatedAt: '2026-09-11T00:00:00Z',
    })
    assert.deepEqual(runs[1], {
      runId: 'r-spec',
      product: 'my-app',
      workflowName: 'my-app-line',
      stage: 'spec',
      suspension: 'spec-gate',
      issueNumber: 12,
      forkPick: null,
      updatedAt: '2026-09-15T00:00:00Z',
    })
  } finally {
    db.close()
    clean()
  }
})

test('updateRunSuspension suspends a running run at a fork and resumes it again', () => {
  const { dbPath, clean, db } = tempDb()
  try {
    db.prepare(
      `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
       VALUES ('r-impl', 'my-app', 'my-app-line', 'implementation', NULL, 21, '2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z')`,
    ).run()

    updateRunSuspension(dbPath, 'r-impl', 'fork')
    const afterFork = readRunTable(dbPath)[0]!
    assert.equal(afterFork.suspension, 'fork')

    updateRunSuspension(dbPath, 'r-impl', null)
    const afterPick = readRunTable(dbPath)[0]!
    assert.equal(afterPick.suspension, null)
    assert.equal(afterPick.stage, 'implementation')
  } finally {
    db.close()
    clean()
  }
})

test('updateRunSuspension cannot resume a run that was never suspended', () => {
  const { dbPath, clean, db } = tempDb()
  try {
    db.prepare(
      `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
       VALUES ('r-impl', 'my-app', 'my-app-line', 'implementation', NULL, 21, '2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z')`,
    ).run()
    assert.throws(() => updateRunSuspension(dbPath, 'r-missing', 'fork'), RunTableError)
  } finally {
    db.close()
    clean()
  }
})

test('updateRunSuspension fails loud when no workflows database exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-runs-'))
  try {
    assert.throws(() => updateRunSuspension(join(dir, 'workflows.db'), 'r-impl', 'fork'), RunTableError)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateRunSuspension fails loud when the run table has not been written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-runs-'))
  const dbPath = join(dir, 'workflows.db')
  const db = new DatabaseSync(dbPath)
  db.close()
  try {
    assert.throws(() => updateRunSuspension(dbPath, 'r-impl', 'fork'), RunTableError)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('latestRunForProduct returns the most recently updated run for a Product, else null', () => {
  const runs: RunRecord[] = [
    {
      runId: 'r-old',
      product: 'my-app',
      workflowName: 'my-app-line',
      stage: 'ship',
      suspension: null,
      issueNumber: 7,
      forkPick: null,
      updatedAt: '2026-09-10T00:00:00Z',
    },
    {
      runId: 'r-spec',
      product: 'my-app',
      workflowName: 'my-app-line',
      stage: 'spec',
      suspension: 'spec-gate',
      issueNumber: 12,
      forkPick: null,
      updatedAt: '2026-09-15T00:00:00Z',
    },
    {
      runId: 'r-other',
      product: 'notes',
      workflowName: 'notes-line',
      stage: 'review',
      suspension: null,
      issueNumber: 9,
      forkPick: null,
      updatedAt: '2026-09-16T00:00:00Z',
    },
  ]
  assert.equal(latestRunForProduct(runs, 'my-app')?.runId, 'r-spec')
  assert.equal(latestRunForProduct(runs, 'notes')?.runId, 'r-other')
  assert.equal(latestRunForProduct(runs, 'nobody'), null)
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

test('resumeRunAlongPick clears the fork suspension and records the picked option', () => {
  const { dbPath, clean, db } = tempDb()
  try {
    db.prepare(
      `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
       VALUES ('r-impl', 'my-app', 'my-app-line', 'implementation', 'fork', 21, '2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z')`,
    ).run()

    resumeRunAlongPick(dbPath, 'r-impl', 2)
    const afterPick = readRunTable(dbPath)[0]!
    assert.equal(afterPick.suspension, null)
    assert.equal(afterPick.forkPick, 2)

    forkRun(dbPath, 'r-impl', '2026-09-16T00:00:00Z')
    const afterFork = readRunTable(dbPath)[0]!
    assert.equal(afterFork.suspension, 'fork')
    assert.equal(afterFork.forkPick, null)
  } finally {
    db.close()
    clean()
  }
})

test('resumeRunAlongPick adds the fork_pick column to a legacy run table', () => {
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
  db.prepare(
    `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
     VALUES ('r-impl', 'my-app', 'my-app-line', 'implementation', 'fork', 21, '2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z')`,
  ).run()
  try {
    assert.equal(readRunTable(dbPath)[0]!.forkPick, null)
    resumeRunAlongPick(dbPath, 'r-impl', 3)
    const afterPick = readRunTable(dbPath)[0]!
    assert.equal(afterPick.suspension, null)
    assert.equal(afterPick.forkPick, 3)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('forkRun and resumeRunAlongPick fail loud for an unknown run', () => {
  const { dbPath, clean, db } = tempDb()
  try {
    assert.throws(() => forkRun(dbPath, 'r-missing'), RunTableError)
    assert.throws(() => resumeRunAlongPick(dbPath, 'r-missing', 1), RunTableError)
  } finally {
    db.close()
    clean()
  }
})