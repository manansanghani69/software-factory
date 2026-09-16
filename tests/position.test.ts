import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { derivePosition, type RunSnapshot } from '../src/position.ts'
import type { TrackerSnapshot } from '../src/tracker.ts'

const EMPTY_TRACKER: TrackerSnapshot = { openIssues: [], openPrs: 0 }

describe('derivePosition', () => {
  test('a run suspended at the spec gate is at spec, awaiting a Disposition', () => {
    const run: RunSnapshot = { product: 'my-app', stage: 'spec', suspension: 'spec-gate', issueNumber: 12 }
    assert.deepEqual(derivePosition(run, EMPTY_TRACKER), {
      stage: 'spec',
      awaiting: 'spec-disposition',
      source: 'run',
    })
  })

  test('a run suspended at the review gate is at review, awaiting a Disposition', () => {
    const run: RunSnapshot = { product: 'my-app', stage: 'review', suspension: 'review-gate', issueNumber: 20 }
    assert.deepEqual(derivePosition(run, EMPTY_TRACKER), {
      stage: 'review',
      awaiting: 'review-disposition',
      source: 'run',
    })
  })

  test('a run suspended at a fork stays on its driven stage, awaiting a pick', () => {
    const run: RunSnapshot = { product: 'my-app', stage: 'implementation', suspension: 'fork', issueNumber: 21 }
    assert.deepEqual(derivePosition(run, EMPTY_TRACKER), {
      stage: 'implementation',
      awaiting: 'fork-pick',
      source: 'run',
    })
  })

  test('a live run that is not suspended sits on the stage it is driving', () => {
    const run: RunSnapshot = { product: 'my-app', stage: 'tickets', suspension: null, issueNumber: 15 }
    assert.deepEqual(derivePosition(run, EMPTY_TRACKER), {
      stage: 'tickets',
      awaiting: null,
      source: 'run',
    })
  })

  test('a completed run that reached ship reports ship', () => {
    const run: RunSnapshot = { product: 'my-app', stage: 'ship', suspension: null, issueNumber: 7 }
    assert.deepEqual(derivePosition(run, EMPTY_TRACKER), { stage: 'ship', awaiting: null, source: 'run' })
  })

  test('with no run, an open PR means implementation is in flight', () => {
    const tracker: TrackerSnapshot = { openIssues: [{ number: 4, title: 'x', labels: [] }], openPrs: 1 }
    assert.deepEqual(derivePosition(null, tracker), {
      stage: 'implementation',
      awaiting: null,
      source: 'tracker',
    })
  })

  test('with no run, an un-sharpened idea issue means sharpening', () => {
    const tracker: TrackerSnapshot = {
      openIssues: [
        { number: 1, title: 'Idea', labels: ['idea', 'needs-sharpening'] },
        { number: 2, title: 'Ticket', labels: [] },
      ],
      openPrs: 0,
    }
    assert.deepEqual(derivePosition(null, tracker), { stage: 'sharpening', awaiting: null, source: 'tracker' })
  })

  test('with no run, open issues that are not ideas mean tickets are cut', () => {
    const tracker: TrackerSnapshot = {
      openIssues: [
        { number: 8, title: 'Blocked ticket', labels: ['blocked'] },
        { number: 9, title: 'Frontier ticket', labels: [] },
      ],
      openPrs: 0,
    }
    assert.deepEqual(derivePosition(null, tracker), { stage: 'tickets', awaiting: null, source: 'tracker' })
  })

  test('with no run and nothing open on the tracker, the Product is ready', () => {
    assert.deepEqual(derivePosition(null, EMPTY_TRACKER), { stage: 'ready', awaiting: null, source: 'tracker' })
  })

  test('a run suspension wins over open tracker work', () => {
    const tracker: TrackerSnapshot = { openIssues: [{ number: 2, title: 'Ticket', labels: [] }], openPrs: 3 }
    const run: RunSnapshot = { product: 'my-app', stage: 'spec', suspension: 'spec-gate', issueNumber: 12 }
    assert.deepEqual(derivePosition(run, tracker), { stage: 'spec', awaiting: 'spec-disposition', source: 'run' })
  })
})