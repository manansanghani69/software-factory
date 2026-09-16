import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { resolveGhBin, runGh } from './github.ts'
import { postComment } from './fork.ts'
import { runImplementCommand } from './implementation.ts'
import { ensureLabel } from './labels.ts'
import type { FactoryConfig } from './config.ts'

const execFileAsync = promisify(execFile)

export const REVIEW_GREEN_LABEL = 'review-bar-green'
export const REVIEW_HALTED_LABEL = 'review-bar-halted'

const REVIEW_REPORT_HEADING = '## Review-bar report'
const MAX_OUTPUT_CHARS = 4000

export interface ReviewInput {
  repo: string
  productRoot: string
  issueNumber: number
  config: FactoryConfig
  env: NodeJS.ProcessEnv
}

export interface CheckResult {
  name: string
  command: string
  ok: boolean
  output: string
}

export type ReviewOutcome = 'green' | 'revise' | 'halt'

export interface ReviewResult {
  outcome: ReviewOutcome
  round: number
  checks: CheckResult[]
  stageReportUrl: string
}

export class ReviewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewError'
  }
}

const CHECKS = [
  { name: 'typecheck', args: ['run', 'typecheck'] },
  { name: 'lint', args: ['run', 'lint'] },
  { name: 'build', args: ['run', 'build'] },
  { name: 'test', args: ['run', 'test'] },
] as const

export async function runReviewBar(input: ReviewInput): Promise<ReviewResult> {
  const { repo, productRoot, issueNumber, config, env } = input
  const ghBin = resolveGhBin(env)
  const checks = await runChecks(productRoot, env)
  const green = checks.every((check) => check.ok)
  const previousFailures = await consecutiveFailureCount(repo, issueNumber, ghBin, env)
  const round = green ? 1 : previousFailures + 1
  const outcome: ReviewOutcome = green ? 'green' : round > config.reviseCap ? 'halt' : 'revise'

  const report = renderReviewReport(outcome, round, checks, config.reviseCap)
  await postComment({ repo, issueNumber, env, ghBin }, report)

  if (outcome === 'green') {
    await ensureReviewLabel(repo, REVIEW_GREEN_LABEL, 'Automated review bar passed', ghBin, env)
    await runGh(ghBin, ['issue', 'edit', String(issueNumber), '--repo', repo, '--add-label', REVIEW_GREEN_LABEL], env)
  } else if (outcome === 'halt') {
    await ensureReviewLabel(repo, REVIEW_HALTED_LABEL, 'Automated review bar halted after failed revise rounds', ghBin, env)
    await runGh(ghBin, ['issue', 'edit', String(issueNumber), '--repo', repo, '--add-label', REVIEW_HALTED_LABEL], env)
  } else {
    await runImplementCommand({ repo, productRoot, issueNumber, config, env })
  }

  return {
    outcome,
    round,
    checks,
    stageReportUrl: `https://github.com/${repo}/issues/${issueNumber}`,
  }
}

async function ensureReviewLabel(
  repo: string,
  label: string,
  description: string,
  ghBin: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await ensureLabel({ repo, label, color: '5319E7', description, ghBin, env })
}

async function runChecks(productRoot: string, env: NodeJS.ProcessEnv): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const check of CHECKS) {
    results.push(await runNpmCheck(productRoot, check.name, check.args, env))
  }
  return results
}

async function runNpmCheck(
  productRoot: string,
  name: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<CheckResult> {
  try {
    const child = await execFileAsync(npmBin(), args, {
      cwd: productRoot,
      env: cleanEnv(env),
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === 'win32',
    })
    return { name, command: `npm ${args.join(' ')}`, ok: true, output: trimOutput(child.stdout + child.stderr) }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string }
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim() || failure.message || 'Command failed without output.'
    return { name, command: `npm ${args.join(' ')}`, ok: false, output: trimOutput(output) }
  }
}

function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

async function consecutiveFailureCount(
  repo: string,
  issueNumber: number,
  ghBin: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const out = await runGh(ghBin, ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'comments'], env)
  const parsed = JSON.parse(out) as { comments?: Array<{ body?: string }> }
  let count = 0
  for (const comment of [...(parsed.comments ?? [])].reverse()) {
    const body = comment.body ?? ''
    if (!body.includes(REVIEW_REPORT_HEADING)) continue
    if (body.includes('**Outcome:** green')) break
    if (body.includes('**Outcome:** revise') || body.includes('**Outcome:** halt')) count += 1
  }
  return count
}

function renderReviewReport(outcome: ReviewOutcome, round: number, checks: CheckResult[], reviseCap: number): string {
  const lines = [
    REVIEW_REPORT_HEADING,
    '',
    `**Outcome:** ${outcome}`,
    `**Round:** ${round}`,
    `**Revise cap:** ${reviseCap}`,
    '',
    '### Automated checks',
    '',
    ...checks.flatMap((check) => renderCheck(check)),
  ]
  if (outcome === 'revise') {
    lines.push('', 'The automated layer is red, so the Factory re-ran implementation without an Operator pick.')
  }
  if (outcome === 'halt') {
    lines.push('', 'The automated layer failed past the revise cap. The Factory halted with all failure evidence attached.')
  }
  return lines.join('\n')
}

function renderCheck(check: CheckResult): string[] {
  const status = check.ok ? 'green' : 'red'
  return [
    `- **${check.name}:** ${status} (\`${check.command}\`)`,
    '',
    '```text',
    check.output.length > 0 ? check.output : '(no output)',
    '```',
  ]
}

function trimOutput(output: string): string {
  const normalized = output.trim()
  if (normalized.length <= MAX_OUTPUT_CHARS) return normalized
  return `${normalized.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]`
}
