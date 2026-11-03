import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, mapEvent } from '../hook/status.mjs'

describe('mapEvent', () => {
  const cases: [Record<string, unknown>, string | null][] = [
    [{ hook_event_name: 'SessionStart' }, 'idle'],
    [{ hook_event_name: 'UserPromptSubmit' }, 'thinking'],
    [{ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, 'thinking'],
    [{ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }, 'needs_you'],
    [{ hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode' }, 'needs_you'],
    [{ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, 'needs_you'],
    [{ hook_event_name: 'PostToolUse' }, 'thinking'],
    [{ hook_event_name: 'PostToolUseFailure' }, 'thinking'],
    [{ hook_event_name: 'PermissionDenied' }, 'thinking'],
    [{ hook_event_name: 'Notification', notification_type: 'permission_prompt' }, 'needs_you'],
    [{ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' }, 'needs_you'],
    [{ hook_event_name: 'Notification', notification_type: 'idle_prompt' }, null],
    [{ hook_event_name: 'Stop' }, 'finished'],
    [{ hook_event_name: 'StopFailure', error: 'rate_limit' }, 'error'],
    [{ hook_event_name: 'SessionEnd' }, 'ended'],
    [{ hook_event_name: 'SomethingNew' }, null],
    [{ hook_event_name: 'PostToolUse', agent_id: 'sub-1' }, null]
  ]
  for (const [input, expected] of cases)
    it(`${input.hook_event_name}${input.tool_name ? '/' + input.tool_name : ''}${input.agent_id ? ' (subagent)' : ''}`, () =>
      expect(mapEvent(input)).toBe(expected))
})

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'cc-hook-'))
  mkdirSync(join(home, 'pending'), { recursive: true })
  writeFileSync(join(home, 'ids.json'), JSON.stringify({ id1: 'my-ticket' }))
  let printed = ''
  const out = { write: (s: string) => ((printed += s), true) }
  return { home, out, printed: () => printed }
}

describe('handle', () => {
  it('does nothing without CLAUDE_CONTROL_TICKET', () => {
    const { home, out, printed } = setup()
    handle({ hook_event_name: 'Stop' }, {}, home, out)
    expect(existsSync(join(home, 'status'))).toBe(false)
    expect(printed()).toBe('')
  })

  it('writes the status file under the ticket slug, atomically, printing nothing', () => {
    const { home, out, printed } = setup()
    handle({ hook_event_name: 'StopFailure', session_id: 's1', error: 'rate_limit', error_details: '429' }, { CLAUDE_CONTROL_TICKET: 'id1' }, home, out)
    const s = JSON.parse(readFileSync(join(home, 'status', 'my-ticket.json'), 'utf8'))
    expect(s).toMatchObject({ ccId: 'id1', slug: 'my-ticket', state: 'error', sessionId: 's1', message: 'rate_limit: 429' })
    expect(readdirSync(join(home, 'status'))).toEqual(['my-ticket.json'])
    expect(printed()).toBe('')
  })

  it('delivers a rename notice once, only on UserPromptSubmit', () => {
    const { home, out, printed } = setup()
    const env = { CLAUDE_CONTROL_TICKET: 'id1' }
    writeFileSync(join(home, 'pending', 'id1.json'), JSON.stringify({ oldPath: 'Tickets/old.md', newPath: 'Tickets/my-ticket.md' }))
    handle({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, env, home, out)
    expect(printed()).toBe('')
    handle({ hook_event_name: 'UserPromptSubmit' }, env, home, out)
    const json = JSON.parse(printed())
    expect(json.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(json.hookSpecificOutput.additionalContext).toContain('Tickets/my-ticket.md (was Tickets/old.md)')
    expect(readdirSync(join(home, 'pending'))).toEqual([])
    const before = printed()
    handle({ hook_event_name: 'UserPromptSubmit' }, env, home, out)
    expect(printed()).toBe(before)
  })

  it('keeps the notice if printing fails', () => {
    const { home } = setup()
    writeFileSync(join(home, 'pending', 'id1.json'), JSON.stringify({ oldPath: 'a', newPath: 'b' }))
    const broken = { write: () => { throw new Error('EPIPE') } }
    handle({ hook_event_name: 'UserPromptSubmit' }, { CLAUDE_CONTROL_TICKET: 'id1' }, home, broken)
    expect(existsSync(join(home, 'pending', 'id1.json'))).toBe(true)
  })
})
