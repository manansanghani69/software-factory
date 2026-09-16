import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readRunTable } from '../src/run-table.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = join(repoRoot, 'src', 'cli.ts')
const fakeGh = join(repoRoot, 'tests', 'fixtures', 'fake-gh.mjs')

interface FakeIssue {
  number: number
  id: number
  title: string
  body: string
  repo: string
  labels: string[]
  url: string
  comments: Array<{ body: string }>
  assignees: string[]
  blockedBy: number[]
  closed: boolean
}

interface GhState {
  issues: FakeIssue[]
  prs: Array<{ number: number; title: string; body: string; repo: string; head: string; base: string; state: string; url: string }>
  nextNumber: number
  nextPrNumber: number
  repos: unknown[]
  labels: Array<{ name: string; repo: string; color: string; description: string }>
}

const PRODUCT_REGISTRATION = {
  name: 'my-app',
  repo: 'acme-dev/widget',
  stack: { framework: 'node', database: 'none', orm: 'none', deploy: 'manual' },
  line: { stage: null, currentTicket: null },
  createdAt: '2026-09-16',
}

function initGitRepo(dir: string, remoteUrl: string): void {
  spawnSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  spawnSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
}

function commitAll(dir: string): void {
  spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  spawnSync('git', ['commit', '-m', 'init'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
}

function createSandbox(options: { failing?: boolean; priorFailureReports?: number } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'factory-review-'))
  const factoryRoot = join(ws, 'factory')
  const productRoot = join(ws, 'my-app')
  const remote = join(ws, 'widget-remote.git')
  mkdirSync(join(factoryRoot, '.factory', 'state'), { recursive: true })
  mkdirSync(join(productRoot, '.factory', 'state'), { recursive: true })
  mkdirSync(remote, { recursive: true })
  spawnSync('git', ['init', '--bare', '-b', 'main'], { cwd: remote, encoding: 'utf-8', stdio: 'pipe' })

  writeFileSync(join(factoryRoot, '.factory', 'config.json'), '{}')
  writeFileSync(join(productRoot, '.factory', 'state', 'product.json'), JSON.stringify(PRODUCT_REGISTRATION))
  writeFileSync(
    join(productRoot, 'package.json'),
    JSON.stringify({
      type: 'module',
      scripts: {
        typecheck: 'node -e "process.exit(0)"',
        lint: 'node -e "process.exit(0)"',
        build: 'node -e "process.exit(0)"',
        test: options.failing ? 'node -e "console.error(\'boom\'); process.exit(1)"' : 'node -e "process.exit(0)"',
      },
    }),
  )
  initGitRepo(productRoot, remote)
  commitAll(productRoot)

  const prior = Array.from({ length: options.priorFailureReports ?? 0 }, (_, index) => ({
    body: ['## Review-bar report', '', '**Outcome:** revise', `**Round:** ${index + 1}`, '', '```text', 'old failure', '```'].join('\n'),
  }))
  const lineIssue: FakeIssue = {
    number: 1,
    id: 1000001,
    title: 'Idea: widget',
    body: 'Line issue',
    repo: 'acme-dev/widget',
    labels: ['idea'],
    url: 'https://github.com/acme-dev/widget/issues/1',
    comments: prior,
    assignees: [],
    blockedBy: [],
    closed: false,
  }
  const ticket: FakeIssue = {
    number: 2,
    id: 1000002,
    title: 'Fix the bar',
    body: 'Part of #1.\n\n## What to build\n\nFix the red bar.\n\n## Acceptance criteria\n\n- [ ] The review bar is green',
    repo: 'acme-dev/widget',
    labels: ['ready-for-agent'],
    url: 'https://github.com/acme-dev/widget/issues/2',
    comments: [],
    assignees: [],
    blockedBy: [],
    closed: false,
  }
  const ghStatePath = join(ws, 'gh-state.json')
  writeFileSync(
    ghStatePath,
    JSON.stringify({ issues: [lineIssue, ticket], prs: [], nextNumber: 3, nextPrNumber: 1, repos: [], labels: [] }),
  )

  const dbPath = join(factoryRoot, '.factory', 'state', 'workflows.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE factory_runs (
    run_id TEXT PRIMARY KEY, product TEXT NOT NULL, workflow_name TEXT NOT NULL, stage TEXT NOT NULL,
    suspension TEXT, issue_number INTEGER, fork_pick INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.prepare(
    `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
     VALUES ('r1', 'my-app', 'my-app-line', 'review', NULL, 1, '2026-09-15T00:00:00Z', '2026-09-16T00:00:00Z')`,
  ).run()
  db.close()

  const env = {
    ...process.env,
    FACTORY_STUB: '1',
    FACTORY_GH_BIN: fakeGh,
    FACTORY_GH_OWNER: 'acme-dev',
    FAKE_GH_OWNER: 'acme-dev',
    FAKE_GH_STATE: ghStatePath,
  }
  return { ws, factoryRoot, ghStatePath, dbPath, env, clean: () => rmSync(ws, { recursive: true, force: true }) }
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], { cwd, env, encoding: 'utf-8' })
  return { stdout: result.stdout, stderr: result.stderr, status: result.status }
}

function readState(path: string): GhState {
  return JSON.parse(readFileSync(path, 'utf-8')) as GhState
}

test('a green checkout yields a green review-bar report', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const result = runCli(['review', 'my-app'], factoryRoot, env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /outcome: green/)
    assert.match(result.stdout, /typecheck=green, lint=green, build=green, test=green/)

    const state = readState(ghStatePath)
    assert.ok(state.labels.some((label) => label.name === 'review-bar-green'))
    const lineIssue = state.issues.find((issue) => issue.number === 1)
    assert.ok(lineIssue)
    assert.ok(lineIssue.labels.includes('review-bar-green'))
    const report = lineIssue.comments.find((comment) => comment.body.includes('## Review-bar report'))
    assert.ok(report)
    assert.match(report.body, /\*\*Outcome:\*\* green/)
    const reviewer = lineIssue.comments.find((comment) => comment.body.includes('## Reviewer report'))
    assert.ok(reviewer, 'the independent reviewer posted a report')
    assert.match(reviewer.body, /\*\*Advice:\*\* advance/)
    assert.match(reviewer.body, /\*\*Coverage:\*\* pass/)
    assert.match(reviewer.body, /\*\*Scope:\*\* pass/)
    assert.match(reviewer.body, /\*\*Standards:\*\* pass/)
    assert.match(reviewer.body, /\*\*Tests:\*\* pass/)
    assert.match(reviewer.body, /### Judgment/)
    assert.match(reviewer.body, /advice only/)

    const run = readRunTable(dbPath)[0]!
    assert.equal(run.stage, 'review')
    assert.equal(run.suspension, 'review-gate')
  } finally {
    clean()
  }
})

test('a red checkout auto-revises by re-running implementation without the Operator', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox({ failing: true })
  try {
    const result = runCli(['review', 'my-app'], factoryRoot, env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /outcome: revise/)

    const state = readState(ghStatePath)
    assert.equal(state.prs.length, 1, 'implementation re-run opened a PR')
    const lineIssue = state.issues.find((issue) => issue.number === 1)
    assert.ok(lineIssue)
    assert.ok(lineIssue.comments.some((comment) => comment.body.includes('**Outcome:** revise')))
    assert.ok(lineIssue.comments.some((comment) => comment.body.includes('## Stage report — implementation')))
    assert.equal(
      lineIssue.comments.some((comment) => comment.body.includes('## Reviewer report')),
      false,
      'a red bar auto-revises without waiting on the reviewer',
    )

    const run = readRunTable(dbPath)[0]!
    assert.equal(run.stage, 'implementation')
    assert.equal(run.suspension, null)
  } finally {
    clean()
  }
})

test('two consecutive failed revise rounds make the third auto-halt with evidence on the Tracker', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox({ failing: true, priorFailureReports: 2 })
  try {
    const result = runCli(['review', 'my-app'], factoryRoot, env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /outcome: halt/)
    assert.match(result.stdout, /round: 3/)

    const state = readState(ghStatePath)
    assert.equal(state.prs.length, 0, 'halt does not start another implementation loop')
    assert.ok(state.labels.some((label) => label.name === 'review-bar-halted'))
    const lineIssue = state.issues.find((issue) => issue.number === 1)
    assert.ok(lineIssue)
    assert.ok(lineIssue.labels.includes('review-bar-halted'))
    const reports = lineIssue.comments.filter((comment) => comment.body.includes('## Review-bar report'))
    assert.equal(reports.length, 3)
    assert.match(reports.at(-1)!.body, /\*\*Outcome:\*\* halt/)
    assert.match(reports.at(-1)!.body, /boom/)
    const reviewer = lineIssue.comments.find((comment) => comment.body.includes('## Reviewer report'))
    assert.ok(reviewer, 'halt includes the reviewer\'s evidence')
    assert.match(reviewer.body, /\*\*Advice:\*\* halt/)

    const run = readRunTable(dbPath)[0]!
    assert.equal(run.stage, 'review')
    assert.equal(run.suspension, 'review-gate')
  } finally {
    clean()
  }
})
