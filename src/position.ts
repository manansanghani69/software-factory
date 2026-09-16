import type { StageId } from './config.ts'
import { NEEDS_SHARPENING_LABEL, type TrackerSnapshot } from './tracker.ts'

export type SuspensionPoint = 'spec-gate' | 'review-gate' | 'fork'

export interface RunSnapshot {
  product: string
  stage: StageId
  suspension: SuspensionPoint | null
  issueNumber: number | null
}

export type PositionStage = StageId | 'ready'

export type Awaiting = 'spec-disposition' | 'review-disposition' | 'fork-pick'

export interface Position {
  stage: PositionStage
  awaiting: Awaiting | null
  source: 'run' | 'tracker'
}

export function derivePosition(run: RunSnapshot | null, tracker: TrackerSnapshot): Position {
  if (run !== null) {
    switch (run.suspension) {
      case 'spec-gate':
        return { stage: 'spec', awaiting: 'spec-disposition', source: 'run' }
      case 'review-gate':
        return { stage: 'review', awaiting: 'review-disposition', source: 'run' }
      case 'fork':
        return { stage: run.stage, awaiting: 'fork-pick', source: 'run' }
      default:
        return { stage: run.stage, awaiting: null, source: 'run' }
    }
  }

  if (tracker.openPrs > 0) {
    return { stage: 'implementation', awaiting: null, source: 'tracker' }
  }
  if (tracker.openIssues.some((issue) => issue.labels.includes(NEEDS_SHARPENING_LABEL))) {
    return { stage: 'sharpening', awaiting: null, source: 'tracker' }
  }
  if (tracker.openIssues.length > 0) {
    return { stage: 'tickets', awaiting: null, source: 'tracker' }
  }
  return { stage: 'ready', awaiting: null, source: 'tracker' }
}