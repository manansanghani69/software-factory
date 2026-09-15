import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, STAGES, type FactoryConfig } from '../src/config.ts'
import { createStageAgent } from '../src/mastra/stage-agent.ts'

test('FACTORY_MODEL_<STAGE> overrides one stage model without touching the others', async () => {
  const env = { FACTORY_MODEL_REVIEW: 'openai/gpt-4o' }
  const review = await createStageAgent('review', DEFAULT_CONFIG, env).getModel()
  assert.equal(review.provider, 'openai')
  assert.equal(review.modelId, 'gpt-4o')

  const sharpening = await createStageAgent('sharpening', DEFAULT_CONFIG, env).getModel()
  assert.equal(sharpening.provider, 'anthropic')
  assert.equal(sharpening.modelId, 'claude-sonnet-4-6')
})

test('createStageAgent routes every Line stage to the v1 default from config', async () => {
  for (const stage of STAGES) {
    const model = await createStageAgent(stage, DEFAULT_CONFIG, {}).getModel()
    assert.equal(model.provider, 'anthropic', stage)
    assert.equal(model.modelId, 'claude-sonnet-4-6', stage)
  }
})

test('a config stage-model override is the model Mastra binds at construction', async () => {
  const config: FactoryConfig = {
    ...DEFAULT_CONFIG,
    models: {
      ...DEFAULT_CONFIG.models,
      stages: { ...DEFAULT_CONFIG.models.stages, implementation: 'openai/gpt-4o' },
    },
  }
  const implementation = await createStageAgent('implementation', config, {}).getModel()
  assert.equal(implementation.provider, 'openai')
  assert.equal(implementation.modelId, 'gpt-4o')

  const tickets = await createStageAgent('tickets', config, {}).getModel()
  assert.equal(tickets.provider, 'anthropic')
  assert.equal(tickets.modelId, 'claude-sonnet-4-6')
})
