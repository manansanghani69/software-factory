import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { resolveGhBin, runGh } from './github.ts'
import { postComment } from './fork.ts'
import { runImplementCommand } from './implementation.ts'
import { ensureLabel } from './labels.ts'
import { createReviewerAgent } from './mastra/stage-agent.ts'
import { loadStageInstructions } from './skills.ts'
import { isStubEnvSet } from './stub.ts'
import type { FactoryConfig, StageId } from './config.ts'
import { updateRunStage } from './run-table.ts'
import { cutTickets } from './tickets.ts'
import type { SuspensionPoint } from './position.ts'

const execFileAsync = promisify(execFile)

export const REVIEW_GREEN_LABEL = 'review-bar-green'
export const REVIEW_HALTED_LABEL = 'review-bar-halted'
export const REVIEW_REPORT_HEADING = '## Review-bar report'
export const REVIEWER_REPORT_HEADING = '## Reviewer report'
export const DISPOSITION_HEADING = '## Operator disposition — review'

const MAX_OUTPUT_CHARS = 4000
const EVIDENCE_SKIP_MARKERS = [
  REVIEW_REPORT_HEADING,
  REVIEWER_REPORT_HEADING,
  DISPOSITION_HEADING,
  '## Stage report',
  '## Fork report',
  "## Operator's pick",
]

export type Disposition = 'advance' | 'revise' | 'halt'
export type ReviewerAdvice = Disposition
export type ReviseTarget = 'implementation' | 'spec'
export type ChecklistVerdict = 'pass' | 'fail'

export interface ReviewerChecklist {
  coverage: ChecklistVerdict
  scope: ChecklistVerdict
  standards: ChecklistVerdict
  tests: ChecklistVerdict
}

export interface ReviewerReport {
  advice: ReviewerAdvice
  reviseTarget: ReviseTarget
  checklist: ReviewerChecklist
  judgment: string
  findings: string
}

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
    return {
      outcome,
      round,
      checks,
      stageReportUrl: `https://github.com/${repo}/issues/${issueNumber}`,
    }
  }

  const reviewer = await produceReviewerReport({
    repo,
    issueNumber,
    outcome,
    barReport: report,
    config,
    env,
    ghBin,
  })
  await postComment({ repo, issueNumber, env, ghBin }, reviewer)

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

const DEFAULT_REVIEWER_INSTRUCTIONS = `You are the independent reviewer for the AI Software Factory, not the author of the implementation.

Check the Product change against the accepted spec on a fixed checklist, then make a judgment pass. Recommend a Disposition as advice only — the Operator decides at the review gate.

Checklist:
- Coverage: every spec'd behavior is present and wired end-to-end
- Scope: no behavior beyond the spec
- Standards: the change conforms to the Product's documented standards
- Tests: every spec'd behavior has at least one test asserting it

Judgment pass: broken paths, error handling, and security.

Return markdown in this exact shape:
## Reviewer report

**Advice:** advance | revise | halt
**Revise target:** implementation | spec

The reviewer is independent of the implementation author. This recommendation is advice only — the Operator decides at the gate.

### Checklist

- **Coverage:** pass|fail — ...
- **Scope:** pass|fail — ...
- **Standards:** pass|fail — ...
- **Tests:** pass|fail — ...

### Judgment

...

### Findings

...`

export function renderReviewerReport(report: ReviewerReport): string {
  return [
    REVIEWER_REPORT_HEADING,
    '',
    `**Advice:** ${report.advice}`,
    `**Revise target:** ${report.reviseTarget}`,
    '',
    'The reviewer is independent of the implementation author. This recommendation is advice only — the Operator decides at the gate.',
    '',
    '### Checklist',
    '',
    `- **Coverage:** ${report.checklist.coverage} — every spec'd behavior is present and wired end-to-end`,
    `- **Scope:** ${report.checklist.scope} — no behavior beyond the spec`,
    `- **Standards:** ${report.checklist.standards} — the change conforms to the Product's standards`,
    `- **Tests:** ${report.checklist.tests} — every spec'd behavior has a test asserting it`,
    '',
    '### Judgment',
    '',
    report.judgment,
    '',
    '### Findings',
    '',
    report.findings,
  ].join('\n')
}

export function stubReviewerReport(outcome: ReviewOutcome): string {
  if (outcome === 'green') {
    return renderReviewerReport({
      advice: 'advance',
      reviseTarget: 'implementation',
      checklist: { coverage: 'pass', scope: 'pass', standards: 'pass', tests: 'pass' },
      judgment:
        'Broken paths, error handling, and security look sound. The running app is ready for the Operator to judge fit.',
      findings: '(none)',
    })
  }
  return renderReviewerReport({
    advice: 'halt',
    reviseTarget: 'implementation',
    checklist: { coverage: 'fail', scope: 'pass', standards: 'fail', tests: 'fail' },
    judgment:
      'The automated bar failed past the revise cap. The Product is not ready to ship; the Operator should redraw the route.',
    findings: 'The automated checks are still red after consecutive revise rounds.',
  })
}

export function parseReviewerReport(markdown: string): ReviewerReport | null {
  if (!markdown.includes(REVIEWER_REPORT_HEADING)) return null
  const advice = readAdvice(markdown)
  if (advice === null) return null
  return {
    advice,
    reviseTarget: readReviseTarget(markdown),
    checklist: {
      coverage: readChecklistItem(markdown, 'Coverage'),
      scope: readChecklistItem(markdown, 'Scope'),
      standards: readChecklistItem(markdown, 'Standards'),
      tests: readChecklistItem(markdown, 'Tests'),
    },
    judgment: readSection(markdown, 'Judgment') || 'No judgment recorded.',
    findings: readSection(markdown, 'Findings') || '(none)',
  }
}

function readAdvice(markdown: string): ReviewerAdvice | null {
  const match = /^\*\*Advice:\*\*\s*(advance|revise|halt)\s*$/im.exec(markdown)
  const value = match?.[1]
  return value === 'advance' || value === 'revise' || value === 'halt' ? value : null
}

function readReviseTarget(markdown: string): ReviseTarget {
  const match = /^\*\*Revise target:\*\*\s*(implementation|spec)\s*$/im.exec(markdown)
  return match?.[1] === 'spec' ? 'spec' : 'implementation'
}

function readChecklistItem(markdown: string, name: string): ChecklistVerdict {
  const match = new RegExp(`^-\\s+\\*\\*${name}:\\*\\*\\s+(pass|fail)\\b`, 'im').exec(markdown)
  return match?.[1] === 'fail' ? 'fail' : 'pass'
}

function readSection(markdown: string, heading: string): string {
  const match = new RegExp(`### ${heading}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`, 'i').exec(markdown)
  return match?.[1]?.trim() ?? ''
}

export function specFromEvidence(issueBody: string, comments: Array<{ body?: string }>): string {
  const evidence: string[] = []
  if (issueBody.trim().length > 0) evidence.push(issueBody.trim())
  for (const comment of comments) {
    const body = (comment.body ?? '').trim()
    if (body.length === 0) continue
    if (EVIDENCE_SKIP_MARKERS.some((marker) => body.includes(marker))) continue
    evidence.push(body)
  }
  return evidence.at(-1) ?? ''
}

async function produceReviewerReport(input: {
  repo: string
  issueNumber: number
  outcome: ReviewOutcome
  barReport: string
  config: FactoryConfig
  env: NodeJS.ProcessEnv
  ghBin: string
}): Promise<string> {
  if (isStubEnvSet(input.env)) return stubReviewerReport(input.outcome)

  const view = await runGh(
    input.ghBin,
    ['issue', 'view', String(input.issueNumber), '--repo', input.repo, '--json', 'body,comments'],
    input.env,
  )
  const parsed = JSON.parse(view) as { body?: string; comments?: Array<{ body?: string }> }
  const spec = specFromEvidence(parsed.body ?? '', parsed.comments ?? [])
  const prs = await listOpenProductPrs(input.repo, input.ghBin, input.env)
  const pr = pickLinePr(prs, input.issueNumber)
  let diff = ''
  if (pr !== null) {
    try {
      diff = await runGh(
        input.ghBin,
        ['pr', 'diff', String(pr.number), '--repo', input.repo],
        input.env,
      )
    } catch {
      diff = ''
    }
  }
  const skill = loadStageInstructions('review', input.env)
  const instructions =
    skill.length > 0
      ? `${DEFAULT_REVIEWER_INSTRUCTIONS}\n\n---\n\nAdditional standards from the Product's skills:\n\n${skill}`
      : DEFAULT_REVIEWER_INSTRUCTIONS
  const agent = createReviewerAgent(input.config, input.env, instructions)
  const response = await agent.generate(reviewerPrompt(spec, input.barReport, pr, diff))
  const text = typeof response.text === 'string' ? response.text : JSON.stringify(response.text)
  const trimmed = text.trim()
  if (parseReviewerReport(trimmed) !== null) return trimmed
  return [
    REVIEWER_REPORT_HEADING,
    '',
    '**Advice:** revise',
    '**Revise target:** implementation',
    '',
    trimmed.length > 0 ? trimmed : 'The reviewer agent returned no report.',
  ].join('\n')
}

function reviewerPrompt(spec: string, barReport: string, pr: ProductPr | null, diff: string): string {
  return [
    'Review this Product change independently of the author. Return ONLY the reviewer report markdown your instructions describe.',
    '',
    'Accepted spec:',
    '',
    spec.length > 0 ? spec : '(no spec found on the Line issue)',
    '',
    'Automated review-bar report:',
    '',
    barReport,
    '',
    pr === null ? 'PR: (none open)' : `PR: #${pr.number} ${pr.title}\n${pr.body}`,
    '',
    'Diff:',
    '',
    diff.length > 0 ? diff : '(no diff available)',
  ].join('\n')
}

export const PRODUCT_APP_URL = 'http://localhost:3000'

export interface ProductPr {
  number: number
  url: string
  title: string
  headRefName: string
  body: string
  state: string
}

export interface ReviewGateEvidence {
  repo: string
  issueNumber: number
  spec: string
  specUrl: string
  barReport: string
  barOutcome: string
  barGreen: boolean
  reviewerReport: string
  reviewer: ReviewerReport | null
  pr: ProductPr | null
  appUrl: string
}

export interface ReviewDispositionResult {
  product: string
  disposition: ReviewerAdvice
  target: ReviseTarget | null
  barGreen: boolean
  pr: ProductPr | null
  merged: boolean
  revisionTicket: { number: number; title: string; url: string } | null
  stage: StageId
  suspension: SuspensionPoint | null
  issueUrl: string
}

export async function listOpenProductPrs(
  repo: string,
  ghBin: string,
  env: NodeJS.ProcessEnv,
): Promise<ProductPr[]> {
  const out = await runGh(
    ghBin,
    ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number,url,title,headRefName,body,state', '--limit', '20'],
    env,
  )
  return parseProductPrs(JSON.parse(out) as unknown)
}

export function pickLinePr(prs: ProductPr[], issueNumber: number): ProductPr | null {
  const matching = prs.filter((pr) => pr.body.includes(`Part of #${issueNumber}`))
  return matching.at(-1) ?? prs.at(-1) ?? null
}

function parseProductPrs(raw: unknown): ProductPr[] {
  if (!Array.isArray(raw)) return []
  const prs: ProductPr[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.number !== 'number') continue
    const head =
      typeof record.headRefName === 'string'
        ? record.headRefName
        : typeof record.head === 'string'
          ? record.head
          : ''
    prs.push({
      number: record.number,
      url: typeof record.url === 'string' ? record.url : '',
      title: typeof record.title === 'string' ? record.title : '',
      headRefName: head,
      body: typeof record.body === 'string' ? record.body : '',
      state: typeof record.state === 'string' ? record.state : 'open',
    })
  }
  return prs
}

function lastMatchingComment(comments: Array<{ body?: string }>, heading: string): string {
  for (const comment of [...comments].reverse()) {
    const body = comment.body ?? ''
    if (body.includes(heading)) return body
  }
  return ''
}

function readBarOutcome(markdown: string): string | null {
  const match = /^\*\*Outcome:\*\*\s*(\w+)/m.exec(markdown)
  return match?.[1] ?? null
}

export async function loadReviewGateEvidence(input: {
  repo: string
  issueNumber: number
  env: NodeJS.ProcessEnv
  ghBin: string
}): Promise<ReviewGateEvidence> {
  const { repo, issueNumber, env, ghBin } = input
  const view = await runGh(
    ghBin,
    ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'body,comments,labels'],
    env,
  )
  const parsed = JSON.parse(view) as {
    body?: string
    comments?: Array<{ body?: string }>
    labels?: Array<{ name?: string }>
  }
  const comments = parsed.comments ?? []
  const barReport = lastMatchingComment(comments, REVIEW_REPORT_HEADING)
  const reviewerReport = lastMatchingComment(comments, REVIEWER_REPORT_HEADING)
  const labels = (parsed.labels ?? []).map((label) => label.name ?? '').filter((name) => name.length > 0)
  const barGreen = labels.includes(REVIEW_GREEN_LABEL)
  const prs = await listOpenProductPrs(repo, ghBin, env)
  return {
    repo,
    issueNumber,
    spec: specFromEvidence(parsed.body ?? '', comments),
    specUrl: `https://github.com/${repo}/issues/${issueNumber}`,
    barReport,
    barOutcome: readBarOutcome(barReport) ?? (barGreen ? 'green' : 'red'),
    barGreen,
    reviewerReport,
    reviewer: parseReviewerReport(reviewerReport),
    pr: pickLinePr(prs, issueNumber),
    appUrl: PRODUCT_APP_URL,
  }
}

export async function applyReviewDisposition(input: {
  repo: string
  product: string
  issueNumber: number
  runId: string
  dbPath: string
  disposition: ReviewerAdvice
  target: ReviseTarget | null
  env: NodeJS.ProcessEnv
}): Promise<ReviewDispositionResult> {
  const { repo, product, issueNumber, runId, dbPath, disposition, env } = input
  const ghBin = resolveGhBin(env)
  const evidence = await loadReviewGateEvidence({ repo, issueNumber, env, ghBin })
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`

  if (disposition === 'advance') {
    if (!evidence.barGreen) {
      throw new ReviewError('advance is only offered on a green bar; halt instead of silently overriding')
    }
    if (evidence.pr === null) {
      throw new ReviewError(`no open PR on ${repo} to merge — ship is the merge`)
    }
    await runGh(ghBin, ['pr', 'merge', String(evidence.pr.number), '--repo', repo, '--merge'], env)
    await postComment(
      { repo, issueNumber, env, ghBin },
      renderDispositionComment('advance', {
        prNumber: evidence.pr.number,
        prUrl: evidence.pr.url,
      }),
    )
    updateRunStage(dbPath, runId, 'ship', null)
    return {
      product,
      disposition,
      target: null,
      barGreen: true,
      pr: evidence.pr,
      merged: true,
      revisionTicket: null,
      stage: 'ship',
      suspension: null,
      issueUrl,
    }
  }

  if (disposition === 'halt') {
    if (evidence.barGreen) {
      await runGh(
        ghBin,
        ['issue', 'edit', String(issueNumber), '--repo', repo, '--remove-label', REVIEW_GREEN_LABEL],
        env,
      )
    }
    await ensureReviewLabel(
      repo,
      REVIEW_HALTED_LABEL,
      'Automated review bar halted after failed revise rounds',
      ghBin,
      env,
    )
    await runGh(ghBin, ['issue', 'edit', String(issueNumber), '--repo', repo, '--add-label', REVIEW_HALTED_LABEL], env)
    await postComment({ repo, issueNumber, env, ghBin }, renderDispositionComment('halt', {}))
    updateRunStage(dbPath, runId, 'review', 'review-gate')
    return {
      product,
      disposition,
      target: null,
      barGreen: false,
      pr: evidence.pr,
      merged: false,
      revisionTicket: null,
      stage: 'review',
      suspension: 'review-gate',
      issueUrl,
    }
  }

  const target = input.target ?? evidence.reviewer?.reviseTarget ?? 'implementation'
  let revisionTicket: ReviewDispositionResult['revisionTicket'] = null
  if (target === 'implementation') {
    const cut = await cutTickets({
      repo,
      specIssueNumber: issueNumber,
      env,
      drafts: [
        {
          title: 'Review revision',
          whatToBuild:
            "Address the reviewer's findings from the review gate and re-clear the review bar.",
          acceptance: ["The reviewer's findings are addressed", 'The review bar is green'],
          blockedBy: [],
        },
      ],
    })
    const created = cut.tickets[0]
    if (created === undefined) {
      throw new ReviewError('revise to implementation cut no ticket')
    }
    revisionTicket = { number: created.number, title: created.title, url: created.url }
    updateRunStage(dbPath, runId, 'implementation', null)
  } else {
    await runGh(ghBin, ['issue', 'reopen', String(issueNumber), '--repo', repo], env)
    updateRunStage(dbPath, runId, 'spec', 'spec-gate')
  }
  await postComment(
    { repo, issueNumber, env, ghBin },
    renderDispositionComment(
      'revise',
      target === 'spec' || revisionTicket === null
        ? { target }
        : { target, ticketNumber: revisionTicket.number },
    ),
  )
  return {
    product,
    disposition,
    target,
    barGreen: evidence.barGreen,
    pr: evidence.pr,
    merged: false,
    revisionTicket,
    stage: target === 'spec' ? 'spec' : 'implementation',
    suspension: target === 'spec' ? 'spec-gate' : null,
    issueUrl,
  }
}

function renderDispositionComment(
  disposition: ReviewerAdvice,
  details: { prNumber?: number; prUrl?: string; target?: ReviseTarget; ticketNumber?: number },
): string {
  const lines = [DISPOSITION_HEADING, '']
  if (disposition === 'advance') {
    lines.push(
      `The Operator chose **advance**. The Factory merged PR #${details.prNumber}. Ship is the merge. Vercel deploy stays documented-only, executed by the Operator.`,
      '',
      '**Disposition:** advance',
      `**PR:** #${details.prNumber} merged (${details.prUrl ?? ''})`,
    )
  } else if (disposition === 'halt') {
    lines.push(
      'The Operator chose **halt**. The Line is stopped. The PR was not merged.',
      '',
      '**Disposition:** halt',
      '**PR:** not merged',
    )
  } else if (details.target === 'spec') {
    lines.push(
      'The Operator chose **revise** targeting spec. The Factory reopened the spec issue and returned the Line to the spec gate.',
      '',
      '**Disposition:** revise',
      '**Target:** spec',
    )
  } else {
    lines.push(
      `The Operator chose **revise** targeting implementation. The Factory cut ticket #${details.ticketNumber} and returned the Line to implementation.`,
      '',
      '**Disposition:** revise',
      '**Target:** implementation',
      `**Ticket:** #${details.ticketNumber}`,
    )
  }
  return lines.join('\n')
}
