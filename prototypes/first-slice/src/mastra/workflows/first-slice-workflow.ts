import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

function stubSpec(idea: string): string {
  return `## What this is

A first-pass sharpening of: ${idea}

This is a **stub** reply — the prototype ran with FACTORY_STUB=1, so the agent was not actually called. It exists so the CLI, the GitHub issue creation, and the Mastra spec-gate mechanics can be exercised end-to-end without an API key.

## Scope

- In scope: prove the thin first slice works (CLI → issue → workflow → suspend → resume).
- Out of scope: any real product decisions; the real sharpener replaces this text.

## Open questions

1. Does the real sharpening agent produce a useful spec here?
2. Does the spec gate correctly suspend and resume on both dispositions?

## Acceptance criteria

1. \`factory idea "<idea>"\` creates a sharpening issue in the tracker.
2. The sharpening workflow suspends at the spec gate.
3. Advancing closes the issue and posts the spec as a comment.
4. Revising re-runs the sharpener with feedback.`
}

async function sharpen(mastra: unknown, idea: string, feedback?: string) {
  if (process.env.FACTORY_STUB === '1') {
    return stubSpec(feedback ? `${idea}\n\n(revising with feedback: ${feedback})` : idea)
  }

  const agent = (mastra as { getAgent: (id: string) => { generate: (ctx: string) => Promise<{ text: string }> } }).getAgent('sharpening-agent')

  const context = feedback
    ? `The Operator reviewed the previous sharpening and requested revisions:\n\n${feedback}\n\nRe-sharpen the idea below, addressing that feedback.\n\nIdea to sharpen:\n\n${idea}`
    : `Idea to sharpen:\n\n${idea}`

  const result = await agent.generate(context)
  return result.text
}

const sharpenStep = createStep({
  id: 'sharpen',
  inputSchema: z.object({
    idea: z.string(),
    issueUrl: z.string(),
  }),
  outputSchema: z.object({
    spec: z.string(),
    issueUrl: z.string(),
  }),
  stateSchema: z.object({
    spec: z.string(),
  }),
  execute: async ({ inputData, setState, mastra }) => {
    const spec = await sharpen(mastra, inputData.idea)
    await setState({ spec })
    return { spec, issueUrl: inputData.issueUrl }
  },
})

const specGate = createStep({
  id: 'spec-gate',
  inputSchema: z.object({
    spec: z.string(),
    issueUrl: z.string(),
  }),
  outputSchema: z.object({
    disposition: z.enum(['advance', 'revise']),
    spec: z.string(),
  }),
  resumeSchema: z.object({
    disposition: z.enum(['advance', 'revise']),
    feedback: z.string().optional(),
  }),
  suspendSchema: z.object({
    spec: z.string(),
    issueUrl: z.string(),
  }),
  stateSchema: z.object({
    spec: z.string(),
  }),
  execute: async ({ inputData, resumeData, suspend, state, getInitData, setState, mastra }) => {
    const issueUrl = inputData.issueUrl

    if (resumeData?.disposition === 'advance') {
      return { disposition: 'advance' as const, spec: state.spec }
    }

    if (resumeData?.disposition === 'revise') {
      const idea = getInitData<{ idea: string }>().idea
      const revised = await sharpen(mastra, idea, resumeData.feedback)
      await setState({ spec: revised })
      return await suspend({ spec: revised, issueUrl })
    }

    return await suspend({ spec: state.spec, issueUrl })
  },
})

export const firstSliceWorkflow = createWorkflow({
  id: 'first-slice',
  inputSchema: z.object({
    idea: z.string(),
    issueUrl: z.string(),
  }),
  stateSchema: z.object({
    spec: z.string(),
  }),
  outputSchema: z.object({
    disposition: z.enum(['advance', 'revise']),
    spec: z.string(),
  }),
})
  .then(sharpenStep)
  .then(specGate)
  .commit()