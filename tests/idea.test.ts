import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
  nextNumber: number
  repos: unknown[]
  labels: Array<{ name: string }>
}

const PRODUCT_REGISTRATION = {
  name: 'my-app',
  repo: 'acme-dev/widget',
  stack: { framework: 'next', database: 'sqlite', orm: 'drizzle', deploy: 'vercel-manual' },
  line: { stage: null, currentTicket: null },
  createdAt: '2026-09-16',
}

function createSandbox(): {
  ws: string
  factoryRoot: string
  ghStatePath: string
  dbPath: string
  env: NodeJS.ProcessEnv
  clean: () => void
} {
  const ws = mkdtempSync(join(tmpdir(), 'factory-idea-'))
  const factoryRoot = join(ws, 'factory')
  mkdirSync(join(factoryRoot, '.factory', 'state'), { recursive: true })
  writeFileSync(join(factoryRoot, '.factory', 'config.json'), '{}')
  const product = join(ws, 'my-app')
  mkdirSync(join(product, '.factory', 'state'), { recursive: true })
  writeFileSync(join(product, '.factory', 'state', 'product.json'), JSON.stringify(PRODUCT_REGISTRATION))

  const ghStatePath = join(ws, 'gh-state.json')
  const seed: GhState = { issues: [], nextNumber: 1, repos: [], labels: [] }
  writeFileSync(ghStatePath, JSON.stringify(seed), 'utf-8')

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
    dbPath: join(factoryRoot, '.factory', 'state', 'workflows.db'),
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

test('factory idea creates a labeled Idea issue and suspends the Line at the spec gate', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const { stdout, stderr, status } = runCli(['idea', 'my-app', 'a widget maker'], { cwd: factoryRoot, env })

    assert.equal(status, 0, stderr)
    assert.match(stdout, /IDEA ENTERED/)
    assert.match(stdout, /idea: #1 — Idea: a widget maker/)
    assert.match(stdout, /gate: spec/)
    assert.match(stdout, /mode: stub/)

    const state = readState(ghStatePath)
    const idea = state.issues.find((issue) => issue.number === 1)
    assert.ok(idea, 'the Idea issue was created in the Product tracker')
    assert.equal(idea.repo, 'acme-dev/widget')
    assert.equal(idea.title, 'Idea: a widget maker')
    assert.equal(idea.closed, false)
    assert.ok(idea.labels.includes('idea'))
    assert.ok(idea.labels.includes('needs-sharpening'))
    assert.match(idea.body, /## Idea/)
    assert.match(idea.body, /a widget maker/)

    const stageReport = idea.comments.find((comment) => comment.body.includes('## Stage report — sharpening'))
    assert.ok(stageReport, 'sharpening posted a stage report')
    assert.match(stageReport.body, /\*\*Mode:\*\* stub/)
    assert.match(stageReport.body, /\*\*Instructions:\*\* /)
    assert.match(stageReport.body, /## Problem Statement/)

    const runs = readRunTable(dbPath)
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.product, 'my-app')
    assert.equal(runs[0]?.stage, 'spec')
    assert.equal(runs[0]?.suspension, 'spec-gate')
    assert.equal(runs[0]?.issueNumber, 1)
  } finally {
    clean()
  }
})

test('the sharpening stage is briefed from the fork to-spec skill even in stub mode', () => {
  const { factoryRoot, ghStatePath, env, clean } = createSandbox()
  const skills = mkdtempSync(join(tmpdir(), 'factory-idea-skills-'))
  mkdirSync(join(skills, 'to-spec'), { recursive: true })
  writeFileSync(join(skills, 'to-spec', 'SKILL.md'), 'Sharpen the Idea into a spec.\n', 'utf-8')
  try {
    const { stderr, status } = runCli(['idea', 'my-app', 'a widget maker'], {
      cwd: factoryRoot,
      env: { ...env, FACTORY_SKILLS_DIR: skills },
    })
    assert.equal(status, 0, stderr)
    const state = readState(ghStatePath)
    const idea = state.issues.find((issue) => issue.number === 1)
    assert.ok(idea)
    const stageReport = idea.comments.find((comment) => comment.body.includes('## Stage report — sharpening'))
    assert.ok(stageReport)
    assert.match(stageReport.body, /\*\*Instructions:\*\* to-spec/)
  } finally {
    rmSync(skills, { recursive: true, force: true })
    clean()
  }
})

test('a fresh process resumes the spec gate by run id and factory open shows the draft spec', () => {
  const { factoryRoot, env, clean } = createSandbox()
  try {
    const entered = runCli(['idea', 'my-app', 'a widget maker'], { cwd: factoryRoot, env })
    assert.equal(entered.status, 0, entered.stderr)

    const brief = runCli(['--stub'], { cwd: factoryRoot, env })
    assert.equal(brief.status, 0, brief.stderr)
    assert.match(brief.stdout, /my-app — spec — awaiting your Disposition at the spec gate/)

    const opened = runCli(['open', 'my-app'], { cwd: factoryRoot, env })
    assert.equal(opened.status, 0, opened.stderr)
    assert.match(opened.stdout, /SPEC GATE/)
    assert.match(opened.stdout, /idea: #1 — Idea: a widget maker/)
    assert.match(opened.stdout, /The Operator wants: a widget maker/)
    assert.match(opened.stdout, /dispositions: advance, revise/)
    assert.match(opened.stdout, /factory open my-app --disposition advance/)
    assert.match(opened.stdout, /--feedback/)
  } finally {
    clean()
  }
})

test('advance posts the accepted spec and closes the Idea issue', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const entered = runCli(['idea', 'my-app', 'a widget maker'], { cwd: factoryRoot, env })
    assert.equal(entered.status, 0, entered.stderr)

    const result = runCli(['open', 'my-app', '--disposition', 'advance'], { cwd: factoryRoot, env })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /SPEC ACCEPTED/)
    assert.match(result.stdout, /disposition: advance/)

    const state = readState(ghStatePath)
    const idea = state.issues.find((issue) => issue.number === 1)
    assert.ok(idea)
    assert.equal(idea.closed, true)
    const last = idea.comments[idea.comments.length - 1]
    assert.ok(last)
    assert.match(last.body, /## Problem Statement/)
    assert.doesNotMatch(last.body, /## Stage report/)

    const runs = readRunTable(dbPath)
    assert.equal(runs[0]?.stage, 'tickets')
    assert.equal(runs[0]?.suspension, null)
  } finally {
    clean()
  }
})

test('revise re-runs the sharpener with the Operator feedback and re-suspends', () => {
  const { factoryRoot, ghStatePath, dbPath, env, clean } = createSandbox()
  try {
    const entered = runCli(['idea', 'my-app', 'a widget maker'], { cwd: factoryRoot, env })
    assert.equal(entered.status, 0, entered.stderr)

    const result = runCli(
      ['open', 'my-app', '--disposition', 'revise', '--feedback', 'Make widgets offline-first'],
      { cwd: factoryRoot, env },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /SPEC REVISED/)
    assert.match(result.stdout, /disposition: revise/)

    const state = readState(ghStatePath)
    const idea = state.issues.find((issue) => issue.number === 1)
    assert.ok(idea)
    assert.equal(idea.closed, false)
    const reports = idea.comments.filter((comment) => comment.body.includes('## Stage report — sharpening'))
    assert.equal(reports.length, 2)
    const latest = reports[1]
    assert.ok(latest)
    assert.match(latest.body, /Make widgets offline-first/)

    const runs = readRunTable(dbPath)
    assert.equal(runs[0]?.stage, 'spec')
    assert.equal(runs[0]?.suspension, 'spec-gate')
  } finally {
    clean()
  }
})

test('factory idea fails cleanly for an unregistered Product and outside a Factory repository', () => {
  const { factoryRoot, ws, env, clean } = createSandbox()
  try {
    const missing = runCli(['idea', 'ghost', 'something'], { cwd: factoryRoot, env })
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /no Product named "ghost" is registered/)

    const outside = runCli(['idea', 'my-app', 'something'], { cwd: ws, env })
    assert.notEqual(outside.status, 0)
    assert.match(outside.stderr, /not inside a Factory repository/)
  } finally {
    clean()
  }
})

test('factory --help lists the idea command', () => {
  const { stdout, status } = runCli(['--help'])
  assert.equal(status, 0)
  assert.match(stdout, /idea/)
})
