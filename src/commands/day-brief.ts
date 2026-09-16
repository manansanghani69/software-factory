import { factoryPaths } from '../paths.ts'
import type { StageId } from '../config.ts'
import { discoverProducts } from '../products.ts'
import { readRunTable } from '../run-table.ts'
import { derivePosition, type Position } from '../position.ts'
import { readTracker, type TrackerSnapshot } from '../tracker.ts'
import type { StubResolution } from '../stub.ts'
import { formatStubMode } from '../render.ts'

export interface DayBriefProduct {
  name: string
  mirrorStage: StageId | null
  position: Position | null
  error: string | null
}

export interface DayBrief {
  stub: StubResolution
  products: DayBriefProduct[]
}

export type TrackerReader = (repo: string) => TrackerSnapshot

const EMPTY_TRACKER: TrackerSnapshot = { openIssues: [], openPrs: 0 }

export interface ComposeOptions {
  trackerRead?: TrackerReader
}

export function composeDayBrief(root: string, stub: StubResolution, options: ComposeOptions = {}): DayBrief {
  const trackerRead = options.trackerRead ?? readTracker
  const runs = readRunTable(factoryPaths(root).workflowsDbPath)
  const products = discoverProducts(root).map((product) => {
    const name = product.registration.name
    const run = runs.findLast((candidate) => candidate.product === name) ?? null
    let tracker: TrackerSnapshot
    if (stub.enabled) {
      tracker = EMPTY_TRACKER
    } else {
      try {
        tracker = trackerRead(product.registration.repo)
      } catch (error) {
        return {
          name,
          mirrorStage: product.registration.line.stage,
          position: run === null ? null : derivePosition(run, EMPTY_TRACKER),
          error: (error as Error).message,
        }
      }
    }
    return {
      name,
      mirrorStage: product.registration.line.stage,
      position: derivePosition(run, tracker),
      error: null,
    }
  })
  return { stub, products }
}

export function renderDayBrief(brief: DayBrief): string {
  const lines: string[] = ['FACTORY DAY BRIEF', `  Products: ${brief.products.length}`]
  if (brief.products.length === 0) {
    lines.push('  No Products are registered yet — a registered product.json in a sibling directory appears here.')
  }
  for (const product of brief.products) {
    if (product.position === null) {
      lines.push(`    ${product.name} — position unavailable — ${product.error ?? 'no position could be derived'}`)
    } else {
      lines.push(`    ${product.name} — ${product.position.stage} — ${detailFor(product.position)}`)
    }
  }
  lines.push(`  stub mode: ${formatStubMode(brief.stub)}`)
  return lines.join('\n')
}

function detailFor(position: Position): string {
  switch (position.awaiting) {
    case 'spec-disposition':
      return 'awaiting your Disposition at the spec gate (advance or revise)'
    case 'review-disposition':
      return 'awaiting your Disposition at the review gate (advance, revise, or halt)'
    case 'fork-pick':
      return 'awaiting your pick on a fork report'
    default:
      break
  }
  if (position.stage === 'ship') return 'the Line is complete'
  if (position.stage === 'ready') return 'nothing in flight'
  return 'driving'
}