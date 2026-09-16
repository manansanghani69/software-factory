import { factoryPaths } from '../paths.ts'
import { loadConfig } from '../config.ts'
import { discoverProducts, findProduct } from '../products.ts'
import { latestRunForProduct, readRunTable } from '../run-table.ts'
import { ImplementError, runImplementCommand, type ImplementResult } from '../implementation.ts'

export interface ImplementCommandInput {
  root: string
  product: string
  env: NodeJS.ProcessEnv
}

export async function runImplementCliCommand(input: ImplementCommandInput): Promise<ImplementResult> {
  const products = discoverProducts(input.root)
  const registration = findProduct(products, input.product)
  if (registration === null) {
    throw new ImplementError(`no Product named "${input.product}" is registered`)
  }
  const repo = registration.registration.repo
  if (repo.length === 0) {
    throw new ImplementError(`Product "${input.product}" has no repo configured in its registration`)
  }
  const run = latestRunForProduct(readRunTable(factoryPaths(input.root).workflowsDbPath), input.product)
  const issueNumber = run?.issueNumber ?? null
  if (run !== null && run.stage !== 'implementation') {
    throw new ImplementError(`latest Line run for ${input.product} is at ${run.stage}, not implementation`)
  }
  if (issueNumber === null) {
    throw new ImplementError(`no Line issue recorded for ${input.product} — cannot post stage reports`)
  }

  return runImplementCommand({
    repo,
    productRoot: registration.root,
    issueNumber,
    config: loadConfig(input.root),
    env: input.env,
  })
}

export function renderImplementResult(result: ImplementResult): string {
  return [
    'IMPLEMENTATION COMPLETE',
    `  ticket: #${result.ticket.number} — ${result.ticket.title}`,
    `  branch: ${result.branch}`,
    `  pr: #${result.pr.number} (${result.pr.url})`,
    `  mode: ${result.mode}`,
    `  stage report: ${result.stageReportUrl}`,
  ].join('\n')
}
