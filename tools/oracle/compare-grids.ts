#!/usr/bin/env tsx
/**
 * Compare two grid JSON dumps and report differences line-by-line.
 *
 * Accepts either format:
 *   - capture_iterm2.py:  { cols, rows, cursor, lines: [...] }
 *   - record-grid.ts:     { cols, rows, cursor, lines: [...], rawBytes? }
 *
 * Normalizes each row by padding/truncating to `cols` so that ragged trailing
 * whitespace does not count as a diff (both sides represent the same cells).
 *
 * Usage:
 *   npx tsx tools/oracle/compare-grids.ts EXPECTED.json ACTUAL.json
 *
 * Exits 0 if the grids are identical at the character level, 1 otherwise.
 */
import { readFileSync } from 'node:fs'

interface GridLike {
  cols: number
  rows: number
  cursor: { x: number; y: number }
  lines: string[]
}

function load(path: string): GridLike {
  const j = JSON.parse(readFileSync(path, 'utf8'))
  return {
    cols: j.cols,
    rows: j.rows,
    cursor: j.cursor,
    lines: j.lines,
  }
}

function normalizeRow(row: string, cols: number): string {
  // iTerm2 returns U+0000 for cells that were cleared (EL/ED) but never
  // written again; @xterm/headless returns space. Same visual meaning —
  // normalize to space so the diff is not drowned in spurious hits.
  const denulled = row.replace(/\u0000/g, ' ')
  if (denulled.length >= cols) return denulled.slice(0, cols)
  return denulled + ' '.repeat(cols - denulled.length)
}

const [expectedPath, actualPath] = process.argv.slice(2)
if (!expectedPath || !actualPath) {
  console.error('usage: compare-grids.ts EXPECTED.json ACTUAL.json')
  process.exit(2)
}
const expected = load(expectedPath)
const actual = load(actualPath)

const reasons: string[] = []
if (expected.cols !== actual.cols || expected.rows !== actual.rows) {
  reasons.push(
    `size: ${expected.cols}x${expected.rows} vs ${actual.cols}x${actual.rows}`,
  )
}
if (
  expected.cursor.x !== actual.cursor.x ||
  expected.cursor.y !== actual.cursor.y
) {
  // Cursor coord semantics differ between parsers (iTerm2 reports in
  // absolute-buffer coords including scrollback, xterm.js in viewport-local).
  // Report it for human inspection but do not count it as a diff.
  console.log(
    `note: cursor ${expected.cursor.x},${expected.cursor.y} vs ${actual.cursor.x},${actual.cursor.y} (coord systems may differ)`,
  )
}

const cols = Math.max(expected.cols, actual.cols)
const nRows = Math.max(expected.lines.length, actual.lines.length)
let diffLines = 0
for (let i = 0; i < nRows; i++) {
  const e = normalizeRow(expected.lines[i] ?? '', cols)
  const a = normalizeRow(actual.lines[i] ?? '', cols)
  if (e !== a) {
    diffLines++
    reasons.push(
      `line ${i}:\n  expected: ${JSON.stringify(e)}\n  actual:   ${JSON.stringify(a)}`,
    )
  }
}

if (reasons.length === 0) {
  console.log(`OK — ${nRows} rows identical (${expected.cols}x${expected.rows})`)
  process.exit(0)
}
console.log(
  `DIFF — ${diffLines}/${nRows} rows differ` +
    (reasons.length > diffLines ? ` (+ ${reasons.length - diffLines} meta)` : ''),
)
for (const r of reasons) console.log(r)
process.exit(1)
