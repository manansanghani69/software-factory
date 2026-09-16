import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveGhBin, resolveGhOwner, runGh } from '../github.ts'
import { INHERITED_LABELS, ensureLabel } from '../labels.ts'
import { isStubEnvSet } from '../stub.ts'
import {
  assertValidProductName,
  gitInitAndCommit,
  productTemplateDir,
  scaffoldProductFiles,
  writeProductRegistration,
} from '../scaffold.ts'

export interface NewProductResult {
  product: string
  dir: string
  repo: string
  labels: string[]
  files: string[]
  mode: 'stub' | 'live'
}

export async function runNewCommand(input: {
  root: string
  env: NodeJS.ProcessEnv
  product: string
}): Promise<NewProductResult> {
  const { root, env, product } = input
  const name = assertValidProductName(product)

  const targetDir = join(dirname(root), name)
  if (existsSync(targetDir)) {
    throw new Error(`A directory already exists at ${targetDir} — remove it or pick another Product name`)
  }

  const templateDir = productTemplateDir()
  if (!existsSync(templateDir)) {
    throw new Error(`Product template not found at ${templateDir}`)
  }

  const ghBin = resolveGhBin(env)
  const owner = await resolveGhOwner(ghBin, env)
  const repoSlug = `${owner}/${name}`
  const repoUrl = `https://github.com/${repoSlug}`

  const files = scaffoldProductFiles(targetDir, name, templateDir)
  writeProductRegistration(targetDir, { name, repo: repoUrl })

  gitInitAndCommit(targetDir, `Scaffold ${name} by the Factory`, env)

  await runGh(
    ghBin,
    ['repo', 'create', repoSlug, '--private', '--source', targetDir, '--remote', 'origin', '--push'],
    env,
  )

  for (const label of INHERITED_LABELS) {
    await ensureLabel({
      repo: repoSlug,
      label: label.name,
      color: label.color,
      description: label.description,
      env,
      ghBin,
    })
  }

  return {
    product: name,
    dir: targetDir,
    repo: repoUrl,
    labels: INHERITED_LABELS.map((item) => item.name),
    files,
    mode: isStubEnvSet(env) ? 'stub' : 'live',
  }
}

export function renderNewResult(result: NewProductResult): string {
  const lines = [
    'PRODUCT SCAFFOLDED',
    `  product: ${result.product}`,
    `  dir: ${result.dir}`,
    `  repo: ${result.repo}`,
    `  labels: ${result.labels.join(', ')}`,
    `  files: ${result.files.length} scaffolded from template`,
    `  mode: ${result.mode}`,
    '  next:',
    `    cd ${result.dir}`,
    '    npm install',
    '    npm run db:generate && npm run db:migrate',
    '    npm run dev   # http://localhost:3000',
  ]
  return lines.join('\n')
}
