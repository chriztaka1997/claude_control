import { BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } from 'electron'
import { VAULT, VAULT_NAME } from './config'
import type { Controller } from './controller'
import type { Sessions } from './sessions'
import type { Tmux } from './tmux'

export function wireIpc(
  controller: Controller,
  sessions: Sessions,
  tmux: Tmux,
  getWindow: () => BrowserWindow | undefined,
  startupError: () => string | undefined
): void {
  const send = (channel: string, ...args: unknown[]) => getWindow()?.webContents.send(channel, ...args)

  controller.on('view', (view) => send('view', view))
  sessions.on('data', (key, chunk) => send('pty:data', key, chunk))
  sessions.on('exit', (key, info) => send('pty:exit', key, info))

  ipcMain.handle('view:get', () => controller.current())
  ipcMain.handle('startup:error', () => startupError())

  // Step 1: settle the row key before the renderer creates a terminal, so the
  // terminal never has to change keys (a ticket's first open writes its cc_id).
  ipcMain.handle('session:prepare', async (_e, key: string) => {
    try {
      const row = controller.rowByKey(key)
      if (!row) return { error: 'Ticket not found' }
      if (row.orphan) return { key }
      const ticket = controller.ticketByKey(key)
      if (!ticket) return { error: 'Ticket not found' }
      if (ticket.ccId) return { key: ticket.ccId }
      const ccId = sessions.ensureCcId(ticket)
      await controller.reloadTickets()
      controller.selectedKey = ccId
      controller.publish()
      return { key: ccId }
    } catch (err) {
      return { error: (err as Error).message }
    }
  })

  // Step 2: start or attach, at the terminal's real size.
  ipcMain.handle('session:open', async (_e, key: string, cols: number, rows: number) => {
    try {
      const row = controller.rowByKey(key)
      if (!row) return { error: 'Ticket not found' }
      if (row.orphan) {
        sessions.openOrphan(key, row.tmuxName, cols, rows)
        return {}
      }
      const ticket = controller.ticketByKey(key)
      if (!ticket) return { error: 'Ticket not found' }
      await controller.refreshLiveness()
      sessions.openTicket(ticket, controller.live, cols, rows)
      await controller.refreshLiveness()
      controller.publish()
      return {}
    } catch (err) {
      return { error: (err as Error).message }
    }
  })

  ipcMain.on('session:select', (_e, key: string | undefined) => controller.select(key))
  ipcMain.on('pty:input', (_e, key: string, data: string) => sessions.write(key, data))
  ipcMain.on('pty:resize', (_e, key: string, cols: number, rows: number) => sessions.resize(key, cols, rows))

  ipcMain.on('row:menu', (_e, key: string) => {
    const row = controller.rowByKey(key)
    const win = getWindow()
    if (!row || !win) return
    const ticket = controller.ticketByKey(key)
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'End session',
        enabled: row.live,
        click: async () => {
          const { response } = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['End session', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: `End the Claude session for "${row.title}"?`,
            detail: row.orphan
              ? 'The ticket file is gone, so this conversation can only be resumed by its session id.'
              : 'The conversation is saved. Clicking the ticket later resumes it.'
          })
          if (response === 0) await sessions.end(key, row.tmuxName)
        }
      },
      {
        label: 'New conversation',
        enabled: !!ticket,
        click: async () => {
          if (!ticket) return
          const { response } = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['Start fresh', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: `Start a new conversation for "${row.title}"?`,
            detail: 'The current session ends and the ticket forgets its session id. The old transcript stays on disk.'
          })
          if (response === 0) await sessions.newConversation(key, ticket)
        }
      },
      { type: 'separator' },
      {
        label: 'Copy resume command',
        enabled: !!row.sessionId,
        click: () => clipboard.writeText(`cd '${VAULT}' && claude --resume ${row.sessionId}`)
      },
      {
        label: 'Copy tmux attach command',
        enabled: row.live,
        click: () => clipboard.writeText(tmux.attachHint(row.tmuxName))
      },
      { type: 'separator' },
      {
        label: 'Reveal in Obsidian',
        enabled: !row.orphan,
        click: () =>
          shell.openExternal(
            `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(`Tickets/${row.slug}`)}`
          )
      }
    ]
    Menu.buildFromTemplate(items).popup({ window: win })
  })
}
