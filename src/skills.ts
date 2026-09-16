import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SKILL_NAMES: Readonly<Record<string, string>> = {
  tickets: 'to-tickets',
  implementation: 'implement',
  review: 'code-review',
}

export function stageSkillName(stage: string): string | null {
  return SKILL_NAMES[stage] ?? null
}

export function skillsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.FACTORY_SKILLS_DIR
  if (override !== undefined && override.length > 0) return override
  return join(homedir(), '.agents', 'skills')
}

export function loadStageInstructions(stage: string, env: NodeJS.ProcessEnv = process.env): string {
  const name = stageSkillName(stage)
  if (name === null) return ''
  const filePath = join(skillsDir(env), name, 'SKILL.md')
  try {
    return readFileSync(filePath, 'utf-8').trim()
  } catch {
    return ''
  }
}