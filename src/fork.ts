import { resolveGhBin, runGh } from './github.ts'

export const FORK_REPORT_HEADING = '## Fork report'
export const PICK_HEADING = "## Operator's pick"

export interface ForkOption {
  label: string
  consequence: string
}

export interface ForkReport {
  decision: string
  found: string
  options: ForkOption[]
  recommendation: number
}

export class ForkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForkError'
  }
}

export interface ForkCommentContext {
  product: string
  stage: string
}

export function renderForkReport(report: ForkReport, context: ForkCommentContext): string {
  const recommended = report.options[report.recommendation - 1]
  const lines = [
    FORK_REPORT_HEADING,
    '',
    `When driving the ${context.stage} stage for ${context.product}, the run hit a decision it was not briefed to make, so it has suspended. Pick an option with \`factory open ${context.product} --pick <n>\`.`,
    '',
    `**Asked to decide:** ${report.decision}`,
    '',
    `**What the stage found:** ${report.found}`,
    '',
    '**Options:**',
    '',
  ]
  for (const [index, option] of report.options.entries()) {
    const id = index + 1
    const marker = id === report.recommendation ? ' (recommended)' : ''
    lines.push(`${id}. **${option.label}** — ${option.consequence}${marker}`)
  }
  lines.push(
    '',
    recommended === undefined
      ? `**Recommendation:** option ${report.recommendation}`
      : `**Recommendation:** option ${report.recommendation} (${recommended.label})`,
  )
  return lines.join('\n')
}

export function renderForkChoices(report: ForkReport): string[] {
  const lines = ['  options:']
  for (const [index, option] of report.options.entries()) {
    const id = index + 1
    const marker = id === report.recommendation ? ' (recommended)' : ''
    lines.push(`    ${id}. ${option.label} — ${option.consequence}${marker}`)
  }
  lines.push(`  recommendation: option ${report.recommendation}`)
  return lines
}

export function parseForkReport(markdown: string): ForkReport | null {
  if (!markdown.includes(FORK_REPORT_HEADING)) return null
  const decision = readLabeled(markdown, 'Asked to decide:')
  const found = readLabeled(markdown, 'What the stage found:')
  const options: ForkOption[] = []
  const optionLine = /^(\d+)\.\s+\*\*(.+?)\*\*\s*—\s*(.+?)\s*$/gm
  for (const match of markdown.matchAll(optionLine)) {
    options.push({
      label: (match[2] ?? '').trim(),
      consequence: stripRecommendedMarker((match[3] ?? '').trim()),
    })
  }
  const recommendation = readRecommendation(markdown)
  if (decision === '' || found === '' || options.length === 0 || recommendation === 0) return null
  return { decision, found, options, recommendation }
}

function stripRecommendedMarker(text: string): string {
  return text.endsWith(' (recommended)') ? text.slice(0, -' (recommended)'.length).trim() : text
}

function readRecommendation(markdown: string): number {
  const match = /^\*\*Recommendation:\*\* option (\d+)/m.exec(markdown)
  const parsed = match === null ? NaN : Number(match[1])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

function readLabeled(markdown: string, label: string): string {
  const match = new RegExp(`^\\*\\*${label}\\*\\*\\s*(.+)$`, 'm').exec(markdown)
  return match?.[1]?.trim() ?? ''
}

export function renderPickComment(product: string, optionId: number, option: ForkOption): string {
  return [
    `${PICK_HEADING} — ${product}`,
    '',
    `The Operator picked option ${optionId} (${option.label}). The Line resumes along this option.`,
    '',
    `**Picked:** option ${optionId} — ${option.label}`,
    `**Consequence:** ${option.consequence}`,
  ].join('\n')
}

export interface TrackerTarget {
  repo: string
  issueNumber: number
  env?: NodeJS.ProcessEnv
  ghBin?: string
}

export async function postComment(target: TrackerTarget, body: string): Promise<void> {
  const env = target.env ?? process.env
  const ghBin = target.ghBin ?? resolveGhBin(env)
  await runGh(ghBin, ['issue', 'comment', String(target.issueNumber), '--repo', target.repo, '--body', body], env)
}

export async function readForkReport(target: TrackerTarget): Promise<ForkReport> {
  const env = target.env ?? process.env
  const ghBin = target.ghBin ?? resolveGhBin(env)
  const out = await runGh(
    ghBin,
    ['issue', 'view', String(target.issueNumber), '--repo', target.repo, '--json', 'comments'],
    env,
  )
  const parsed = JSON.parse(out) as { comments?: Array<{ body?: unknown }> }
  for (const comment of [...(parsed.comments ?? [])].reverse()) {
    if (typeof comment.body !== 'string') continue
    const report = parseForkReport(comment.body)
    if (report !== null) return report
  }
  throw new ForkError(`No fork report found on ${target.repo}#${target.issueNumber} — a run is suspended at a fork but the Tracker holds no report`)
}