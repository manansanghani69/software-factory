import { spawnSync } from 'node:child_process'

export const IDEA_LABEL = 'idea'
export const NEEDS_SHARPENING_LABEL = 'needs-sharpening'

export interface TrackerIssue {
  number: number
  title: string
  labels: string[]
}

export interface TrackerSnapshot {
  openIssues: TrackerIssue[]
  openPrs: number
}

export class TrackerReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrackerReadError'
  }
}

export function parseTrackerSnapshot(issuesJson: string, prsJson: string): TrackerSnapshot {
  let issues: unknown
  let prs: unknown
  try {
    issues = JSON.parse(issuesJson)
    prs = JSON.parse(prsJson)
  } catch {
    throw new TrackerReadError('The tracker returned malformed JSON')
  }
  if (!Array.isArray(issues) || !Array.isArray(prs)) {
    throw new TrackerReadError('The tracker returned an unexpected shape (expected JSON arrays)')
  }
  return { openIssues: issues.map(parseIssue), openPrs: prs.length }
}

function parseIssue(value: unknown): TrackerIssue {
  const record = value as Record<string, unknown>
  return {
    number: readNumber(record.number),
    title: readString(record.title),
    labels: readLabels(record.labels),
  }
}

function readNumber(value: unknown): number {
  if (typeof value !== 'number') throw new TrackerReadError('The tracker returned an issue without a number')
  return value
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readLabels(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return []
  return value.map((label) => {
    if (typeof label === 'string') return label
    if (typeof label === 'object' && label !== null) {
      const name = (label as Record<string, unknown>).name
      if (typeof name === 'string') return name
    }
    throw new TrackerReadError('The tracker returned a label in an unexpected shape')
  })
}

export function readTracker(repo: string, ghPath = 'gh'): TrackerSnapshot {
  try {
    const issues = runGh(ghPath, ['issue', 'list', '--repo', repo, '--state', 'open', '--json', 'number,title,labels'])
    const prs = runGh(ghPath, ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number,title'])
    return parseTrackerSnapshot(issues, prs)
  } catch (error) {
    if (error instanceof TrackerReadError) throw error
    throw new TrackerReadError(`Could not read the tracker for ${repo}: ${(error as Error).message}`)
  }
}

function runGh(ghPath: string, args: string[]): string {
  const result = spawnSync(ghPath, args, { encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return String(result.stdout)
}