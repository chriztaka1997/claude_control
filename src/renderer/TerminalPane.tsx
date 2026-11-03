import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

interface Entry {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  key: string
}

/**
 * One xterm per opened ticket, kept alive in hidden divs so switching is
 * instant. All terminals share a single data/exit subscription.
 */
export class TerminalHost {
  private entries = new Map<string, Entry>()
  private visible?: string
  private unsubs: (() => void)[] = []

  constructor(private readonly container: HTMLDivElement) {
    this.unsubs.push(
      window.cc.onData((key, chunk) => this.entries.get(key)?.term.write(chunk)),
      window.cc.onExit((key, info) => {
        const e = this.entries.get(key)
        if (!e) return
        e.term.write(
          info.failed
            ? `\r\n\x1b[31m[Claude Control] Session failed to start: ${info.detail ?? ''}\x1b[0m\r\n`
            : '\r\n\x1b[90m[Claude Control] Session ended. Click the ticket to resume.\x1b[0m\r\n'
        )
        this.entries.delete(key)
        // Keep the text visible until another ticket is shown; then drop it.
        this.retired.set(key, e)
      })
    )
    new ResizeObserver(() => this.fitVisible()).observe(container)
  }

  private retired = new Map<string, Entry>()

  has(key: string): boolean {
    return this.entries.has(key)
  }

  /**
   * Creates the terminal for a settled key, shows it and fits it to the pane
   * right away, so the session starts at the real size (not xterm's 80x24).
   */
  create(key: string): { cols: number; rows: number } {
    this.dropRetired(key)
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;inset:0;display:none'
    this.container.appendChild(host)
    const term = new Terminal({
      fontFamily: 'Menlo, "SF Mono", Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
      scrollback: 1000,
      theme: { background: '#0b0d10', foreground: '#d7dae0', cursor: '#d7dae0', selectionBackground: '#3b82f655' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, url) => window.open(url)))
    term.open(host)
    // Shift+Enter: send the kitty/CSI-u sequence so Claude gets a newline, not submit.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === 'keydown' && ev.key === 'Enter' && ev.shiftKey) {
        window.cc.input(key, '\x1b[13;2u')
        return false
      }
      return true
    })
    term.onData((d) => window.cc.input(key, d))
    term.onResize(({ cols, rows }) => window.cc.resize(key, cols, rows))
    this.entries.set(key, { term, fit, host, key })
    this.show(key)
    this.fitNow(key)
    return { cols: term.cols, rows: term.rows }
  }

  show(key: string | undefined): void {
    for (const [k, e] of [...this.entries, ...this.retired]) e.host.style.display = k === key ? 'block' : 'none'
    for (const k of [...this.retired.keys()]) if (k !== key) this.dropRetired(k)
    this.visible = key
    this.fitVisible()
    if (key) this.entries.get(key)?.term.focus()
  }

  private dropRetired(key: string): void {
    const e = this.retired.get(key)
    if (!e) return
    e.term.dispose()
    e.host.remove()
    this.retired.delete(key)
  }

  private fitNow(key: string): void {
    const e = this.entries.get(key) ?? this.retired.get(key)
    if (!e || e.host.style.display === 'none') return // hidden → measures as 0 columns
    try {
      e.fit.fit()
    } catch {}
  }

  /** Refit after layout changes (window resize, switching tickets). */
  fitVisible(): void {
    const key = this.visible
    if (key) requestAnimationFrame(() => this.fitNow(key))
  }

  dispose(): void {
    this.unsubs.forEach((u) => u())
    for (const e of [...this.entries.values(), ...this.retired.values()]) e.term.dispose()
  }
}

export function TerminalArea({ onReady }: { onReady: (host: TerminalHost) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = new TerminalHost(ref.current!)
    onReady(host)
    return () => host.dispose()
  }, [])
  return <div ref={ref} className="relative flex-1 min-w-0" />
}
