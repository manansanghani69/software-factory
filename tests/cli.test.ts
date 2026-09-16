import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = join(repoRoot, 'src', 'cli.ts')

function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): {
  stdout: string
  stderr: string
  status: number | null
} {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, FACTORY_STUB: '', ...options.env },
    encoding: 'utf-8',
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  }
}

function scratchLayout(): { factory: string; clean: () => void } {
  const root = mkdtempSync(join(process.env.TEMP ?? 'C:\\', 'factory-cli-'))
  const factory = join(root, 'software-factory')
  mkdirSync(join(factory, '.factory', 'state'), { recursive: true })
  writeFileSync(join(factory, '.factory', 'config.json'), '{}')
  const product = join(root, 'my-app')
  mkdirSync(join(product, '.factory', 'state'), { recursive: true })
  writeFileSync(
    join(product, '.factory', 'state', 'product.json'),
    JSON.stringify({
      name: 'my-app',
      repo: 'scratch/app',
      stack: { framework: 'next', database: 'sqlite', orm: 'drizzle', deploy: 'vercel-manual' },
      line: { stage: null, currentTicket: null },
      createdAt: '2026-09-16',
    }),
  )
  return { factory, clean: () => rmSync(root, { recursive: true, force: true }) }
}

function seedSpecGateRun(factory: string): void {
  const db = new DatabaseSync(join(factory, '.factory', 'state', 'workflows.db'))
  db.exec(`CREATE TABLE IF NOT EXISTS factory_runs (
    run_id TEXT PRIMARY KEY, product TEXT NOT NULL, workflow_name TEXT NOT NULL, stage TEXT NOT NULL,
    suspension TEXT, issue_number INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.prepare(
    `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
     VALUES ('r1', 'my-app', 'my-app-line', 'spec', 'spec-gate', 12, '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z')`,
  ).run()
  db.close()
}

test('factory state prints the local state layout', () => {
  const { stdout, stderr, status } = runCli(['state'])

  assert.equal(status, 0, stderr)
  assert.match(stdout, /FACTORY STATE/)
  assert.match(stdout, /root:/)
  assert.match(stdout, /\.factory[\\/]config\.json/)
  assert.match(stdout, /\.factory[\\/]state[\\/]/)
  assert.match(stdout, /workflows\.db/)
  assert.match(stdout, /stub mode: off/)
  assert.match(stdout, /default model: anthropic\/claude-sonnet-4-6/)
})

test('bare factory prints a day-brief placeholder', () => {
  const { stdout, stderr, status } = runCli([])

  assert.equal(status, 0, stderr)
  assert.match(stdout, /FACTORY DAY BRIEF/)
  assert.match(stdout, /stub mode: off/)
})

test('--stub flag turns stub mode on everywhere', () => {
  const { stdout, status } = runCli(['state', '--stub'])

  assert.equal(status, 0)
  assert.match(stdout, /stub mode: on \(via --stub\)/)
})

test('FACTORY_STUB env var turns stub mode on everywhere', () => {
  const { stdout, status } = runCli(['state',], { env: { FACTORY_STUB: '1' } })

  assert.equal(status, 0)
  assert.match(stdout, /stub mode: on \(via FACTORY_STUB\)/)
})

test('factory fails cleanly outside a Factory repository', () => {
  const { stderr, status } = runCli(['state'], { cwd: process.env.TEMP ?? 'C:\\' })

  assert.notEqual(status, 0)
  assert.match(stderr, /not inside a Factory repository/)
})

test('bare factory also fails cleanly outside a Factory repository', () => {
  const { stderr, status } = runCli([], { cwd: process.env.TEMP ?? 'C:\\' })

  assert.notEqual(status, 0)
  assert.match(stderr, /not inside a Factory repository/)
})

test('factory state resolves FACTORY_MODEL_<STAGE> env overrides', () => {
  const { stdout, status } = runCli(['state'], { env: { FACTORY_MODEL_REVIEW: 'openrouter/deepseek' } })

  assert.equal(status, 0)
  assert.match(stdout, /review: openrouter\/deepseek/)
  assert.match(stdout, /sharpening: anthropic\/claude-sonnet-4-6/)
})

test('factory --help lists the state command', () => {
  const { stdout, status } = runCli(['--help'])

  assert.equal(status, 0)
  assert.match(stdout, /state/)
})

test('the day brief shows a registered scratch Product with its derived position', () => {
  const { factory, clean } = scratchLayout()
  try {
    const { stdout, status } = runCli(['--stub'], { cwd: factory })
    assert.equal(status, 0)
    assert.match(stdout, /FACTORY DAY BRIEF/)
    assert.match(stdout, /Products: 1/)
    assert.match(stdout, /my-app — ready — nothing in flight/)
  } finally {
    clean()
  }
})

test('the day brief shows a Product suspended at the spec gate awaiting a Disposition', () => {
  const { factory, clean } = scratchLayout()
  seedSpecGateRun(factory)
  try {
    const { stdout, status } = runCli(['--stub'], { cwd: factory })
    assert.equal(status, 0)
    assert.match(stdout, /my-app — spec — awaiting your Disposition at the spec gate/)
  } finally {
    clean()
  }
})

test('factory state lists registrations and the run table without reading JSON by hand', () => {
  const { factory, clean } = scratchLayout()
  seedSpecGateRun(factory)
  try {
    const { stdout, status } = runCli(['state'], { cwd: factory })
    assert.equal(status, 0)
    assert.match(stdout, /registrations \(discovered Products\):/)
    assert.match(stdout, /my-app — next\/sqlite\/drizzle/)
    assert.match(stdout, /line mirror \(not authoritative\): null/)
    assert.match(stdout, /run table \(workflows\.db\): 1 run/)
    assert.match(stdout, /my-app: run r1 — stage=spec — spec-gate/)
  } finally {
    clean()
  }
})