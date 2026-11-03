import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HOME_DIR = join(homedir(), '.claude-control')

export const CONFIG_FILE = join(HOME_DIR, 'config.json')

function userConfig(): { vault?: string } {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return {}
  }
}

// Empty when not configured; boot() reports it before anything uses the paths below.
export const VAULT = (userConfig().vault ?? '').replace(/^~(?=\/|$)/, homedir()).replace(/\/+$/, '')
export const VAULT_NAME = VAULT.split('/').filter(Boolean).pop() ?? ''
export const TICKETS_DIR = join(VAULT, 'Tickets')
export const BOARD_FILE = join(VAULT, 'board.base')

// Claude Code stores transcripts under the cwd with every non-alphanumeric character turned into "-".
export const TRANSCRIPTS = join(homedir(), '.claude', 'projects', VAULT.replace(/[^A-Za-z0-9]/g, '-'))

export const STATUS_DIR = join(HOME_DIR, 'status')
export const PENDING_DIR = join(HOME_DIR, 'pending')
export const HOOK_DIR = join(HOME_DIR, 'hook')
export const HOOK_SCRIPT = join(HOOK_DIR, 'status.mjs')
export const HOOKS_FILE = join(HOME_DIR, 'control-hooks.json')
export const TMUX_CONF = join(HOME_DIR, 'control.tmux.conf')
export const SEEN_FILE = join(HOME_DIR, 'seen.json')
export const IDS_FILE = join(HOME_DIR, 'ids.json')

export const HIDDEN_STATUSES = new Set(['done', 'handed over', 'scrapped'])
export const NO_STATUS = '(No value)'

// Used when board.base can't be read.
export const DEFAULT_COLUMNS = [
  'TODO',
  'Planning/Discussion',
  'Review high level plan',
  'Breaking down',
  'Review implementation plan',
  'Implementing',
  'Code Review',
  'Testing - staging',
  'TL Review',
  'Ready to deploy',
  'Testing - production',
  'Done'
]

export const TMUX_SOCKET = 'claude-control'
export const TMUX_PREFIX = 'cc-'
export const LIVENESS_INTERVAL_MS = 5_000
export const STUCK_THINKING_MS = 10 * 60_000
export const FAILED_START_MS = 5_000
