import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export const FACTORY_DIR_NAME = '.factory'
export const STATE_DIR_NAME = 'state'
export const CONFIG_FILE_NAME = 'config.json'
export const WORKFLOWS_DB_FILE_NAME = 'workflows.db'

export interface FactoryPaths {
  root: string
  configPath: string
  stateDir: string
  workflowsDbPath: string
}

export function findFactoryRoot(start = process.cwd()): string | null {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, FACTORY_DIR_NAME))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function factoryPaths(root: string): FactoryPaths {
  return {
    root,
    configPath: join(root, FACTORY_DIR_NAME, CONFIG_FILE_NAME),
    stateDir: join(root, FACTORY_DIR_NAME, STATE_DIR_NAME),
    workflowsDbPath: join(root, FACTORY_DIR_NAME, STATE_DIR_NAME, WORKFLOWS_DB_FILE_NAME),
  }
}

export function relativeToRoot(root: string, absolute: string): string {
  return relative(root, absolute)
}