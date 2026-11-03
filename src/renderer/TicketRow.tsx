import { DOTS } from './statusColors'
import type { Row } from '../shared/types'

export function TicketRow({ row, selected, onClick }: { row: Row; selected: boolean; onClick: () => void }) {
  const dot = DOTS[row.dot]
  const tip = [dot.label, row.dotDetail].filter(Boolean).join(': ')
  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        window.cc.showMenu(row.key)
      }}
      className={`w-full text-left px-3 py-1.5 flex items-start gap-2.5 rounded-md transition-colors ${
        selected ? 'bg-white/10' : 'hover:bg-white/5'
      }`}
    >
      <span
        title={tip}
        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot.pulse ? 'dot-pulse' : ''}`}
        style={{ background: dot.color }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-neutral-100">{row.title}</span>
        <span className="block truncate text-[11px] text-neutral-500">
          {row.repos.length ? row.repos.join(', ') : row.orphan ? row.dotDetail : row.slug}
        </span>
      </span>
    </button>
  )
}
