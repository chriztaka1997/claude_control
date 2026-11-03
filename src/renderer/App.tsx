import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from './Sidebar'
import { TerminalArea, type TerminalHost } from './TerminalPane'
import type { View } from '../shared/api'

export function App() {
  const [view, setView] = useState<View>({ groups: [], badge: 0 })
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState<string>()
  const [fatal, setFatal] = useState<string>()
  const host = useRef<TerminalHost | undefined>(undefined)

  useEffect(() => {
    void window.cc.startupError().then(setFatal)
    void window.cc.getView().then(setView)
    const offView = window.cc.onView(setView)
    const offSelect = window.cc.onSelect((key) => void open(key))
    return () => {
      offView()
      offSelect()
    }
  }, [])

  const open = useCallback(async (clicked: string) => {
    const h = host.current
    if (!h) return
    setError(undefined)
    // Settle the key first: a ticket's first open gives it a cc_id, and the
    // terminal's input/resize handlers must be bound to the final key.
    const prep = await window.cc.prepare(clicked)
    if (prep.error || !prep.key) {
      setError(prep.error ?? 'Ticket not found')
      return
    }
    const key = prep.key
    setSelected(key)
    window.cc.select(key)
    if (h.has(key)) {
      h.show(key)
      return
    }
    const { cols, rows } = h.create(key)
    const res = await window.cc.open(key, cols, rows)
    if (res.error) setError(res.error)
    h.fitVisible()
  }, [])

  if (fatal) {
    return (
      <div className="h-full flex items-center justify-center p-10">
        <div className="max-w-lg rounded-lg border border-red-500/40 bg-red-500/10 p-6">
          <h1 className="mb-2 text-lg font-semibold text-red-300">Claude Control can't start</h1>
          <p className="text-sm text-neutral-300">{fatal}</p>
        </div>
      </div>
    )
  }

  const selectedRow = view.groups.flatMap((g) => g.rows).find((r) => r.key === selected)

  return (
    <div className="h-full flex">
      <Sidebar groups={view.groups} selected={selected} onSelect={(k) => void open(k)} />
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="drag h-11 shrink-0 flex items-end gap-3 border-b border-white/10 px-4 pb-2 text-[12px]">
          <span className="truncate text-neutral-300">{selectedRow?.title ?? ''}</span>
          {selectedRow && <span className="text-neutral-600">{selectedRow.status}</span>}
          {error && <span className="ml-auto text-red-400">{error}</span>}
        </header>
        <div className="relative flex-1 min-h-0 flex">
          {!selected && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-neutral-500">
              Pick a ticket
            </div>
          )}
          <TerminalArea onReady={(h) => (host.current = h)} />
        </div>
      </main>
    </div>
  )
}
