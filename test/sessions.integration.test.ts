// Full open-a-ticket flow against a throwaway HOME + vault, a scratch tmux
// socket and a fake `claude` that just echoes its args and waits.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const tmuxBin = (() => {
  try {
    return execFileSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()

const home = mkdtempSync(join(tmpdir(), 'cc-sess-'))
const vault = join(home, 'Vault')
mkdirSync(join(vault, 'Tickets'), { recursive: true })
mkdirSync(join(home, '.claude-control'), { recursive: true })
writeFileSync(join(home, '.claude-control', 'config.json'), JSON.stringify({ vault }))
const fakeClaude = join(home, 'fake-claude')
writeFileSync(fakeClaude, '#!/bin/sh\necho "ARGS: $*"\necho "TICKET: $CLAUDE_CONTROL_TICKET"\nsleep 30\n')
chmodSync(fakeClaude, 0o755)
const ticketFile = join(vault, 'Tickets', 'demo-ticket.md')
const original = '---\ntype: ticket\nstatus: TODO\nupdated: 2026-11-01\n---\n# Demo\n'
writeFileSync(ticketFile, original)

describe.skipIf(!tmuxBin)('Sessions (scratch)', async () => {
  vi.stubEnv('HOME', home)
  const { Tmux } = await import('../src/main/tmux')
  const { Sessions } = await import('../src/main/sessions')
  const { loadTickets } = await import('../src/main/tickets')
  const { cleanEnv } = await import('../src/main/env')
  const conf = new URL('../resources/control.tmux.conf', import.meta.url).pathname
  class ScratchTmux extends Tmux {
    baseArgs() {
      return ['-L', `cc-sess-${process.pid}`, '-f', conf]
    }
  }
  const env = { ...cleanEnv(), HOME: home }
  const tmux = new ScratchTmux(tmuxBin, env)
  const sessions = new Sessions(tmux, fakeClaude, env)

  afterAll(() => {
    sessions.detachAll()
    try { execFileSync(tmuxBin, [...tmux.baseArgs(), 'kill-server']) } catch {}
    rmSync(`/private/tmp/tmux-${process.getuid!()}/cc-sess-${process.pid}`, { force: true })
  })

  it('first open writes cc_id + session_id (not updated:) and starts claude with --session-id and the ticket prompt', async () => {
    const out: string[] = []
    sessions.on('data', (_k, c) => out.push(c))
    const [ticket] = loadTickets(join(vault, 'Tickets'))
    const key = sessions.openTicket(ticket, await tmux.listSessions(), 120, 30)

    const text = readFileSync(ticketFile, 'utf8')
    expect(text).toMatch(new RegExp(`cc_id: ${key}\\n`))
    const sessionId = text.match(/session_id: (\S+)/)![1]
    expect(text).toContain('updated: 2026-11-01')

    await vi.waitFor(() => expect(out.join('')).toContain('TICKET:'), { timeout: 5000 })
    const screen = out.join('')
    expect(screen).toContain(`--session-id ${sessionId}`)
    expect(screen).toContain('Working on [[Tickets/demo-ticket]]')
    expect(screen).toContain(`TICKET: ${key}`)
    expect([...(await tmux.listSessions())]).toEqual(['cc-demo-ticket'])
  })

  it('reopening after the app detaches reattaches to the same tmux session instead of starting claude again', async () => {
    sessions.detachAll()
    const [ticket] = loadTickets(join(vault, 'Tickets'))
    const before = readFileSync(ticketFile, 'utf8')
    sessions.openTicket(ticket, await tmux.listSessions(), 120, 30)
    expect(readFileSync(ticketFile, 'utf8')).toBe(before) // no new session_id
    expect([...(await tmux.listSessions())]).toEqual(['cc-demo-ticket'])
  })

  it('a dead session with no transcript starts a fresh conversation rather than a failing --resume', async () => {
    const [ticket] = loadTickets(join(vault, 'Tickets'))
    await sessions.end(ticket.ccId!, 'cc-demo-ticket')
    const oldId = ticket.sessionId
    const out: string[] = []
    sessions.on('data', (_k, c) => out.push(c))
    sessions.openTicket(ticket, await tmux.listSessions(), 120, 30)
    await vi.waitFor(() => expect(out.join('')).toContain('ARGS:'), { timeout: 5000 })
    expect(out.join('')).not.toContain('--resume')
    expect(readFileSync(ticketFile, 'utf8')).not.toContain(`session_id: ${oldId}`)
  })
})
