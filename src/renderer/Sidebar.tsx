import { TicketRow } from './TicketRow'
import type { Group } from '../shared/types'

export function Sidebar({
  groups,
  selected,
  onSelect
}: {
  groups: Group[]
  selected?: string
  onSelect: (key: string) => void
}) {
  return (
    <aside className="w-80 shrink-0 flex flex-col border-r border-white/10 bg-[#0f1216]">
      <div className="drag h-11 shrink-0 flex items-end px-4 pb-2 pl-20 text-[12px] font-medium text-neutral-400">
        Claude Control
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 && <p className="px-3 py-6 text-sm text-neutral-500">No active tickets.</p>}
        {groups.map((g) => (
          <section key={g.name} className="mt-3">
            <h2 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              {g.name} <span className="text-neutral-600">{g.rows.length}</span>
            </h2>
            {g.rows.map((r) => (
              <TicketRow key={r.key} row={r} selected={r.key === selected} onClick={() => onSelect(r.key)} />
            ))}
          </section>
        ))}
      </nav>
    </aside>
  )
}
