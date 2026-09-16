import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { branchName, implementationCheckoutRoot } from '../src/implementation.ts'
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
  prs: Array<{ number: number; id: number; title: string; body: string; repo: string; head: string; base: string; state: string; url: string; createdAt: string }>
  nextNumber: number
  nextPrNumber: number
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
  '',
  '## Testing Decisions',
  '',
  'Tests prove widgets are made.',
  '',
  '## Out of Scope',
  '',
  'Widget repair.',
].join('\n')

function initGitRepo(dir: string, options: { remoteUrl?: string; branch?: string } = {}): void {
  const branch = options.branch ?? 'main'
  spawnSync('git', ['init', '-b', branch], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  writeFileSync(join(dir, '.gitkeep'), '')
  spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  spawnSync('git', ['commit', '-m', 'init'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  if (options.remoteUrl !== undefined) {
    spawnSync('git', ['remote', 'add', 'origin', options.remoteUrl], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
  }
}

function createSandbox(options: {
  suspension?: string | null
  productBranch?: string
  runStage?: string
  runIssueNumber?: number
  runUpdatedAt?: string
  extraRuns?: Array<{ runId: string; stage: string; issueNumber: number | null; updatedAt: string }>
  tickets?: Array<{ number: number; title: string; body: string; blockedBy?: number[]; closed?: boolean; assignees?: string[] }>
} = {}): {
  ws: string
  factoryRoot: string
  productRoot: string
  ghStatePath: string
  dbPath: string
  env: NodeJS.ProcessEnv
  clean: () => void
} {
  const suspension = options.suspension ?? null
  const ws = mkdtempSync(join(tmpdir(), 'factory-implement-'))
  const factoryRoot = join(ws, 'factory')
  mkdirSync(join(factoryRoot, '.factory', 'state'), { recursive: true })
  writeFileSync(join(factoryRoot, '.factory', 'config.json'), '{}')

  const product = join(ws, 'my-app')
  const bareRemote = join(ws, 'widget-remote.git')
  mkdirSync(bareRemote, { recursive: true })
  const productBranch = options.productBranch ?? 'main'
  spawnSync('git', ['init', '--bare', '-b', productBranch], { cwd: bareRemote, encoding: 'utf-8', stdio: 'pipe' })
  mkdirSync(join(product, '.factory', 'state'), { recursive: true })
  writeFileSync(join(product, '.factory', 'state', 'product.json'), JSON.stringify(PRODUCT_REGISTRATION))
  initGitRepo(product, { remoteUrl: bareRemote, branch: productBranch })

  const specIssue: FakeIssue = {
    number: 1,
    id: 1000001,
    title: 'Idea: a widget maker',
    body: '## Idea\n\nA widget maker for the Operator.\n',
    repo: 'acme-dev/widget',
    labels: ['idea', 'needs-sharpening'],
    url: 'https://github.com/acme-dev/widget/issues/1',
    comments: [{ body: ACCEPTED_SPEC }],
    assignees: [],
    blockedBy: [],
    closed: true,
  }

  const defaultTickets: Array<{ number: number; title: string; body: string; blockedBy?: number[]; closed?: boolean; assignees?: string[] }> = [
    {
      number: 2,
      title: 'Problem Statement',
      body: [
        'Part of #1.',
        '',
        '## What to build',
        '',
        'Implement the Problem Statement section of the spec.',
        '',
        '## Acceptance criteria',
        '',
        '- [ ] The problem statement is delivered',
      ].join('\n'),
      blockedBy: [],
      closed: false,
      assignees: [],
    },
    {
      number: 3,
      title: 'Solution',
      body: [
        'Part of #1.',
        '',
        'Blocked by: #2',
        '',
        '## What to build',
        '',
        'Implement the Solution section of the spec.',
        '',
        '## Acceptance criteria',
        '',
        '- [ ] The solution is delivered',
      ].join('\n'),
      blockedBy: [2],
      closed: false,
      assignees: [],
    },
  ]

  const ticketDefs = options.tickets ?? defaultTickets
  const ticketIssues: FakeIssue[] = ticketDefs.map((def) => ({
    number: def.number,
    id: 1000000 + def.number,
    title: def.title,
    body: def.body,
    repo: 'acme-dev/widget',
    labels: ['ready-for-agent'],
    url: `https://github.com/acme-dev/widget/issues/${def.number}`,
    comments: [],
    assignees: def.assignees ?? [],
    blockedBy: def.blockedBy ?? [],
    closed: def.closed ?? false,
  }))

  const ghState: GhState = {
    issues: [specIssue, ...ticketIssues],
    prs: [],
    nextNumber: 4,
    nextPrNumber: 1,
    repos: [],
    labels: [],
  }

  const ghStatePath = join(ws, 'gh-state.json')
  writeFileSync(ghStatePath, JSON.stringify(ghState), 'utf-8')

  const dbPath = join(factoryRoot, '.factory', 'state', 'workflows.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE IF NOT EXISTS factory_runs (
    run_id TEXT PRIMARY KEY, product TEXT NOT NULL, workflow_name TEXT NOT NULL, stage TEXT NOT NULL,
    suspension TEXT, issue_number INTEGER, fork_pick INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.prepare(
    `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
     VALUES ('r1', 'my-app', 'my-app-line', ?, ?, ?, '2026-09-15T00:00:00Z', ?)`,
  ).run(options.runStage ?? 'implementation', suspension, options.runIssueNumber ?? 1, options.runUpdatedAt ?? '2026-09-15T00:00:00Z')
  for (const extraRun of options.extraRuns ?? []) {
    db.prepare(
      `INSERT INTO factory_runs (run_id, product, workflow_name, stage, suspension, issue_number, created_at, updated_at)
       VALUES (?, 'my-app', 'my-app-line', ?, NULL, ?, '2026-09-15T00:00:00Z', ?)`,
    ).run(extraRun.runId, extraRun.stage, extraRun.issueNumber, extraRun.updatedAt)
  }
  db.close()

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FACTORY_STUB: '1',
    FACTORY_GH_BIN: fakeGh,
    FACTORY_GH_OWNER: 'acme-dev',
    FAKE_GH_OWNER: 'acme-dev',
    FAKE_GH_STATE: ghStatePath,
  }
  return {
    ws,
    factoryRoot,
    productRoot: product,
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

test('branchName generates a clean branch slug from ticket number and title', () => {
  assert.equal(branchName(5, 'Problem Statement'), 'impl/5-problem-statement')
  assert.equal(branchName(12, 'Auth.js Integration'), 'impl/12-auth-js-integration')
  assert.equal(branchName(1, 'A Very Long Title That Goes Beyond Forty Characters'), 'impl/1-a-very-long-title-that-goes-beyond-forty')
  assert.equal(branchName(3, 'UPPER CASE and Special@Chars!'), 'impl/3-upper-case-and-special-chars')
})

test('implementationCheckoutRoot derives a sibling worktree path from the Product root and branch', () => {
  assert.equal(
    implementationCheckoutRoot(join('tmp', 'my-app'), 'impl/12-auth-js-integration'),
    join('tmp', 'my-app-impl-12-auth-js-integration'),
  )
})

test('the implementation drive picks the next frontier ticket and opens a PR', () => {
  const { factoryRoot, productRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const { stdout, stderr, status } = runCli(['implement', 'my-app'], { cwd: factoryRoot, env })

    assert.equal(status, 0, stderr)
    assert.match(stdout, /IMPLEMENTATION COMPLETE/)
    assert.match(stdout, /ticket: #2 — Problem Statement/)
    assert.match(stdout, /branch: impl\/2-problem-statement/)
    assert.match(stdout, /pr: #1/)
    assert.match(stdout, /mode: stub/)
    assert.match(stdout, /stage report: https:\/\/github\.com\/acme-dev\/widget\/issues\/1/)

    const originalBranch = spawnSync('git', ['branch', '--show-current'], { cwd: productRoot, encoding: 'utf-8' })
    assert.equal(originalBranch.status, 0, originalBranch.stderr?.toString())
    assert.equal(originalBranch.stdout.trim(), 'main')
    const checkoutRoot = implementationCheckoutRoot(productRoot, 'impl/2-problem-statement')
    const worktrees = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: productRoot, encoding: 'utf-8' })
    assert.equal(worktrees.status, 0, worktrees.stderr?.toString())
    assert.equal(existsSync(checkoutRoot), true, `expected ${checkoutRoot}; worktrees:\n${worktrees.stdout}`)
    assert.match(worktrees.stdout.replaceAll('\\', '/'), new RegExp(`worktree ${checkoutRoot.replaceAll('\\', '/')}`))
    assert.match(worktrees.stdout, /branch refs\/heads\/impl\/2-problem-statement/)

    const state = readState(ghStatePath)
    assert.equal(state.prs.length, 1, 'a PR was created')
    const pr = state.prs[0]
    assert.ok(pr, 'PR exists')
    assert.match(pr.title, /\[Implementation\] Problem Statement/)
    assert.equal(pr.head, 'impl/2-problem-statement')
    assert.equal(pr.base, 'main')
    assert.match(pr.body, /Part of #1/)
    assert.match(pr.body, /Closes #2/)

    const ticket = state.issues.find((issue) => issue.number === 2)
    assert.ok(ticket, 'the picked ticket exists')
    assert.deepEqual(ticket.assignees, ['acme-dev'])

    const lineIssue = state.issues.find((issue) => issue.number === 1)
    assert.ok(lineIssue, 'the Line issue exists')
    const stageReport = lineIssue.comments.find((comment) => comment.body.includes('## Stage report — implementation'))
    assert.ok(stageReport, 'a stage report was posted')
    assert.match(stageReport.body, /\*\*Ticket:\*\* #2 — Problem Statement/)
    assert.match(stageReport.body, /\*\*Branch:\*\* `impl\/2-problem-statement`/)
    assert.match(stageReport.body, /\*\*PR:\*\* #1/)
    assert.match(stageReport.body, /\*\*Mode:\*\* stub/)
    assert.match(stageReport.body, /Stub mode: no agent was called/)

    const runs = readRunTable(dbPath)
    const run = runs.find((candidate) => candidate.runId === 'r1')
    assert.ok(run, 'the run is in the run table')
    assert.equal(run.stage, 'implementation', 'the run stays at implementation')
  } finally {
    clean()
  }
})

test('the implementation drive bases the worktree and PR on the Product checkout branch', () => {
  const { factoryRoot, productRoot, ghStatePath, env, clean } = createSandbox({ productBranch: 'develop' })
  try {
    const { stdout, stderr, status } = runCli(['implement', 'my-app'], { cwd: factoryRoot, env })

    assert.equal(status, 0, stderr)
    assert.match(stdout, /branch: impl\/2-problem-statement/)

    const checkoutRoot = implementationCheckoutRoot(productRoot, 'impl/2-problem-statement')
    const worktrees = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: productRoot, encoding: 'utf-8' })
    assert.equal(worktrees.status, 0, worktrees.stderr?.toString())
    assert.equal(existsSync(checkoutRoot), true)

    const state = readState(ghStatePath)
    const pr = state.prs[0]
    assert.ok(pr)
    assert.equal(pr.base, 'develop')
  } finally {
    clean()
  }
})

test('the implementation drive skips blocked tickets and picks the first unblocked one', () => {
  const { factoryRoot, ghStatePath, env, clean } = createSandbox({
    tickets: [
      {
        number: 2,
        title: 'Blocked Ticket',
        body: 'Part of #1.\n\n## What to build\n\nThis one is blocked.\n\n## Acceptance criteria\n\n- [ ] Done',
        blockedBy: [],
        closed: false,
        assignees: ['agent-1'],
      },
      {
        number: 3,
        title: 'Frontier Ticket',
        body: 'Part of #1.\n\n## What to build\n\nThis one is on the frontier.\n\n## Acceptance criteria\n\n- [ ] Done',
        blockedBy: [],
        closed: false,
        assignees: [],
      },
    ],
  })
  try {
    const { stdout, stderr, status } = runCli(['implement', 'my-app'], { cwd: factoryRoot, env })

    assert.equal(status, 0, stderr)
    assert.match(stdout, /ticket: #3 — Frontier Ticket/)
    assert.match(stdout, /branch: impl\/3-frontier-ticket/)

    const state = readState(ghStatePath)
    assert.equal(state.prs.length, 1, 'a PR was created')
    const firstPr = state.prs[0]
    assert.ok(firstPr, 'first PR exists')
    assert.match(firstPr.title, /Frontier Ticket/)
    const ticket = state.issues.find((issue) => issue.number === 3)
    assert.ok(ticket, 'the picked ticket exists')
    assert.deepEqual(ticket.assignees, ['acme-dev'])
  } finally {
    clean()
  }
})

test('the implementation drive fails cleanly when no frontier tickets exist', () => {
  const { factoryRoot, env, clean } = createSandbox({
    tickets: [
      {
        number: 2,
        title: 'Claimed Ticket',
        body: 'Part of #1.\n\n## What to build\n\nDone.\n\n## Acceptance criteria\n\n- [ ] Done',
        blockedBy: [],
        closed: false,
        assignees: ['agent-1'],
      },
    ],
  })
  try {
    const { stderr, status } = runCli(['implement', 'my-app'], { cwd: factoryRoot, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /no unblocked, unclaimed tickets on the frontier/)
  } finally {
    clean()
  }
})

test('the implementation drive fails cleanly for an unregistered Product', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const { stderr, status } = runCli(['implement', 'ghost'], { cwd: factoryRoot, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /no Product named "ghost" is registered/)
  } finally {
    clean()
  }
})

test('the implementation drive refuses to post against a run that is not at implementation', () => {
  const { factoryRoot, env, clean } = createSandbox({
    runStage: 'tickets',
    extraRuns: [{ runId: 'r2', stage: 'review', issueNumber: 9, updatedAt: '2026-09-16T00:00:00Z' }],
  })
  try {
    const { stderr, status } = runCli(['implement', 'my-app'], { cwd: factoryRoot, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /latest Line run for my-app is at review, not implementation/)
  } finally {
    clean()
  }
})

test('the implementation drive rejects extra arguments', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const { stderr, status } = runCli(['implement', 'my-app', 'nope'], { cwd: factoryRoot, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /too many arguments/i)
  } finally {
    clean()
  }
})

test('the implementation drive fails cleanly outside a Factory repository', () => {
  const { ws, env, clean } = createSandbox()
  try {
    const { stderr, status } = runCli(['implement', 'my-app'], { cwd: ws, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /not inside a Factory repository/)
  } finally {
    clean()
  }
})

test('factory --help lists the implement command', () => {
  const { stdout, status } = runCli(['--help'])
  assert.equal(status, 0)
  assert.match(stdout, /implement/)
})

test('a second implementation drive picks the next unblocked ticket after the first is done', () => {
  const { factoryRoot, ghStatePath, env, clean } = createSandbox()
  try {
    const first = runCli(['implement', 'my-app'], { cwd: factoryRoot, env })
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /ticket: #2 — Problem Statement/)

    const stateAfterFirst = readState(ghStatePath)
    const ticket2 = stateAfterFirst.issues.find((issue) => issue.number === 2)
    assert.ok(ticket2)
    assert.deepEqual(ticket2.assignees, ['acme-dev'])
    ticket2.closed = true
    writeFileSync(ghStatePath, JSON.stringify(stateAfterFirst), 'utf-8')

    const second = runCli(['implement', 'my-app'], { cwd: factoryRoot, env })
    assert.equal(second.status, 0, second.stderr)
    assert.match(second.stdout, /ticket: #3 — Solution/)
    assert.match(second.stdout, /branch: impl\/3-solution/)

    const stateAfterSecond = readState(ghStatePath)
    assert.equal(stateAfterSecond.prs.length, 2, 'two PRs were created')
    const secondPr = stateAfterSecond.prs[1]
    assert.ok(secondPr, 'second PR exists')
    assert.match(secondPr.title, /Solution/)
    const ticket3 = stateAfterSecond.issues.find((issue) => issue.number === 3)
    assert.ok(ticket3)
    assert.deepEqual(ticket3.assignees, ['acme-dev'])
  } finally {
    clean()
  }
})

test('the day brief shows implementation driving after a ticket is picked', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const impl = runCli(['implement', 'my-app'], { cwd: factoryRoot, env })
    assert.equal(impl.status, 0, impl.stderr)

    const brief = runCli(['--stub'], { cwd: factoryRoot, env })
    assert.match(brief.stdout, /my-app — implementation — driving/)
  } finally {
    clean()
  }
})

test('the stage report includes both ticket and PR details', () => {
  const { factoryRoot, ghStatePath, env, clean } = createSandbox()
  try {
    const { status, stderr } = runCli(['implement', 'my-app'], { cwd: factoryRoot, env })
    assert.equal(status, 0, stderr)

    const state = readState(ghStatePath)
    const lineIssue = state.issues.find((issue) => issue.number === 1)
    assert.ok(lineIssue)
    const report = lineIssue.comments.find((c) => c.body.includes('## Stage report'))
    assert.ok(report)
    assert.match(report.body, /\*\*Ticket:\*\* #2 — Problem Statement/)
    assert.match(report.body, /\*\*Branch:\*\* `impl\/2-problem-statement`/)
    assert.match(report.body, /\*\*PR:\*\* #1/)
    assert.match(report.body, /\*\*Mode:\*\* stub/)
    assert.match(report.body, /Stub mode: no agent was called/)
  } finally {
    clean()
  }
})
