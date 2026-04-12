#!/usr/bin/env tsx
/**
 * Bisect the first byte offset at which @xterm/headless and iTerm2 disagree
 * on the rendered grid for a given raw PTY byte stream.
 *
 * Strategy
 * --------
 * - Pre-compute xterm/headless grids at a sequence of prefix lengths
 *   (geometric schedule up to the full length). This is fast.
 * - For each prefix length, ask iTerm2 to replay the prefix via
 *   `replay_in_iterm2.py` and compare the resulting grid against the
 *   xterm/headless grid (normalized: null→space, padded to cols).
 * - The first prefix that yields a content-level disagreement is the zone
 *   of the first divergence. Report it with a byte-level excerpt.
 *
 * Usage
 * -----
 *   npx tsx tools/oracle/bisect-divergence.ts RAW_FILE COLS ROWS
 *
 * Example
 * -------
 *   npx tsx tools/oracle/bisect-divergence.ts /tmp/claude-scenario.raw 120 40
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { replayBytes } from '../../src/lib/oracle'
import type { Grid } from '../../src/lib/oracle'
import { join } from 'node:path'

const [rawPath, colsStr, rowsStr] = process.argv.slice(2)
if (!rawPath) {
  console.error('usage: bisect-divergence.ts RAW_FILE COLS ROWS')
  process.exit(2)
}
const COLS = Number.parseInt(colsStr, 10)
const ROWS = Number.parseInt(rowsStr, 10)

const raw = readFileSync(rawPath, 'utf8')
console.log(`raw length: ${raw.length} chars`)

function normalizeRow(row: string): string {
  const denulled = row.replace(/\u0000/g, ' ')
  return denulled.length >= COLS
    ? denulled.slice(0, COLS)
    : denulled + ' '.repeat(COLS - denulled.length)
}

function gridLinesEqual(a: Grid, b: { lines: string[] }): boolean {
  const n = Math.max(a.lines.length, b.lines.length)
  for (let i = 0; i < n; i++) {
    if (normalizeRow(a.lines[i] ?? '') !== normalizeRow(b.lines[i] ?? ''))
      return false
  }
  return true
}

async function runItermReplay(
  prefix: string,
  tmpRaw: string,
  tmpJson: string,
): Promise<{ cols: number; rows: number; lines: string[] }> {
  writeFileSync(tmpRaw, prefix, 'utf8')
  const oracleDir = join(process.cwd(), 'tools/oracle')
  execSync(
    `.venv/bin/python replay_in_iterm2.py ${tmpRaw} ${tmpJson} ${COLS} ${ROWS}`,
    { cwd: oracleDir, stdio: 'pipe' },
  )
  return JSON.parse(readFileSync(tmpJson, 'utf8'))
}

async function main() {
  // Geometric schedule of prefix lengths
  const lengths: number[] = []
  let n = 500
  while (n < raw.length) {
    lengths.push(n)
    n = Math.ceil(n * 1.5)
  }
  lengths.push(raw.length)
  console.log(`testing ${lengths.length} prefix lengths:`, lengths.join(', '))

  let firstDiverge = -1
  for (const len of lengths) {
    const prefix = raw.slice(0, len)
    const xtermGrid = await replayBytes(prefix, { cols: COLS, rows: ROWS })
    const itermGrid = await runItermReplay(
      prefix,
      '/tmp/bisect.raw',
      '/tmp/bisect.iterm2.json',
    )
    const match = gridLinesEqual(xtermGrid, itermGrid)
    console.log(`  len=${len}: ${match ? 'match' : 'DIFFER'}`)
    if (!match && firstDiverge === -1) {
      firstDiverge = len
      // Show a few offending rows
      for (let i = 0; i < Math.min(xtermGrid.rows, itermGrid.lines.length); i++) {
        const e = normalizeRow(xtermGrid.lines[i] ?? '')
        const a = normalizeRow(itermGrid.lines[i] ?? '')
        if (e !== a) {
          console.log(
            `  row ${i}:\n    xterm  : ${JSON.stringify(e.slice(0, 80))}\n    iterm2 : ${JSON.stringify(a.slice(0, 80))}`,
          )
          break
        }
      }
      // Keep going a couple more to see if it's transient
    }
  }

  if (firstDiverge === -1) {
    console.log('\nNo divergence across any tested prefix — parsers agree.')
  } else {
    console.log(
      `\nFirst divergence at prefix length <= ${firstDiverge} bytes`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
