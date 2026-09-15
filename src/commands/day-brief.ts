import type { StubResolution } from '../stub.ts'
import { formatStubMode } from '../render.ts'

export function renderDayBrief(stub: StubResolution): string {
  const lines: string[] = [
    'FACTORY DAY BRIEF — placeholder',
    '  No Products are wired yet, so there is nothing to digest yet.',
    '  The day brief will show each Product’s Line position, the gates awaiting a',
    '  disposition, and the recent stage reports from each Line run.',
  ]
  lines.push(`  stub mode: ${formatStubMode(stub)}`)
  return lines.join('\n')
}