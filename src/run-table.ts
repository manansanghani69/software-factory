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
  forkPick: number | null
  updatedAt: string
}

export class RunTableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunTableError'
  }
}

export function latestRunForProduct(runs: RunRecord[], product: string): RunRecord | null {
  return runs.findLast((run) => run.product === product) ?? null
}

export function updateRunSuspension(
  dbPath: string,
  runId: string,
  suspension: SuspensionPoint | null,
  now: string = new Date().toISOString(),
): void {
  withRunDb(dbPath, runId, (db) => {
    const result = db
      .prepare(`UPDATE ${RUN_TABLE_NAME} SET suspension = ?, updated_at = ? WHERE run_id = ?`)
      .run(suspension, now, runId)
    assertChanged(result, runId, dbPath)
  })
}

export function forkRun(dbPath: string, runId: string, now: string = new Date().toISOString()): void {
  withRunDb(dbPath, runId, (db) => {
    ensureRunTableColumn(db, 'fork_pick', 'INTEGER')
    const result = db
      .prepare(`UPDATE ${RUN_TABLE_NAME} SET suspension = 'fork', fork_pick = NULL, updated_at = ? WHERE run_id = ?`)
      .run(now, runId)
    assertChanged(result, runId, dbPath)
  })
}

export function resumeRunAlongPick(dbPath: string, runId: string, pick: number, now: string = new Date().toISOString()): void {
  withRunDb(dbPath, runId, (db) => {
    ensureRunTableColumn(db, 'fork_pick', 'INTEGER')
    const result = db
      .prepare(`UPDATE ${RUN_TABLE_NAME} SET suspension = NULL, fork_pick = ?, updated_at = ? WHERE run_id = ?`)
      .run(pick, now, runId)
    assertChanged(result, runId, dbPath)
  })
}

function ensureRunTableColumn(db: DatabaseSync, name: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${RUN_TABLE_NAME})`).all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE ${RUN_TABLE_NAME} ADD COLUMN ${name} ${type}`)
  }
}

function withRunDb(dbPath: string, runId: string, write: (db: DatabaseSync) => void): void {
  if (!existsSync(dbPath)) {
    throw new RunTableError(`Cannot update run ${runId}: no workflows database at ${dbPath}`)
  }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath)
  } catch (error) {
    throw new RunTableError(`Cannot open the workflows database at ${dbPath}: ${(error as Error).message}`)
  }
  try {
    const table = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(RUN_TABLE_NAME)
    if (table === undefined) {
      throw new RunTableError(`Cannot update run ${runId}: no run table at ${dbPath}`)
    }
    write(db)
  } finally {
    db.close()
  }
}

function assertChanged(result: { changes: number | bigint }, runId: string, dbPath: string): void {
  if (Number(result.changes) === 0) {
    throw new RunTableError(`Cannot update run ${runId}: no such run in the run table at ${dbPath}`)
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
    const hasForkPick = db
      .prepare(`PRAGMA table_info(${RUN_TABLE_NAME})`)
      .all()
      .some((column) => column.name === 'fork_pick')
    const select = hasForkPick
      ? `SELECT run_id, product, workflow_name, stage, suspension, issue_number, fork_pick, updated_at
         FROM ${RUN_TABLE_NAME}
         ORDER BY updated_at`
      : `SELECT run_id, product, workflow_name, stage, suspension, issue_number, updated_at
         FROM ${RUN_TABLE_NAME}
         ORDER BY updated_at`
    const rows = db.prepare(select).all()
    return rows.map((row) => parseRow(row, dbPath, hasForkPick))
  } finally {
    db.close()
  }
}

function parseRow(row: Record<string, unknown>, dbPath: string, hasForkPick = false): RunRecord {
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

  const forkPick = hasForkPick ? row.fork_pick : undefined
  if (forkPick !== null && forkPick !== undefined && typeof forkPick !== 'number') {
    throw new RunTableError(`Invalid run row in ${dbPath}: fork_pick must be a number or null`)
  }

  return {
    runId,
    product,
    workflowName,
    stage: stage as StageId,
    suspension: (suspension ?? null) as SuspensionPoint | null,
    issueNumber: issueNumber === undefined || issueNumber === null ? null : (issueNumber as number),
    forkPick: forkPick === undefined || forkPick === null ? null : (forkPick as number),
    updatedAt,
  }
}