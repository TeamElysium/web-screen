#!/usr/bin/env tsx
/** Binary search the exact smallest prefix length at which @xterm/headless
 * and iTerm2 disagree on the grid, within a bounded range. */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { replayBytes } from '../../src/lib/oracle'
import type { Grid } from '../../src/lib/oracle'
import { join } from 'node:path'

const [rawPath, colsStr, rowsStr, loStr, hiStr] = process.argv.slice(2)
const COLS = +colsStr
const ROWS = +rowsStr
const raw = readFileSync(rawPath, 'utf8')
let lo = +loStr
let hi = +hiStr

function normalizeRow(row: string): string {
  const d = row.replace(/\u0000/g, ' ')
  return d.length >= COLS ? d.slice(0, COLS) : d + ' '.repeat(COLS - d.length)
}

function gridsDiffer(a: Grid, b: { lines: string[] }): boolean {
  const n = Math.max(a.lines.length, b.lines.length)
  for (let i = 0; i < n; i++) {
    if (normalizeRow(a.lines[i] ?? '') !== normalizeRow(b.lines[i] ?? ''))
      return true
  }
  return false
}

async function differsAt(len: number): Promise<boolean> {
  const prefix = raw.slice(0, len)
  writeFileSync('/tmp/bisect.raw', prefix, 'utf8')
  const oracleDir = join(process.cwd(), 'tools/oracle')
  execSync(
    `.venv/bin/python replay_in_iterm2.py /tmp/bisect.raw /tmp/bisect.iterm2.json ${COLS} ${ROWS}`,
    { cwd: oracleDir, stdio: 'pipe' },
  )
  const iterm = JSON.parse(readFileSync('/tmp/bisect.iterm2.json', 'utf8'))
  const xterm = await replayBytes(prefix, { cols: COLS, rows: ROWS })
  return gridsDiffer(xterm, iterm)
}

async function main() {
  console.log(`bisecting prefix length in [${lo}, ${hi}]`)
  // Invariant: lo matches, hi differs
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    const diff = await differsAt(mid)
    console.log(`  len=${mid}: ${diff ? 'DIFFER' : 'match'}`)
    if (diff) hi = mid
    else lo = mid
  }
  console.log(`\nfirst divergence: prefix length ${hi}`)
  // Dump the byte context around the boundary
  const ctx = raw.slice(Math.max(0, hi - 40), hi + 20)
  console.log(
    'bytes around boundary (ESC marked):\n' +
      JSON.stringify(ctx).replace(/\\u001b/g, 'ESC'),
  )

  // Also show the first diverging row
  const prefix = raw.slice(0, hi)
  const xterm = await replayBytes(prefix, { cols: COLS, rows: ROWS })
  const iterm = JSON.parse(readFileSync('/tmp/bisect.iterm2.json', 'utf8'))
  for (let i = 0; i < xterm.rows; i++) {
    const e = normalizeRow(xterm.lines[i] ?? '')
    const a = normalizeRow(iterm.lines[i] ?? '')
    if (e !== a) {
      console.log(`row ${i}:\n  xterm  : ${JSON.stringify(e)}\n  iterm2 : ${JSON.stringify(a)}`)
      break
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
