import { factoryPaths } from '../paths.ts'
import { loadConfig } from '../config.ts'
import { discoverProducts, findProduct } from '../products.ts'
import { IdeaError, runIdeaCommand, type IdeaResult } from '../idea.ts'

export interface IdeaCommandInput {
  root: string
  product: string
  idea: string
  env: NodeJS.ProcessEnv
}

export async function runIdeaCliCommand(input: IdeaCommandInput): Promise<IdeaResult> {
  const products = discoverProducts(input.root)
  const registration = findProduct(products, input.product)
  if (registration === null) {
    throw new IdeaError(`no Product named "${input.product}" is registered`)
  }
  return runIdeaCommand({
    product: input.product,
    repo: registration.registration.repo,
    idea: input.idea,
    dbPath: factoryPaths(input.root).workflowsDbPath,
    config: loadConfig(input.root),
    env: input.env,
  })
}

export function renderIdeaResult(result: IdeaResult): string {
  return [
    'IDEA ENTERED',
    `  product: ${result.product}`,
    `  idea: #${result.idea.number} — ${result.idea.title}`,
    `  run: ${result.runId}`,
    '  gate: spec',
    `  mode: ${result.mode}`,
    `  stage report: ${result.stageReportUrl}`,
  ].join('\n')
}
