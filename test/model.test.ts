import { describe, expect, it } from 'vitest'
import { badgeCount, buildGroups, CLOSING, detectRenames, displayState, ORPHANED, type ModelInput } from '../src/main/model'
import { STUCK_THINKING_MS } from '../src/main/config'
import { sessionName, target } from '../src/main/tmux'
import type { StatusFile, Ticket } from '../src/shared/types'

const now = 1_000_000_000
const status = (state: StatusFile['state'], at = now - 1000, extra: Partial<StatusFile> = {}): StatusFile => ({
  ccId: 'id', slug: 's', state, event: 'x', at, ...extra
})

describe('displayState', () => {
  const cases: [string, Parameters<typeof displayState>[0], string][] = [
    ['launch failure wins', { alive: false, failure: 'boom', now }, 'error'],
    ['no tmux → none', { alive: false, status: status('thinking'), now }, 'none'],
    ['error state', { alive: true, status: status('error'), now }, 'error'],
    ['needs you', { alive: true, status: status('needs_you'), now }, 'needs_you'],
    ['thinking', { alive: true, status: status('thinking'), now }, 'thinking'],
    ['stale thinking → idle', { alive: true, status: status('thinking', now - STUCK_THINKING_MS - 1), now }, 'idle'],
    ['finished, unseen', { alive: true, status: status('finished'), seenAt: now - 5000, now }, 'unread'],
    ['finished, seen', { alive: true, status: status('finished'), seenAt: now, now }, 'idle'],
    ['ended but tmux alive (/clear)', { alive: true, status: status('ended'), now }, 'idle'],
    ['live, no status yet', { alive: true, now }, 'idle']
  ]
  for (const [name, input, expected] of cases) it(name, () => expect(displayState(input)).toBe(expected))
})

describe('tmux names', () => {
  it('sanitizes slugs and always targets exactly', () => {
    expect(sessionName('demo-testing')).toBe('cc-demo-testing')
    expect(sessionName('a.b:c d')).toBe('cc-a_b_c_d')
    expect(target('cc-demo-testing')).toBe('=cc-demo-testing')
  })
})

const ticket = (slug: string, extra: Partial<Ticket> = {}): Ticket => ({
  path: `/v/Tickets/${slug}.md`, slug, title: slug.toUpperCase(), status: 'TODO', priority: 2, repos: [], updated: 0, ...extra
})

function input(extra: Partial<ModelInput>): ModelInput {
  return {
    tickets: [], columns: ['TODO', 'Code Review', 'Done'], live: new Set(), ccIdByTmux: new Map(),
    statuses: new Map(), seen: {}, failures: new Map(), now, ...extra
  }
}

describe('buildGroups', () => {
  it('groups by board column order, case-insensitively, sorted by priority then updated', () => {
    const groups = buildGroups(input({
      tickets: [
        ticket('b', { status: 'code review', priority: 2 }),
        ticket('a', { status: 'TODO', priority: 2, updated: 1 }),
        ticket('c', { status: 'TODO', priority: 1 }),
        ticket('d', { status: 'TODO', priority: 2, updated: 5 })
      ]
    }))
    expect(groups.map((g) => g.name)).toEqual(['TODO', 'Code Review'])
    expect(groups[0].rows.map((r) => r.slug)).toEqual(['c', 'd', 'a'])
  })

  it('hides done tickets unless their session is live (→ Closing)', () => {
    const groups = buildGroups(input({
      tickets: [ticket('done-idle', { status: 'Done' }), ticket('done-live', { status: 'done' }), ticket('gone', { status: 'Scrapped' })],
      live: new Set(['cc-done-live'])
    }))
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe(CLOSING)
    expect(groups[0].rows.map((r) => r.slug)).toEqual(['done-live'])
  })

  it('puts unknown statuses after the columns and No value last', () => {
    const groups = buildGroups(input({
      tickets: [ticket('x', { status: '(No value)' }), ticket('y', { status: 'Handed over' }), ticket('z', { status: 'Weird' }), ticket('t')]
    }))
    expect(groups.map((g) => g.name)).toEqual(['TODO', 'Weird', '(No value)'])
  })

  it('shows live sessions with no ticket as Orphaned', () => {
    const groups = buildGroups(input({ tickets: [ticket('a')], live: new Set(['cc-a', 'cc-deleted']) }))
    expect(groups.at(-1)!.name).toBe(ORPHANED)
    expect(groups.at(-1)!.rows[0]).toMatchObject({ tmuxName: 'cc-deleted', orphan: true, live: true })
  })

  it('only matches exact session names (demo-testing vs demo-testing-fixes)', () => {
    const groups = buildGroups(input({
      tickets: [ticket('demo-testing'), ticket('demo-testing-fixes')],
      live: new Set(['cc-demo-testing-fixes'])
    }))
    const rows = groups[0].rows
    expect(rows.find((r) => r.slug === 'demo-testing')!.live).toBe(false)
    expect(rows.find((r) => r.slug === 'demo-testing-fixes')!.live).toBe(true)
  })

  it('ignores a status file left by a different ticket with the same slug', () => {
    const groups = buildGroups(input({
      tickets: [ticket('a', { ccId: 'new' })],
      live: new Set(['cc-a']),
      statuses: new Map([['a', status('needs_you', now, { ccId: 'old' })]])
    }))
    expect(groups[0].rows[0].dot).toBe('idle')
  })

  it('counts needs-you, errors and unread for the badge', () => {
    const groups = buildGroups(input({
      tickets: [ticket('a', { ccId: 'a' }), ticket('b', { ccId: 'b' }), ticket('c', { ccId: 'c' }), ticket('d', { ccId: 'd' })],
      live: new Set(['cc-a', 'cc-b', 'cc-c', 'cc-d']),
      statuses: new Map([
        ['a', status('needs_you', now, { ccId: 'a' })],
        ['b', status('error', now, { ccId: 'b' })],
        ['c', status('finished', now, { ccId: 'c' })],
        ['d', status('thinking', now, { ccId: 'd' })]
      ])
    }))
    expect(badgeCount(groups)).toBe(3)
  })
})

describe('detectRenames', () => {
  it('finds a rename from the last known slug', () => {
    expect(detectRenames([ticket('new-name', { ccId: 'id1' })], { id1: 'old-name' }, new Map())).toEqual([
      { ccId: 'id1', oldSlug: 'old-name', newSlug: 'new-name', tmuxFrom: undefined }
    ])
  })

  it('finds a rename made while the app was closed, from the tmux session env', () => {
    expect(detectRenames([ticket('new-name', { ccId: 'id1' })], {}, new Map([['cc-old-name', 'id1']]))).toEqual([
      { ccId: 'id1', oldSlug: 'old-name', newSlug: 'new-name', tmuxFrom: 'cc-old-name' }
    ])
  })

  it('reports nothing when names match', () => {
    expect(detectRenames([ticket('a', { ccId: 'id1' })], { id1: 'a' }, new Map([['cc-a', 'id1']]))).toEqual([])
  })
})
