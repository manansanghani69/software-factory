import { execSync } from 'node:child_process'
import { Command } from 'commander'
import { createInterface } from 'node:readline/promises'
import process from 'node:process'
import { mastra } from './mastra/index.ts'
import { createIdeaIssue, addCommentToIssue, closeIssue } from './github.ts'

function repoFromRemote(): string {
  const url = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
  const match = url.match(/(?:github\.com[:\/])([^\/]+\/[^\/]+?)(?:\.git)?$/)
  if (!match) throw new Error(`Cannot infer owner/repo from remote url: ${url}`)
  return match[1]
}

const rl = createInterface({ input: process.stdin, output: process.stdout })

async function readPipedInput(): Promise<string[]> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8').split(/\r?\n/)
}

let pipedLines: string[] | null = null

async function ask(question: string): Promise<string> {
  if (process.stdin.isTTY) {
    return await rl.question(question)
  }
  if (pipedLines === null) pipedLines = await readPipedInput()
  return pipedLines.shift() ?? ''
}

async function runIdea(idea: string, repo: string, stub: boolean) {
  if (stub) process.env.FACTORY_STUB = '1'

  console.log(`\nCreating sharpening issue in ${repo}...`)
  const issue = createIdeaIssue(idea, repo)
  console.log(`Created: ${issue.url}\n`)

  console.log('Spinning the sharpening agent...\n')
  const workflow = mastra.getWorkflow('first-slice')
  const run = await workflow.createRun()

  let result = await run.start({ inputData: { idea, issueUrl: issue.url }, initialState: { spec: '' } })

  while (result.status === 'suspended') {
    const stepPayload = (result.suspendPayload?.['spec-gate'] ??
      result.suspendPayload) as { spec?: string; issueUrl?: string } | undefined

    console.log('\n── SPEC GATE ──────────────────────────')
    console.log(stepPayload?.spec ?? '(no spec in suspend payload)')
    console.log(`Sharpened issue: ${stepPayload?.issueUrl ?? issue.url}`)
    console.log('────────────────────────────────────────\n')

    const disposition = (await ask('Disposition? [advance/revise] ')).trim().toLowerCase()
    const feedback = disposition === 'revise'
      ? (await ask('Revision feedback: ')).trim()
      : undefined

    result = await run.resume({
      resumeData: { disposition, feedback },
    })
  }

  if (result.status === 'success') {
    const { disposition, spec } = result.result
    console.log(`\nWorkflow complete — disposition: ${disposition}\n`)
    console.log('Final spec:')
    console.log(spec)

    const comment = `## Spec\n\n${spec}\n\n_Sharpened by the Factory. Disposition: ${disposition}._`
    addCommentToIssue(repo, issue.number, comment)
    console.log(`\nSpec comment posted to ${issue.url}`)

    if (disposition === 'advance') {
      closeIssue(repo, issue.number)
      console.log('Idea issue closed (spec accepted).\n')
    } else {
      console.log('Idea issue left open for revision.\n')
    }
  } else if (result.status === 'failed') {
    console.error('Workflow failed:', result.error.message)
    process.exitCode = 1
  } else {
    console.error('Unexpected workflow status:', result.status)
    process.exitCode = 1
  }
}

async function runDayBrief(repo: string) {
  const issues = execSync(
    `gh issue list --repo ${repo} --state open --json number,title,labels,assignees,url --limit 30`,
    { encoding: 'utf-8' }
  )
  const parsed = JSON.parse(issues) as Array<{
    number: number
    title: string
    labels: Array<{ name: string }>
    assignees: Array<{ login: string }>
    url: string
  }>

  console.log(`\nDAY BRIEF — ${repo}\n`)
  console.log(`${parsed.length} open issues:`)
  for (const i of parsed) {
    const labels = i.labels.map(l => l.name).join(', ')
    const assignee = i.assignees.map(a => a.login).join(', ') || 'unassigned'
    console.log(`  #${i.number} ${i.title}  [${labels}]  (${assignee})`)
  }
  console.log('')
}

const program = new Command()
  .name('factory')
  .description('AI software factory CLI — thin slice prototype')
  .version('0.1.0')
  .option('-r, --repo <repo>', 'owner/repo of the tracker (default: inferred from origin)')
  .option('--stub', 'use a canned sharpening reply instead of calling the model')

program
  .command('idea')
  .description('Take an idea, create a sharpening issue, and run it to the spec gate')
  .argument('[idea]', 'the raw idea to sharpen (prompted if omitted)')
  .action(async (rawIdea: string | undefined) => {
    const opts = program.opts()
    const repo = (opts.repo as string | undefined) ?? repoFromRemote()
    const idea = rawIdea ?? (await ask('What is the idea? ')).trim()
    if (!idea) {
      console.error('No idea given.')
      process.exitCode = 1
      return
    }
    await runIdea(idea, repo, Boolean(opts.stub))
  })

program
  .command('day')
  .description('Print the day brief for the tracker')
  .action(async () => {
    const opts = program.opts()
    const repo = (opts.repo as string | undefined) ?? repoFromRemote()
    await runDayBrief(repo)
  })

program.parseAsync(process.argv)