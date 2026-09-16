import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TrackerReadError, parseTrackerSnapshot } from '../src/tracker.ts'

test('parseTrackerSnapshot reads open issues and their labels from gh JSON', () => {
  const issuesJson = JSON.stringify([
    { number: 1, title: 'Idea', labels: [{ name: 'idea' }, { name: 'needs-sharpening' }] },
    { number: 2, title: 'Ticket', labels: [{ name: 'blocked' }] },
  ])
  const snapshot = parseTrackerSnapshot(issuesJson, '[]')
  assert.deepEqual(snapshot, {
    openIssues: [
      { number: 1, title: 'Idea', labels: ['idea', 'needs-sharpening'] },
      { number: 2, title: 'Ticket', labels: ['blocked'] },
    ],
    openPrs: 0,
  })
})

test('parseTrackerSnapshot counts open PRs from gh PR JSON', () => {
  const prsJson = JSON.stringify([{ number: 10, title: 'PR' }, { number: 11, title: 'PR 2' }])
  const snapshot = parseTrackerSnapshot('[]', prsJson)
  assert.equal(snapshot.openPrs, 2)
  assert.deepEqual(snapshot.openIssues, [])
})

test('parseTrackerSnapshot accepts issues with no labels', () => {
  const snapshot = parseTrackerSnapshot('[{"number": 3, "title": "x"}]', '[]')
  assert.deepEqual(snapshot.openIssues, [{ number: 3, title: 'x', labels: [] }])
})

test('parseTrackerSnapshot throws on malformed tracker JSON', () => {
  assert.throws(() => parseTrackerSnapshot('not json', '[]'), TrackerReadError)
  assert.throws(() => parseTrackerSnapshot('[]', '{"not":"an array"}'), TrackerReadError)
})