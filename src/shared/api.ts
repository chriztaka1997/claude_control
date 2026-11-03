import type { Group } from './types'

export interface View {
  groups: Group[]
  badge: number
}

export type MenuAction = 'end' | 'new' | 'copyResume' | 'copyAttach' | 'reveal'

/** What preload exposes on window.cc. */
export interface ControlApi {
  getView(): Promise<View>
  startupError(): Promise<string | undefined>
  /** Settles the row key (a ticket's first open gives it a cc_id). Call before creating a terminal. */
  prepare(key: string): Promise<{ key?: string; error?: string }>
  /** Starts or attaches the session for a prepared key at the given size. */
  open(key: string, cols: number, rows: number): Promise<{ error?: string }>
  select(key: string | undefined): void
  input(key: string, data: string): void
  resize(key: string, cols: number, rows: number): void
  showMenu(key: string): void
  onView(cb: (view: View) => void): () => void
  onData(cb: (key: string, chunk: string) => void): () => void
  onExit(cb: (key: string, info: { failed: boolean; detail?: string }) => void): () => void
  onSelect(cb: (key: string) => void): () => void
}
