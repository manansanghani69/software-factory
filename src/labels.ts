import { resolveGhBin, runGh } from './github.ts'

export const NEEDS_TRIAGE_LABEL = 'needs-triage'
export const READY_FOR_AGENT_LABEL = 'ready-for-agent'

export interface EnsureLabelInput {
  repo: string
  label: string
  color: string
  description: string
  env: NodeJS.ProcessEnv
  ghBin?: string
}

export async function ensureLabel(input: EnsureLabelInput): Promise<void> {
  const ghBin = input.ghBin ?? resolveGhBin(input.env)
  const existing = await runGh(
    ghBin,
    ['label', 'list', '--repo', input.repo, '--json', 'name', '--jq', '.[].name'],
    input.env,
  )
  const hasLabel = existing
    .split(/\r?\n/)
    .some((name) => name.trim() === input.label)
  if (hasLabel) return
  await runGh(
    ghBin,
    ['label', 'create', input.label, '--repo', input.repo, '--color', input.color, '--description', input.description],
    input.env,
  )
}