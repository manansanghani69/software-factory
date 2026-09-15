import { Mastra } from '@mastra/core/mastra'
import { sharpeningAgent } from './agents/sharpening-agent.ts'
import { firstSliceWorkflow } from './workflows/first-slice-workflow.ts'

export const mastra = new Mastra({
  agents: { 'sharpening-agent': sharpeningAgent },
  workflows: { 'first-slice': firstSliceWorkflow },
})