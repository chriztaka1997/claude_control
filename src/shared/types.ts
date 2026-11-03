// Types shared by main, preload and renderer.

export type HookState = 'idle' | 'thinking' | 'needs_you' | 'finished' | 'error' | 'ended'

export type Dot = 'thinking' | 'needs_you' | 'error' | 'unread' | 'idle' | 'none'

export interface StatusFile {
  ccId: string
  slug: string
  state: HookState
  event: string
  sessionId?: string
  source?: string
  message?: string
  at: number
}

export interface Ticket {
  path: string
  slug: string
  ccId?: string
  title: string
  status: string
  priority: number
  repos: string[]
  sessionId?: string
  updated: number
  /** set when this file is a copy that shares another ticket's cc_id */
  duplicateOf?: string
}

export interface Row {
  key: string // ccId when known, else "slug:<slug>", else "tmux:<name>"
  slug: string
  ccId?: string
  title: string
  status: string
  repos: string[]
  sessionId?: string
  tmuxName: string
  live: boolean
  orphan: boolean
  dot: Dot
  dotDetail?: string
}

export interface Group {
  name: string
  rows: Row[]
}

export interface StartupError {
  message: string
}
