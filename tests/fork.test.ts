import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseForkReport, renderForkReport, type ForkReport } from '../src/fork.ts'
import { readRunTable } from '../src/run-table.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = join(repoRoot, 'src', 'cli.ts')
const fakeGh = join(repoRoot, 'tests', 'fixtures', 'fake-gh.mjs')

interface FakeIssue {
  number: number
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
  nextNumber: number
  repos: unknown[]
  labels: unknown[]
}

const PRODUCT_REGISTRATION = {
  name: 'my-app',
  repo: 'acme-dev/widget',
  stack: { framework: 'next', database: 'sqlite', orm: 'drizzle', deploy: 'vercel-manual' },
  line: { stage: null, currentTicket: null },
  createdAt: '2026-09-16',
}

function createSandbox(options: { seedRun?: boolean; suspension?: string | null } = {}): {
  ws: string
  factoryRoot: string
  ghStatePath: string
  dbPath: string
  env: NodeJS.ProcessEnv
  clean: () => void
} {
  const seedRun = options.seedRun ?? true
  const suspension = options.suspension ?? null
  const ws = mkdtempSync(join(tmpdir(), 'factory-fork-'))
  const factoryRoot = join(ws, 'factory')
  mkdirSync(join(factoryRoot, '.factory', 'state'), { recursive: true })
  writeFileSync(join(factoryRoot, '.factory', 'config.json'), '{}')
  const product = join(ws, 'my-app')
  mkdirSync(join(product, '.factory', 'state'), { recursive: true })
  writeFileSync(join(product, '.factory', 'state', 'product.json'), JSON.stringify(PRODUCT_REGISTRATION))

  const ghStatePath = join(ws, 'gh-state.json')
  const ghState: GhState = {
    issues: [
      {
        number: 12,
        title: 'Idea: a widget maker',
        body: '## Idea\n\nA widget maker for the Operator.\n',
        repo: 'acme-dev/widget',
        labels: ['idea', 'needs-sharpening'],
        url: 'https://github.com/acme-dev/widget/issues/12',
        comments: [],
        assignees: [],
        blockedBy: [],
        closed: true,
      },
    ],
    nextNumber: 13,
    repos: [],
    labels: [],
  }
  writeFileSync(ghStatePath, JSON.stringify(ghState), 'utf-8')

  const dbPath = join(factoryRoot, '.factory', 'state', 'workflows.db')
  if (seedRun) {
    const db = new DatabaseSync(dbPath)
    db.exec(`CREATE TABLE IF NOT EXISTS factory_runs (
      run_id TEXT PRIMARY KEY, product TEXT NOT NULL, workflow_name TEXT NOT NULL, stage TEXT NOT NULL,
      suspension TEXT, issue_number INTEGER, fork_pick INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.prepare(
      `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
       VALUES ('r1', 'my-app', 'my-app-line', 'implementation', ?, 12, '2026-09-15T00:00:00Z', '2026-09-15T00:00:00Z')`,
    ).run(suspension)
    db.close()
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FACTORY_STUB: '1',
    FACTORY_GH_BIN: fakeGh,
    FACTORY_GH_OWNER: 'acme-dev',
    FAKE_GH_STATE: ghStatePath,
  }
  return {
    ws,
    factoryRoot,
    ghStatePath,
    dbPath,
    env,
    clean: () => rmSync(ws, { recursive: true, force: true }),
  }
}

function runCli(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf-8',
  })
  return { stdout: result.stdout, stderr: result.stderr, status: result.status }
}

function readState(ghStatePath: string): GhState {
  return JSON.parse(readFileSync(ghStatePath, 'utf-8')) as GhState
}

const FORK_ARGS = [
  'fork',
  'my-app',
  '--decision',
  'Should we add auth now?',
  '--found',
  'The spec does not brief auth on this slice.',
  '--option',
  'Add Auth.js :: stays on the opinionated Next.js stack',
  '--option',
  'Skip auth :: ships the slice now, no login to own',
  '--recommend',
  '1',
]

test('a fork report round-trips through render and parse', () => {
  const report: ForkReport = {
    decision: 'Which auth approach should this slice take?',
    found: 'Two options stay within the opinionated stack and one leaves it.',
    options: [
      { label: 'Auth.js', consequence: 'Stays in Next.js middleware, adds a dependency' },
      { label: 'DIY sessions', consequence: 'No dependency, more code to own' },
    ],
    recommendation: 1,
  }
  const markdown = renderForkReport(report, { product: 'my-app', stage: 'implementation' })
  assert.deepEqual(parseForkReport(markdown), report)
})

test('the recommendation is read from the Recommendation line, not the option marker', () => {
  const report: ForkReport = {
    decision: 'Which auth approach should this slice take?',
    found: 'Two options stay on the opinionated stack.',
    options: [
      { label: 'Auth.js', consequence: 'Stays in Next.js middleware, adds a dependency' },
      { label: 'DIY sessions', consequence: 'No dependency, more code to own' },
      { label: 'Skip auth', consequence: 'Ships this slice with no auth' },
    ],
    recommendation: 2,
  }
  const markdown = renderForkReport(report, { product: 'my-app', stage: 'implementation' })
  assert.deepEqual(parseForkReport(markdown), report)
})

test('an unbriefed decision suspends the run and posts a fork report with options and a recommendation', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const { stdout, stderr, status } = runCli(FORK_ARGS, { cwd: factoryRoot, env })

    assert.equal(status, 0, stderr)
    assert.match(stdout, /FORKED/)
    assert.match(stdout, /run: r1/)
    assert.match(stdout, /stage: implementation/)
    assert.match(stdout, /asked to decide: Should we add auth now\?/)
    assert.match(stdout, /found: The spec does not brief auth on this slice\./)
    assert.match(stdout, /1\. Add Auth\.js — stays on the opinionated Next\.js stack \(recommended\)/)
    assert.match(stdout, /2\. Skip auth — ships the slice now, no login to own/)
    assert.match(stdout, /recommendation: option 1/)
    assert.match(stdout, /fork report posted on: acme-dev\/widget#12/)

    const state = readState(ghStatePath)
    const issue = state.issues.find((candidate) => candidate.number === 12)
    assert.ok(issue, 'the Line issue exists')
    const report = issue.comments[issue.comments.length - 1]
    assert.ok(report, 'a fork report comment was posted')
    assert.match(report.body, /## Fork report/)
    assert.match(report.body, /When driving the implementation stage for my-app/)
    assert.match(report.body, /1\. \*\*Add Auth\.js\*\* — stays on the opinionated Next\.js stack \(recommended\)/)
    assert.match(report.body, /\*\*Recommendation:\*\* option 1 \(Add Auth\.js\)/)
    const stageReport = issue.comments.filter(
      (comment) => comment.body.includes('## Fork report') || comment.body.includes('## Operator'),
    )
    assert.equal(stageReport.length, 1, 'the fork is reported exactly once')

    const runs = readRunTable(dbPath)
    const run = runs.find((candidate) => candidate.runId === 'r1')
    assert.ok(run, 'the run is in the run table')
    assert.equal(run.suspension, 'fork', 'the run suspends at the fork')
  } finally {
    clean()
  }
})

test('factory open surfaces a pending fork report with its options and recommendation', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const fork = runCli(FORK_ARGS, { cwd: factoryRoot, env })
    assert.equal(fork.status, 0, fork.stderr)

    const { stdout, stderr, status } = runCli(['open', 'my-app'], { cwd: factoryRoot, env })
    assert.equal(status, 0, stderr)
    assert.match(stdout, /FORK AWAITING A PICK/)
    assert.match(stdout, /asked to decide: Should we add auth now\?/)
    assert.match(stdout, /found: The spec does not brief auth on this slice\./)
    assert.match(stdout, /1\. Add Auth\.js — stays on the opinionated Next\.js stack \(recommended\)/)
    assert.match(stdout, /recommendation: option 1/)
    assert.match(stdout, /pick: factory open my-app --pick <n>/)
  } finally {
    clean()
  }
})

test('factory open takes an option-pick, records it on the Tracker, and resumes the run along it', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const fork = runCli(FORK_ARGS, { cwd: factoryRoot, env })
    assert.equal(fork.status, 0, fork.stderr)

    const { stdout, stderr, status } = runCli(['open', 'my-app', '--pick', '2'], { cwd: factoryRoot, env })
    assert.equal(status, 0, stderr)
    assert.match(stdout, /PICK RECORDED/)
    assert.match(stdout, /picked: option 2 \(Skip auth\)/)
    assert.match(stdout, /resolved: the fork suspension cleared and the Line resumes along the picked option/)
    assert.match(stdout, /pick visible on the Tracker: acme-dev\/widget#12/)

    const state = readState(ghStatePath)
    const issue = state.issues.find((candidate) => candidate.number === 12)
    assert.ok(issue, 'the Line issue exists')
    const reports = issue.comments.filter((comment) => comment.body.includes('## '))
    assert.ok(reports.some((comment) => comment.body.includes('## Fork report')), 'the report stays on the Tracker')
    const pick = reports.find((comment) => comment.body.startsWith("## Operator's pick"))
    assert.ok(pick, 'a pick comment was posted')
    assert.match(pick.body, /picked option 2 \(Skip auth\)/)
    assert.match(pick.body, /The Line resumes along this option\./)

    const runs = readRunTable(dbPath)
    const run = runs.find((candidate) => candidate.runId === 'r1')
    assert.ok(run, 'the run is in the run table')
    assert.equal(run.suspension, null, 'the run resumes after the pick')
    assert.equal(run.forkPick, 2, 'the picked option is recorded in run state')
    assert.equal(run.stage, 'implementation', 'the Line resumes along the picked option in place')

    const brief = runCli(['--stub'], { cwd: factoryRoot, env })
    assert.match(brief.stdout, /my-app — implementation — driving/)

    const stateOutput = runCli(['state'], { cwd: factoryRoot, env })
    assert.match(stateOutput.stdout, /my-app: run r1 — stage=implementation — running — picked option 2/)
  } finally {
    clean()
  }
})

test('the day brief flags a suspended fork before a pick is made', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const fork = runCli(FORK_ARGS, { cwd: factoryRoot, env })
    assert.equal(fork.status, 0, fork.stderr)
    const brief = runCli(['--stub'], { cwd: factoryRoot, env })
    assert.match(brief.stdout, /my-app — implementation — awaiting your pick on a fork report/)
  } finally {
    clean()
  }
})

test('factory open on a Product with no pending fork reports nothing awaiting', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const { stdout, stderr, status } = runCli(['open', 'my-app'], { cwd: factoryRoot, env })
    assert.equal(status, 0, stderr)
    assert.match(stdout, /OPEN/)
    assert.match(stdout, /no fork report awaits a pick/)
    assert.match(stdout, /position: implementation \(running\)/)
  } finally {
    clean()
  }
})

test('factory open --pick on a run with nothing to pick errors instead of silently discarding', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const { stderr, status } = runCli(['open', 'my-app', '--pick', '1'], { cwd: factoryRoot, env })
    assert.notEqual(status, 0)
    assert.match(stderr, /nothing awaits a pick for my-app/)
    assert.match(stderr, /no run in flight|at \w+/)
  } finally {
    clean()
  }
})

test('factory open --pick against a run suspended at a gate summons no pick', () => {
  const { factoryRoot, env, clean } = createSandbox({ suspension: 'spec-gate' })
  try {
    const { stderr, status } = runCli(['open', 'my-app', '--pick', '1'], { cwd: factoryRoot, env })
    assert.notEqual(status, 0)
    assert.match(stderr, /nothing awaits a pick for my-app/)
    assert.match(stderr, /at spec-gate/)
  } finally {
    clean()
  }
})

test('factory fork fails cleanly when the Product has no run in flight', () => {
  const { factoryRoot, env, clean } = createSandbox({ seedRun: false })
  try {
    const { stderr, status } = runCli(FORK_ARGS, { cwd: factoryRoot, env })
    assert.notEqual(status, 0)
    assert.match(stderr, /no run in flight for my-app/)
  } finally {
    clean()
  }
})

test('factory fork fails cleanly when the run is already suspended', () => {
  const { factoryRoot, env, clean } = createSandbox({ suspension: 'fork' })
  try {
    const { stderr, status } = runCli(FORK_ARGS, { cwd: factoryRoot, env })
    assert.notEqual(status, 0)
    assert.match(stderr, /already suspended at fork/)
  } finally {
    clean()
  }
})

test('factory fork rejects a recommendation outside the listed options and an empty option set', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const tooHigh = runCli(
      ['fork', 'my-app', '--decision', 'd', '--found', 'f', '--option', 'A :: one', '--recommend', '2'],
      { cwd: factoryRoot, env },
    )
    assert.notEqual(tooHigh.status, 0)
    assert.match(tooHigh.stderr, /not among the fork's options \(1\.\.1\)/)

    const noOptions = runCli(
      ['fork', 'my-app', '--decision', 'd', '--found', 'f', '--recommend', '1'],
      { cwd: factoryRoot, env },
    )
    assert.notEqual(noOptions.status, 0)
    assert.match(noOptions.stderr, /at least one option/)

    const badOption = runCli(
      ['fork', 'my-app', '--decision', 'd', '--found', 'f', '--option', 'no-separator', '--recommend', '1'],
      { cwd: factoryRoot, env },
    )
    assert.notEqual(badOption.status, 0)
    assert.match(badOption.stderr, /label/)
    assert.match(badOption.stderr, /consequence/)
  } finally {
    clean()
  }
})

test('factory open rejects a pick that is not one of the fork’s options', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const fork = runCli(FORK_ARGS, { cwd: factoryRoot, env })
    assert.equal(fork.status, 0, fork.stderr)
    const badPick = runCli(['open', 'my-app', '--pick', '9'], { cwd: factoryRoot, env })
    assert.notEqual(badPick.status, 0)
    assert.match(badPick.stderr, /option 9 is not among the fork's options \(1\.\.2\)/)

    const zeroPick = runCli(['open', 'my-app', '--pick', '0'], { cwd: factoryRoot, env })
    assert.notEqual(zeroPick.status, 0)
    assert.match(zeroPick.stderr, /positive integer/)
  } finally {
    clean()
  }
})

test('factory open and fork fail cleanly for an unregistered Product', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const open = runCli(['open', 'ghost'], { cwd: factoryRoot, env })
    assert.notEqual(open.status, 0)
    assert.match(open.stderr, /no Product named "ghost" is registered/)

    const fork = runCli(['fork', 'ghost', '--decision', 'd', '--found', 'f', '--option', 'A :: b', '--recommend', '1'], {
      cwd: factoryRoot,
      env,
    })
    assert.notEqual(fork.status, 0)
    assert.match(fork.stderr, /no Product named "ghost" is registered/)
  } finally {
    clean()
  }
})

test('factory --help lists the fork and open commands', () => {
  const { stdout, status } = runCli(['--help'])
  assert.equal(status, 0)
  assert.match(stdout, /fork/)
  assert.match(stdout, /open/)
})