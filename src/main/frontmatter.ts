import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

/**
 * Sets `key: value` in a markdown file's frontmatter by editing just that line.
 * Everything else (quoting, order, comments, line endings, the body) stays
 * byte-identical. Returns null if the text has no frontmatter starting on line 1.
 */
export function setFieldInText(text: string, key: string, value: string): string | null {
  const lines = text.split(/(\r?\n)/) // keep separators at odd indexes
  const content = (i: number) => lines[i * 2]
  const count = Math.ceil(lines.length / 2)
  if (content(0) !== '---') return null
  let close = -1
  for (let i = 1; i < count; i++) {
    if (content(i) === '---') {
      close = i
      break
    }
  }
  if (close === -1) return null

  const eol = lines[1] ?? '\n'
  const newLine = value === '' ? `${key}:` : `${key}: ${value}`
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  for (let i = 1; i < close; i++) {
    if (keyRe.test(content(i))) {
      lines[i * 2] = newLine
      return lines.join('')
    }
  }
  lines.splice(close * 2, 0, newLine, eol)
  return lines.join('')
}

/**
 * Writes one frontmatter field in place. Re-reads the file right before writing,
 * never recreates a file that's gone, and never touches `updated:`.
 * Returns false if nothing was written.
 */
export function setField(file: string, key: string, value: string): boolean {
  if (key === 'updated') throw new Error('Claude Control never writes updated:')
  if (!existsSync(file)) return false
  const before = readFileSync(file, 'utf8')
  const after = setFieldInText(before, key, value)
  if (after === null) {
    console.warn(`[frontmatter] ${file}: no frontmatter on line 1, not writing ${key}`)
    return false
  }
  if (after === before) return true
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, after)
  if (!existsSync(file)) {
    // renamed or deleted between read and write
    try { unlinkSync(tmp) } catch {}
    return false
  }
  renameSync(tmp, file)
  return true
}
