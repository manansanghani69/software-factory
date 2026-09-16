import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blockedByFromBody,
  bodyReferencesSpec,
  extractHeadings,
  extractJsonArray,
  parseTicketDrafts,
  planTicketsStub,
  ticketBody,
  ticketBodyWithBlockedBy,
} from '../src/tickets.ts'

const SPEC = [
  '# Widget',
  '',
  'An accepted spec for a widget maker.',
  '',
  '## Problem Statement',
  '',
  'People need widgets.',
  '',
  '## Solution',
  '',
  'A web app that makes widgets.',
  '',
  '## Out of Scope',
  '',
  'Widget repair.',
].join('\n')

test('planTicketsStub cuts one ticket per deliverable heading in a linear blocking chain', () => {
  const drafts = planTicketsStub(SPEC)
  assert.deepEqual(
    drafts.map((draft) => draft.title),
    ['Problem Statement', 'Solution'],
  )
  assert.deepEqual(drafts[0]?.blockedBy, [])
  assert.deepEqual(drafts[1]?.blockedBy, [0])
  assert.ok(drafts[0]?.acceptance.length === 2)
})

test('planTicketsStub skips headings that name non-deliverables', () => {
  const drafts = planTicketsStub(SPEC)
  assert.ok(!drafts.some((draft) => /out of scope/i.test(draft.title)))
})

test('planTicketsStub falls back to a single ticket when the spec has no headings', () => {
  const drafts = planTicketsStub('# Bare spec\n\nNo headed sections here.')
  assert.equal(drafts.length, 1)
  assert.deepEqual(drafts[0]?.blockedBy, [])
})

test('extractHeadings returns every markdown H2 in order', () => {
  assert.deepEqual(extractHeadings(SPEC), ['Problem Statement', 'Solution', 'Out of Scope'])
})

test('parseTicketDrafts accepts a valid agent plan with blockers-first indexes', () => {
  const drafts = parseTicketDrafts([
    { title: 'A', whatToBuild: 'Slices A', acceptance: ['a works'], blockedBy: [] },
    { title: 'B', whatToBuild: 'Slices B', acceptance: ['b works'], blockedBy: [0] },
  ])
  assert.equal(drafts.length, 2)
  assert.equal(drafts[0]?.title, 'A')
  assert.deepEqual(drafts[1]?.blockedBy, [0])
})

test('parseTicketDrafts accepts a plan without optional fields', () => {
  const drafts = parseTicketDrafts([{ title: 'A', whatToBuild: 'Slices A' }])
  assert.deepEqual(drafts[0]?.acceptance, [])
  assert.deepEqual(drafts[0]?.blockedBy, [])
})

test('parseTicketDrafts rejects non-array plans and missing fields', () => {
  assert.throws(() => parseTicketDrafts({ ticket: 'nope' }))
  assert.throws(() => parseTicketDrafts([{ whatToBuild: 'no title' }]))
})

test('parseTicketDrafts rejects blockers that are not earlier tickets', () => {
  assert.throws(() =>
    parseTicketDrafts([
      { title: 'A', whatToBuild: 'A', blockedBy: [1] },
      { title: 'B', whatToBuild: 'B', blockedBy: [] },
    ]),
  )
  assert.throws(() =>
    parseTicketDrafts([{ title: 'A', whatToBuild: 'A', blockedBy: [0] }]),
  )
})

test('extractJsonArray strips code fences and finds the JSON array', () => {
  const plan = extractJsonArray('```json\n[{"title":"A","whatToBuild":"Slices A"}]\n```')
  assert.deepEqual(plan, [{ title: 'A', whatToBuild: 'Slices A' }])
})

test('extractJsonArray rejects prose without a JSON array', () => {
  assert.throws(() => extractJsonArray('Here are the tickets:'))

  assert.throws(() => extractJsonArray('{ "not": "an array" }'))
})

test('bodyReferencesSpec matches only the exact spec issue number', () => {
  assert.equal(bodyReferencesSpec('Part of #3.\n\nBody...', 3), true)
  assert.equal(bodyReferencesSpec('Part of #30.\n\nBody...', 3), false)
  assert.equal(bodyReferencesSpec('Part of #3.', 30), false)
  assert.equal(bodyReferencesSpec('No parent line', 3), false)
})

test('blockedByFromBody reads the Blocked by line and ignores its absence', () => {
  const body = ticketBody({ repo: 'acme/widget', specIssueNumber: 3, whatToBuild: 'Slice', acceptance: ['works'] })
  assert.deepEqual(blockedByFromBody(body), [])
  const fallback = ticketBodyWithBlockedBy(body, [7, 9])
  assert.deepEqual(blockedByFromBody(fallback), [7, 9])
})

test('ticketBody shapes the tracker issue and ticketBodyWithBlockedBy lists blockers at the top', () => {
  const body = ticketBody({
    repo: 'acme/widget',
    specIssueNumber: 3,
    whatToBuild: 'Slice X',
    acceptance: ['it works', 'it is demoable'],
  })
  assert.ok(body.startsWith('Part of #3.'), 'ticket references the spec it was cut from')
  assert.match(body, /## What to build/)
  assert.match(body, /Slice X/)
  assert.match(body, /- \[ \] it works/)
  assert.doesNotMatch(body, /Blocked by: /, 'bodies of unblocked tickets carry no Blocked by line')

  const fallback = ticketBodyWithBlockedBy(body, [5])
  assert.match(fallback, /^Part of #3\.\nBlocked by: #5/m)
  assert.ok(fallback.includes('Part of #3.'), 'fallback body keeps the spec reference')
})