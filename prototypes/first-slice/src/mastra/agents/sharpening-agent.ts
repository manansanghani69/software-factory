import { Agent } from '@mastra/core/agent'
import { SHARPENING_PROMPT } from '../../sharpening-prompt.ts'

export const sharpeningAgent = new Agent({
  id: 'sharpening-agent',
  name: 'Sharpening Agent',
  instructions: SHARPENING_PROMPT,
  model: 'anthropic/claude-sonnet-4-6',
})
