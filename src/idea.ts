import { randomUUID } from 'node:crypto'
import { resolveGhBin, runGh } from './github.ts'
import { postComment } from './fork.ts'
import { ensureLabel } from './labels.ts'
import { createStageAgent } from './mastra/stage-agent.ts'
import { loadStageInstructions } from './skills.ts'
import { isStubEnvSet } from './stub.ts'
import { IDEA_LABEL, NEEDS_SHARPENING_LABEL } from './tracker.ts'
import { insertRun, updateRunStage } from './run-table.ts'
import type { FactoryConfig } from './config.ts'
import type { Disposition } from './review.ts'

export interface IdeaInput {
  product: string
  repo: string
  idea: string
  dbPath: string
  config: FactoryConfig
  env: NodeJS.ProcessEnv
}

export interface IdeaResult {
  product: string
  idea: { number: number; title: string; url: string }
  runId: string
  mode: 'stub' | 'live'
  spec: string
  stageReportUrl: string
}

export class IdeaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdeaError'
  }
}

const DEFAULT_SHARPENING_INSTRUCTIONS = `You are the sharpening stage of the AI Software Factory.

Given a raw Idea, produce a spec-shaped draft the Operator can accept or revise at the spec gate.

- Use the Product's domain vocabulary.
- Cover Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, and Out of Scope.
- Return ONLY the spec markdown, with no prose before or after.`

export function ideaIssueTitle(idea: string): string {
  const firstLine = idea.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (firstLine.length === 0) return 'Idea'
  if (/^idea:/i.test(firstLine)) return firstLine
  return `Idea: ${firstLine}`
}

export function ideaIssueBody(idea: string): string {
  return ['## Idea', '', idea.trim(), '', 'Entered through `factory idea`; the Factory drives sharpening to the spec gate.'].join(
    '\n',
  )
}

export function sharpenIdeaStub(idea: string, feedback?: string): string {
  const title = idea.trim().split(/\r?\n/, 1)[0]?.trim() || 'Idea'
  const lines = [
    `# ${title}`,
    '',
    '## Problem Statement',
    '',
    `The Operator wants: ${idea.trim()}`,
    '',
    '## Solution',
    '',
    'A web app that delivers that Idea end to end.',
    '',
    '## Testing Decisions',
    '',
    "Tests prove the Idea through the Product's public seams.",
    '',
    '## Out of Scope',
    '',
    'Work outside this Idea.',
  ]
  if (feedback !== undefined && feedback.trim().length > 0) {
    lines.push('', '## Operator feedback', '', feedback.trim())
  }
  return lines.join('\n')
}

function sharpeningPrompt(idea: string, feedback?: string): string {
  const lines = [
    'Sharpen the Idea below into a spec. Return ONLY the spec markdown, with no prose before or after.',
    '',
    idea.trim(),
  ]
  if (feedback !== undefined && feedback.trim().length > 0) {
    lines.push('', 'Operator feedback to apply:', '', feedback.trim())
  }
  return lines.join('\n')
}

export async function sharpenIdea(input: {
  idea: string
  stub: boolean
  config: FactoryConfig
  env: NodeJS.ProcessEnv
  feedback?: string
}): Promise<{ spec: string; instructionsSource: string }> {
  const loaded = loadStageInstructions('sharpening', input.env)
  const instructions = loaded || DEFAULT_SHARPENING_INSTRUCTIONS
  const instructionsSource = loaded.length > 0 ? 'to-spec' : 'default'
  if (input.stub) {
    return { spec: sharpenIdeaStub(input.idea, input.feedback), instructionsSource }
  }
  const agent = createStageAgent('sharpening', input.config, input.env, instructions)
  const response = await agent.generate(sharpeningPrompt(input.idea, input.feedback))
  const text = typeof response.text === 'string' ? response.text : JSON.stringify(response.text)
  const spec = text.trim().length > 0 ? text.trim() : sharpenIdeaStub(input.idea, input.feedback)
  return { spec, instructionsSource }
}

export function renderSharpeningStageReport(input: {
  issueNumber: number
  title: string
  mode: 'stub' | 'live'
  spec: string
  instructionsSource: string
}): string {
  return [
    '## Stage report — sharpening',
    '',
    `**Idea:** #${input.issueNumber} — ${input.title}`,
    `**Mode:** ${input.mode}`,
    '**Gate:** spec',
    `**Instructions:** ${input.instructionsSource}`,
    '',
    'The sharpening stage produced the draft spec below. The Line is suspended at the spec gate.',
    '',
    '---',
    '',
    input.spec,
  ].join('\n')
}

export function extractDraftSpec(stageReport: string): string | null {
  if (!stageReport.includes('## Stage report — sharpening')) return null
  const separator = '\n---\n'
  const index = stageReport.lastIndexOf(separator)
  if (index === -1) return null
  const spec = stageReport.slice(index + separator.length).trim()
  return spec.length > 0 ? spec : null
}

export async function runIdeaCommand(input: IdeaInput): Promise<IdeaResult> {
  const idea = input.idea.trim()
  if (idea.length === 0) {
    throw new IdeaError('an Idea needs some text')
  }
  if (input.repo.length === 0) {
    throw new IdeaError(`Product "${input.product}" has no repo configured in its registration`)
  }

  const env = input.env
  const ghBin = resolveGhBin(env)
  const stub = isStubEnvSet(env)
  const title = ideaIssueTitle(idea)

  await ensureLabel({
    repo: input.repo,
    label: IDEA_LABEL,
    color: 'f9d0c4',
    description: 'Raw Idea entering the Line through sharpening',
    env,
    ghBin,
  })
  await ensureLabel({
    repo: input.repo,
    label: NEEDS_SHARPENING_LABEL,
    color: 'fef2c0',
    description: 'Idea awaiting the sharpening stage',
    env,
    ghBin,
  })

  const createdOut = await runGh(
    ghBin,
    [
      'issue',
      'create',
      '--repo',
      input.repo,
      '--title',
      title,
      '--body',
      ideaIssueBody(idea),
      '--label',
      IDEA_LABEL,
      '--label',
      NEEDS_SHARPENING_LABEL,
      '--json',
      'number,url,title',
    ],
    env,
  )
  const parsed = JSON.parse(createdOut) as { number: number; url: string; title: string }
  if (!Number.isInteger(parsed.number)) {
    throw new IdeaError('gh issue create returned no issue number for the Idea')
  }

  const sharpened = await sharpenIdea({ idea, stub, config: input.config, env })
  const spec = sharpened.spec
  const mode: 'stub' | 'live' = stub ? 'stub' : 'live'
  await postComment(
    { repo: input.repo, issueNumber: parsed.number, env, ghBin },
    renderSharpeningStageReport({
      issueNumber: parsed.number,
      title: parsed.title,
      mode,
      spec,
      instructionsSource: sharpened.instructionsSource,
    }),
  )

  const runId = randomUUID()
  insertRun(input.dbPath, {
    runId,
    product: input.product,
    workflowName: `${input.product}-line`,
    stage: 'spec',
    suspension: 'spec-gate',
    issueNumber: parsed.number,
  })

  return {
    product: input.product,
    idea: { number: parsed.number, title: parsed.title, url: parsed.url },
    runId,
    mode,
    spec,
    stageReportUrl: `https://github.com/${input.repo}/issues/${parsed.number}`,
  }
}

export interface SpecGateEvidence {
  issueNumber: number
  title: string
  url: string
  spec: string
  idea: string
}

export interface SpecDispositionResult {
  product: string
  disposition: 'advance' | 'revise'
  issueNumber: number
  issueUrl: string
  spec: string
}

function ideaTextFromBody(body: string): string {
  const match = /## Idea\s*\n+([\s\S]*?)(?:\n## |\nEntered through|$)/.exec(body)
  return (match?.[1] ?? body).trim()
}

export async function loadSpecGateEvidence(input: {
  repo: string
  issueNumber: number
  env: NodeJS.ProcessEnv
  ghBin: string
}): Promise<SpecGateEvidence> {
  const out = await runGh(
    input.ghBin,
    ['issue', 'view', String(input.issueNumber), '--repo', input.repo, '--json', 'number,title,url,body,comments'],
    input.env,
  )
  const parsed = JSON.parse(out) as {
    number?: number
    title?: string
    url?: string
    body?: string
    comments?: Array<{ body?: string }>
  }
  let spec: string | null = null
  for (const comment of [...(parsed.comments ?? [])].reverse()) {
    if (typeof comment.body !== 'string') continue
    spec = extractDraftSpec(comment.body)
    if (spec !== null) break
  }
  if (spec === null) {
    throw new IdeaError(
      `No draft spec found on ${input.repo}#${input.issueNumber} — sharpening must post a stage report before the spec gate can open`,
    )
  }
  return {
    issueNumber: parsed.number ?? input.issueNumber,
    title: parsed.title ?? '',
    url: parsed.url ?? `https://github.com/${input.repo}/issues/${input.issueNumber}`,
    spec,
    idea: ideaTextFromBody(parsed.body ?? ''),
  }
}

export async function applySpecDisposition(input: {
  repo: string
  product: string
  issueNumber: number
  runId: string
  dbPath: string
  disposition: Disposition
  feedback?: string
  config: FactoryConfig
  env: NodeJS.ProcessEnv
}): Promise<SpecDispositionResult> {
  if (input.disposition === 'halt') {
    throw new IdeaError('halt is not a spec-gate Disposition — use advance or revise')
  }
  const env = input.env
  const ghBin = resolveGhBin(env)
  const evidence = await loadSpecGateEvidence({
    repo: input.repo,
    issueNumber: input.issueNumber,
    env,
    ghBin,
  })
  const issueUrl = evidence.url

  if (input.disposition === 'advance') {
    await postComment({ repo: input.repo, issueNumber: input.issueNumber, env, ghBin }, evidence.spec)
    await runGh(ghBin, ['issue', 'close', String(input.issueNumber), '--repo', input.repo], env)
    updateRunStage(input.dbPath, input.runId, 'tickets', null)
    return {
      product: input.product,
      disposition: 'advance',
      issueNumber: input.issueNumber,
      issueUrl,
      spec: evidence.spec,
    }
  }

  const feedback = input.feedback?.trim() ?? ''
  if (feedback.length === 0) {
    throw new IdeaError('revise at the spec gate needs --feedback with the Operator notes for the sharpener')
  }
  const stub = isStubEnvSet(env)
  const sharpened = await sharpenIdea({ idea: evidence.idea, stub, config: input.config, env, feedback })
  const spec = sharpened.spec
  const mode: 'stub' | 'live' = stub ? 'stub' : 'live'
  await postComment(
    { repo: input.repo, issueNumber: input.issueNumber, env, ghBin },
    renderSharpeningStageReport({
      issueNumber: input.issueNumber,
      title: evidence.title,
      mode,
      spec,
      instructionsSource: sharpened.instructionsSource,
    }),
  )
  updateRunStage(input.dbPath, input.runId, 'spec', 'spec-gate')
  return {
    product: input.product,
    disposition: 'revise',
    issueNumber: input.issueNumber,
    issueUrl,
    spec,
  }
}
