import { homedir } from 'node:os'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadStageInstructions, skillsDir, stageSkillName } from '../src/skills.ts'

test('stageSkillName maps the tickets stage to to-tickets and implementation to implement', () => {
  assert.equal(stageSkillName('tickets'), 'to-tickets')
  assert.equal(stageSkillName('implementation'), 'implement')
  assert.equal(stageSkillName('review'), 'code-review')
})

test('skillsDir defaults to the home-agent skills path and honors the override', () => {
  assert.equal(skillsDir({}), join(homedir(), '.agents', 'skills'))
  assert.equal(skillsDir({ FACTORY_SKILLS_DIR: '' }), join(homedir(), '.agents', 'skills'))
  assert.equal(skillsDir({ FACTORY_SKILLS_DIR: 'C:/override' }), 'C:/override')
})

test('loadStageInstructions reads the tickets skill from the configured skills directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-skills-'))
  mkdirSync(join(dir, 'to-tickets'), { recursive: true })
  writeFileSync(join(dir, 'to-tickets', 'SKILL.md'), 'Cut tickets natively.\n', 'utf-8')
  try {
    const instructions = loadStageInstructions('tickets', { FACTORY_SKILLS_DIR: dir })
    assert.equal(instructions, 'Cut tickets natively.')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadStageInstructions is empty when the file is missing or the stage is unmapped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-skills-'))
  try {
    assert.equal(loadStageInstructions('tickets', { FACTORY_SKILLS_DIR: dir }), '')
    assert.equal(loadStageInstructions('implementation', { FACTORY_SKILLS_DIR: dir }), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})