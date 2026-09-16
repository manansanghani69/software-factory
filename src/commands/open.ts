import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { factoryPaths } from '../paths.ts'
import { loadConfig } from '../config.ts'
import { discoverProducts, findProduct } from '../products.ts'
import { latestRunForProduct, readRunTable, resumeRunAlongPick } from '../run-table.ts'
import { resolveGhBin } from '../github.ts'
import { implementationCheckoutRoot } from '../implementation.ts'
import { isStubEnvSet } from '../stub.ts'
import {
  ForkError,
  postComment,
  readForkReport,
  renderForkChoices,
  renderPickComment,
  type ForkOption,
  type ForkReport,
} from '../fork.ts'
import {
  PRODUCT_APP_URL,
  ReviewError,
  applyReviewDisposition,
  loadReviewGateEvidence,
  type Disposition,
  type ProductPr,
  type ReviewDispositionResult,
  type ReviewGateEvidence,
  type ReviseTarget,
} from '../review.ts'
import {
  IdeaError,
  applySpecDisposition,
  loadSpecGateEvidence,
  type SpecDispositionResult,
  type SpecGateEvidence,
} from '../idea.ts'

export interface OpenCommandInput {
  root: string
  product: string
  pick: number | null
  env: NodeJS.ProcessEnv
  disposition?: Disposition | null
  target?: ReviseTarget | null
  feedback?: string | null
}

export type OpenCommandResult =
  | {
      kind: 'report'
      product: string
      runId: string
      stage: string
      repo: string
      issueNumber: number
      report: ForkReport
    }
  | {
      kind: 'picked'
      product: string
      runId: string
      repo: string
      issueNumber: number
      issueUrl: string
      optionId: number
      option: ForkOption
    }
  | {
      kind: 'review-gate'
      product: string
      runId: string
      evidence: ReviewGateEvidence
      appStarted: boolean
    }
  | { kind: 'disposed'; runId: string; result: ReviewDispositionResult }
  | {
      kind: 'spec-gate'
      product: string
      runId: string
      repo: string
      evidence: SpecGateEvidence
    }
  | { kind: 'spec-disposed'; runId: string; result: SpecDispositionResult }
  | { kind: 'idle'; product: string; stage: string | null; suspension: string | null }

export async function runOpenCommand(input: OpenCommandInput): Promise<OpenCommandResult> {
  const env = input.env
  const ghBin = resolveGhBin(env)
  const disposition = input.disposition ?? null
  const target = input.target ?? null
  const feedback = input.feedback ?? null
  const products = discoverProducts(input.root)
  const registration = findProduct(products, input.product)
  if (registration === null) {
    throw new ForkError(`no Product named "${input.product}" is registered`)
  }
  if (target !== null && disposition !== 'revise') {
    throw new ReviewError('--target is only valid with --disposition revise')
  }
  if (feedback !== null && disposition !== 'revise') {
    throw new IdeaError('--feedback is only valid with --disposition revise')
  }
  const dbPath = factoryPaths(input.root).workflowsDbPath
  const run = latestRunForProduct(readRunTable(dbPath), input.product)

  if (run?.suspension === 'spec-gate') {
    if (input.pick !== null) {
      throw new IdeaError(`nothing awaits a pick for ${input.product}: at spec-gate`)
    }
    if (target !== null) {
      throw new IdeaError('--target is only valid at the review gate')
    }
    if (run.issueNumber === null) {
      throw new IdeaError(`run ${run.runId} for ${input.product} is at the spec gate but has no Line issue`)
    }
    const repo = registration.registration.repo
    if (disposition !== null) {
      const result = await applySpecDisposition({
        repo,
        product: input.product,
        issueNumber: run.issueNumber,
        runId: run.runId,
        dbPath,
        disposition,
        ...(feedback !== null ? { feedback } : {}),
        config: loadConfig(input.root),
        env,
      })
      return { kind: 'spec-disposed', runId: run.runId, result }
    }
    const evidence = await loadSpecGateEvidence({ repo, issueNumber: run.issueNumber, env, ghBin })
    return {
      kind: 'spec-gate',
      product: input.product,
      runId: run.runId,
      repo,
      evidence,
    }
  }

  if (run?.suspension === 'review-gate') {
    if (input.pick !== null) {
      throw new ReviewError(`nothing awaits a pick for ${input.product}: at review-gate`)
    }
    if (run.issueNumber === null) {
      throw new ReviewError(`run ${run.runId} for ${input.product} is at the review gate but has no Line issue`)
    }
    const repo = registration.registration.repo
    if (disposition !== null) {
      const result = await applyReviewDisposition({
        repo,
        product: input.product,
        issueNumber: run.issueNumber,
        runId: run.runId,
        dbPath,
        disposition,
        target,
        env,
      })
      return { kind: 'disposed', runId: run.runId, result }
    }
    const evidence = await loadReviewGateEvidence({ repo, issueNumber: run.issueNumber, env, ghBin })
    const app = startProductApp(registration.root, evidence.pr, env)
    return {
      kind: 'review-gate',
      product: input.product,
      runId: run.runId,
      evidence: { ...evidence, appUrl: app.url },
      appStarted: app.started,
    }
  }

  if (disposition !== null) {
    const position = run === null ? 'no run in flight' : `at ${run.suspension ?? 'driving'}`
    throw new ReviewError(`no review gate awaits a Disposition for ${input.product}: ${position}`)
  }

  if (run === null || run.suspension !== 'fork') {
    if (input.pick !== null) {
      const position = run === null ? 'no run in flight' : `at ${run.suspension ?? 'driving'}`
      throw new ForkError(`nothing awaits a pick for ${input.product}: ${position}`)
    }
    return {
      kind: 'idle',
      product: input.product,
      stage: run?.stage ?? null,
      suspension: run?.suspension ?? null,
    }
  }
  if (run.issueNumber === null) {
    throw new ForkError(`run ${run.runId} for ${input.product} is suspended at a fork but has no Line issue`)
  }
  const repo = registration.registration.repo
  const report = await readForkReport({ repo, issueNumber: run.issueNumber, env, ghBin })
  if (input.pick === null) {
    return {
      kind: 'report',
      product: input.product,
      runId: run.runId,
      stage: run.stage,
      repo,
      issueNumber: run.issueNumber,
      report,
    }
  }
  const option = report.options[input.pick - 1]
  if (option === undefined) {
    throw new ForkError(`option ${input.pick} is not among the fork's options (1..${report.options.length})`)
  }
  await postComment(
    { repo, issueNumber: run.issueNumber, env, ghBin },
    renderPickComment(input.product, input.pick, option),
  )
  resumeRunAlongPick(dbPath, run.runId, input.pick)
  return {
    kind: 'picked',
    product: input.product,
    runId: run.runId,
    repo,
    issueNumber: run.issueNumber,
    issueUrl: `https://github.com/${repo}/issues/${run.issueNumber}`,
    optionId: input.pick,
    option,
  }
}

function startProductApp(
  productRoot: string,
  pr: ProductPr | null,
  env: NodeJS.ProcessEnv,
): { url: string; started: boolean } {
  if (isStubEnvSet(env)) return { url: PRODUCT_APP_URL, started: false }
  const checkout =
    pr !== null && existsSync(implementationCheckoutRoot(productRoot, pr.headRefName))
      ? implementationCheckoutRoot(productRoot, pr.headRefName)
      : productRoot
  try {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
      cwd: checkout,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    })
    child.unref()
    return { url: PRODUCT_APP_URL, started: true }
  } catch {
    return { url: PRODUCT_APP_URL, started: false }
  }
}

export function renderOpenResult(result: OpenCommandResult): string {
  if (result.kind === 'idle') {
    const position = result.stage === null ? 'no run in flight' : `${result.stage} (${result.suspension ?? 'running'})`
    return ['OPEN', `  product: ${result.product}`, '  no fork report awaits a pick', `  position: ${position}`].join(
      '\n',
    )
  }
  if (result.kind === 'report') {
    const lines = [
      'FORK AWAITING A PICK',
      `  product: ${result.product}`,
      `  run: ${result.runId}`,
      `  stage: ${result.stage}`,
      `  asked to decide: ${result.report.decision}`,
      `  found: ${result.report.found}`,
      ...renderForkChoices(result.report),
      `  pick: factory open ${result.product} --pick <n>`,
    ]
    return lines.join('\n')
  }
  if (result.kind === 'review-gate') {
    return renderReviewGate(result)
  }
  if (result.kind === 'spec-gate') {
    return renderSpecGate(result)
  }
  if (result.kind === 'spec-disposed') {
    return renderSpecDisposition(result.result)
  }
  if (result.kind === 'disposed') {
    return renderDisposition(result.result)
  }
  return [
    'PICK RECORDED',
    `  product: ${result.product}`,
    `  run: ${result.runId}`,
    `  picked: option ${result.optionId} (${result.option.label})`,
    '  resolved: the fork suspension cleared and the Line resumes along the picked option',
    `  pick visible on the Tracker: ${result.repo}#${result.issueNumber}`,
  ].join('\n')
}

function renderReviewGate(result: Extract<OpenCommandResult, { kind: 'review-gate' }>): string {
  const evidence = result.evidence
  const dispositions = evidence.barGreen ? 'advance, revise, halt' : 'revise, halt'
  const checklist = evidence.reviewer
    ? `coverage=${evidence.reviewer.checklist.coverage}, scope=${evidence.reviewer.checklist.scope}, standards=${evidence.reviewer.checklist.standards}, tests=${evidence.reviewer.checklist.tests}`
    : '(none)'
  const lines = [
    'REVIEW GATE',
    `  product: ${result.product}`,
    `  spec: ${evidence.specUrl}`,
    '  spec excerpt:',
    ...specExcerpt(evidence.spec).map((line) => `    ${line}`),
    `  automated bar: ${evidence.barOutcome}`,
    `  reviewer advice: ${evidence.reviewer?.advice ?? '(none)'} (advice only)`,
    `  reviewer checklist: ${checklist}`,
    `  app: ${evidence.appUrl}${result.appStarted ? ' (dev server started)' : ''}`,
    `  dispositions: ${dispositions}`,
  ]
  if (evidence.barGreen) {
    lines.push(`  advance: factory open ${result.product} --disposition advance`)
  } else {
    lines.push('  advance: not offered (bar is not green; halt instead of a silent override)')
  }
  lines.push(`  revise: factory open ${result.product} --disposition revise [--target implementation|spec]`)
  lines.push(`  halt: factory open ${result.product} --disposition halt`)
  lines.push('  automated bar report:')
  for (const line of reportExcerpt(evidence.barReport, 16)) lines.push(`    ${line}`)
  lines.push('  reviewer report:')
  for (const line of reportExcerpt(evidence.reviewerReport, 16)) lines.push(`    ${line}`)
  lines.push('  note: Vercel deploy stays documented-only, executed by the Operator')
  return lines.join('\n')
}

function renderSpecGate(result: Extract<OpenCommandResult, { kind: 'spec-gate' }>): string {
  const evidence = result.evidence
  const lines = [
    'SPEC GATE',
    `  product: ${result.product}`,
    `  run: ${result.runId}`,
    `  idea: #${evidence.issueNumber} — ${evidence.title}`,
    '  spec excerpt:',
    ...specExcerpt(evidence.spec).map((line) => `    ${line}`),
    '  dispositions: advance, revise',
    `  advance: factory open ${result.product} --disposition advance`,
    `  revise: factory open ${result.product} --disposition revise --feedback "<notes>"`,
  ]
  return lines.join('\n')
}

function renderSpecDisposition(result: SpecDispositionResult): string {
  if (result.disposition === 'advance') {
    return [
      'SPEC ACCEPTED',
      `  product: ${result.product}`,
      `  idea: #${result.issueNumber}`,
      '  disposition: advance',
      '  the Idea issue is closed',
      '  the Line continues to tickets',
    ].join('\n')
  }
  return [
    'SPEC REVISED',
    `  product: ${result.product}`,
    `  idea: #${result.issueNumber}`,
    '  disposition: revise',
    "  the sharpener re-ran with the Operator's feedback",
    '  the Line is suspended at the spec gate',
  ].join('\n')
}

function specExcerpt(spec: string): string[] {
  const lines = spec
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 8)
  return lines.length > 0 ? lines : ['(no spec found on the Line issue)']
}

function reportExcerpt(markdown: string, maxLines: number): string[] {
  if (markdown.trim().length === 0) return ['(none)']
  return markdown
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('```'))
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, maxLines)
}

function renderDisposition(result: ReviewDispositionResult): string {
  if (result.disposition === 'advance') {
    const pr = result.pr
    return [
      'SHIPPED',
      `  product: ${result.product}`,
      '  disposition: advance',
      `  pr: #${pr?.number ?? '?'} merged (${pr?.url ?? ''})`,
      '  ship is the merge',
      '  Vercel deploy stays documented-only, executed by the Operator',
    ].join('\n')
  }
  if (result.disposition === 'halt') {
    return [
      'LINE HALTED',
      `  product: ${result.product}`,
      '  disposition: halt',
      '  pr: not merged',
      '  the Line is stopped',
    ].join('\n')
  }
  const lines = ['REVISE RECORDED', `  product: ${result.product}`, `  target: ${result.target ?? 'implementation'}`]
  if (result.revisionTicket !== null) {
    lines.push(`  ticket: #${result.revisionTicket.number} — ${result.revisionTicket.title}`)
  }
  lines.push(
    result.target === 'spec' ? '  the Line returns to the spec gate' : '  the Line returns to implementation',
  )
  return lines.join('\n')
}