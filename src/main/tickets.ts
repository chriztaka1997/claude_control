import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import YAML from 'yaml'
import { BOARD_FILE, DEFAULT_COLUMNS, HIDDEN_STATUSES, NO_STATUS, TICKETS_DIR } from './config'
import type { Ticket } from '../shared/types'

/** Frontmatter at line 1, up to the next line that is exactly `---`. */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } | null {
  const lines = text.split(/\r?\n/)
  if (lines[0] !== '---') return null
  const close = lines.indexOf('---', 1)
  if (close === -1) return null
  const data = YAML.parse(lines.slice(1, close).join('\n')) ?? {}
  if (typeof data !== 'object' || Array.isArray(data)) return null
  return { data: data as Record<string, unknown>, body: lines.slice(close + 1).join('\n') }
}

function flatStrings(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) return value.flatMap(flatStrings)
  return [String(value)]
}

function toTime(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  const t = Date.parse(String(value ?? ''))
  return Number.isNaN(t) ? 0 : t
}

function str(value: unknown): string | undefined {
  if (value == null) return undefined
  const s = String(value).trim()
  return s === '' ? undefined : s
}

export function parseTicket(path: string, text: string): Ticket | null {
  const fm = splitFrontmatter(text)
  if (!fm || fm.data.type !== 'ticket') return null
  const slug = basename(path, '.md')
  const heading = fm.body.split('\n').find((l) => l.startsWith('# '))
  const priority = Number(fm.data.priority)
  return {
    path,
    slug,
    ccId: str(fm.data.cc_id),
    title: heading ? heading.slice(2).trim() : slug,
    status: str(fm.data.status) ?? NO_STATUS,
    priority: Number.isFinite(priority) ? priority : 99,
    repos: flatStrings(fm.data.repos),
    sessionId: str(fm.data.session_id),
    updated: toTime(fm.data.updated)
  }
}

export function loadTickets(dir = TICKETS_DIR): Ticket[] {
  const tickets: Ticket[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === '_template.md') continue
    const path = join(dir, name)
    try {
      const ticket = parseTicket(path, readFileSync(path, 'utf8'))
      if (ticket) tickets.push(ticket)
    } catch (err) {
      console.warn(`[tickets] skipping ${name}: ${(err as Error).message}`)
    }
  }
  return tickets
}

/** Column order as the Base Board plugin shows it (boardColumns), with fallbacks. */
export function columnsFromBase(text: string): string[] {
  try {
    const base = YAML.parse(text)
    const views: any[] = Array.isArray(base?.views) ? base.views : []
    const view = views.find((v) => v?.name === 'Board') ?? views.find((v) => v?.type === 'kanban')
    for (const key of ['boardColumns', 'groupOrder']) {
      const cols = view?.[key]
      if (Array.isArray(cols) && cols.length) return cols.map(String)
    }
  } catch {}
  return DEFAULT_COLUMNS
}

export function loadColumns(file = BOARD_FILE): string[] {
  try {
    return columnsFromBase(readFileSync(file, 'utf8'))
  } catch {
    return DEFAULT_COLUMNS
  }
}

/**
 * Duplicated files share a cc_id. The id stays with the copy whose tmux
 * session is live, else with the copy that had it before (`previous`), else the
 * first by name. The others lose it (and their session_id) until a session is
 * started for them.
 */
export function resolveDuplicateIds(
  tickets: Ticket[],
  liveSlugByCcId: Map<string, string>,
  previous: Map<string, string>
): Ticket[] {
  const byId = new Map<string, Ticket[]>()
  for (const t of tickets) if (t.ccId) byId.set(t.ccId, [...(byId.get(t.ccId) ?? []), t])
  const losers = new Set<Ticket>()
  for (const [ccId, list] of byId) {
    if (list.length < 2) continue
    const owner =
      list.find((t) => t.slug === liveSlugByCcId.get(ccId)) ??
      list.find((t) => t.slug === previous.get(ccId)) ??
      [...list].sort((a, b) => a.slug.localeCompare(b.slug))[0]
    for (const t of list) if (t !== owner) losers.add(t)
  }
  return tickets.map((t) => (losers.has(t) ? { ...t, ccId: undefined, sessionId: undefined, duplicateOf: t.ccId } : t))
}

export function isHidden(status: string): boolean {
  return HIDDEN_STATUSES.has(status.toLowerCase())
}
