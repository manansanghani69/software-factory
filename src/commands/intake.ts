import { enterIntakeRequest, type EnterIntakeRequestOutput } from '../intake.ts'

export interface IntakeCommandInput {
  env: NodeJS.ProcessEnv
  repo: string
  title: string
  body?: string
}

export type IntakeCommandResult = EnterIntakeRequestOutput

export async function runIntakeCommand(input: IntakeCommandInput): Promise<IntakeCommandResult> {
  return enterIntakeRequest({ repo: input.repo, title: input.title, body: input.body ?? '', env: input.env })
}

export function renderIntakeResult(result: IntakeCommandResult): string {
  const lines: string[] = [
    'REQUEST INTAKE',
    `  repo: ${result.repo}`,
    `  request: #${result.request.number}  ${result.request.title}`,
    `  url: ${result.request.url}`,
    `  labels: ${result.enteredWith.join(', ')} → ${result.triagedTo.join(', ')}`,
    `  END — 1 request(s) triaged`,
  ]
  return lines.join('\n')
}