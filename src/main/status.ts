import { EventEmitter } from 'node:events'
import { readFileSync, readdirSync, renameSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { STATUS_DIR } from './config'
import type { StatusFile } from '../shared/types'

/** Latest hook status per ticket slug, fed by ~/.claude-control/status/*.json. */
export class StatusStore extends EventEmitter {
  readonly statuses = new Map<string, StatusFile>()
  private watcher?: FSWatcher

  /** Loads everything synchronously first, so startup never looks like a transition. */
  start(): void {
    for (const name of readdirSync(STATUS_DIR)) if (name.endsWith('.json')) this.read(join(STATUS_DIR, name), false)
    this.watcher = watch(STATUS_DIR, {
      ignoreInitial: true,
      depth: 0,
      ignored: (path, stats) => !!stats?.isFile() && !path.endsWith('.json')
    })
    this.watcher.on('add', (p) => this.read(p, true))
    this.watcher.on('change', (p) => this.read(p, true))
  }

  stop(): Promise<void> {
    return this.watcher?.close() ?? Promise.resolve()
  }

  private read(path: string, emit: boolean): void {
    let status: StatusFile
    try {
      status = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return // half-written files can't happen (atomic rename), but be safe
    }
    const slug = basename(path, '.json')
    const current = this.statuses.get(slug)
    // Hook processes can finish out of order; keep the newest.
    if (current && current.ccId === status.ccId && current.at > status.at) return
    this.statuses.set(slug, status)
    if (emit) this.emit('update', slug, status, current)
  }

  /** Follows a ticket rename. */
  move(oldSlug: string, newSlug: string): void {
    const from = join(STATUS_DIR, `${oldSlug}.json`)
    const to = join(STATUS_DIR, `${newSlug}.json`)
    if (existsSync(from)) {
      try {
        renameSync(from, to)
      } catch {}
    }
    const s = this.statuses.get(oldSlug)
    if (s) {
      this.statuses.delete(oldSlug)
      this.statuses.set(newSlug, { ...s, slug: newSlug })
    }
  }
}
