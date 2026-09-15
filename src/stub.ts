export type StubSource = 'flag' | 'env' | 'off'

export interface StubResolution {
  enabled: boolean
  source: StubSource
}

export function isStubEnvSet(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.FACTORY_STUB
  if (value === undefined || value === '') return false
  return value === '1' || value.toLowerCase() === 'true'
}

export function resolveStub(flag: boolean, env: NodeJS.ProcessEnv = process.env): StubResolution {
  if (flag) return { enabled: true, source: 'flag' }
  if (isStubEnvSet(env)) return { enabled: true, source: 'env' }
  return { enabled: false, source: 'off' }
}

export function applyStubMode(env: NodeJS.ProcessEnv, enabled: boolean): void {
  if (enabled) {
    env.FACTORY_STUB = '1'
  } else {
    delete env.FACTORY_STUB
  }
}