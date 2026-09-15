import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findFactoryRoot, factoryPaths, relativeToRoot } from '../src/paths.ts'

test('findFactoryRoot walks up to the nearest .factory directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-paths-'))
  mkdirSync(join(root, '.factory'))
  const nested = join(root, 'a', 'b', 'c')
  mkdirSync(nested, { recursive: true })
  try {
    assert.equal(findFactoryRoot(nested), root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('findFactoryRoot returns null when no .factory exists upward', () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-paths-'))
  try {
    assert.equal(findFactoryRoot(root), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('factoryPaths lays out config and state under .factory', () => {
  const paths = factoryPaths('C:/repo')
  assert.equal(paths.configPath, join('C:/repo', '.factory', 'config.json'))
  assert.equal(paths.stateDir, join('C:/repo', '.factory', 'state'))
  assert.equal(paths.workflowsDbPath, join('C:/repo', '.factory', 'state', 'workflows.db'))
})

test('relativeToRoot renders paths relative to the factory root', () => {
  assert.equal(relativeToRoot('C:/repo', 'C:/repo/.factory/config.json'), join('.factory', 'config.json'))
})