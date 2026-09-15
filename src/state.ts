import { existsSync } from 'node:fs'
import { factoryPaths, relativeToRoot, type FactoryPaths } from './paths.ts'

export interface StateFileReport {
  name: string
  path: string
  present: boolean
}

export interface StateReport {
  paths: FactoryPaths
  configPresent: boolean
  stateDirPresent: boolean
  files: StateFileReport[]
}

export function describeState(root: string): StateReport {
  const paths = factoryPaths(root)
  return {
    paths,
    configPresent: existsSync(paths.configPath),
    stateDirPresent: existsSync(paths.stateDir),
    files: [
      {
        name: 'workflows.db',
        path: relativeToRoot(root, paths.workflowsDbPath),
        present: existsSync(paths.workflowsDbPath),
      },
    ],
  }
}