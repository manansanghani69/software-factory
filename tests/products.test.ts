import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProductRegistrationError, discoverProducts, parseProductRegistration } from '../src/products.ts'

const SEED = {
  name: 'my-app',
  repo: '<github-repo-url>',
  stack: { framework: 'next', database: 'sqlite', orm: 'drizzle', deploy: 'vercel-manual' },
  line: { stage: null, currentTicket: null },
  createdAt: '2026-09-14',
}

function tempLayout(): { root: string; clean: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'factory-products-'))
  return { root, clean: () => rmSync(root, { recursive: true, force: true }) }
}

test('parseProductRegistration reads the seeded product.json shape', () => {
  const registration = parseProductRegistration(SEED, 'product.json')
  assert.equal(registration.name, 'my-app')
  assert.equal(registration.repo, '<github-repo-url>')
  assert.deepEqual(registration.stack, SEED.stack)
  assert.equal(registration.line.stage, null)
  assert.equal(registration.line.currentTicket, null)
  assert.equal(registration.createdAt, '2026-09-14')
})

test('parseProductRegistration keeps the Line stage mirror when present', () => {
  const registration = parseProductRegistration(
    { ...SEED, line: { stage: 'implementation', currentTicket: 42 } },
    'product.json',
  )
  assert.equal(registration.line.stage, 'implementation')
  assert.equal(registration.line.currentTicket, 42)
})

test('parseProductRegistration rejects a registration without a name', () => {
  const noName: Record<string, unknown> = { ...SEED }
  delete noName.name
  assert.throws(() => parseProductRegistration(noName, 'product.json'), ProductRegistrationError)
})

test('parseProductRegistration rejects an unknown Line stage', () => {
  assert.throws(
    () => parseProductRegistration({ ...SEED, line: { stage: 'not-a-stage', currentTicket: null } }, 'product.json'),
    ProductRegistrationError,
  )
})

test('parseProductRegistration rejects a non-object registration', () => {
  assert.throws(() => parseProductRegistration('nope', 'product.json'), ProductRegistrationError)
})

test('discoverProducts finds registered sibling products and sorts by name', () => {
  const { root, clean } = tempLayout()
  try {
    const factory = join(root, 'software-factory')
    mkdirSync(join(factory, '.factory', 'state'), { recursive: true })
    writeFileSync(join(factory, '.factory', 'config.json'), '{}')

    for (const name of ['zeta-app', 'alpha-app']) {
      const dir = join(root, name)
      mkdirSync(join(dir, '.factory', 'state'), { recursive: true })
      writeFileSync(join(dir, '.factory', 'state', 'product.json'), JSON.stringify({ ...SEED, name }))
    }

    const discovered = discoverProducts(factory)
    assert.deepEqual(
      discovered.map((p) => p.registration.name),
      ['alpha-app', 'zeta-app'],
    )
    for (const product of discovered) {
      assert.equal(dirname(product.registrationPath), join(root, product.registration.name, '.factory', 'state'))
      assert.equal(product.registration.line.stage, null)
    }
  } finally {
    clean()
  }
})

test('discoverProducts ignores siblings without a registration file', () => {
  const { root, clean } = tempLayout()
  try {
    const factory = join(root, 'software-factory')
    mkdirSync(join(factory, '.factory', 'state'), { recursive: true })
    mkdirSync(join(root, 'not-a-product', '.factory', 'state'), { recursive: true })
    mkdirSync(join(root, 'plain-directory'))

    assert.deepEqual(discoverProducts(factory), [])
  } finally {
    clean()
  }
})

test('discoverProducts does not treat the factory root itself as a product', () => {
  const { root, clean } = tempLayout()
  try {
    const factory = join(root, 'software-factory')
    mkdirSync(join(factory, '.factory', 'state'), { recursive: true })
    writeFileSync(join(factory, '.factory', 'state', 'product.json'), JSON.stringify({ ...SEED, name: 'self' }))
    assert.deepEqual(discoverProducts(factory), [])
  } finally {
    clean()
  }
})

test('discoverProducts fails loud on a malformed registration, naming the file', () => {
  const { root, clean } = tempLayout()
  try {
    const factory = join(root, 'software-factory')
    mkdirSync(join(factory, '.factory', 'state'), { recursive: true })
    const product = join(root, 'broken-app')
    mkdirSync(join(product, '.factory', 'state'), { recursive: true })
    writeFileSync(join(product, '.factory', 'state', 'product.json'), 'not json')

    try {
      discoverProducts(factory)
      assert.fail('expected discoverProducts to throw')
    } catch (error) {
      assert.ok(error instanceof ProductRegistrationError)
      assert.match(error.message, /broken-app/)
      assert.match(error.message, /product\.json/)
    }
  } finally {
    clean()
  }
})