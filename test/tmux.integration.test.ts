// Runs against a real tmux on a scratch socket (never the app's own server).
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanEnv } from '../src/main/env'
import { Tmux, sessionName } from '../src/main/tmux'

const bin = (() => {
  try {
    return execFileSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()
const conf = new URL('../resources/control.tmux.conf', import.meta.url).pathname
const leaky = { ...process.env, CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', TMUX: '/tmp/x,1,0' }
const env = cleanEnv(leaky)

class ScratchTmux extends Tmux {
  baseArgs() {
    return ['-L', `cc-selftest-${process.pid}`, '-f', conf]
  }
}
const t = new ScratchTmux(bin, env)
const raw = (args: string[]) => execFileSync(bin, [...t.baseArgs(), ...args], { env, encoding: 'utf8' })

describe.skipIf(!bin)('tmux (scratch server)', () => {
  afterAll(() => {
    try { raw(['kill-server']) } catch {}
    rmSync(`/private/tmp/tmux-${process.getuid!()}/cc-selftest-${process.pid}`, { force: true })
  })

  it('treats "no server running" as no sessions', async () => {
    expect([...(await t.listSessions())]).toEqual([])
  })

  it('ending a session never kills one that only shares its prefix', async () => {
    raw(['new-session', '-d', '-s', sessionName('demo-testing-fixes'), '-e', 'CLAUDE_CONTROL_TICKET=abc', 'sleep', '60'])
    await t.kill(sessionName('demo-testing'))
    expect([...(await t.listSessions())]).toEqual(['cc-demo-testing-fixes'])
  })

  it('reads the cc_id back from the session env and renames exactly', async () => {
    expect(await t.sessionEnv('cc-demo-testing-fixes', 'CLAUDE_CONTROL_TICKET')).toBe('abc')
    expect(await t.sessionEnv('cc-demo-testing', 'CLAUDE_CONTROL_TICKET')).toBeUndefined()
    expect(await t.rename('cc-demo-testing-fixes', 'cc-demo-bugfixes')).toBe(true)
    expect([...(await t.listSessions())]).toEqual(['cc-demo-bugfixes'])
  })

  it('loads the app config (no prefix, extended keys) and none of my ~/.tmux.conf', () => {
    expect(raw(['show', '-gv', 'prefix']).trim()).toBe('None')
    expect(raw(['show', '-gv', 'extended-keys']).trim()).toBe('on')
    // ~/.tmux.conf binds C-h/j/k/l/n/b/q in the root table; none of those may exist here.
    expect(raw(['list-keys', '-T', 'root'])).not.toMatch(/root\s+C-[hjklnbq]\s/)
  })

  it('does not leak a parent Claude session env into the server', () => {
    const global = raw(['show-environment', '-g'])
    expect(global).not.toMatch(/^CLAUDECODE=/m)
    expect(global).not.toMatch(/^CLAUDE_CODE_CHILD_SESSION=/m)
    expect(global).not.toMatch(/^TMUX=/m)
  })
})
