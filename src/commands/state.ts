import { sep } from 'node:path'
import { STAGES, modelForStage, type FactoryConfig } from '../config.ts'
import { describeState, type StateReport } from '../state.ts'
import { relativeToRoot } from '../paths.ts'
import type { StubResolution } from '../stub.ts'
import type { DiscoveredProduct } from '../products.ts'
import type { RunRecord } from '../run-table.ts'
import { formatStubMode } from '../render.ts'

export function renderState(
  root: string,
  config: FactoryConfig,
  stub: StubResolution,
  products: DiscoveredProduct[],
  runs: RunRecord[],
): string {
  const report: StateReport = describeState(root)
  const lines: string[] = ['FACTORY STATE', `  root: ${root}`]

  lines.push(`  stub mode: ${formatStubMode(stub)}`)

  const configState = report.configPresent ? 'present' : 'missing (defaults in use)'
  lines.push(`  config: ${report.paths.configPath} — ${configState}`)
  lines.push(`    revise cap: ${config.reviseCap}`)
  lines.push(`    default model: ${config.models.default}`)
  lines.push('    stage models (effective):')
  for (const stage of STAGES) {
    lines.push(`      ${stage}: ${modelForStage(config, stage, process.env)}`)
  }

  const dirState = report.stateDirPresent ? 'present' : 'not present yet (created on first run)'
  const stateDir = report.paths.stateDir.endsWith(sep) ? report.paths.stateDir : `${report.paths.stateDir}${sep}`
  lines.push(`  state dir: ${stateDir} — ${dirState}`)
  for (const file of report.files) {
    lines.push(`    ${file.name}: ${file.present ? 'present' : 'not present'}`)
  }

  lines.push('  registrations (discovered Products):')
  if (products.length === 0) {
    lines.push('    none')
  }
  for (const product of products) {
    const registration = product.registration
    lines.push(
      `    ${registration.name} — ${registration.stack.framework}/${registration.stack.database}/${registration.stack.orm} — ${relativeToRoot(root, product.registrationPath)}`,
    )
    lines.push(`      repo: ${registration.repo}`)
    lines.push(`      line mirror (not authoritative): ${registration.line.stage ?? 'null'}`)
  }

  lines.push(`  run table (workflows.db): ${runs.length} run(s)`)
  if (runs.length === 0) {
    lines.push('    none')
  }
  for (const run of runs) {
    lines.push(`    ${run.product}: run ${run.runId} — stage=${run.stage} — ${run.suspension ?? 'running'}`)
  }

  return lines.join('\n')
}