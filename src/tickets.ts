import { resolveGhBin, runGh } from './github.ts'

export const TICKET_LABEL = 'ready-for-agent'

export interface TicketDraft {
  title: string
  whatToBuild: string
  acceptance: string[]
  blockedBy: number[]
}

export interface TicketView {
  number: number
  title: string
  body: string
  url: string
  assignees: string[]
  labels: string[]
}

export interface CutTicket {
  number: number
  url: string
  title: string
  blockedByNumbers: number[]
  blockerMode: 'native' | 'body' | 'none'
}

export interface TrackerContext {
  repo: string
  specIssueNumber: number
  env?: NodeJS.ProcessEnv
  ghBin?: string
}

export interface CutTicketsInput extends TrackerContext {
  drafts: TicketDraft[]
}

export interface CutTicketsOutput {
  repo: string
  specIssueNumber: number
  tickets: CutTicket[]
  fallbackUsed: boolean
}

export function resolveTrackerContext(input: TrackerContext): {
  repo: string
  specIssueNumber: number
  env: NodeJS.ProcessEnv
  ghBin: string
} {
  const env = input.env ?? process.env
  return { repo: input.repo, specIssueNumber: input.specIssueNumber, env, ghBin: input.ghBin ?? resolveGhBin(env) }
}

const SKIPPED_STUB_HEADINGS = ['out of scope', 'further notes', 'open questions', 'blocked by', 'parent']

export function extractHeadings(spec: string): string[] {
  const headings: string[] = []
  const pattern = /^##\s+(.+?)\s*$/gim
  for (const match of spec.matchAll(pattern)) {
    const heading = (match[1] ?? '').replace(/[`*_#]/g, '').trim()
    if (heading.length > 0) headings.push(heading)
  }
  return headings
}

export function planTicketsStub(spec: string): TicketDraft[] {
  const headings = extractHeadings(spec).filter(
    (heading) => !SKIPPED_STUB_HEADINGS.includes(heading.toLowerCase()),
  )
  const drafts: TicketDraft[] = headings.map((heading, index) => ({
    title: heading,
    whatToBuild: `The vertical slice that delivers the "${heading}" section of the accepted spec, end to end.`,
    acceptance: [
      `The "${heading}" behavior from the accepted spec is delivered end to end`,
      `The acceptance criteria the spec states for ${heading.toLowerCase()} hold`,
    ],
    blockedBy: index === 0 ? [] : [index - 1],
  }))
  if (drafts.length > 0) return drafts
  return [
    {
      title: 'Implement the accepted spec',
      whatToBuild: 'Deliver the accepted spec end to end.',
      acceptance: ['The accepted spec is implemented end to end'],
      blockedBy: [],
    },
  ]
}

export function extractJsonArray(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fence?.[1] ?? text
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('The tickets stage returned no JSON array to cut from')
  }
  const slice = candidate.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch (error) {
    throw new Error('The tickets stage returned malformed JSON for the ticket plan', { cause: error })
  }
}

export function parseTicketDrafts(value: unknown): TicketDraft[] {
  if (!Array.isArray(value)) throw new Error('The ticket plan must be a JSON array of tickets')
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Ticket #${index + 1} is not an object`)
    }
    const record = entry as Record<string, unknown>
    return {
      title: requiredString(record.title, `Ticket #${index + 1} title`),
      whatToBuild: requiredString(record.whatToBuild, `Ticket #${index + 1} what-to-build description`),
      acceptance: listOfStrings(record.acceptance, `Ticket #${index + 1} acceptance criteria`),
      blockedBy: validateBlockerIndexes(record.blockedBy, `Ticket #${index + 1} blockers`, index),
    }
  })
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function listOfStrings(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value
}

function validateBlockerIndexes(value: unknown, label: string, ownIndex: number): number[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of blocker indexes`)
  const indexes: number[] = []
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item >= ownIndex) {
      throw new Error(`${label} must reference earlier tickets only (0-based indexes below ${ownIndex})`)
    }
    indexes.push(item)
  }
  return [...new Set(indexes)]
}

export function bodyReferencesSpec(body: string, specIssueNumber: number): boolean {
  return new RegExp(`^Part of #${specIssueNumber}\\.`, 'im').test(body)
}

export function blockedByFromBody(body: string): number[] {
  const line = /^Blocked by:\s*([^\n]+)$/im.exec(body)
  if (line === null) return []
  const numbers = new Set<number>()
  for (const match of (line[1] ?? '').matchAll(/#(\d+)/g)) {
    const number = Number(match[1])
    if (Number.isInteger(number)) numbers.add(number)
  }
  return [...numbers]
}

export function ticketBody(input: {
  repo: string
  specIssueNumber: number
  whatToBuild: string
  acceptance: string[]
}): string {
  const criteria =
    input.acceptance.length > 0
      ? input.acceptance.map((item) => `- [ ] ${item}`).join('\n')
      : '- [ ] The slice is delivered end to end and verified'
  return [
    `Part of #${input.specIssueNumber}.`,
    '',
    '## Parent',
    '',
    `Cut from the accepted [spec #${input.specIssueNumber}](https://github.com/${input.repo}/issues/${input.specIssueNumber}) by the tickets stage.`,
    '',
    '## What to build',
    '',
    input.whatToBuild,
    '',
    '## Acceptance criteria',
    '',
    criteria,
  ].join('\n')
}

export function ticketBodyWithBlockedBy(body: string, blockedBy: number[]): string {
  const line = `Blocked by: ${blockedBy.map((number) => `#${number}`).join(', ')}`
  const existing = /^Blocked by:.*$/im.exec(body)
  if (existing !== null) {
    return body.replace(/^Blocked by:.*$/im, line)
  }
  const [head = '', ...rest] = body.split('\n')
  return [head, line, ...rest].join('\n')
}

export async function cutTickets(input: CutTicketsInput): Promise<CutTicketsOutput> {
  const { repo, specIssueNumber, env, ghBin } = resolveTrackerContext(input)
  await ensureTicketLabel(repo, ghBin, env)

  const created: CutTicket[] = []
  let fallbackUsed = false

  for (const draft of input.drafts) {
    const blockerNumbers: number[] = []
    for (const index of draft.blockedBy) {
      const prior = created[index]
      if (prior === undefined) {
        throw new Error(`Ticket "${draft.title}" lists a blocker that was not created earlier`)
      }
      blockerNumbers.push(prior.number)
    }

    const initialBody = ticketBody({
      repo,
      specIssueNumber,
      whatToBuild: draft.whatToBuild,
      acceptance: draft.acceptance,
    })
    const createdOut = await runGh(
      ghBin,
      [
        'issue',
        'create',
        '--repo',
        repo,
        '--title',
        draft.title,
        '--body',
        initialBody,
        '--label',
        TICKET_LABEL,
        '--json',
        'number,url,title',
      ],
      env,
    )
    const parsed = JSON.parse(createdOut) as { number: number; url: string; title: string }
    if (!Number.isInteger(parsed.number)) {
      throw new Error(`gh issue create returned no issue number for "${draft.title}"`)
    }

    let textFallback = false
    for (const blockerNumber of blockerNumbers) {
      const blockerDbId = await issueDatabaseId(repo, blockerNumber, ghBin, env)
      let native: boolean
      try {
        await runGh(
          ghBin,
          [
            'api',
            '--method',
            'POST',
            `repos/${repo}/issues/${parsed.number}/dependencies/blocked_by`,
            '-F',
            `issue_id=${blockerDbId}`,
          ],
          env,
        )
        native = true
      } catch {
        native = false
      }
      if (!native) textFallback = true
    }

    let blockerMode: CutTicket['blockerMode'] = 'none'
    if (blockerNumbers.length > 0) {
      if (textFallback) {
        const finalBody = ticketBodyWithBlockedBy(initialBody, blockerNumbers)
        await runGh(ghBin, ['issue', 'edit', String(parsed.number), '--repo', repo, '--body', finalBody], env)
        fallbackUsed = true
        blockerMode = 'body'
      } else {
        blockerMode = 'native'
      }
    }

    created.push({
      number: parsed.number,
      url: parsed.url,
      title: parsed.title,
      blockedByNumbers: blockerNumbers,
      blockerMode,
    })
  }

  return { repo, specIssueNumber, tickets: created, fallbackUsed }
}

async function ensureTicketLabel(repo: string, ghBin: string, env: NodeJS.ProcessEnv): Promise<void> {
  const existing = await runGh(
    ghBin,
    ['label', 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name'],
    env,
  )
  const hasLabel = existing
    .split(/\r?\n/)
    .some((name) => name.trim() === TICKET_LABEL)
  if (hasLabel) return
  await runGh(
    ghBin,
    [
      'label',
      'create',
      TICKET_LABEL,
      '--repo',
      repo,
      '--color',
      '0e8a16',
      '--description',
      'Fully specified, ready for an AFK agent',
    ],
    env,
  )
}

async function issueDatabaseId(repo: string, issueNumber: number, ghBin: string, env: NodeJS.ProcessEnv): Promise<number> {
  const out = (await runGh(ghBin, ['api', `repos/${repo}/issues/${issueNumber}`, '--jq', '.id'], env)).trim()
  const id = Number(out)
  if (!Number.isInteger(id)) {
    throw new Error(`Cannot resolve the database id of blocker #${issueNumber} in ${repo}`)
  }
  return id
}

interface LaneIssueRow {
  number: number
  title: string
  body: string
  url: string
  assignees: Array<{ login: string }>
  labels: Array<{ name: string }>
}

export async function listLineTickets(input: TrackerContext): Promise<TicketView[]> {
  const { repo, specIssueNumber, env, ghBin } = resolveTrackerContext(input)
  const out = await runGh(
    ghBin,
    [
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--json',
      'number,title,body,url,assignees,labels',
      '--limit',
      '100',
    ],
    env,
  )
  const issues = JSON.parse(out) as LaneIssueRow[]
  return issues
    .filter((issue) => bodyReferencesSpec(issue.body ?? '', specIssueNumber))
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      url: issue.url,
      assignees: (issue.assignees ?? []).map((assignee) => assignee.login),
      labels: (issue.labels ?? []).map((label) => label.name),
    }))
    .sort((a, b) => a.number - b.number)
}

async function nativeOpenBlockers(repo: string, issueNumber: number, ghBin: string, env: NodeJS.ProcessEnv): Promise<number[]> {
  const jq = '(.issue_dependencies_summary?.blocked_by? // []) | map(.number)'
  try {
    const out = await runGh(ghBin, ['api', `repos/${repo}/issues/${issueNumber}`, '--jq', jq], env)
    const parsed: unknown = JSON.parse(out)
    if (Array.isArray(parsed)) return parsed.filter((item): item is number => typeof item === 'number')
    return []
  } catch {
    return []
  }
}

export async function listFrontier(input: TrackerContext): Promise<TicketView[]> {
  const { repo, ghBin, env } = resolveTrackerContext(input)
  const tickets = await listLineTickets(input)
  const openNumbers = new Set(tickets.map((ticket) => ticket.number))
  const frontier: TicketView[] = []
  for (const ticket of tickets) {
    const native = await nativeOpenBlockers(repo, ticket.number, ghBin, env)
    const body = blockedByFromBody(ticket.body)
    const blockers = [...new Set([...native, ...body])]
    const isBlocked = blockers.some((number) => openNumbers.has(number))
    if (isBlocked) continue
    if (ticket.assignees.length > 0) continue
    frontier.push(ticket)
  }
  return frontier.sort((a, b) => a.number - b.number)
}

export async function fetchAcceptedSpec(input: TrackerContext): Promise<string> {
  const { repo, specIssueNumber, env, ghBin } = resolveTrackerContext(input)
  const out = await runGh(
    ghBin,
    ['issue', 'view', String(specIssueNumber), '--repo', repo, '--json', 'comments,state'],
    env,
  )
  const parsed = JSON.parse(out) as {
    comments?: Array<{ body?: string }>
    state?: string
  }
  if (parsed.state !== 'CLOSED') {
    throw new Error(
      `Spec ${repo}#${specIssueNumber} is not closed — the spec gate must close the issue when it accepts the spec, before tickets can be cut`,
    )
  }
  const comments = parsed.comments ?? []
  const last = comments[comments.length - 1]
  if (last === undefined || last.body === undefined || last.body.trim().length === 0) {
    throw new Error(
      `No accepted spec found on ${repo}#${specIssueNumber} — the spec gate must post the accepted spec as a stage-report comment before tickets can be cut`,
    )
  }
  return last.body
}