import type { FactoryConfig } from '../config.ts'
import { createStageAgent } from '../mastra/stage-agent.ts'
import { loadStageInstructions } from '../skills.ts'
import { isStubEnvSet } from '../stub.ts'
import {
  cutTickets,
  extractJsonArray,
  fetchAcceptedSpec,
  listFrontier,
  parseTicketDrafts,
  planTicketsStub,
  type CutTicketsOutput,
  type TicketDraft,
  type TicketView,
} from '../tickets.ts'

export interface TicketsCommandInput {
  env: NodeJS.ProcessEnv
  repo: string
  specIssueNumber: number
  frontierOnly: boolean
  config: FactoryConfig
}

export type TicketsCommandResult =
  | { kind: 'frontier'; repo: string; specIssueNumber: number; tickets: TicketView[] }
  | {
      kind: 'cut'
      repo: string
      specIssueNumber: number
      mode: 'stub' | 'live'
      cut: CutTicketsOutput
      frontier: TicketView[]
    }

const DEFAULT_TICKETS_INSTRUCTIONS = `You are the tickets stage of the AI Software Factory.

Given an accepted Product spec you cut tracer-bullet implementation tickets into the Product's tracker.

- A ticket is one tracer-bullet vertical slice: a narrow but complete path through the stack, demoable on its own, sized to fit a single agent session.
- Tickets use the Product's domain vocabulary from the spec.
- Order the tickets so every ticket may only be blocked by earlier tickets (blockers first).
- Every ticket lands as an issue carrying the tracker's ready-for-agent triage label.
- The first line of every ticket body is "Part of #<spec>", and blocking edges are wired natively on the tracker.

Return ONLY a JSON array. Each element is an object:
{
  "title": "short deliverable name",
  "whatToBuild": "what the end-to-end behaviour this ticket delivers is, in domain terms",
  "acceptance": ["checkable behaviour 1", "checkable behaviour 2"],
  "blockedBy": [0, 2]
}
blockedBy holds 0-based indexes of earlier tickets that must land first; omit it for tickets that can start immediately.`

function ticketsPrompt(spec: string): string {
  return [
    'Cut the tickets for the accepted spec below. Return ONLY a JSON array of ticket objects as your instructions describe, with no prose before or after.',
    '',
    'Accepted spec:',
    '',
    spec,
  ].join('\n')
}

async function planTicketsLive(input: {
  spec: string
  config: FactoryConfig
  env: NodeJS.ProcessEnv
}): Promise<TicketDraft[]> {
  const instructions = loadStageInstructions('tickets', input.env) || DEFAULT_TICKETS_INSTRUCTIONS
  const agent = createStageAgent('tickets', input.config, input.env, instructions)
  const response = await agent.generate(ticketsPrompt(input.spec))
  const text = typeof response.text === 'string' ? response.text : JSON.stringify(response.text)
  return parseTicketDrafts(extractJsonArray(text))
}

export async function runTicketsCommand(input: TicketsCommandInput): Promise<TicketsCommandResult> {
  const { repo, specIssueNumber, env } = input
  if (input.frontierOnly) {
    const tickets = await listFrontier({ repo, specIssueNumber, env })
    return { kind: 'frontier', repo, specIssueNumber, tickets }
  }

  const spec = await fetchAcceptedSpec({ repo, specIssueNumber, env })
  const stub = isStubEnvSet(env)
  const drafts: TicketDraft[] = stub
    ? planTicketsStub(spec)
    : await planTicketsLive({ spec, config: input.config, env })
  const cut = await cutTickets({ repo, specIssueNumber, drafts, env })
  const frontier = await listFrontier({ repo, specIssueNumber, env })
  return { kind: 'cut', repo, specIssueNumber, mode: stub ? 'stub' : 'live', cut, frontier }
}

export function renderTicketsResult(result: TicketsCommandResult): string {
  if (result.kind === 'frontier') {
    const lines: string[] = [`FRONTIER — ${result.repo} (spec #${result.specIssueNumber})`]
    appendFrontier(lines, result.tickets)
    return lines.join('\n')
  }

  const cut = result.cut
  const lines: string[] = [
    'TICKETS CUT',
    `  repo: ${cut.repo}`,
    `  spec: #${cut.specIssueNumber}`,
    `  mode: ${result.mode}`,
    `  created: ${cut.tickets.length} ticket(s)`,
  ]
  for (const ticket of cut.tickets) {
    const blockers =
      ticket.blockedByNumbers.length === 0
        ? '(none)'
        : ticket.blockerMode === 'body'
          ? `#${ticket.blockedByNumbers.join(', #')} (body list)`
          : `#${ticket.blockedByNumbers.join(', #')} (native edge)`
    lines.push(`    #${ticket.number}  ${ticket.title} — blocked by: ${blockers}`)
  }
  if (cut.fallbackUsed) {
    lines.push('  note: native issue dependencies unavailable — Blocked by lists written to ticket bodies')
  }
  lines.push('')
  lines.push('FRONTIER — open, unblocked, unclaimed only')
  appendFrontier(lines, result.frontier)
  return lines.join('\n')
}

function appendFrontier(lines: string[], tickets: TicketView[]): void {
  if (tickets.length === 0) {
    lines.push('  (none — every open line ticket is claimed or blocked)')
    lines.push('  END — 0 ticket(s) on the frontier')
    return
  }
  for (const ticket of tickets) {
    lines.push(`  #${ticket.number}  ${ticket.title}`)
  }
  lines.push(`  END — ${tickets.length} ticket(s) on the frontier`)
}