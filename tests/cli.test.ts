import { spawnSync } from 'node:child_process'
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