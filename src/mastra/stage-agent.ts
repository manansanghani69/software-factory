import { Agent } from '@mastra/core/agent'
import { modelForStage } from '../config.ts'
import type { FactoryConfig, StageId } from '../config.ts'

export function createStageAgent(
  stage: StageId,
  config: FactoryConfig,
  env: NodeJS.ProcessEnv = process.env,
  instructions = '',
): Agent {
  return new Agent({
    id: `${stage}-agent`,
    name: `${stage} agent`,
    instructions,
    model: modelForStage(config, stage, env),
  })
}

export function createReviewerAgent(
  config: FactoryConfig,
  env: NodeJS.ProcessEnv = process.env,
  instructions = '',
): Agent {
  return new Agent({
    id: 'reviewer-agent',
    name: 'reviewer agent',
    instructions,
    model: modelForStage(config, 'review', env),
  })
}
