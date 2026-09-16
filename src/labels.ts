import { resolveGhBin, runGh } from './github.ts'

export const NEEDS_TRIAGE_LABEL = 'needs-triage'
export const READY_FOR_AGENT_LABEL = 'ready-for-agent'

export const INHERITED_LABELS = [
  { name: NEEDS_TRIAGE_LABEL, color: 'fbca04', description: 'Maintainer needs to evaluate this issue' },
  { name: 'needs-info', color: 'aaaaaa', description: 'Waiting on reporter for more information' },
  { name: READY_FOR_AGENT_LABEL, color: '0e8a16', description: 'Fully specified, ready for an AFK agent' },
  { name: 'ready-for-human', color: '0e8a16', description: 'Requires human implementation' },
  { name: 'wontfix', color: 'ffffff', description: 'Will not be actioned' },
] as const

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