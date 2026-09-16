import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { STAGES, type StageId } from './config.ts'
import type { SuspensionPoint } from './position.ts'

export const RUN_TABLE_NAME = 'factory_runs'

export interface RunRecord {
  runId: string
  product: string
  workflowName: string
  stage: StageId
  suspension: SuspensionPoint | null
  issueNumber: number | null
  updatedAt: string
}

export class RunTableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunTableError'
  }
}

export function readRunTable(dbPath: string): RunRecord[] {
  if (!existsSync(dbPath)) return []
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return []
  }
  try {
    const table = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(RUN_TABLE_NAME)
    if (table === undefined) return []
    const rows = db
      .prepare(
        `SELECT run_id, product, workflow_name, stage, suspension, issue_number, updated_at
         FROM ${RUN_TABLE_NAME}
         ORDER BY updated_at`,
      )
      .all()
    return rows.map((row) => parseRow(row, dbPath))
  } finally {
    db.close()
  }
}

function parseRow(row: Record<string, unknown>, dbPath: string): RunRecord {
  const runId = row.run_id
  const product = row.product
  const workflowName = row.workflow_name
  const stage = row.stage
  const suspension = row.suspension
  const issueNumber = row.issue_number
  const updatedAt = row.updated_at
  if (typeof runId !== 'string') throw new RunTableError(`Invalid run row in ${dbPath}: run_id must be a string`)
  if (typeof product !== 'string') throw new RunTableError(`Invalid run row in ${dbPath}: product must be a string`)
  if (typeof workflowName !== 'string') throw new RunTableError(`Invalid run row in ${dbPath}: workflow_name must be a string`)
  if (typeof stage !== 'string' || !STAGES.includes(stage as StageId)) {
    throw new RunTableError(`Invalid run row in ${dbPath}: unknown stage "${String(stage)}"`)
  }
  if (suspension !== null && suspension !== 'spec-gate' && suspension !== 'review-gate' && suspension !== 'fork') {
    throw new RunTableError(`Invalid run row in ${dbPath}: unknown suspension point "${String(suspension)}"`)
  }
  if (issueNumber !== null && issueNumber !== undefined && typeof issueNumber !== 'number') {
    throw new RunTableError(`Invalid run row in ${dbPath}: issue_number must be a number or null`)
  }
  if (typeof updatedAt !== 'string') throw new RunTableError(`Invalid run row in ${dbPath}: updated_at must be a string`)

  return {
    runId,
    product,
    workflowName,
    stage: stage as StageId,
    suspension: (suspension ?? null) as SuspensionPoint | null,
    issueNumber: issueNumber === undefined || issueNumber === null ? null : (issueNumber as number),
    updatedAt,
  }
}