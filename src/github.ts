import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ExecFileException } from 'node:child_process'

const execFileAsync = promisify(execFile)

function isScriptPath(path: string): boolean {
  return /\.(?:js|mjs|cjs)$/i.test(path)
}

export async function runGh(
  ghBin: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const commandEnv: NodeJS.ProcessEnv = { ...env, GH_PROMPT_DISABLED: '1' }
  try {
    const child = isScriptPath(ghBin)
      ? await execFileAsync(process.execPath, [ghBin, ...args], { env: commandEnv, maxBuffer: 10 * 1024 * 1024 })
      : await execFileAsync(ghBin, args, { env: commandEnv, maxBuffer: 10 * 1024 * 1024 })
    return child.stdout
  } catch (error) {
    const failure = error as ExecFileException
    const detail =
      failure.stderr !== undefined && failure.stderr.length > 0 ? failure.stderr.trim() : failure.message
    throw new Error(`gh command failed (\`${[ghBin, ...args].join(' ')}\`): ${detail}`, { cause: error })
  }
}

export function resolveGhBin(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.FACTORY_GH_BIN
  return override !== undefined && override.length > 0 ? override : 'gh'
}