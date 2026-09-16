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
  labels: Array<{ name: string; repo?: string }>
}

function createSandbox(): { ws: string; factoryRoot: string; ghStatePath: string; env: NodeJS.ProcessEnv } {
  const ws = mkdtempSync(join(tmpdir(), 'factory-intake-'))
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
        comments: [],
        assignees: [],
        blockedBy: [],
        closed: false,
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

test('factory intake enters a bug report into the Product tracker and triages it to agent-ready', () => {
  const { ws, factoryRoot, ghStatePath, env } = createSandbox()
  try {
    const { stdout, stderr, status } = runCli(
      ['intake', 'acme-dev/widget', '--title', 'Login crashes on POST', '--body', 'Submitting the login form throws a 500.'],
      { cwd: factoryRoot, env },
    )

    assert.equal(status, 0, `${status}: ${stderr}`)
    assert.match(stdout, /REQUEST INTAKE/)
    assert.match(stdout, /#2 {2}Login crashes on POST/)
    assert.match(stdout, /labels: needs-triage → ready-for-agent/)
    assert.match(stdout, /1 request\(s\) triaged/)

    const state = readState(ghStatePath)
    const request = state.issues.find((issue) => issue.number === 2)
    assert.ok(request, 'the intake created a Request issue in the tracker')

    assert.equal(request.repo, 'acme-dev/widget')
    assert.equal(request.title, 'Login crashes on POST')
    assert.equal(request.closed, false)
    assert.deepEqual(request.labels, ['ready-for-agent'], 'raw arrival needs-triage moved to agent-ready')
    assert.match(request.body, /## Request/)
    assert.match(request.body, /Submitting the login form throws a 500\./)

    const idea = state.issues.find((issue) => issue.number === 1)
    assert.ok(idea)
    assert.deepEqual(
      idea.labels,
      ['idea', 'needs-sharpening'],
      'the Request path is distinct from the Idea/sharpening path',
    )

    const labelNames = state.labels.map((label) => label.name)
    assert.ok(labelNames.includes('needs-triage'), 'the tracker carries the needs-triage label')
    assert.ok(labelNames.includes('ready-for-agent'), 'the tracker carries the ready-for-agent label')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('factory intake requires a title and validates the repo argument', () => {
  const { ws, factoryRoot, env } = createSandbox()
  try {
    const noTitle = runCli(['intake', 'acme-dev/widget'], { cwd: factoryRoot, env })
    assert.notEqual(noTitle.status, 0)
    assert.match(noTitle.stderr, /required option '--title/)

    const badRepo = runCli(['intake', 'not-a-repo', '--title', 'Something broke'], { cwd: factoryRoot, env })
    assert.notEqual(badRepo.status, 0)
    assert.match(badRepo.stderr, /owner\/name/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('factory intake fails cleanly outside a Factory repository', () => {
  const { ws, env } = createSandbox()
  try {
    const { stderr, status } = runCli(['intake', 'acme-dev/widget', '--title', 'Something broke'], { cwd: ws, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /not inside a Factory repository/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})