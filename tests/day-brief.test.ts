import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDayBrief, composeDayBrief, type DayBrief } from '../src/commands/day-brief.ts'
import type { StubResolution } from '../src/stub.ts'
import type { TrackerSnapshot } from '../src/tracker.ts'

const STUB_OFF: StubResolution = { enabled: false, source: 'off' }
const STUB_ON: StubResolution = { enabled: true, source: 'flag' }

const SEED = {
  repo: 'scratch/app',
  stack: { framework: 'next', database: 'sqlite', orm: 'drizzle', deploy: 'vercel-manual' },
  line: { stage: null, currentTicket: null },
  createdAt: '2026-09-16',
}

function layout(names: string[]): { factory: string; clean: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'factory-brief-'))
  const factory = join(root, 'software-factory')
  mkdirSync(join(factory, '.factory', 'state'), { recursive: true })
  writeFileSync(join(factory, '.factory', 'config.json'), '{}')
  for (const name of names) {
    mkdirSync(join(root, name, '.factory', 'state'), { recursive: true })
    writeFileSync(join(root, name, '.factory', 'state', 'product.json'), JSON.stringify({ ...SEED, name }))
  }
  return { factory, clean: () => rmSync(root, { recursive: true, force: true }) }
}

function seedRuns(factory: string, inserts: { product: string; stage: string; suspension: string | null }[]): void {
  const dbPath = join(factory, '.factory', 'state', 'workflows.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE IF NOT EXISTS factory_runs (
    run_id TEXT PRIMARY KEY, product TEXT NOT NULL, workflow_name TEXT NOT NULL, stage TEXT NOT NULL,
    suspension TEXT, issue_number INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  let i = 0
  for (const row of inserts) {
    i += 1
    const runId = `run-${i}`
    db.prepare(
      `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, row.product, `${row.product}-line`, row.stage, row.suspension, i, '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z')
  }
  db.close()
}

function briefLines(brief: DayBrief): string[] {
  return renderDayBrief(brief).split('\n')
}

test('the placeholder day brief renders with no discovered Products', () => {
  const { factory, clean } = layout([])
  try {
    const brief = composeDayBrief(factory, STUB_OFF)
    const lines = briefLines(brief)
    assert.equal(lines[0], 'FACTORY DAY BRIEF')
    assert.match(lines[1]!, /^ {2}Products: 0/)
    assert.ok(lines.some((line) => line.includes('No Products are registered yet')))
    assert.ok(lines.some((line) => line === '  stub mode: off'))
  } finally {
    clean()
  }
})

test('a registered scratch Product appears with a derived position in stub mode', () => {
  const { factory, clean } = layout(['my-app'])
  try {
    const brief = composeDayBrief(factory, STUB_ON)
    const lines = briefLines(brief)
    assert.match(lines[1]!, /^ {2}Products: 1/)
    assert.ok(lines.some((line) => line === '    my-app — ready — nothing in flight'))
  } finally {
    clean()
  }
})

test('a spec-gate suspension shows the Product at spec, awaiting a Disposition', () => {
  const { factory, clean } = layout(['my-app'])
  seedRuns(factory, [{ product: 'my-app', stage: 'spec', suspension: 'spec-gate' }])
  try {
    const brief = composeDayBrief(factory, STUB_ON)
    const lines = briefLines(brief)
    assert.ok(
      lines.some((line) => line.includes('my-app — spec — awaiting your Disposition at the spec gate')),
    )
  } finally {
    clean()
  }
})

test('a completed run that reached ship shows ship after the merge', () => {
  const { factory, clean } = layout(['my-app'])
  seedRuns(factory, [{ product: 'my-app', stage: 'ship', suspension: null }])
  try {
    const brief = composeDayBrief(factory, STUB_ON)
    assert.ok(briefLines(brief).some((line) => line.includes('my-app — ship — the Line is complete')))
  } finally {
    clean()
  }
})

test('open tracked tickets without a run place the Product at tickets (tracker-derived)', () => {
  const { factory, clean } = layout(['my-app'])
  try {
    const trackerRead = (): TrackerSnapshot => ({
      openIssues: [{ number: 4, title: 'Blocked ticket', labels: ['blocked'] }],
      openPrs: 0,
    })
    const brief = composeDayBrief(factory, STUB_OFF, { trackerRead })
    assert.ok(briefLines(brief).some((line) => line.includes('my-app — tickets — driving')))
  } finally {
    clean()
  }
})

test('an open PR without a run places the Product at implementation (tracker-derived)', () => {
  const { factory, clean } = layout(['my-app'])
  try {
    const trackerRead = (): TrackerSnapshot => ({ openIssues: [], openPrs: 2 })
    const brief = composeDayBrief(factory, STUB_OFF, { trackerRead })
    assert.ok(briefLines(brief).some((line) => line.includes('my-app — implementation — driving')))
  } finally {
    clean()
  }
})

test('an unreadable tracker surfaces a per-Product error instead of guessing a position', () => {
  const { factory, clean } = layout(['my-app'])
  try {
    const trackerRead = (): TrackerSnapshot => {
      throw new Error('gh not authenticated')
    }
    const brief = composeDayBrief(factory, STUB_OFF, { trackerRead })
    assert.ok(
      briefLines(brief).some((line) => line.includes('my-app — position unavailable') && line.includes('gh not authenticated')),
    )
  } finally {
    clean()
  }
})

test('stub mode never reads the tracker', () => {
  const { factory, clean } = layout(['my-app'])
  let reads = 0
  try {
    const trackerRead = (): TrackerSnapshot => {
      reads += 1
      return { openIssues: [], openPrs: 0 }
    }
    composeDayBrief(factory, STUB_ON, { trackerRead })
    assert.equal(reads, 0)
  } finally {
    clean()
  }
})