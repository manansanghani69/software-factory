import { resolveGhBin, runGh } from './github.ts'
import { ensureLabel, NEEDS_TRIAGE_LABEL, READY_FOR_AGENT_LABEL } from './labels.ts'

export interface IntakeRequestView {
  number: number
  url: string
  title: string
  labels: string[]
}

export interface EnterIntakeRequestInput {
  repo: string
  title: string
  body: string
  env: NodeJS.ProcessEnv
  ghBin?: string
}

export interface EnterIntakeRequestOutput {
  repo: string
  request: IntakeRequestView
  enteredWith: string[]
  triagedTo: string[]
}

const INTAKE_BODY_DEFAULT = 'The Reporter gave no further detail — triage may need to ask for a repro or a clearer ask.'

export function requestBody(title: string, body: string): string {
  const detail = body.trim().length > 0 ? body.trim() : INTAKE_BODY_DEFAULT
  return [
    '## Request',
    '',
    detail,
    '',
    '## Intake',
    '',
    'Entered through the Factory intake ramp; triaged to agent-ready work.',
  ].join('\n')
}

export async function enterIntakeRequest(input: EnterIntakeRequestInput): Promise<EnterIntakeRequestOutput> {
  const ghBin = input.ghBin ?? resolveGhBin(input.env)
  const repo = input.repo

  await ensureLabel({
    repo,
    label: NEEDS_TRIAGE_LABEL,
    color: 'fbca04',
    description: 'Maintainer needs to evaluate this issue',
    env: input.env,
    ghBin,
  })
  await ensureLabel({
    repo,
    label: READY_FOR_AGENT_LABEL,
    color: '0e8a16',
    description: 'Fully specified, ready for an AFK agent',
    env: input.env,
    ghBin,
  })

  const createdOut = await runGh(
    ghBin,
    [
      'issue',
      'create',
      '--repo',
      repo,
      '--title',
      input.title,
      '--body',
      requestBody(input.title, input.body),
      '--label',
      NEEDS_TRIAGE_LABEL,
      '--json',
      'number,url,title',
    ],
    input.env,
  )
  const parsed = JSON.parse(createdOut) as { number: number; url: string; title: string }
  if (!Number.isInteger(parsed.number)) {
    throw new Error('gh issue create returned no issue number for the Request')
  }

  await runGh(
    ghBin,
    [
      'issue',
      'edit',
      String(parsed.number),
      '--repo',
      repo,
      '--add-label',
      READY_FOR_AGENT_LABEL,
      '--remove-label',
      NEEDS_TRIAGE_LABEL,
    ],
    input.env,
  )

  return {
    repo,
    request: { number: parsed.number, url: parsed.url, title: parsed.title, labels: [READY_FOR_AGENT_LABEL] },
    enteredWith: [NEEDS_TRIAGE_LABEL],
    triagedTo: [READY_FOR_AGENT_LABEL],
  }
}