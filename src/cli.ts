import process from 'node:process'
import { Command, InvalidArgumentError } from 'commander'
import { factoryPaths, findFactoryRoot } from './paths.ts'
import { loadConfig } from './config.ts'
import { applyStubMode, resolveStub } from './stub.ts'
import { discoverProducts } from './products.ts'
import { readRunTable } from './run-table.ts'
import { renderState } from './commands/state.ts'
import { composeDayBrief, renderDayBrief } from './commands/day-brief.ts'
import { renderTicketsResult, runTicketsCommand } from './commands/tickets.ts'
import { renderIntakeResult, runIntakeCommand } from './commands/intake.ts'
import { renderForkResult, runForkCommand } from './commands/fork.ts'
import { renderOpenResult, runOpenCommand } from './commands/open.ts'
import { renderImplementResult, runImplementCliCommand } from './commands/implementation.ts'
import { renderReviewResult, runReviewCliCommand } from './commands/review.ts'

function requireFactoryRoot(): string {
  const root = findFactoryRoot(process.cwd())
  if (root === null) {
    console.error('factory: not inside a Factory repository (no .factory/ found upward from the current directory)')
    process.exit(1)
  }
  return root
}

const program = new Command()
  .name('factory')
  .description('AI software factory — the Operator’s driving surface for the Line')
  .version('0.1.0')
  .option('--stub', 'run all agents in stub mode (canned outputs, no API keys)')

program
  .command('state')
  .description('Show the Factory’s local state layout (config plus gitignored state)')
  .action(() => {
    const root = requireFactoryRoot()
    const stub = resolveStub(Boolean(program.opts().stub), process.env)
    applyStubMode(process.env, stub.enabled)
    const products = discoverProducts(root)
    const runs = readRunTable(factoryPaths(root).workflowsDbPath)
    console.log(renderState(root, loadConfig(root), stub, products, runs))
  })

function parsePositiveInteger(value: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    throw new InvalidArgumentError('must be a positive integer issue number')
  }
  return number
}

function parseOptionId(value: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    throw new InvalidArgumentError('must be a positive integer')
  }
  return number
}

function collectForkOptions(
  value: string,
  previous: Array<{ label: string; consequence: string }>,
): Array<{ label: string; consequence: string }> {
  const separator = ' :: '
  const index = value.indexOf(separator)
  if (index === -1) {
    throw new InvalidArgumentError('--option must be "<label> :: <consequence>"')
  }
  const label = value.slice(0, index).trim()
  const consequence = value.slice(index + separator.length).trim()
  if (label.length === 0 || consequence.length === 0) {
    throw new InvalidArgumentError('--option needs both a <label> and a <consequence>')
  }
  return [...previous, { label, consequence }]
}

function parseRepo(value: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(value)) {
    throw new InvalidArgumentError('must be a GitHub repository in owner/name form')
  }
  return value
}

program
  .command('tickets')
  .description('Cut implementation tickets from an accepted spec into a Product tracker, or query the frontier')
  .argument('<repo>', 'the Product tracker repository, e.g. owner/name', parseRepo)
  .argument('<spec-issue>', 'the spec issue the tickets are cut from', parsePositiveInteger)
  .option('--frontier', 'only query the frontier (do not cut)')
  .action(async (repo: string, specIssueNumber: number, options: { frontier: boolean }) => {
    const root = requireFactoryRoot()
    const stub = resolveStub(Boolean(program.opts().stub), process.env)
    applyStubMode(process.env, stub.enabled)
    const config = loadConfig(root)
    const result = await runTicketsCommand({
      env: process.env,
      repo,
      specIssueNumber,
      frontierOnly: Boolean(options.frontier),
      config,
    })
    console.log(renderTicketsResult(result))
  })

program
  .command('fork')
  .description('Fork a driven stage: suspend the run on an unbriefed decision and post a fork report with options and a recommendation')
  .argument('<product>', 'the Product whose run has hit the unbriefed decision')
  .requiredOption('--decision <text>', 'what the stage was asked to decide')
  .requiredOption('--found <text>', 'what the stage found')
  .requiredOption('--option <label :: consequence>', 'an option the stage can see; repeat for each option', collectForkOptions, [])
  .requiredOption('--recommend <n>', 'the id of the recommended option', parseOptionId)
  .action(async (product: string, options: { decision: string; found: string; option: Array<{ label: string; consequence: string }>; recommend: number }) => {
    const root = requireFactoryRoot()
    const stub = resolveStub(Boolean(program.opts().stub), process.env)
    applyStubMode(process.env, stub.enabled)
    const result = await runForkCommand({
      root,
      product,
      decision: options.decision,
      found: options.found,
      options: options.option,
      recommendation: options.recommend,
      env: process.env,
    })
    console.log(renderForkResult(result))
  })

program
  .command('open')
  .description('Attach to a pending fork report on a Product: show the report and take an option-pick to resume the Line')
  .argument('<product>', 'the Product awaiting a pick')
  .option('--pick <n>', 'pick the option with this id to resume the Line along it', parseOptionId, null)
  .action(async (product: string, options: { pick: number | null }) => {
    const root = requireFactoryRoot()
    const stub = resolveStub(Boolean(program.opts().stub), process.env)
    applyStubMode(process.env, stub.enabled)
    const result = await runOpenCommand({ root, product, pick: options.pick, env: process.env })
    console.log(renderOpenResult(result))
  })

program
  .command('intake')
  .description('Enter a Request (bug report or feature request) for an existing Product and triage it to agent-ready in its Tracker')
  .argument('<repo>', 'the Product tracker repository, e.g. owner/name', parseRepo)
  .requiredOption('--title <title>', 'the Request title (a short bug report or feature request heading)')
  .option('--body <body>', 'the Request body (what is broken or what feature is wanted)')
  .action(async (repo: string, options: { title: string; body?: string }) => {
    requireFactoryRoot()
    const stub = resolveStub(Boolean(program.opts().stub), process.env)
    applyStubMode(process.env, stub.enabled)
    const result = await runIntakeCommand({
      env: process.env,
      repo,
      title: options.title,
      ...(options.body !== undefined ? { body: options.body } : {}),
    })
    console.log(renderIntakeResult(result))
  })

program
  .command('implement')
  .description('Drive the implementation stage: pick the next frontier ticket, work it on a sibling checkout, and open a PR')
  .argument('<product>', 'the Product to implement for')
  .action(async (product: string) => {
    const root = requireFactoryRoot()
    const stub = resolveStub(Boolean(program.opts().stub), process.env)
    applyStubMode(process.env, stub.enabled)
    const result = await runImplementCliCommand({
      root,
      product,
      env: process.env,
    })
    console.log(renderImplementResult(result))
  })

program
  .command('review')
  .description('Run the review bar: typecheck, lint, build, and test; auto-revise mechanical failures')
  .argument('<product>', 'the Product to review')
  .action(async (product: string) => {
    const root = requireFactoryRoot()
    const stub = resolveStub(Boolean(program.opts().stub), process.env)
    applyStubMode(process.env, stub.enabled)
    const result = await runReviewCliCommand({
      root,
      product,
      env: process.env,
    })
    console.log(renderReviewResult(result))
  })

program.action(() => {
  const root = requireFactoryRoot()
  const stub = resolveStub(Boolean(program.opts().stub), process.env)
  applyStubMode(process.env, stub.enabled)
  console.log(renderDayBrief(composeDayBrief(root, stub)))
})

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
