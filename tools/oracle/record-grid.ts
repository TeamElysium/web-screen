#!/usr/bin/env tsx
/**
 * Record a command under node-pty, stream its output into an @xterm/headless
 * terminal, and dump the resulting grid as JSON — the companion to
 * capture_iterm2.py. Run the *same* command in iTerm2 to get an iTerm2
 * baseline, then compare the two JSONs with compare-grids.ts.
 *
 * Usage:
 *   npx tsx tools/oracle/record-grid.ts COLS ROWS OUT.json -- <cmd> [args...]
 *
 * Example:
 *   npx tsx tools/oracle/record-grid.ts 80 24 /tmp/xterm.json -- \
 *     bash -c 'printf "\\x1b[2J\\x1b[H"; echo hi; printf "\\x1b[5;10Hanchor"'
 */
import { writeFileSync } from 'node:fs'
import { recordPtyCommand } from '../../src/lib/oracle'

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
if (sep < 3 || sep === argv.length - 1) {
  console.error(
    'usage: record-grid.ts COLS ROWS OUT.json -- <cmd> [args...]',
  )
  process.exit(2)
}
const [colsArg, rowsArg, outPath] = argv.slice(0, sep)
const [cmd, ...cmdArgs] = argv.slice(sep + 1)

const cols = Number.parseInt(colsArg, 10)
const rows = Number.parseInt(rowsArg, 10)
if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
  console.error('error: COLS and ROWS must be integers')
  process.exit(2)
}

async function main() {
  const rec = await recordPtyCommand(cmd, cmdArgs, {
    cols,
    rows,
    timeoutMs: 30_000,
  })
  const dump = {
    source: 'xterm-headless',
    cols: rec.liveGrid.cols,
    rows: rec.liveGrid.rows,
    cursor: rec.liveGrid.cursor,
    lines: rec.liveGrid.lines,
    rawBytes: rec.bytes,
  }
  writeFileSync(outPath, JSON.stringify(dump, null, 2), 'utf8')
  console.error(
    `wrote ${outPath}: ${rec.liveGrid.rows} rows, ${rec.bytes.length} bytes raw`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
