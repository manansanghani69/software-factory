import { existsSync, readFileSync } from 'node:fs'
import { factoryPaths } from './paths.ts'

export const STAGES = ['sharpening', 'spec', 'tickets', 'implementation', 'review', 'ship'] as const
export type StageId = (typeof STAGES)[number]

export interface FactoryConfig {
  reviseCap: number
  models: {
    default: string
    stages: Record<StageId, string>
  }
}

export const DEFAULT_CONFIG: FactoryConfig = {
  reviseCap: 2,
  models: {
    default: 'anthropic/claude-sonnet-4-6',
    stages: {
      sharpening: 'anthropic/claude-sonnet-4-6',
      spec: 'anthropic/claude-sonnet-4-6',
      tickets: 'anthropic/claude-sonnet-4-6',
      implementation: 'anthropic/claude-sonnet-4-6',
      review: 'anthropic/claude-sonnet-4-6',
      ship: 'anthropic/claude-sonnet-4-6',
    },
  },
}

export function loadConfig(root: string): FactoryConfig {
  const configPath = factoryPaths(root).configPath
  let file: Partial<FactoryConfig> = {}
  if (existsSync(configPath)) {
    const read = readFileSync(configPath, 'utf-8')
    if (read.trim().length > 0) {
      const parsed: unknown = JSON.parse(read)
      if (!isConfigLike(parsed)) {
        throw new Error(`Invalid factory config at ${configPath}`)
      }
      file = parsed
    }
  }
  const stageModels: Record<StageId, string> = { ...DEFAULT_CONFIG.models.stages }
  if (file.models?.stages) {
    for (const stage of STAGES) {
      const override = file.models.stages[stage]
      if (typeof override === 'string' && override.length > 0) stageModels[stage] = override
    }
  }
  return {
    reviseCap: typeof file.reviseCap === 'number' ? file.reviseCap : DEFAULT_CONFIG.reviseCap,
    models: {
      default: typeof file.models?.default === 'string' ? file.models.default : DEFAULT_CONFIG.models.default,
      stages: stageModels,
    },
  }
}

function isConfigLike(value: unknown): value is Partial<FactoryConfig> {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if ('reviseCap' in record && typeof record.reviseCap !== 'number') return false
  if ('models' in record) {
    const models = record.models as Record<string, unknown>
    if (typeof models !== 'object' || models === null) return false
    if ('default' in models && typeof models.default !== 'string') return false
    if ('stages' in models && (typeof models.stages !== 'object' || models.stages === null)) return false
  }
  return true
}

export function modelForStage(config: FactoryConfig, stage: StageId, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[`FACTORY_MODEL_${stage.toUpperCase()}`]
  if (override !== undefined && override.length > 0) return override
  return config.models.stages[stage] ?? config.models.default
}