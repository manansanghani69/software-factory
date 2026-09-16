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

interface FakePr {
  number: number
  id: number
  title: string
  body: string
  repo: string
  head: string
  base: string
  state: string
  url: string
}

interface GhState {
  issues: FakeIssue[]
  prs: FakePr[]
  nextNumber: number
  nextPrNumber: number
  repos: unknown[]
  labels: Array<{ name: string; repo: string; color: string; description: string }>
}

const PRODUCT_REGISTRATION = {
  name: 'my-app',
  repo: 'acme-dev/widget',
  stack: { framework: 'next', database: 'none', orm: 'none', deploy: 'manual' },
  line: { stage: null, currentTicket: null },
  createdAt: '2026-09-16',
}

const ACCEPTED_SPEC = [
  '# Widget',
  '',
  'An accepted spec for a widget maker.',
  '',
  '## Problem Statement',
  '',
  'People need widgets.',
  '',
  '## Solution',
  '',
  'A web app that makes widgets.',
].join('\n')

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
  const ws = mkdtempSync(join(tmpdir(), 'factory-review-gate-'))
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
    comments: [{ body: ACCEPTED_SPEC }, ...prior],
    assignees: [],
    blockedBy: [],
    closed: true,
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
    assignees: ['acme-dev'],
    blockedBy: [],
    closed: false,
  }
  const pr: FakePr = {
    number: 1,
    id: 2000001,
    title: '[Implementation] Fix the bar',
    body: 'Part of #1.\n\nCloses #2',
    repo: 'acme-dev/widget',
    head: 'impl/2-fix-the-bar',
    base: 'main',
    state: 'open',
    url: 'https://github.com/acme-dev/widget/pull/1',
  }
  const ghStatePath = join(ws, 'gh-state.json')
  writeFileSync(
    ghStatePath,
    JSON.stringify({
      issues: [lineIssue, ticket],
      prs: [pr],
      nextNumber: 3,
      nextPrNumber: 2,
      repos: [],
      labels: [],
    }),
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

function driveToReviewGate(
  factoryRoot: string,
  env: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; status: number | null } {
  return runCli(['review', 'my-app'], factoryRoot, env)
}

test('factory open at the review gate shows the running app, spec, and both reports', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const review = driveToReviewGate(factoryRoot, env)
    assert.equal(review.status, 0, review.stderr)

    const result = runCli(['open', 'my-app'], factoryRoot, env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /REVIEW GATE/)
    assert.match(result.stdout, /spec: https:\/\/github\.com\/acme-dev\/widget\/issues\/1/)
    assert.match(result.stdout, /An accepted spec for a widget maker/)
    assert.match(result.stdout, /automated bar: green/)
    assert.match(result.stdout, /reviewer advice: advance/)
    assert.match(result.stdout, /coverage=pass/)
    assert.match(result.stdout, /scope=pass/)
    assert.match(result.stdout, /standards=pass/)
    assert.match(result.stdout, /tests=pass/)
    assert.match(result.stdout, /app: http:\/\/localhost:3000/)
    assert.match(result.stdout, /dispositions: advance, revise, halt/)
    assert.match(result.stdout, /factory open my-app --disposition advance/)
  } finally {
    clean()
  }
})

test('advance on a green bar merges the PR and treats ship as the merge', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const review = driveToReviewGate(factoryRoot, env)
    assert.equal(review.status, 0, review.stderr)

    const shown = runCli(['open', 'my-app'], factoryRoot, env)
    assert.equal(shown.status, 0, shown.stderr)
    const before = readState(ghStatePath)
    assert.equal(before.prs[0]?.state, 'open')

    const result = runCli(['open', 'my-app', '--disposition', 'advance'], factoryRoot, env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /SHIPPED/)
    assert.match(result.stdout, /disposition: advance/)
    assert.match(result.stdout, /pr: #1 merged/)
    assert.match(result.stdout, /ship is the merge/)
    assert.match(result.stdout, /Vercel deploy stays documented-only/)

    const state = readState(ghStatePath)
    assert.equal(state.prs[0]?.state, 'merged')
    const lineIssue = state.issues.find((issue) => issue.number === 1)
    assert.ok(lineIssue)
    const disposition = lineIssue.comments.find((comment) => comment.body.includes('## Operator disposition — review'))
    assert.ok(disposition)
    assert.match(disposition.body, /\*\*Disposition:\*\* advance/)
    assert.match(disposition.body, /merged PR #1/)

    const run = readRunTable(dbPath)[0]!
    assert.equal(run.stage, 'ship')
    assert.equal(run.suspension, null)

    const brief = runCli(['--stub'], factoryRoot, env)
    assert.match(brief.stdout, /my-app — ship — the Line is complete/)
  } finally {
    clean()
  }
})

test('advance is refused off a green bar; the Operator can only revise or halt', () => {
  const { factoryRoot, ghStatePath, env, clean } = createSandbox({ failing: true, priorFailureReports: 2 })
  try {
    const review = driveToReviewGate(factoryRoot, env)
    assert.equal(review.status, 0, review.stderr)
    assert.match(review.stdout, /outcome: halt/)

    const shown = runCli(['open', 'my-app'], factoryRoot, env)
    assert.equal(shown.status, 0, shown.stderr)
    assert.match(shown.stdout, /REVIEW GATE/)
    assert.match(shown.stdout, /dispositions: revise, halt/)
    assert.match(shown.stdout, /advance: not offered/)

    const result = runCli(['open', 'my-app', '--disposition', 'advance'], factoryRoot, env)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /only offered on a green bar/)
    assert.match(result.stderr, /halt/)

    const state = readState(ghStatePath)
    assert.equal(state.prs[0]?.state, 'open', 'off-green advance must not merge')
  } finally {
    clean()
  }
})

test('revise at the review gate cuts an implementation ticket and returns the Line to implementation', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const review = driveToReviewGate(factoryRoot, env)
    assert.equal(review.status, 0, review.stderr)

    const result = runCli(
      ['open', 'my-app', '--disposition', 'revise', '--target', 'implementation'],
      factoryRoot,
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /REVISE RECORDED/)
    assert.match(result.stdout, /target: implementation/)
    assert.match(result.stdout, /ticket: #3/)

    const state = readState(ghStatePath)
    assert.equal(state.prs[0]?.state, 'open', 'revise does not merge')
    const ticket = state.issues.find((issue) => issue.number === 3)
    assert.ok(ticket)
    assert.match(ticket.title, /Review revision/i)
    assert.match(ticket.body, /Part of #1/)
    assert.ok(ticket.labels.includes('ready-for-agent'))

    const run = readRunTable(dbPath)[0]!
    assert.equal(run.stage, 'implementation')
    assert.equal(run.suspension, null)
  } finally {
    clean()
  }
})

test('revise with --target spec returns the Line to the spec gate', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const review = driveToReviewGate(factoryRoot, env)
    assert.equal(review.status, 0, review.stderr)

    const result = runCli(['open', 'my-app', '--disposition', 'revise', '--target', 'spec'], factoryRoot, env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /REVISE RECORDED/)
    assert.match(result.stdout, /target: spec/)

    const state = readState(ghStatePath)
    assert.equal(state.prs[0]?.state, 'open')
    const lineIssue = state.issues.find((issue) => issue.number === 1)
    assert.ok(lineIssue)
    assert.equal(lineIssue.closed, false, 'the spec issue is reopened')

    const run = readRunTable(dbPath)[0]!
    assert.equal(run.stage, 'spec')
    assert.equal(run.suspension, 'spec-gate')

    const brief = runCli(['--stub'], factoryRoot, env)
    assert.match(brief.stdout, /my-app — spec — awaiting your Disposition at the spec gate/)
  } finally {
    clean()
  }
})

test('halt at the review gate stops the Line without merging', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const review = driveToReviewGate(factoryRoot, env)
    assert.equal(review.status, 0, review.stderr)

    const result = runCli(['open', 'my-app', '--disposition', 'halt'], factoryRoot, env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /LINE HALTED/)
    assert.match(result.stdout, /disposition: halt/)
    assert.match(result.stdout, /pr: not merged/)

    const state = readState(ghStatePath)
    assert.equal(state.prs[0]?.state, 'open')
    const lineIssue = state.issues.find((issue) => issue.number === 1)
    assert.ok(lineIssue)
    const disposition = lineIssue.comments.find((comment) => comment.body.includes('## Operator disposition — review'))
    assert.ok(disposition)
    assert.match(disposition.body, /\*\*Disposition:\*\* halt/)

    const run = readRunTable(dbPath)[0]!
    assert.equal(run.stage, 'review')
    assert.equal(run.suspension, 'review-gate')

    const blocked = runCli(['open', 'my-app', '--disposition', 'advance'], factoryRoot, env)
    assert.notEqual(blocked.status, 0)
    assert.match(blocked.stderr, /only offered on a green bar/)
    assert.equal(readState(ghStatePath).prs[0]?.state, 'open')
  } finally {
    clean()
  }
})
