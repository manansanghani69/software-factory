import { sep } from 'node:path'
import { STAGES, modelForStage, type FactoryConfig } from '../config.ts'
import { describeState, type StateReport } from '../state.ts'
import type { StubResolution } from '../stub.ts'
import { formatStubMode } from '../render.ts'

export function renderState(root: string, config: FactoryConfig, stub: StubResolution): string {
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

  return lines.join('\n')
}