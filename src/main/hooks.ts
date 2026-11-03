import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR, HOOK_DIR, HOOK_SCRIPT, HOOKS_FILE, PENDING_DIR, STATUS_DIR, TMUX_CONF } from './config'

const TOOL_EVENTS = ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'PermissionDenied']
const PLAIN_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'StopFailure', 'SessionEnd']

/**
 * Runs the hook on Electron's bundled Node, so an nvm upgrade can't break it.
 * Falls back to `node` on PATH if Electron can't run as Node.
 */
export function hookRunner(): string {
  const probe = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 10_000
  })
  if (probe.status === 0) return `ELECTRON_RUN_AS_NODE=1 "${process.execPath}"`
  const node = spawnSync('/bin/sh', ['-c', 'command -v node'], { encoding: 'utf8' }).stdout.trim()
  if (!node) throw new Error('Cannot run the status hook: Electron-as-Node failed and node is not on PATH.')
  return `"${node}"`
}

export function hooksSettings(command: string): object {
  const entry = (matcher?: string) => ({
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: 'command', command, timeout: 10 }]
  })
  const hooks: Record<string, object[]> = {}
  for (const e of TOOL_EVENTS) hooks[e] = [entry('*')]
  for (const e of PLAIN_EVENTS) hooks[e] = [entry()]
  return { hooks }
}

/** Installs the hook script, the scoped hook settings and the tmux config. Run on every start. */
export function installRuntimeFiles(appRoot: string): void {
  for (const dir of [HOME_DIR, HOOK_DIR, STATUS_DIR, PENDING_DIR]) mkdirSync(dir, { recursive: true })
  copyFileSync(join(appRoot, 'hook', 'status.mjs'), HOOK_SCRIPT)
  copyFileSync(join(appRoot, 'resources', 'control.tmux.conf'), TMUX_CONF)
  const command = `${hookRunner()} "${HOOK_SCRIPT}"`
  writeFileSync(HOOKS_FILE, JSON.stringify(hooksSettings(command), null, 2))
}
