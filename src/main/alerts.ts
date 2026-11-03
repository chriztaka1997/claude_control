import { app, Notification, type BrowserWindow } from 'electron'
import type { Controller } from './controller'
import type { Dot, Row } from '../shared/types'

const MESSAGES: Partial<Record<Dot, (r: Row) => [string, string | undefined]>> = {
  needs_you: (r) => [`${r.title} needs you`, r.dotDetail],
  error: (r) => [`${r.title} hit an error`, r.dotDetail],
  unread: (r) => [`${r.title} finished`, undefined]
}

export function wireAlerts(controller: Controller, getWindow: () => BrowserWindow | undefined, select: (key: string) => void): void {
  controller.on('view', ({ badge }) => app.dock?.setBadge(badge ? String(badge) : ''))

  controller.on('transition', (row: Row) => {
    const make = MESSAGES[row.dot]
    if (!make || !Notification.isSupported()) return
    const win = getWindow()
    if (win?.isFocused() && controller.selectedKey === row.key) return
    const [title, body] = make(row)
    const n = new Notification({ title, body: body ?? '', silent: true })
    n.on('click', () => {
      const w = getWindow()
      if (w) {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      }
      select(row.key)
    })
    n.show()
  })
}
