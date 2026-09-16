import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { STAGES, type StageId } from './config.ts'

export const PRODUCT_STATE_DIR = join('.factory', 'state')
export const PRODUCT_REGISTRATION_FILE = 'product.json'

export interface ProductStack {
  framework: string
  database: string
  orm: string
  deploy: string
}

export interface ProductLineMirror {
  stage: StageId | null
  currentTicket: number | null
}

export interface ProductRegistration {
  name: string
  repo: string
  stack: ProductStack
  line: ProductLineMirror
  createdAt: string
}

export interface DiscoveredProduct {
  registration: ProductRegistration
  root: string
  registrationPath: string
}

export class ProductRegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductRegistrationError'
  }
}

export function parseProductRegistration(value: unknown, sourcePath: string): ProductRegistration {
  if (typeof value !== 'object' || value === null) {
    throw new ProductRegistrationError(`Invalid product registration at ${sourcePath}: expected a JSON object`)
  }
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || record.name.length === 0) {
    throw new ProductRegistrationError(`Invalid product registration at ${sourcePath}: missing "name"`)
  }
  const stack = readStack(record.stack, sourcePath)
  const lineMirror = readLineMirror(record.line, sourcePath)
  return {
    name: record.name,
    repo: typeof record.repo === 'string' ? record.repo : '',
    stack,
    line: lineMirror,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
  }
}

function readStack(value: unknown, sourcePath: string): ProductStack {
  if (typeof value !== 'object' || value === null) {
    throw new ProductRegistrationError(`Invalid product registration at ${sourcePath}: missing "stack"`)
  }
  const record = value as Record<string, unknown>
  const pick = (key: string): string => (typeof record[key] === 'string' ? record[key] : '')
  return { framework: pick('framework'), database: pick('database'), orm: pick('orm'), deploy: pick('deploy') }
}

function readLineMirror(value: unknown, sourcePath: string): ProductLineMirror {
  if (value === undefined) {
    return { stage: null, currentTicket: null }
  }
  if (typeof value !== 'object' || value === null) {
    throw new ProductRegistrationError(`Invalid product registration at ${sourcePath}: "line" must be an object`)
  }
  const record = value as Record<string, unknown>
  const stage = record.stage
  if (stage !== null && !STAGES.includes(stage as StageId)) {
    throw new ProductRegistrationError(`Invalid product registration at ${sourcePath}: unknown Line stage "${String(stage)}"`)
  }
  const currentTicket = record.currentTicket
  if (currentTicket !== null && currentTicket !== undefined && typeof currentTicket !== 'number') {
    throw new ProductRegistrationError(
      `Invalid product registration at ${sourcePath}: "line.currentTicket" must be a number or null`,
    )
  }
  return { stage: (stage as StageId) ?? null, currentTicket: currentTicket === undefined ? null : currentTicket }
}

export function discoverProducts(factoryRoot: string): DiscoveredProduct[] {
  const resolvedRoot = resolve(factoryRoot)
  const parent = dirname(resolvedRoot)
  const products: DiscoveredProduct[] = []
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const sibling = resolve(parent, entry.name)
    if (sibling === resolvedRoot) continue
    const registrationPath = join(sibling, PRODUCT_STATE_DIR, PRODUCT_REGISTRATION_FILE)
    if (!existsSync(registrationPath)) continue
    products.push(loadRegistration(sibling, registrationPath))
  }
  return products.sort((a, b) => a.registration.name.localeCompare(b.registration.name))
}

function loadRegistration(root: string, registrationPath: string): DiscoveredProduct {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(registrationPath, 'utf-8'))
  } catch (error) {
    throw new ProductRegistrationError(
      `Invalid product registration at ${registrationPath}: not valid JSON (${(error as Error).message})`,
    )
  }
  return {
    registration: parseProductRegistration(parsed, registrationPath),
    root,
    registrationPath,
  }
}