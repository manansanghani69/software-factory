import { factoryPaths } from '../paths.ts'
import { discoverProducts, findProduct } from '../products.ts'
import { latestRunForProduct, readRunTable, resumeRunAlongPick } from '../run-table.ts'
import { resolveGhBin } from '../github.ts'
import {
  ForkError,
  postComment,
  readForkReport,
  renderForkChoices,
  renderPickComment,
  type ForkOption,
  type ForkReport,
} from '../fork.ts'

export interface OpenCommandInput {
  root: string
  product: string
  pick: number | null
  env: NodeJS.ProcessEnv
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
  | { kind: 'idle'; product: string; stage: string | null; suspension: string | null }

export async function runOpenCommand(input: OpenCommandInput): Promise<OpenCommandResult> {
  const env = input.env
  const ghBin = resolveGhBin(env)
  const products = discoverProducts(input.root)
  const registration = findProduct(products, input.product)
  if (registration === null) {
    throw new ForkError(`no Product named "${input.product}" is registered`)
  }
  const dbPath = factoryPaths(input.root).workflowsDbPath
  const run = latestRunForProduct(readRunTable(dbPath), input.product)
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
  return [
    'PICK RECORDED',
    `  product: ${result.product}`,
    `  run: ${result.runId}`,
    `  picked: option ${result.optionId} (${result.option.label})`,
    '  resolved: the fork suspension cleared and the Line resumes along the picked option',
    `  pick visible on the Tracker: ${result.repo}#${result.issueNumber}`,
  ].join('\n')
}