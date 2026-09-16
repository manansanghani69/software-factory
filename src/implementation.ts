import { basename, dirname, join } from 'node:path'
import { resolveGhBin, runGh } from './github.ts'
import { postComment } from './fork.ts'
import { listFrontier, type TicketView } from './tickets.ts'
import { isStubEnvSet } from './stub.ts'
import { createStageAgent } from './mastra/stage-agent.ts'
import { loadStageInstructions } from './skills.ts'
import { addAll, commit, createWorktreeBranch, currentBranch, push } from './git.ts'
import type { FactoryConfig } from './config.ts'

export interface ImplementInput {
  repo: string
  productRoot: string
  issueNumber: number
  config: FactoryConfig
  env: NodeJS.ProcessEnv
}

export interface ImplementResult {
  ticket: { number: number; title: string }
  branch: string
  pr: { number: number; url: string }
  mode: 'stub' | 'live'
  stageReportUrl: string
}

export class ImplementError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImplementError'
  }
}

export function branchName(ticketNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return `impl/${ticketNumber}-${slug}`
}

export function implementationCheckoutRoot(productRoot: string, branch: string): string {
  const checkoutName = `${basename(productRoot)}-${branch.replace(/[^a-zA-Z0-9._-]+/g, '-')}`
  return join(dirname(productRoot), checkoutName)
}

const DEFAULT_IMPLEMENT_INSTRUCTIONS = `You are the implementation stage of the AI Software Factory.

Given one frontier ticket from a Product's line you carry out the ticket's work on the sibling checkout and open a PR.

- Work against the ticket's \`whatToBuild\` and \`acceptance criteria\`.
- Deliver the narrowest vertical slice that satisfies the acceptance criteria, using the Product's existing stack and domain vocabulary.
- Leave the working tree changed so the drive can commit and push it.`

function implementTicketPrompt(ticket: TicketView, specIssueNumber: number): string {
  return [
    'Implement the ticket below on the current checkout. Return ONLY a concise summary of the change you made (what it does and where it lives), with no prose before or after.',
    '',
    `Line ticket #${ticket.number}: ${ticket.title}`,
    '',
    ticket.body,
    `Part of spec #${specIssueNumber}.`,
  ].join('\n')
}

const STUB_SUMMARY = 'Stub mode: no agent was called. The drive mechanics were exercised end to end — a placeholder commit and PR were produced for verification.'

async function summarizeImplementation(
  ticket: TicketView,
  specIssueNumber: number,
  stub: boolean,
  config: FactoryConfig,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  if (stub) {
    return STUB_SUMMARY
  }
  const instructions = loadStageInstructions('implementation', env) || DEFAULT_IMPLEMENT_INSTRUCTIONS
  const agent = createStageAgent('implementation', config, env, instructions)
  const response = await agent.generate(implementTicketPrompt(ticket, specIssueNumber))
  const text = typeof response.text === 'string' ? response.text : JSON.stringify(response.text)
  return text.trim().length > 0 ? text : 'The implementation agent returned no summary.'
}

export async function runImplementCommand(input: ImplementInput): Promise<ImplementResult> {
  const { repo, productRoot, issueNumber, config, env } = input
  const ghBin = resolveGhBin(env)
  const stub = isStubEnvSet(env)

  const frontier = await listFrontier({ repo, specIssueNumber: issueNumber, env })
  if (frontier.length === 0) {
    throw new ImplementError(
      `no unblocked, unclaimed tickets on the frontier for ${repo} (spec #${issueNumber}) — nothing to implement`,
    )
  }

  const ticket = frontier[0]
  if (ticket === undefined) {
    throw new ImplementError('frontier returned no tickets')
  }
  const branch = branchName(ticket.number, ticket.title)
  const checkoutRoot = implementationCheckoutRoot(productRoot, branch)
  const baseBranch = await currentBranch(productRoot)

  await runGh(ghBin, ['issue', 'edit', String(ticket.number), '--repo', repo, '--add-assignee', '@me'], env)
  await createWorktreeBranch(productRoot, checkoutRoot, branch, baseBranch)
  const summary = await summarizeImplementation(ticket, issueNumber, stub, config, env)
  await addAll(checkoutRoot)
  await commit(checkoutRoot, `Implement #${ticket.number}: ${ticket.title}`)
  await push(checkoutRoot, branch)

  const prBody = [
    `Part of #${issueNumber}.`,
    '',
    `Closes #${ticket.number}`,
    '',
    summary,
  ].join('\n')

  const prOut = await runGh(
    ghBin,
    [
      'pr',
      'create',
      '--repo',
      repo,
      '--title',
      `[Implementation] ${ticket.title}`,
      '--body',
      prBody,
      '--head',
      branch,
      '--base',
      baseBranch,
      '--json',
      'number,url,title',
    ],
    env,
  )
  const prParsed = JSON.parse(prOut) as { number: number; url: string; title: string }

  const stageReport = [
    '## Stage report — implementation',
    '',
    `**Ticket:** #${ticket.number} — ${ticket.title}`,
    `**Branch:** \`${branch}\``,
    `**PR:** #${prParsed.number} (${prParsed.url})`,
    `**Mode:** ${stub ? 'stub' : 'live'}`,
    '',
    stub
      ? `${STUB_SUMMARY}`
      : `The implementation agent was briefed with the ticket and returned the summary recorded on the PR. No code changes are attached yet — file tooling lands with the review drive, which re-runs implementation against the bar.`,
  ].join('\n')

  await postComment({ repo, issueNumber, env, ghBin }, stageReport)

  return {
    ticket: { number: ticket.number, title: ticket.title },
    branch,
    pr: { number: prParsed.number, url: prParsed.url },
    mode: stub ? 'stub' : 'live',
    stageReportUrl: `https://github.com/${repo}/issues/${issueNumber}`,
  }
}
