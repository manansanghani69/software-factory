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