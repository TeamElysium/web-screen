#!/usr/bin/env tsx
/**
 * Record Claude Code's table output inside a screen session, then capture
 * the screen redraw after reattach — comparing streaming vs refresh.
 *
 * Flow:
 *   1. Create screen session, launch Claude inside
 *   2. Attach via node-pty, ask Claude to output a table
 *   3. Record streaming bytes (what xterm.js sees live)
 *   4. Detach, then reattach with cols-1 trick (simulating page refresh)
 *   5. Record redraw bytes (what xterm.js sees after refresh)
 *   6. Replay both through browser-configured @xterm/headless and compare
 *
 * Output:
 *   /tmp/table-stream.raw         streaming bytes from live session
 *   /tmp/table-redraw.raw         redraw bytes after reattach
 *   /tmp/table-stream.grid.txt    streaming grid (human-readable)
 *   /tmp/table-redraw.grid.txt    redraw grid (human-readable)
 *   /tmp/table-diff.txt           line-by-line diff
 *
 * Run: npx tsx tools/oracle/scenarios/record-table-redraw.ts
 * Requires real Claude API access (~1 minute).
 */
import { execSync } from 'node:child_process'
import { spawn as ptySpawn } from 'node-pty'
import { writeFileSync } from 'node:fs'
import { Terminal } from '@xterm/headless'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { diffGrids, type Grid } from '../../../src/lib/oracle'

const COLS = 120
const ROWS = 40

const STARTUP_IDLE_MS = 4000
const STARTUP_MAX_MS = 30_000
const TURN_IDLE_MS = 6000
const TURN_MAX_MS = 120_000

const log = (msg: string) => process.stderr.write(`[table-redraw] ${msg}\n`)

const PROMPT = `Print a table using box-drawing characters (┌─┬┐│├┼┤└┴┘) showing programming language popularity. Include columns: Language, Stars (GitHub), Usage %, and a Status column. Include at least 8 languages including Korean comments (한글 주석). Make the table at least 80 chars wide. Use bold SGR for headers and colored SGR (yellow) for the top 3 entries. Print it directly to stdout with printf or echo -e, do not create a file. Do NOT use any tools — just print the table directly as your text response.`

function makeBrowserTerm(cols: number, rows: number): Terminal {
  const term = new Terminal({ cols, rows, convertEol: true, allowProposedApi: true, scrollback: 0 })
  const u = new Unicode11Addon()
  term.loadAddon(u)
  term.unicode.activeVersion = '11'
  return term
}

function writeTermAsync(term: Terminal, data: string): Promise<void> {
  return new Promise(r => term.write(data, () => r()))
}

function snapshotLines(term: Terminal): string[] {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < term.rows; i++) {
    const line = buf.getLine(buf.baseY + i)
    lines.push(line ? line.translateToString(false) : ' '.repeat(term.cols))
  }
  return lines
}

function formatGrid(lines: string[], cols: number, rows: number): string {
  const border = '+' + '-'.repeat(cols) + '+'
  return [border, ...lines.map(l => '|' + l + '|'), border].join('\n')
}

async function waitForIdle(
  getLastDataTime: () => number,
  idleMs: number,
  maxMs: number,
  label: string,
): Promise<void> {
  const start = Date.now()
  while (true) {
    const sinceLast = Date.now() - getLastDataTime()
    if (sinceLast >= idleMs) return
    if (Date.now() - start >= maxMs) {
      log(`WARN: ${label} exceeded ${maxMs}ms`)
      return
    }
    await new Promise(r => setTimeout(r, 200))
  }
}

async function main(): Promise<void> {
  const sessionName = `wst_tblrec_${Date.now()}`
  log(`creating screen session: ${sessionName}`)

  execSync(
    `screen -dmUS ${sessionName} bash -c 'claude --dangerously-skip-permissions'`,
    { timeout: 3000 },
  )
  await new Promise(r => setTimeout(r, 1500))

  // === Phase 1: Attach and record streaming ===
  const chunks: string[] = []
  let lastData = Date.now()

  log(`attaching at ${COLS}x${ROWS}`)
  const proc = ptySpawn('screen', ['-xU', sessionName], {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: process.env.HOME,
  })
  proc.onData((d: string) => {
    chunks.push(d)
    lastData = Date.now()
  })
  let exited = false
  proc.onExit(() => { exited = true })

  log('waiting for Claude startup...')
  await waitForIdle(() => lastData, STARTUP_IDLE_MS, STARTUP_MAX_MS, 'startup')
  log(`startup idle, ${chunks.reduce((a, c) => a + c.length, 0)} bytes`)

  // Mark where the table turn starts
  const preTurnChunkCount = chunks.length

  log('sending table prompt...')
  proc.write(PROMPT + '\r')
  await new Promise(r => setTimeout(r, 200))
  lastData = Date.now()
  await waitForIdle(() => lastData, TURN_IDLE_MS, TURN_MAX_MS, 'table turn')

  const streamBytes = chunks.join('')
  const turnBytes = chunks.slice(preTurnChunkCount).join('')
  log(`streaming: ${streamBytes.length} total bytes, ${turnBytes.length} turn bytes`)

  // Save streaming bytes
  writeFileSync('/tmp/table-stream.raw', streamBytes, 'utf8')

  // Replay streaming in browser xterm
  const streamTerm = makeBrowserTerm(COLS, ROWS)
  await writeTermAsync(streamTerm, streamBytes)
  const streamLines = snapshotLines(streamTerm)
  streamTerm.dispose()

  writeFileSync('/tmp/table-stream.grid.txt', formatGrid(streamLines, COLS, ROWS), 'utf8')
  log('streaming grid saved')

  // === Phase 2: Detach and reattach (simulating page refresh) ===
  const preDetachCount = chunks.length

  // Detach cleanly
  log('detaching...')
  try { proc.write('\x01d') } catch {}
  await new Promise(r => setTimeout(r, 500))
  if (!exited) try { proc.kill() } catch {}

  // Reattach with cols-1 trick (same as socket-handler)
  log('reattaching with cols-1 trick...')
  const redrawChunks: string[] = []
  const redrawProc = ptySpawn('screen', ['-xU', sessionName], {
    name: 'xterm-256color',
    cols: Math.max(COLS - 1, 1),
    rows: ROWS,
    cwd: process.env.HOME,
  })
  let discarding = true
  redrawProc.onData((d: string) => {
    if (!discarding) redrawChunks.push(d)
  })
  let redrawExited = false
  redrawProc.onExit(() => { redrawExited = true })

  await new Promise(r => setTimeout(r, 50))
  discarding = false
  redrawProc.resize(COLS, ROWS)
  await new Promise(r => setTimeout(r, 2000))

  const redrawBytes = redrawChunks.join('')
  log(`redraw: ${redrawBytes.length} bytes`)

  writeFileSync('/tmp/table-redraw.raw', redrawBytes, 'utf8')

  // Replay redraw in browser xterm
  const redrawTerm = makeBrowserTerm(COLS, ROWS)
  await writeTermAsync(redrawTerm, redrawBytes)
  const redrawLines = snapshotLines(redrawTerm)
  redrawTerm.dispose()

  writeFileSync('/tmp/table-redraw.grid.txt', formatGrid(redrawLines, COLS, ROWS), 'utf8')
  log('redraw grid saved')

  // === Phase 3: Compare ===
  log('\n=== Streaming grid (last 30 rows with content) ===')
  for (let i = 0; i < ROWS; i++) {
    const l = streamLines[i]?.trimEnd()
    if (l) log(`[${String(i).padStart(2)}] ${l}`)
  }

  log('\n=== Redraw grid (last 30 rows with content) ===')
  for (let i = 0; i < ROWS; i++) {
    const l = redrawLines[i]?.trimEnd()
    if (l) log(`[${String(i).padStart(2)}] ${l}`)
  }

  log('\n=== Diffs ===')
  let diffs = 0
  const diffLines: string[] = []
  for (let i = 0; i < ROWS; i++) {
    const s = streamLines[i] ?? ''
    const r = redrawLines[i] ?? ''
    if (s !== r) {
      diffs++
      const line = `line ${i}:\n  stream: "${s.trimEnd()}"\n  redraw: "${r.trimEnd()}"`
      diffLines.push(line)
      log(line)
    }
  }
  if (diffs === 0) {
    log('(no diffs — streaming and redraw are identical)')
  } else {
    log(`\n${diffs} lines differ`)
  }

  writeFileSync('/tmp/table-diff.txt', diffLines.join('\n\n'), 'utf8')

  // Cleanup
  log('cleaning up...')
  try { redrawProc.write('\x01d') } catch {}
  await new Promise(r => setTimeout(r, 300))
  if (!redrawExited) try { redrawProc.kill() } catch {}
  try { execSync(`screen -S ${sessionName} -X quit`, { timeout: 3000 }) } catch {}

  log('done')
  if (diffs > 0) {
    log(`\nFiles saved:`)
    log(`  /tmp/table-stream.raw        — streaming bytes`)
    log(`  /tmp/table-redraw.raw        — redraw bytes`)
    log(`  /tmp/table-stream.grid.txt   — streaming grid`)
    log(`  /tmp/table-redraw.grid.txt   — redraw grid`)
    log(`  /tmp/table-diff.txt          — line diffs`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
