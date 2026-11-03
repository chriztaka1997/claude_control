// Claude Control status hook. Runs on every hook event of sessions started by
// the app (CLAUDE_CONTROL_TICKET is set); does nothing for normal sessions.
// Must never block Claude: always exit 0, and print nothing except the
// one-time rename notice on UserPromptSubmit.
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const NEEDS_YOU_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog', 'agent_needs_input'])

/** Hook input → state, or null to ignore the event. */
export function mapEvent(input) {
  if (!input || input.agent_id) return null
  switch (input.hook_event_name) {
    case 'SessionStart':
      return 'idle'
    case 'UserPromptSubmit':
      return 'thinking'
    case 'PreToolUse':
      return ASK_TOOLS.has(input.tool_name) ? 'needs_you' : 'thinking'
    case 'PermissionRequest':
      return 'needs_you'
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionDenied':
      return 'thinking'
    case 'Notification':
      return NEEDS_YOU_NOTIFICATIONS.has(input.notification_type) ? 'needs_you' : null
    case 'Stop':
      return 'finished'
    case 'StopFailure':
      return 'error'
    case 'SessionEnd':
      return 'ended'
    default:
      return null
  }
}

function eventMessage(input) {
  if (input.hook_event_name === 'StopFailure') return [input.error, input.error_details].filter(Boolean).join(': ')
  if (input.hook_event_name === 'Notification') return input.message
  if (input.hook_event_name === 'PermissionRequest' || input.hook_event_name === 'PreToolUse') return input.tool_name
  return undefined
}

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

function resolveSlug(home, ccId) {
  try {
    const ids = JSON.parse(readFileSync(join(home, 'ids.json'), 'utf8'))
    if (ids[ccId]) return ids[ccId]
  } catch {}
  return process.env.CLAUDE_CONTROL_SLUG || ccId
}

/** Claims and returns the pending rename notice for this ticket, once. */
export function takeRenameNotice(home, ccId) {
  const pending = join(home, 'pending', `${ccId}.json`)
  if (!existsSync(pending)) return null
  const claimed = `${pending}.${process.pid}.claimed`
  try {
    renameSync(pending, claimed)
  } catch {
    return null // another hook process got it
  }
  try {
    const { oldPath, newPath } = JSON.parse(readFileSync(claimed, 'utf8'))
    return {
      text:
        `Note from Claude Control: this session's ticket was renamed. It is now ${newPath} (was ${oldPath}). ` +
        'Use the new path from now on; the old file no longer exists.',
      done: () => unlinkSync(claimed),
      undo: () => renameSync(claimed, pending)
    }
  } catch {
    try { unlinkSync(claimed) } catch {}
    return null
  }
}

/**
 * @param {Record<string, any>} input hook JSON from stdin
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [home] ~/.claude-control
 * @param {{ write(s: string): unknown }} [out]
 */
export function handle(input, env = process.env, home = join(homedir(), '.claude-control'), out = process.stdout) {
  const at = Date.now()
  const ccId = env.CLAUDE_CONTROL_TICKET
  if (!ccId) return
  const state = mapEvent(input)
  if (state) {
    const slug = resolveSlug(home, ccId)
    const dir = join(home, 'status')
    mkdirSync(dir, { recursive: true })
    const status = {
      ccId,
      slug,
      state,
      event: input.hook_event_name,
      sessionId: input.session_id,
      source: input.source,
      message: eventMessage(input),
      at
    }
    atomicWrite(join(dir, `${slug}.json`), JSON.stringify(status))
  }
  if (input?.hook_event_name === 'UserPromptSubmit' && !input.agent_id) {
    const notice = takeRenameNotice(home, ccId)
    if (notice) {
      try {
        out.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: notice.text } }))
        notice.done()
      } catch {
        try { notice.undo() } catch {}
      }
    }
  }
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    handle(JSON.parse(readStdin() || '{}'))
  } catch {}
  process.exit(0)
}
