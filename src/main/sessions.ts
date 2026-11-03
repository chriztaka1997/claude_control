// Owns ticket ↔ session ↔ terminal: launching, attaching, renames, ids.json.
import { EventEmitter } from 'node:events'
import { randomUUID, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { FAILED_START_MS, HOOKS_FILE, IDS_FILE, PENDING_DIR, TRANSCRIPTS, VAULT } from './config'
import { setField } from './frontmatter'
import { sessionName, type Tmux } from './tmux'
import type { Rename } from './model'
import type { Ticket } from '../shared/types'

export function newCcId(): string {
  return randomBytes(8).toString('base64url').slice(0, 10)
}

export function transcriptExists(sessionId: string, dir = TRANSCRIPTS): boolean {
  return existsSync(join(dir, `${sessionId}.jsonl`))
}

function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

interface Open {
  term: pty.IPty
  slug: string
  startedAt: number
  output: string
}

/**
 * Events: 'data' (key, chunk), 'exit' (key, {failed, detail}), 'changed'.
 * Keys are ticket row keys (cc_id once a session exists).
 */
export class Sessions extends EventEmitter {
  private open = new Map<string, Open>()
  readonly failures = new Map<string, string>()

  constructor(
    private readonly tmux: Tmux,
    private readonly claudeBin: string,
    private readonly env: Record<string, string>
  ) {
    super()
  }

  isOpen(key: string): boolean {
    return this.open.has(key)
  }

  /**
   * Opens (or reuses) the terminal for a ticket. Ensures cc_id, picks
   * --resume or --session-id by whether the transcript exists, and attaches.
   * Returns the row key, which becomes the cc_id.
   */
  /** Gives the ticket its permanent cc_id (written to the frontmatter) if it has none. */
  ensureCcId(ticket: Ticket): string {
    if (ticket.ccId) return ticket.ccId
    const ccId = newCcId()
    if (!setField(ticket.path, 'cc_id', ccId)) throw new Error(`Could not write cc_id to ${ticket.path}`)
    ticket.ccId = ccId
    return ccId
  }

  openTicket(ticket: Ticket, live: Set<string>, cols: number, rows: number): string {
    const ccId = this.ensureCcId(ticket)
    const existing = this.open.get(ccId)
    if (existing) return ccId

    const name = sessionName(ticket.slug)
    let command: string[] = []
    if (!live.has(name)) {
      const base = [this.claudeBin, '--settings', HOOKS_FILE]
      if (ticket.sessionId && transcriptExists(ticket.sessionId)) {
        command = [...base, '--resume', ticket.sessionId]
      } else {
        const sessionId = randomUUID()
        if (!setField(ticket.path, 'session_id', sessionId)) throw new Error(`Could not write session_id to ${ticket.path}`)
        const rel = `Tickets/${ticket.slug}`
        command = [...base, '--session-id', sessionId, `Working on [[${rel}]]. Read ${rel}.md first.`]
      }
    }
    this.spawn(ccId, ticket.slug, name, command, cols, rows)
    return ccId
  }

  /** Attaches to an orphaned tmux session (ticket file gone). */
  openOrphan(key: string, name: string, cols: number, rows: number): void {
    if (!this.open.has(key)) this.spawn(key, name, name, [], cols, rows)
  }

  private spawn(key: string, slug: string, name: string, command: string[], cols: number, rows: number): void {
    this.failures.delete(key)
    const args = this.tmux.newSessionArgs(
      name,
      VAULT,
      { CLAUDE_CONTROL_TICKET: key, CLAUDE_CONTROL_SLUG: slug },
      command
    )
    const term = pty.spawn(this.tmux.bin, args, {
      name: 'xterm-256color',
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      cwd: VAULT,
      env: this.env
    })
    const entry: Open = { term, slug, startedAt: Date.now(), output: '' }
    this.open.set(key, entry)
    term.onData((chunk) => {
      if (entry.output.length < 4000) entry.output += chunk
      this.emit('data', key, chunk)
    })
    term.onExit(({ exitCode }) => {
      if (this.open.get(key) === entry) this.open.delete(key)
      const quick = Date.now() - entry.startedAt < FAILED_START_MS
      const failed = command.length > 0 && quick
      let detail: string | undefined
      if (failed) {
        detail = stripAnsi(entry.output).trim().split('\n').slice(-3).join(' ').slice(0, 300) || `exit code ${exitCode}`
        this.failures.set(key, `Failed to start: ${detail}`)
      }
      this.emit('exit', key, { failed, detail })
      this.emit('changed')
    })
    this.emit('changed')
  }

  write(key: string, data: string): void {
    this.open.get(key)?.term.write(data)
  }

  resize(key: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return
    try {
      this.open.get(key)?.term.resize(cols, rows)
    } catch {}
  }

  clearFailure(key: string): void {
    if (this.failures.delete(key)) this.emit('changed')
  }

  async end(key: string, name: string): Promise<void> {
    await this.tmux.kill(name)
    this.open.get(key)?.term.kill()
    this.open.delete(key)
    this.emit('changed')
  }

  async newConversation(key: string, ticket: Ticket): Promise<void> {
    await this.end(key, sessionName(ticket.slug))
    setField(ticket.path, 'session_id', '')
  }

  /** Applies a detected rename: tmux session, open terminal, pending notice for Claude. */
  async applyRename(r: Rename, live: Set<string>): Promise<void> {
    const to = sessionName(r.newSlug)
    const from = r.tmuxFrom ?? sessionName(r.oldSlug)
    if (live.has(from) && !live.has(to)) await this.tmux.rename(from, to)
    const entry = this.open.get(r.ccId)
    if (entry) entry.slug = r.newSlug
    const pendingFile = join(PENDING_DIR, `${r.ccId}.json`)
    // A second rename before the next message keeps the original old path.
    const previous = readJson<{ oldPath?: string } | null>(pendingFile, null)
    writeJson(pendingFile, {
      oldPath: previous?.oldPath ?? `Tickets/${r.oldSlug}.md`,
      newPath: `Tickets/${r.newSlug}.md`
    })
  }

  /** Detaches every terminal. tmux and claude keep running. */
  detachAll(): void {
    for (const { term } of this.open.values()) {
      try {
        term.kill()
      } catch {}
    }
    this.open.clear()
  }
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]/g, '')
}

export function saveIds(ids: Record<string, string>): void {
  writeJson(IDS_FILE, ids)
}

export function loadIds(): Record<string, string> {
  return readJson(IDS_FILE, {})
}
