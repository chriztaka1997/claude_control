import { describe, expect, it } from 'vitest'
import { columnsFromBase, parseTicket, resolveDuplicateIds } from '../src/main/tickets'
import { DEFAULT_COLUMNS, NO_STATUS } from '../src/main/config'
import type { Ticket } from '../src/shared/types'

describe('parseTicket', () => {
  it('reads the fields the sidebar needs, flattening wikilink repos', () => {
    const t = parseTicket(
      '/v/Tickets/my-ticket.md',
      `---\ntype: ticket\nstatus: "Code Review"\nrepos: [[[my-repo]], other-repo]\npriority: 1\nupdated: 2026-11-02\ncc_id: abc\nsession_id: 11111111-2222-3333-4444-555555555555\n---\n# My ticket\n\n---\nbody\n`
    )!
    expect(t).toMatchObject({
      slug: 'my-ticket',
      title: 'My ticket',
      status: 'Code Review',
      repos: ['my-repo', 'other-repo'],
      priority: 1,
      ccId: 'abc',
      sessionId: '11111111-2222-3333-4444-555555555555'
    })
    expect(t.updated).toBe(Date.parse('2026-11-02'))
  })

  it('handles empty values and missing headings', () => {
    const t = parseTicket('/v/Tickets/x.md', `---\ntype: ticket\nstatus:\nrepos:\ncc_id:\nsession_id:\n---\nSo# Broken heading\n`)!
    expect(t).toMatchObject({ title: 'x', status: NO_STATUS, repos: [], ccId: undefined, sessionId: undefined, priority: 99 })
  })

  it('skips non-tickets', () => {
    expect(parseTicket('/v/Tickets/_template.md', '---\ntype: template\n---\n')).toBeNull()
    expect(parseTicket('/v/Tickets/n.md', '# no frontmatter')).toBeNull()
  })
})

describe('columnsFromBase', () => {
  it('reads boardColumns from the view named Board', () => {
    const base = `views:\n  - type: kanban\n    name: All tickets\n    boardColumns: [A]\n  - type: kanban\n    name: Board\n    groupOrder: [X, Y]\n    boardColumns: [TODO, Done]\n`
    expect(columnsFromBase(base)).toEqual(['TODO', 'Done'])
  })

  it('falls back to groupOrder, then the default list', () => {
    expect(columnsFromBase(`views:\n  - type: kanban\n    name: Board\n    groupOrder: [X, Y]\n`)).toEqual(['X', 'Y'])
    expect(columnsFromBase('not: [valid')).toEqual(DEFAULT_COLUMNS)
  })
})

describe('resolveDuplicateIds', () => {
  const t = (slug: string, ccId?: string): Ticket => ({
    path: `/v/${slug}.md`, slug, ccId, title: slug, status: 'TODO', priority: 2, repos: [], sessionId: 's-' + slug, updated: 0
  })

  it('keeps the id with the copy whose tmux session is live', () => {
    const out = resolveDuplicateIds([t('a', 'id1'), t('a-copy', 'id1')], new Map([['id1', 'a-copy']]), new Map())
    expect(out.find((x) => x.slug === 'a-copy')!.ccId).toBe('id1')
    expect(out.find((x) => x.slug === 'a')).toMatchObject({ ccId: undefined, sessionId: undefined, duplicateOf: 'id1' })
  })

  it('else keeps it with the slug that had it before', () => {
    const out = resolveDuplicateIds([t('a 1', 'id1'), t('a', 'id1')], new Map(), new Map([['id1', 'a']]))
    expect(out.find((x) => x.slug === 'a')!.ccId).toBe('id1')
    expect(out.find((x) => x.slug === 'a 1')!.ccId).toBeUndefined()
  })

  it('leaves unique ids alone', () => {
    const input = [t('a', 'id1'), t('b', 'id2'), t('c')]
    expect(resolveDuplicateIds(input, new Map(), new Map())).toEqual(input)
  })
})
