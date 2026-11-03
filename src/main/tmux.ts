import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { TMUX_CONF, TMUX_PREFIX, TMUX_SOCKET } from './config'

const run = promisify(execFile)

/** tmux rewrites "." and ":" in names; keep names predictable. */
export function sessionName(slug: string): string {
  return TMUX_PREFIX + slug.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** Exact-match target. A bare name would match any session starting with it. */
export function target(name: string): string {
  return `=${name}`
}

export class Tmux {
  constructor(
    readonly bin: string,
    private readonly env: Record<string, string>
  ) {}

  /** Every call goes through the app's own server and config. */
  baseArgs(): string[] {
    return ['-L', TMUX_SOCKET, '-f', TMUX_CONF]
  }

  private async exec(args: string[]): Promise<string> {
    const { stdout } = await run(this.bin, [...this.baseArgs(), ...args], { env: this.env, encoding: 'utf8' })
    return stdout
  }

  /** Live session names; empty when no server is running. */
  async listSessions(): Promise<Set<string>> {
    try {
      const out = await this.exec(['list-sessions', '-F', '#{session_name}'])
      return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))
    } catch {
      return new Set()
    }
  }

  async sessionEnv(name: string, key: string): Promise<string | undefined> {
    try {
      const out = (await this.exec(['show-environment', '-t', target(name), key])).trim()
      return out.startsWith(`${key}=`) ? out.slice(key.length + 1) : undefined
    } catch {
      return undefined
    }
  }

  async kill(name: string): Promise<void> {
    try {
      await this.exec(['kill-session', '-t', target(name)])
    } catch {}
  }

  async rename(from: string, to: string): Promise<boolean> {
    try {
      await this.exec(['rename-session', '-t', target(from), to])
      return true
    } catch {
      return false
    }
  }

  /** Re-applies the app's config to a server that may have started without -f. */
  async reloadConfig(): Promise<void> {
    try {
      await this.exec(['source-file', TMUX_CONF])
    } catch {}
  }

  /** argv for node-pty: attach to `name`, creating it with `command` if needed. */
  newSessionArgs(name: string, cwd: string, env: Record<string, string>, command: string[]): string[] {
    const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
    return [...this.baseArgs(), 'new-session', '-A', '-s', name, '-c', cwd, ...envArgs, ...command]
  }

  attachHint(name: string): string {
    return `tmux -L ${TMUX_SOCKET} attach -t '${target(name)}'`
  }
}
