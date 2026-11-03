// Glues the stores together and pushes a fresh view to the renderer.
import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'chokidar'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { BOARD_FILE, LIVENESS_INTERVAL_MS, SEEN_FILE, TICKETS_DIR } from './config'
import { setField } from './frontmatter'
import { badgeCount, buildGroups, detectRenames, rowKey, type Rename } from './model'
import { loadIds, saveIds, Sessions } from './sessions'
import { StatusStore } from './status'
import { loadColumns, loadTickets, resolveDuplicateIds } from './tickets'
import { sessionName, type Tmux } from './tmux'
import type { View } from '../shared/api'
import type { Row, StatusFile, Ticket } from '../shared/types'

export type { View }

/** Events: 'view' (View), 'transition' (row, previousDot). */
export class Controller extends EventEmitter {
  tickets: Ticket[] = []
  columns: string[] = []
  live = new Set<string>()
  ccIdByTmux = new Map<string, string>()
  seen: Record<string, number> = {}
  lastSlugByCcId: Record<string, string> = {}
  selectedKey?: string
  windowFocused = true
  private view: View = { groups: [], badge: 0 }
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout
  private reloadTimer?: NodeJS.Timeout
  private ready = false

  constructor(
    readonly tmux: Tmux,
    readonly sessions: Sessions,
    readonly status: StatusStore
  ) {
    super()
  }

  async start(): Promise<void> {
    this.seen = readJsonFile(SEEN_FILE, {})
    this.lastSlugByCcId = loadIds()
    await this.tmux.reloadConfig()
    this.status.start()
    await this.refreshLiveness()
    await this.reloadTickets()
    this.ready = true
    this.publish()

    this.status.on('update', (slug: string, s: StatusFile) => this.onStatus(slug, s))
    this.sessions.on('changed', () => void this.refreshLiveness().then(() => this.publish()))
    this.watcher = watch([TICKETS_DIR, BOARD_FILE], { ignoreInitial: true, depth: 0 })
    this.watcher.on('all', () => this.scheduleReload())
    // Liveness + the stuck-thinking timeout both need a periodic tick.
    this.timer = setInterval(() => void this.refreshLiveness().then(() => this.publish()), LIVENESS_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    clearTimeout(this.reloadTimer)
    await this.watcher?.close()
    await this.status.stop()
  }

  private scheduleReload(): void {
    clearTimeout(this.reloadTimer)
    this.reloadTimer = setTimeout(() => void this.reloadTickets().then(() => this.publish()), 300)
  }

  async refreshLiveness(): Promise<void> {
    const live = await this.tmux.listSessions()
    const known = new Map<string, string>()
    for (const name of live) {
      const cached = this.ccIdByTmux.get(name)
      const id = cached ?? (await this.tmux.sessionEnv(name, 'CLAUDE_CONTROL_TICKET'))
      if (id) known.set(name, id)
    }
    this.live = live
    this.ccIdByTmux = known
  }

  async reloadTickets(): Promise<void> {
    const raw = loadTickets()
    const liveSlugByCcId = new Map(
      [...this.ccIdByTmux].map(([name, id]) => [id, name.replace(/^cc-/, '')])
    )
    const previous = new Map(Object.entries(this.lastSlugByCcId))
    this.tickets = resolveDuplicateIds(raw, liveSlugByCcId, previous)
    this.columns = loadColumns()

    const renames = detectRenames(this.tickets, this.lastSlugByCcId, this.ccIdByTmux)
    for (const r of renames) await this.applyRename(r)
    if (renames.length) await this.refreshLiveness()

    const ids: Record<string, string> = { ...this.lastSlugByCcId }
    for (const t of this.tickets) if (t.ccId) ids[t.ccId] = t.slug
    if (JSON.stringify(ids) !== JSON.stringify(this.lastSlugByCcId)) {
      this.lastSlugByCcId = ids
      saveIds(ids)
    }
  }

  private async applyRename(r: Rename): Promise<void> {
    console.log(`[rename] ${r.oldSlug} → ${r.newSlug}`)
    this.status.move(r.oldSlug, r.newSlug)
    const name = sessionName(r.oldSlug)
    const tmuxFrom = r.tmuxFrom ?? (this.live.has(name) ? name : undefined)
    await this.sessions.applyRename({ ...r, tmuxFrom }, this.live)
    if (tmuxFrom) this.ccIdByTmux.delete(tmuxFrom)
  }

  private onStatus(slug: string, s: StatusFile): void {
    const ticket = this.tickets.find((t) => t.slug === slug && t.ccId === s.ccId)
    if (ticket && s.event === 'UserPromptSubmit') this.sessions.clearFailure(rowKey(ticket))
    // After /clear (or a fork) the conversation id changes; keep --resume pointing at the latest.
    if (
      ticket &&
      s.event === 'SessionStart' &&
      (s.source === 'clear' || s.source === 'fork') &&
      s.sessionId &&
      s.sessionId !== ticket.sessionId
    ) {
      setField(ticket.path, 'session_id', s.sessionId)
      ticket.sessionId = s.sessionId
    }
    // Finishing while I'm looking at it isn't "unread".
    if (ticket && s.state === 'finished' && this.windowFocused && this.selectedKey === rowKey(ticket)) {
      this.markSeen(rowKey(ticket), s.at + 1)
    }
    this.publish()
  }

  markSeen(key: string, at = Date.now()): void {
    if ((this.seen[key] ?? 0) >= at) return
    this.seen[key] = at
    writeJsonFile(SEEN_FILE, this.seen)
  }

  select(key: string | undefined): void {
    this.selectedKey = key
    if (key) this.markSeen(key)
    this.publish()
  }

  ticketByKey(key: string): Ticket | undefined {
    return this.tickets.find((t) => rowKey(t) === key)
  }

  rowByKey(key: string): Row | undefined {
    for (const g of this.view.groups) for (const r of g.rows) if (r.key === key) return r
    return undefined
  }

  publish(): void {
    if (!this.ready) return
    const groups = buildGroups({
      tickets: this.tickets,
      columns: this.columns,
      live: this.live,
      ccIdByTmux: this.ccIdByTmux,
      statuses: this.status.statuses,
      seen: this.seen,
      failures: this.sessions.failures,
      now: Date.now()
    })
    const before = new Map<string, Row>()
    for (const g of this.view.groups) for (const r of g.rows) before.set(r.key, r)
    this.view = { groups, badge: badgeCount(groups) }
    for (const g of groups)
      for (const r of g.rows) {
        const prev = before.get(r.key)
        if (prev && prev.dot !== r.dot) this.emit('transition', r, prev.dot)
      }
    this.emit('view', this.view)
  }

  current(): View {
    return this.view
  }
}

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
  } catch {
    return fallback
  }
}

function writeJsonFile(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, file)
}
