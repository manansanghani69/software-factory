import { execSync } from 'node:child_process'

export interface IssueCreated {
  number: number
  url: string
  title: string
}

function ensureLabel(repo: string, name: string, color: string): void {
  try {
    execSync(`gh label create "${name}" --repo ${repo} --color ${color} --force`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
  } catch {
    // label already exists; fine
  }
}

function shellQuote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`
}

export function createIdeaIssue(idea: string, repo: string): IssueCreated {
  ensureLabel(repo, 'idea', 'f9d0c4')
  ensureLabel(repo, 'needs-sharpening', 'fef2c0')

  const body = `## Idea\n\n${idea}\n\n## Status\n\nAwaiting sharpening.\n`
  const shortTitle = idea.length > 72 ? `${idea.slice(0, 72)}...` : idea

  const result = execSync(
    `gh issue create --repo ${repo} --title ${shellQuote(`Idea: ${shortTitle}`)} --body-file - --label "idea" --label "needs-sharpening"`,
    { encoding: 'utf-8', input: body }
  )

  const lines = result.trim().split('\n')
  const url = lines[lines.length - 1]
  const numberMatch = url.match(/\/issues\/(\d+)/)
  const number = numberMatch ? parseInt(numberMatch[1], 10) : 0

  return { number, url, title: `Idea: ${shortTitle}` }
}

export function addCommentToIssue(repo: string, issueNumber: number, comment: string): void {
  execSync(
    `gh issue comment ${issueNumber} --repo ${repo} --body-file -`,
    { encoding: 'utf-8', input: comment }
  )
}

export function closeIssue(repo: string, issueNumber: number): void {
  execSync(`gh issue close ${issueNumber} --repo ${repo}`, { encoding: 'utf-8' })
}