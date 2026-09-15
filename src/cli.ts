import process from 'node:process'
import { Command } from 'commander'
import { findFactoryRoot } from './paths.ts'
import { loadConfig } from './config.ts'
import { applyStubMode, resolveStub } from './stub.ts'
import { renderState } from './commands/state.ts'
import { renderDayBrief } from './commands/day-brief.ts'

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
    console.log(renderState(root, loadConfig(root), stub))
  })

program.action(() => {
  requireFactoryRoot()
  const stub = resolveStub(Boolean(program.opts().stub), process.env)
  applyStubMode(process.env, stub.enabled)
  console.log(renderDayBrief(stub))
})

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})