import type { Dot } from '../shared/types'

export const DOTS: Record<Dot, { color: string; label: string; pulse?: boolean }> = {
  thinking: { color: '#eab308', label: 'Thinking', pulse: true },
  needs_you: { color: '#f97316', label: 'Needs you' },
  error: { color: '#ef4444', label: 'Error or blocker' },
  unread: { color: '#3b82f6', label: 'Finished, unread' },
  idle: { color: '#22c55e', label: 'Idle' },
  none: { color: '#6b7280', label: 'No session' }
}
