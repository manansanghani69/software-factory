import { factoryPaths } from '../paths.ts'
import { loadConfig } from '../config.ts'
import { discoverProducts, findProduct } from '../products.ts'
import { latestRunForProduct, readRunTable, updateRunStage } from '../run-table.ts'
import { ReviewError, runReviewBar, type ReviewResult } from '../review.ts'

export interface ReviewCommandInput {
  root: string
  product: string
  env: NodeJS.ProcessEnv
}

export async function runReviewCliCommand(input: ReviewCommandInput): Promise<ReviewResult> {
  const products = discoverProducts(input.root)
  const registration = findProduct(products, input.product)
  if (registration === null) {
    throw new ReviewError(`no Product named "${input.product}" is registered`)
  }
  const repo = registration.registration.repo
  if (repo.length === 0) {
    throw new ReviewError(`Product "${input.product}" has no repo configured in its registration`)
  }

  const dbPath = factoryPaths(input.root).workflowsDbPath
  const run = latestRunForProduct(readRunTable(dbPath), input.product)
  if (run === null) {
    throw new ReviewError(`no Line run recorded for ${input.product} — cannot run review`)
  }
  if (run.stage !== 'review' && run.stage !== 'implementation') {
    throw new ReviewError(`latest Line run for ${input.product} is at ${run.stage}, not review`)
  }
  if (run.issueNumber === null) {
    throw new ReviewError(`no Line issue recorded for ${input.product} — cannot post review reports`)
  }

  const result = await runReviewBar({
    repo,
    productRoot: registration.root,
    issueNumber: run.issueNumber,
    config: loadConfig(input.root),
    env: input.env,
  })

  if (result.outcome === 'revise') {
    updateRunStage(dbPath, run.runId, 'implementation', null)
  } else {
    updateRunStage(dbPath, run.runId, 'review', 'review-gate')
  }

  return result
}

export function renderReviewResult(result: ReviewResult): string {
  return [
    'REVIEW BAR COMPLETE',
    `  outcome: ${result.outcome}`,
    `  round: ${result.round}`,
    `  checks: ${result.checks.map((check) => `${check.name}=${check.ok ? 'green' : 'red'}`).join(', ')}`,
    `  stage report: ${result.stageReportUrl}`,
  ].join('\n')
}
