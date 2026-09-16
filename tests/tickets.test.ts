import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

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
  nextNumber: number
  repos: unknown[]
  labels: unknown[]
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

function createSandbox(options: { disableDependencies?: boolean } = {}): {
  ws: string
  factoryRoot: string
  ghStatePath: string
  env: NodeJS.ProcessEnv
} {
  const ws = mkdtempSync(join(tmpdir(), 'factory-tickets-'))
  const factoryRoot = join(ws, 'factory')
  mkdirSync(join(factoryRoot, '.factory', 'state'), { recursive: true })
  const ghStatePath = join(ws, 'gh-state.json')
  const seed: GhState = {
    issues: [
      {
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
      },
    ],
    nextNumber: 2,
    repos: [],
    labels: [],
  }
  writeFileSync(ghStatePath, JSON.stringify(seed), 'utf-8')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FACTORY_STUB: '1',
    FACTORY_GH_BIN: fakeGh,
    FACTORY_GH_OWNER: 'acme-dev',
    FAKE_GH_STATE: ghStatePath,
    ...(options.disableDependencies ? { FAKE_GH_DISABLE_DEPENDENCIES: '1' } : {}),
  }
  return { ws, factoryRoot, ghStatePath, env }
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

function writeState(ghStatePath: string, state: GhState): void {
  writeFileSync(ghStatePath, JSON.stringify(state), 'utf-8')
}

test('advancing a spec cuts tickets into the Product tracker with native blocking edges', () => {
  const { ws, factoryRoot, ghStatePath, env } = createSandbox()
  try {
    const { stdout, stderr, status } = runCli(['tickets', 'acme-dev/widget', '1'], { cwd: factoryRoot, env })

    assert.equal(status, 0, `${status}: ${stderr}`)
    assert.match(stdout, /TICKETS CUT/)
    assert.match(stdout, /mode: stub/)
    assert.match(stdout, /#2 {2}Problem Statement — blocked by: \(none\)/)
    assert.match(stdout, /#3 {2}Solution — blocked by: #2 \(native edge\)/)
    assert.match(stdout, /#4 {2}Testing Decisions — blocked by: #3 \(native edge\)/)
    assert.match(stdout, /END — 1 ticket\(s\) on the frontier/)

    const state = readState(ghStatePath)
    const tickets = state.issues.filter((issue) => issue.number >= 2)
    assert.equal(tickets.length, 3)

    const problem = tickets.find((ticket) => ticket.number === 2)
    const solution = tickets.find((ticket) => ticket.number === 3)
    const testing = tickets.find((ticket) => ticket.number === 4)
    assert.ok(problem, 'Problem Statement ticket')
    assert.ok(solution, 'Solution ticket')
    assert.ok(testing, 'Testing Decisions ticket')
    assert.equal(problem.title, 'Problem Statement')
    assert.equal(solution.title, 'Solution')
    assert.equal(testing.title, 'Testing Decisions')

    for (const ticket of tickets) {
      assert.ok(ticket.body.startsWith('Part of #1.'), `${ticket.title} references the spec it was cut from`)
      assert.deepEqual(ticket.labels, ['ready-for-agent'], ticket.title)
      assert.match(ticket.body, /## What to build/)
      assert.match(ticket.body, /## Acceptance criteria/)
      assert.match(ticket.body, /## Parent/)
      assert.equal(ticket.closed, false, ticket.title)
    }

    assert.deepEqual(problem.blockedBy, [])
    assert.deepEqual(solution.blockedBy, [2])
    assert.deepEqual(testing.blockedBy, [3])

    assert.ok(state.labels.some((label) => (label as { name: string }).name === 'ready-for-agent'))
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('the frontier is exactly the open, unblocked, unclaimed tickets, in creation order', () => {
  const { ws, factoryRoot, ghStatePath, env } = createSandbox()
  try {
    const cut = runCli(['tickets', 'acme-dev/widget', '1'], { cwd: factoryRoot, env })
    assert.equal(cut.status, 0, cut.stderr)

    const frontier = runCli(['tickets', 'acme-dev/widget', '1', '--frontier'], { cwd: factoryRoot, env })
    assert.equal(frontier.status, 0, frontier.stderr)
    assert.match(frontier.stdout, /FRONTIER — acme-dev\/widget \(spec #1\)/)
    assert.match(frontier.stdout, /#2 {2}Problem Statement/)
    assert.doesNotMatch(frontier.stdout, /#3 {2}Solution/)
    assert.match(frontier.stdout, /END — 1 ticket\(s\) on the frontier/)

    const stateAfterCut = readState(ghStatePath)
    const problem = stateAfterCut.issues.find((issue) => issue.number === 2)
    assert.ok(problem)
    problem.closed = true
    writeState(ghStatePath, stateAfterCut)

    const headDone = runCli(['tickets', 'acme-dev/widget', '1', '--frontier'], { cwd: factoryRoot, env })
    assert.equal(headDone.status, 0, headDone.stderr)
    assert.match(headDone.stdout, /#3 {2}Solution/)
    assert.doesNotMatch(headDone.stdout, /#2 {2}Problem Statement/)
    assert.doesNotMatch(headDone.stdout, /#4 {2}Testing Decisions/)
    assert.match(headDone.stdout, /END — 1 ticket\(s\) on the frontier/)

    const stateAfterClose = readState(ghStatePath)
    const solution = stateAfterClose.issues.find((issue) => issue.number === 3)
    assert.ok(solution)
    solution.assignees = ['agent-1']
    writeState(ghStatePath, stateAfterClose)

    const claimed = runCli(['tickets', 'acme-dev/widget', '1', '--frontier'], { cwd: factoryRoot, env })
    assert.equal(claimed.status, 0, claimed.stderr)
    assert.match(claimed.stdout, /END — 0 ticket\(s\) on the frontier/)
    assert.match(claimed.stdout, /\(none — every open line ticket is claimed or blocked\)/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('cutting without an accepted-spec comment on the spec issue fails cleanly', () => {
  const { ws, factoryRoot, ghStatePath, env } = createSandbox()
  try {
    const state = readState(ghStatePath)
    const spec = state.issues.find((issue) => issue.number === 1)
    assert.ok(spec)
    spec.comments = []
    writeState(ghStatePath, state)

    const { stderr, status } = runCli(['tickets', 'acme-dev/widget', '1'], { cwd: factoryRoot, env })
    assert.notEqual(status, 0)
    assert.match(stderr, /No accepted spec found/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('cutting from a spec issue the gate has not closed fails cleanly', () => {
  const { ws, factoryRoot, ghStatePath, env } = createSandbox()
  try {
    const state = readState(ghStatePath)
    const spec = state.issues.find((issue) => issue.number === 1)
    assert.ok(spec)
    spec.closed = false
    writeState(ghStatePath, state)

    const { stderr, status } = runCli(['tickets', 'acme-dev/widget', '1'], { cwd: factoryRoot, env })
    assert.notEqual(status, 0)
    assert.match(stderr, /is not closed/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('when native dependencies are unavailable, blocker edges fall back to body lists and the frontier still resolves', () => {
  const { ws, factoryRoot, ghStatePath, env } = createSandbox({ disableDependencies: true })
  try {
    const cut = runCli(['tickets', 'acme-dev/widget', '1'], { cwd: factoryRoot, env })
    assert.equal(cut.status, 0, cut.stderr)
    assert.match(cut.stdout, /#3 {2}Solution — blocked by: #2 \(body list\)/)
    assert.match(cut.stdout, /native issue dependencies unavailable/)

    const state = readState(ghStatePath)
    const solution = state.issues.find((issue) => issue.number === 3)
    assert.ok(solution)
    assert.deepEqual(solution.blockedBy, [], 'no native edges were applied')
    assert.match(solution.body, /^Part of #1\.\nBlocked by: #2/m)
    assert.ok(solution.body.startsWith('Part of #1.'))

    const frontier = runCli(['tickets', 'acme-dev/widget', '1', '--frontier'], { cwd: factoryRoot, env })
    assert.equal(frontier.status, 0, frontier.stderr)
    assert.match(frontier.stdout, /#2 {2}Problem Statement/)
    assert.doesNotMatch(frontier.stdout, /#3 {2}Solution/)

    const state2 = readState(ghStatePath)
    const problem = state2.issues.find((issue) => issue.number === 2)
    assert.ok(problem)
    problem.closed = true
    writeState(ghStatePath, state2)

    const next = runCli(['tickets', 'acme-dev/widget', '1', '--frontier'], { cwd: factoryRoot, env })
    assert.equal(next.status, 0, next.stderr)
    assert.match(next.stdout, /#3 {2}Solution/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('factory tickets validates the repo and spec-issue arguments', () => {
  const { ws, factoryRoot, env } = createSandbox()
  try {
    const badRepo = runCli(['tickets', 'not-a-repo', '1'], { cwd: factoryRoot, env })
    assert.notEqual(badRepo.status, 0)
    assert.match(badRepo.stderr, /owner\/name/)

    const badSpec = runCli(['tickets', 'acme-dev/widget', 'nope'], { cwd: factoryRoot, env })
    assert.notEqual(badSpec.status, 0)
    assert.match(badSpec.stderr, /positive integer/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('factory tickets fails cleanly outside a Factory repository', () => {
  const { ws, env } = createSandbox()
  try {
    const { stderr, status } = runCli(['tickets', 'acme-dev/widget', '1'], { cwd: ws, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /not inside a Factory repository/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})