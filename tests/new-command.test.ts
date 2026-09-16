import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = join(repoRoot, 'src', 'cli.ts')
const fakeGh = join(repoRoot, 'tests', 'fixtures', 'fake-gh.mjs')

const INHERITED_LABEL_NAMES = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix']

interface GhState {
  issues: unknown[]
  nextNumber: number
  repos: Array<{ fullName: string; visibility: string; source: string | null; remote: string | null; push: boolean }>
  labels: Array<{ name: string; repo: string; color: string; description: string }>
}

function createSandbox(): { ws: string; factoryRoot: string; ghStatePath: string; env: NodeJS.ProcessEnv } {
  const ws = mkdtempSync(join(tmpdir(), 'factory-new-'))
  const factoryRoot = join(ws, 'factory')
  mkdirSync(join(factoryRoot, '.factory', 'state'), { recursive: true })
  const ghStatePath = join(ws, 'gh-state.json')
  writeFileSync(ghStatePath, JSON.stringify({ issues: [], nextNumber: 1, repos: [], labels: [] }), 'utf-8')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FACTORY_STUB: '',
    FACTORY_GH_BIN: fakeGh,
    FACTORY_GH_OWNER: 'acme-dev',
    FAKE_GH_STATE: ghStatePath,
    GIT_AUTHOR_NAME: 'Factory Test',
    GIT_AUTHOR_EMAIL: 'factory-test@example.com',
    GIT_COMMITTER_NAME: 'Factory Test',
    GIT_COMMITTER_EMAIL: 'factory-test@example.com',
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

test('factory new scaffolds a Product repo with labels and registration', () => {
  const { ws, factoryRoot, ghStatePath, env } = createSandbox()
  try {
    const { stdout, stderr, status } = runCli(['new', 'widget'], { cwd: factoryRoot, env })

    assert.equal(status, 0, `${status}: ${stderr}`)
    assert.match(stdout, /PRODUCT SCAFFOLDED/)
    assert.match(stdout, /product: widget/)
    assert.match(stdout, /repo: https:\/\/github\.com\/acme-dev\/widget/)

    const productDir = join(ws, 'widget')
    assert.equal(existsSync(productDir), true)

    const pkg = JSON.parse(readFileSync(join(productDir, 'package.json'), 'utf-8')) as { name: string }
    assert.equal(pkg.name, 'widget')
    assert.match(readFileSync(join(productDir, 'src', 'app', 'layout.tsx'), 'utf-8'), /title: "widget"/)

    const page = readFileSync(join(productDir, 'src', 'app', 'page.tsx'), 'utf-8')
    assert.match(page, /import \{ db, tasks \} from "@\/db";/)
    assert.match(page, /<h1>widget<\/h1>/)

    assert.match(readFileSync(join(productDir, 'drizzle', 'schema.ts'), 'utf-8'), /sqliteTable\("tasks"/)
    assert.equal(existsSync(join(productDir, 'src', 'db', 'index.ts')), true)

    for (const relative of [
      'CONTEXT.md',
      'AGENTS.md',
      'docs/agents/domain.md',
      'docs/agents/issue-tracker.md',
      'docs/agents/triage-labels.md',
      'docs/adr/.gitkeep',
    ]) {
      assert.equal(existsSync(join(productDir, ...relative.split('/'))), true, relative)
    }

    const registration = JSON.parse(
      readFileSync(join(productDir, '.factory', 'state', 'product.json'), 'utf-8'),
    ) as {
      name: string
      repo: string
      stack: { framework: string; database: string; orm: string; deploy: string }
      line: { stage: string | null; currentTicket: string | null }
    }
    assert.equal(registration.name, 'widget')
    assert.equal(registration.repo, 'https://github.com/acme-dev/widget')
    assert.deepEqual(registration.stack, { framework: 'next', database: 'sqlite', orm: 'drizzle', deploy: 'vercel-manual' })
    assert.equal(registration.line.stage, null)

    const tracked = execFileSync('git', ['-C', productDir, 'ls-files'], { encoding: 'utf-8' })
    assert.match(tracked, /package\.json/)
    assert.doesNotMatch(tracked, /\.factory[\\/]state[\\/]product\.json/)
    const log = execFileSync('git', ['-C', productDir, 'log', '--oneline'], { encoding: 'utf-8' })
    assert.match(log, /Scaffold widget by the Factory/)

    const state: GhState = JSON.parse(readFileSync(ghStatePath, 'utf-8'))
    assert.deepEqual(state.repos, [
      { fullName: 'acme-dev/widget', visibility: 'private', source: productDir, remote: 'origin', push: true },
    ])
    assert.equal(state.labels.length, INHERITED_LABEL_NAMES.length)
    for (const label of state.labels) {
      assert.equal(label.repo, 'acme-dev/widget')
      assert.ok(INHERITED_LABEL_NAMES.includes(label.name), label.name)
      assert.equal(label.color.length, 6)
    }
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('factory new runs in stub mode with no model or API key', () => {
  const { ws, factoryRoot, env } = createSandbox()
  try {
    const { stdout, stderr, status } = runCli(['--stub', 'new', 'stubapp'], { cwd: factoryRoot, env })

    assert.equal(status, 0, stderr)
    assert.match(stdout, /mode: stub/)
    assert.equal(existsSync(join(ws, 'stubapp')), true)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('factory new rejects an invalid Product name', () => {
  const { ws, factoryRoot, env } = createSandbox()
  try {
    const { stderr, status } = runCli(['new', 'Bad Name!'], { cwd: factoryRoot, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /Invalid Product name/)
    assert.equal(existsSync(join(ws, 'Bad Name!')), false)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('factory new refuses an existing Product directory', () => {
  const { ws, factoryRoot, env } = createSandbox()
  try {
    mkdirSync(join(ws, 'dup'))
    const { stderr, status } = runCli(['new', 'dup'], { cwd: factoryRoot, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /already exists/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('factory new fails cleanly outside a Factory repository', () => {
  const { ws, env } = createSandbox()
  try {
    const { stderr, status } = runCli(['new', 'foo'], { cwd: ws, env })

    assert.notEqual(status, 0)
    assert.match(stderr, /not inside a Factory repository/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('no {{product}} token survives into the generated scaffold', () => {
  const { ws, factoryRoot, env } = createSandbox()
  try {
    const { stderr, status } = runCli(['new', 'cleanprod'], { cwd: factoryRoot, env })
    assert.equal(status, 0, stderr)

    const productDir = join(ws, 'cleanprod')
    const leftovers = execFileSync('git', ['-C', productDir, 'ls-files'], { encoding: 'utf-8' })
      .trim()
      .split(/\r?\n/)
      .filter((relative) => relative.length > 0)
      .filter((relative) => readFileSync(join(productDir, relative), 'utf-8').includes('{{product}}'))

    assert.deepEqual(leftovers, [])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})
