import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class GitError extends Error {
  override cause?: unknown

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message)
    this.name = 'GitError'
    this.cause = options.cause
  }
}

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const child = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })
    return child.stdout
  } catch (error) {
    const failure = error as { message?: string; stderr?: string }
    const detail = failure.stderr !== undefined && failure.stderr.length > 0 ? failure.stderr.trim() : failure.message
    throw new GitError(`git ${args.join(' ')} failed: ${detail}`, { cause: error })
  }
}

export async function createWorktreeBranch(repoDir: string, checkoutDir: string, branch: string, from: string): Promise<void> {
  await runGit(['worktree', 'add', '-B', branch, checkoutDir, from], repoDir)
}

export async function currentBranch(repoDir: string): Promise<string> {
  const branch = (await runGit(['branch', '--show-current'], repoDir)).trim()
  if (branch.length === 0) {
    throw new GitError(`git branch --show-current failed: ${repoDir} is not on a branch`)
  }
  return branch
}

export async function addAll(repoDir: string): Promise<void> {
  await runGit(['add', '-A'], repoDir)
}

export async function commit(repoDir: string, message: string): Promise<void> {
  await runGit(['commit', '-m', message, '--allow-empty'], repoDir)
}

export async function push(repoDir: string, branch: string): Promise<void> {
  await runGit(['push', '-u', 'origin', branch], repoDir)
}
