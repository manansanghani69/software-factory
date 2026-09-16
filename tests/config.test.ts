import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, STAGES, loadConfig, modelForStage } from '../src/config.ts'

function tempFactoryRoot(partial?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'factory-config-'))
  mkdirSync(join(dir, '.factory', 'state'), { recursive: true })
  if (partial !== undefined) {
    writeFileSync(join(dir, '.factory', 'config.json'), JSON.stringify(partial))
  }
  return dir
}

test('loadConfig falls back to defaults when no config file exists', () => {
  const root = tempFactoryRoot()
  try {
    const config = loadConfig(root)
    assert.deepEqual(config, DEFAULT_CONFIG)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadConfig merges partial config over defaults', () => {
  const root = tempFactoryRoot({ reviseCap: 3 })
  try {
    const config = loadConfig(root)
    assert.equal(config.reviseCap, 3)
    assert.equal(config.models.default, DEFAULT_CONFIG.models.default)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadConfig lets config override a single stage model', () => {
  const root = tempFactoryRoot({ models: { stages: { review: 'openai/gpt-5' } } })
  try {
    const config = loadConfig(root)
    assert.equal(config.models.stages.review, 'openai/gpt-5')
    assert.equal(config.models.stages.sharpening, DEFAULT_CONFIG.models.stages.sharpening)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadConfig throws on malformed config', () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-config-'))
  mkdirSync(join(root, '.factory'), { recursive: true })
  writeFileSync(join(root, '.factory', 'config.json'), 'not json')
  try {
    assert.throws(() => loadConfig(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('modelForStage prefers FACTORY_MODEL_<STAGE> env, then config, then stage model', () => {
  const config = loadConfig(tempFactoryRoot())
  assert.equal(
    modelForStage(config, 'review', { FACTORY_MODEL_REVIEW: 'openrouter/deepseek' }),
    'openrouter/deepseek',
  )
  assert.equal(modelForStage(config, 'review', { FACTORY_MODEL_SPEC: 'openrouter/deepseek' }), config.models.stages.review)
  assert.equal(modelForStage(config, 'review', {}), config.models.stages.review)
  assert.equal(modelForStage(config, 'review', { FACTORY_MODEL_REVIEW: '' }), config.models.stages.review)
})

test('modelForStage resolves every stage through the config table', () => {
  const config = loadConfig(tempFactoryRoot())
  for (const stage of STAGES) {
    const model = modelForStage(config, stage, {})
    assert.equal(model, config.models.stages[stage])
  }
})