import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProductRegistration } from './products.ts'

export const PRODUCT_TOKEN = '{{product}}'
export const PRODUCT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function productTemplateDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'templates', 'product')
}

export function assertValidProductName(name: string): string {
  if (!PRODUCT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid Product name "${name}": use lowercase letters, digits, and hyphens, starting and ending with a letter or digit (e.g. "acme-web")`,
    )
  }
  return name
}

export function scaffoldProductFiles(
  targetDir: string,
  productName: string,
  templateDir = productTemplateDir(),
): string[] {
  const created: string[] = []
  const copyDir = (sourceDir: string, relativeToTarget: string): void => {
    for (const entry of readdirSync(sourceDir)) {
      const source = join(sourceDir, entry)
      const relative = join(relativeToTarget, entry)
      const destination = join(targetDir, relative)
      const stat = statSync(source)
      if (stat.isDirectory()) {
        copyDir(source, relative)
      } else {
        mkdirSync(dirname(destination), { recursive: true })
        const content = readFileSync(source, 'utf-8').split(PRODUCT_TOKEN).join(productName)
        writeFileSync(destination, content, 'utf-8')
        created.push(relative)
      }
    }
  }
  copyDir(templateDir, '')
  return created
}

export function writeProductRegistration(productDir: string, input: { name: string; repo: string }): string {
  const seed: ProductRegistration = {
    name: input.name,
    repo: input.repo,
    stack: { framework: 'next', database: 'sqlite', orm: 'drizzle', deploy: 'vercel-manual' },
    line: { stage: null, currentTicket: null },
    createdAt: new Date().toISOString().slice(0, 10),
  }
  const filePath = join(productDir, '.factory', 'state', 'product.json')
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(seed, null, 2)}\n`, 'utf-8')
  return filePath
}

export function gitInitAndCommit(productDir: string, message: string, env: NodeJS.ProcessEnv): void {
  execFileSync('git', ['-C', productDir, 'init', '-b', 'main'], { encoding: 'utf-8', stdio: 'pipe' })
  execFileSync('git', ['-C', productDir, 'add', '-A'], { encoding: 'utf-8', stdio: 'pipe' })
  execFileSync('git', ['-C', productDir, 'commit', '--no-gpg-sign', '-m', message], {
    encoding: 'utf-8',
    stdio: 'pipe',
    env,
  })
}
