import { factoryPaths } from '../paths.ts'
import { discoverProducts, findProduct } from '../products.ts'
import { forkRun, latestRunForProduct, readRunTable } from '../run-table.ts'
import { resolveGhBin } from '../github.ts'
import { ForkError, postComment, renderForkChoices, renderForkReport, type ForkOption, type ForkReport } from '../fork.ts'

export interface ForkCommandInput {
  root: string
  product: string
  decision: string
  found: string
  options: ForkOption[]
  recommendation: number
  env: NodeJS.ProcessEnv
}

export interface ForkedResult {
  kind: 'forked'
  product: string
  runId: string
  stage: string
  repo: string
  issueNumber: number
  issueUrl: string
  report: ForkReport
}

export function validateForkInput(input: { options: ForkOption[]; recommendation: number }): void {
  if (input.options.length === 0) {
    throw new ForkError('a fork report needs at least one option')
  }
  if (
    !Number.isInteger(input.recommendation) ||
    input.recommendation < 1 ||
    input.recommendation > input.options.length
  ) {
    throw new ForkError(
      `recommendation option ${input.recommendation} is not among the fork's options (1..${input.options.length})`,
    )
  }
}

export async function runForkCommand(input: ForkCommandInput): Promise<ForkedResult> {
  const env = input.env
  const ghBin = resolveGhBin(env)
  const products = discoverProducts(input.root)
  const registration = findProduct(products, input.product)
  if (registration === null) {
    throw new ForkError(`no Product named "${input.product}" is registered`)
  }
  validateForkInput(input)
  const repo = registration.registration.repo
  const dbPath = factoryPaths(input.root).workflowsDbPath
  const run = latestRunForProduct(readRunTable(dbPath), input.product)
  if (run === null) {
    throw new ForkError(`no run in flight for ${input.product} — nothing to fork`)
  }
  if (run.suspension !== null) {
    throw new ForkError(
      `run ${run.runId} for ${input.product} is already suspended at ${run.suspension} — resolve it before forking again`,
    )
  }
  if (run.issueNumber === null) {
    throw new ForkError(`run ${run.runId} for ${input.product} has no Line issue — cannot post a fork report`)
  }
  const report: ForkReport = {
    decision: input.decision,
    found: input.found,
    options: input.options,
    recommendation: input.recommendation,
  }
  await postComment(
    { repo, issueNumber: run.issueNumber, env, ghBin },
    renderForkReport(report, { product: input.product, stage: run.stage }),
  )
  forkRun(dbPath, run.runId)
  return {
    kind: 'forked',
    product: input.product,
    runId: run.runId,
    stage: run.stage,
    repo,
    issueNumber: run.issueNumber,
    issueUrl: `https://github.com/${repo}/issues/${run.issueNumber}`,
    report,
  }
}

export function renderForkResult(result: ForkedResult): string {
  const lines = [
    'FORKED',
    `  product: ${result.product}`,
    `  run: ${result.runId}`,
    `  stage: ${result.stage}`,
    `  asked to decide: ${result.report.decision}`,
    `  found: ${result.report.found}`,
    ...renderForkChoices(result.report),
    `  fork report posted on: ${result.repo}#${result.issueNumber}`,
  ]
  return lines.join('\n')
}