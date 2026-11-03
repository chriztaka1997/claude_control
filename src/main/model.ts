// Pure state logic: what the sidebar shows and which dot each row gets.
import { NO_STATUS, STUCK_THINKING_MS } from './config'
import { isHidden } from './tickets'
import { sessionName } from './tmux'
import type { Dot, Group, Row, StatusFile, Ticket } from '../shared/types'

export const CLOSING = 'Closing'
export const ORPHANED = 'Orphaned'

export function rowKey(t: Pick<Ticket, 'ccId' | 'slug'>): string {
  return t.ccId ?? `slug:${t.slug}`
}

export function displayState(opts: {
  status?: StatusFile
  seenAt?: number
  alive: boolean
  failure?: string
  now: number
}): Dot {
  const { status, seenAt = 0, alive, failure, now } = opts
  if (failure) return 'error'
  if (!alive) return 'none'
  if (!status) return 'idle'
  switch (status.state) {
    case 'error':
      return 'error'
    case 'needs_you':
      return 'needs_you'
    case 'thinking':
      // No Stop after an interrupted turn: don't stay yellow forever.
      return now - status.at < STUCK_THINKING_MS ? 'thinking' : 'idle'
    case 'finished':
      return status.at > seenAt ? 'unread' : 'idle'
    default:
      return 'idle'
  }
}

export interface ModelInput {
  tickets: Ticket[]
  columns: string[]
  live: Set<string>
  /** cc_id read from each live tmux session's environment */
  ccIdByTmux: Map<string, string>
  statuses: Map<string, StatusFile>
  seen: Record<string, number>
  failures: Map<string, string>
  now: number
}

export function buildGroups(input: ModelInput): Group[] {
  const { tickets, columns, live, ccIdByTmux, statuses, seen, failures, now } = input
  const byColumn = new Map<string, Row[]>()
  const unknown = new Map<string, Row[]>()
  const closing: Row[] = []
  const orphaned: Row[] = []
  const columnIndex = new Map(columns.map((c, i) => [c.toLowerCase(), i]))
  const claimed = new Set<string>()

  const sorted = [...tickets].sort((a, b) => a.priority - b.priority || b.updated - a.updated)
  for (const t of sorted) {
    const tmuxName = sessionName(t.slug)
    const alive = live.has(tmuxName)
    if (alive) claimed.add(tmuxName)
    if (isHidden(t.status) && !alive) continue
    const key = rowKey(t)
    const status = statuses.get(t.slug)
    const failure = failures.get(key)
    const row: Row = {
      key,
      slug: t.slug,
      ccId: t.ccId,
      title: t.title,
      status: t.status,
      repos: t.repos,
      sessionId: t.sessionId,
      tmuxName,
      live: alive,
      orphan: false,
      dot: displayState({ status: status?.ccId === t.ccId ? status : undefined, seenAt: seen[key], alive, failure, now }),
      dotDetail: failure ?? status?.message
    }
    if (isHidden(t.status)) closing.push(row)
    else {
      const col = columnIndex.get(t.status.toLowerCase())
      const name = col === undefined ? t.status : columns[col]
      const bucket = col === undefined ? unknown : byColumn
      bucket.set(name, [...(bucket.get(name) ?? []), row])
    }
  }

  for (const name of [...live].sort()) {
    if (claimed.has(name)) continue
    const ccId = ccIdByTmux.get(name)
    orphaned.push({
      key: `tmux:${name}`,
      slug: name,
      ccId,
      title: name,
      status: ORPHANED,
      repos: [],
      tmuxName: name,
      live: true,
      orphan: true,
      dot: 'idle',
      dotDetail: 'Ticket file not found'
    })
  }

  const groups: Group[] = []
  for (const c of columns) {
    const rows = byColumn.get(c)
    if (rows?.length) groups.push({ name: c, rows })
  }
  const unknownNames = [...unknown.keys()].sort((a, b) =>
    a === NO_STATUS ? 1 : b === NO_STATUS ? -1 : a.localeCompare(b)
  )
  for (const name of unknownNames) groups.push({ name, rows: unknown.get(name)! })
  if (closing.length) groups.push({ name: CLOSING, rows: closing })
  if (orphaned.length) groups.push({ name: ORPHANED, rows: orphaned })
  return groups
}

export interface Rename {
  ccId: string
  oldSlug: string
  newSlug: string
  /** live tmux session to rename, if any */
  tmuxFrom?: string
}

/**
 * Finds tickets whose slug changed since we last saw their cc_id, either
 * through the last known slug (ids.json) or through a live tmux session that
 * carries the cc_id under its old name.
 */
export function detectRenames(
  tickets: Ticket[],
  lastSlugByCcId: Record<string, string>,
  ccIdByTmux: Map<string, string>
): Rename[] {
  const tmuxByCcId = new Map([...ccIdByTmux].map(([name, id]) => [id, name]))
  const renames: Rename[] = []
  for (const t of tickets) {
    if (!t.ccId) continue
    const tmux = tmuxByCcId.get(t.ccId)
    const tmuxFrom = tmux && tmux !== sessionName(t.slug) ? tmux : undefined
    const last = lastSlugByCcId[t.ccId]
    const oldSlug = last && last !== t.slug ? last : tmuxFrom ? tmuxFrom.replace(/^cc-/, '') : undefined
    if (oldSlug) renames.push({ ccId: t.ccId, oldSlug, newSlug: t.slug, tmuxFrom })
  }
  return renames
}

export function badgeCount(groups: Group[]): number {
  let n = 0
  for (const g of groups) for (const r of g.rows) if (r.dot === 'needs_you' || r.dot === 'error' || r.dot === 'unread') n++
  return n
}
