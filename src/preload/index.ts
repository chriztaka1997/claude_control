import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ControlApi } from '../shared/api'

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ControlApi = {
  getView: () => ipcRenderer.invoke('view:get'),
  startupError: () => ipcRenderer.invoke('startup:error'),
  prepare: (key) => ipcRenderer.invoke('session:prepare', key),
  open: (key, cols, rows) => ipcRenderer.invoke('session:open', key, cols, rows),
  select: (key) => ipcRenderer.send('session:select', key),
  input: (key, data) => ipcRenderer.send('pty:input', key, data),
  resize: (key, cols, rows) => ipcRenderer.send('pty:resize', key, cols, rows),
  showMenu: (key) => ipcRenderer.send('row:menu', key),
  onView: (cb) => listen('view', cb),
  onData: (cb) => listen('pty:data', cb),
  onExit: (cb) => listen('pty:exit', cb),
  onSelect: (cb) => listen('select', cb)
}

contextBridge.exposeInMainWorld('cc', api)
