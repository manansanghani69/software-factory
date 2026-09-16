import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyStubMode, isStubEnvSet, resolveStub } from '../src/stub.ts'

test('isStubEnvSet treats 1 and true as on, everything else off', () => {
  assert.equal(isStubEnvSet({ FACTORY_STUB: '1' }), true)
  assert.equal(isStubEnvSet({ FACTORY_STUB: 'true' }), true)
  assert.equal(isStubEnvSet({ FACTORY_STUB: 'TRUE' }), true)
  assert.equal(isStubEnvSet({ FACTORY_STUB: '0' }), false)
  assert.equal(isStubEnvSet({ FACTORY_STUB: 'false' }), false)
  assert.equal(isStubEnvSet({ FACTORY_STUB: '' }), false)
  assert.equal(isStubEnvSet({}), false)
})

test('resolveStub precedence is flag then env', () => {
  assert.deepEqual(resolveStub(true, { FACTORY_STUB: '1' }), { enabled: true, source: 'flag' })
  assert.deepEqual(resolveStub(false, { FACTORY_STUB: '1' }), { enabled: true, source: 'env' })
  assert.deepEqual(resolveStub(false, {}), { enabled: false, source: 'off' })
})

test('applyStubMode normalizes to FACTORY_STUB env for downstream agents', () => {
  const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'x' }
  applyStubMode(env, true)
  assert.equal(env.FACTORY_STUB, '1')
  applyStubMode(env, false)
  assert.equal('FACTORY_STUB' in env, false)
})