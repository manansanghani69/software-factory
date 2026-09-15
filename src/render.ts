import type { StubResolution } from './stub.ts'

export function formatStubMode(stub: StubResolution): string {
  switch (stub.source) {
    case 'flag':
      return 'on (via --stub)'
    case 'env':
      return 'on (via FACTORY_STUB)'
    case 'off':
      return 'off'
  }
}