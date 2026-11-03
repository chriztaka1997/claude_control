import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface Binaries {
  claude: string
  tmux: string
  claudeVersion: string
}

/** Finder launches get a minimal PATH; take the one from my login shell. */
export function loadShellPath(): void {
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const out = execFileSync(shell, ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const match = out.match(/__PATH__(.*)__PATH__/)
    if (match?.[1]) process.env.PATH = match[1]
  } catch {
    // keep the inherited PATH
  }
}

function which(bin: string): string | undefined {
  try {
    const path = execFileSync('/bin/sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).trim()
    return path && existsSync(path) ? path : undefined
  } catch {
    return undefined
  }
}

/** Throws a readable error if claude or tmux is missing. */
export function resolveBinaries(): Binaries {
  const claude = which('claude')
  const tmux = which('tmux')
  const missing = [!claude && 'claude', !tmux && 'tmux'].filter(Boolean)
  if (missing.length) throw new Error(`Not found on PATH: ${missing.join(', ')}. Install it and restart Claude Control.`)
  let claudeVersion = 'unknown'
  try {
    claudeVersion = execFileSync(claude!, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim()
  } catch {
    throw new Error(`${claude} --version failed. Check the Claude Code install.`)
  }
  return { claude: claude!, tmux: tmux!, claudeVersion }
}

const LEAKY = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_CONTROL_.*|TMUX|TMUX_PANE|ELECTRON_.*|VITE_.*|NODE_OPTIONS)$/

/**
 * Environment for tmux/claude. tmux copies the first client's env into its
 * global env, so anything from a parent Claude session would leak into every
 * agent (and nested-session markers can break transcripts and --resume).
 */
export function cleanEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !LEAKY.test(key)) env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}
