import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setField, setFieldInText } from '../src/main/frontmatter'

const doc = `---
type: ticket
status: "Code Review"
repos: [[[my-repo]]]
updated: 2026-11-02
---
# Title

Body
---
not frontmatter: here
`

describe('setFieldInText', () => {
  it('inserts before the closing --- and leaves everything else byte-identical', () => {
    const out = setFieldInText(doc, 'cc_id', 'abc123')!
    expect(out).toBe(doc.replace('updated: 2026-11-02\n---', 'updated: 2026-11-02\ncc_id: abc123\n---'))
  })

  it('replaces an existing key in place', () => {
    const once = setFieldInText(doc, 'session_id', 'one')!
    const twice = setFieldInText(once, 'session_id', 'two')!
    expect(twice).toBe(doc.replace('updated: 2026-11-02\n---', 'updated: 2026-11-02\nsession_id: two\n---'))
  })

  it('writes an empty value as a bare key', () => {
    const out = setFieldInText(setFieldInText(doc, 'session_id', 'x')!, 'session_id', '')!
    expect(out).toContain('\nsession_id:\n---')
  })

  it('never touches --- lines in the body', () => {
    const out = setFieldInText(doc, 'cc_id', 'z')!
    expect(out.endsWith('Body\n---\nnot frontmatter: here\n')).toBe(true)
  })

  it('keeps CRLF line endings', () => {
    const crlf = doc.replace(/\n/g, '\r\n')
    const out = setFieldInText(crlf, 'cc_id', 'q')!
    expect(out).toBe(crlf.replace('updated: 2026-11-02\r\n---', 'updated: 2026-11-02\r\ncc_id: q\r\n---'))
  })

  it('does not match a key that only shares a prefix', () => {
    const out = setFieldInText('---\nsession_id_old: a\n---\n', 'session_id', 'b')!
    expect(out).toBe('---\nsession_id_old: a\nsession_id: b\n---\n')
  })

  it('refuses files without frontmatter on line 1', () => {
    expect(setFieldInText('\n---\na: 1\n---\n', 'cc_id', 'x')).toBeNull()
    expect(setFieldInText('# no frontmatter', 'cc_id', 'x')).toBeNull()
    expect(setFieldInText('---\nunclosed: true\n', 'cc_id', 'x')).toBeNull()
  })
})

describe('setField', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-fm-'))

  it('writes in place and leaves no temp files', () => {
    const file = join(dir, 't.md')
    writeFileSync(file, doc)
    expect(setField(file, 'cc_id', 'k1')).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('cc_id: k1')
    expect(readFileSync(file, 'utf8')).toContain('updated: 2026-11-02')
    expect(readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('never recreates a missing file', () => {
    const file = join(dir, 'gone.md')
    expect(setField(file, 'cc_id', 'k1')).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('refuses to write updated:', () => {
    expect(() => setField(join(dir, 't.md'), 'updated', '2030-01-01')).toThrow()
  })
})
