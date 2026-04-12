#!/usr/bin/env tsx
/**
 * Real-world oracle stress test.
 *
 * Spawns an interactive `claude` session under node-pty, injects a multi-turn
 * conversation that creates and edits a temp file, and records every PTY byte.
 * Then:
 *   1. Checks the on-disk temp file has the expected final content.
 *   2. Replays the recorded bytes twice through @xterm/headless — the two
 *      grids must be identical (replay determinism).
 *   3. Replays the bytes once at a different cols/rows — the grid must
 *      differ (confirms size is load-bearing, no accidental invariants).
 *   4. Saves raw bytes, final grid, and a text render of the grid to /tmp
 *      so the human can eyeball the result vs what they'd see in iTerm2.
 *
 * Why this matters: the vitest oracle tests use a synthetic producer. This
 * script proves the oracle holds on a realistic Claude Code TUI stream —
 * streaming tokens, box-drawing prompts, alt-screen, tool-use panels, and
 * the kinds of overdraws that have been the source of the web-screen
 * regressions we're trying to fix.
 *
 * Usage:
 *   npx tsx tools/oracle/scenarios/claude-multiturn.ts
 *
 * Output (in /tmp):
 *   - oracle-claude-scenario.txt         the file Claude created/edited
 *   - claude-scenario.raw                raw PTY bytes
 *   - claude-scenario.grid.json          final grid as JSON
 *   - claude-scenario.grid.txt           final grid as plain text (eyeball)
 */
import { spawn } from 'node-pty'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import {
  replayBytes,
  diffGrids,
  type Grid,
} from '../../../src/lib/oracle'

const COLS = 120
const ROWS = 40
const TEMP_FILE = '/tmp/oracle-claude-scenario.txt'
const RAW_OUT = '/tmp/claude-scenario.raw'
const GRID_JSON_OUT = '/tmp/claude-scenario.grid.json'
const GRID_TXT_OUT = '/tmp/claude-scenario.grid.txt'

// Per-turn idle threshold — declare a turn "done" after this many ms with no
// PTY output. Claude streams, so shorter values risk cutting mid-response.
const TURN_IDLE_MS = 4000
// Hard cap per turn, in case claude never goes idle (network stall, etc.).
const TURN_MAX_MS = 120_000
// Initial startup wait (claude prints splash + prompt before it's ready).
const STARTUP_IDLE_MS = 3000
const STARTUP_MAX_MS = 30_000

const log = (msg: string) => process.stderr.write(`[scenario] ${msg}\n`)

interface Turn {
  name: string
  message: string
}

const TURNS: Turn[] = [
  {
    name: 'create',
    message:
      `create a file at ${TEMP_FILE} whose entire contents are exactly the single line "hello" (no trailing newline). Use the Write tool directly — do not ask for confirmation.`,
  },
  {
    name: 'append',
    message:
      `append a second line containing exactly the word "world" to ${TEMP_FILE}. So the file should now be two lines: hello then world.`,
  },
  {
    name: 'replace',
    message:
      `in ${TEMP_FILE}, replace the word "world" on the second line with the word "universe". Final contents must be "hello" on line 1 and "universe" on line 2.`,
  },
]

type ProcHandle = ReturnType<typeof spawn>

async function waitForIdle(
  getLastDataTime: () => number,
  idleMs: number,
  maxMs: number,
  label: string,
): Promise<void> {
  const start = Date.now()
  while (true) {
    const sinceLast = Date.now() - getLastDataTime()
    const sinceStart = Date.now() - start
    if (sinceLast >= idleMs) return
    if (sinceStart >= maxMs) {
      log(`WARN: ${label} exceeded ${maxMs}ms without going idle — continuing`)
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

function cleanupTempFile() {
  try {
    if (existsSync(TEMP_FILE)) unlinkSync(TEMP_FILE)
  } catch {
    // ignore
  }
}

function formatGridAsText(grid: Grid): string {
  const border = '+' + '-'.repeat(grid.cols) + '+'
  const rows = grid.lines.map((l) => '|' + l + '|')
  return [border, ...rows, border, `cursor: (${grid.cursor.x}, ${grid.cursor.y})`].join(
    '\n',
  )
}

async function driveClaude(): Promise<{ bytes: string }> {
  cleanupTempFile()

  const chunks: string[] = []
  let lastData = Date.now()

  log(`spawning claude (${COLS}x${ROWS})`)
  const proc: ProcHandle = spawn(
    'claude',
    ['--dangerously-skip-permissions'],
    {
      name: 'xterm-256color',
      cols: COLS,
      rows: ROWS,
      cwd: process.cwd(),
      env: { ...process.env },
    },
  )

  proc.onData((d: string) => {
    chunks.push(d)
    lastData = Date.now()
  })

  let exited = false
  proc.onExit(() => {
    exited = true
    log('claude exited')
  })

  try {
    log(`waiting up to ${STARTUP_MAX_MS}ms for startup`)
    await waitForIdle(() => lastData, STARTUP_IDLE_MS, STARTUP_MAX_MS, 'startup')
    log(`startup idle, ${chunks.reduce((a, c) => a + c.length, 0)} bytes so far`)

    for (let i = 0; i < TURNS.length; i++) {
      const turn = TURNS[i]
      log(`turn ${i + 1}/${TURNS.length} [${turn.name}]: sending`)
      proc.write(turn.message + '\r')
      // Tiny delay so the \r is not coalesced with subsequent activity.
      await new Promise((r) => setTimeout(r, 200))
      lastData = Date.now() // reset idle clock
      await waitForIdle(() => lastData, TURN_IDLE_MS, TURN_MAX_MS, `turn ${i + 1}`)
      const totalBytes = chunks.reduce((a, c) => a + c.length, 0)
      log(`turn ${i + 1} idle, ${totalBytes} bytes so far`)
    }

    log('done with turns; killing claude')
  } finally {
    if (!exited) {
      try {
        proc.kill()
      } catch {
        // ignore
      }
    }
    // Give onData a moment to flush any final writes.
    await new Promise((r) => setTimeout(r, 300))
  }

  return { bytes: chunks.join('') }
}

async function main(): Promise<void> {
  const { bytes } = await driveClaude()
  writeFileSync(RAW_OUT, bytes, 'utf8')
  log(`raw bytes saved: ${bytes.length} bytes -> ${RAW_OUT}`)

  // --- File content verification ----------------------------------------
  let fileOk = false
  if (existsSync(TEMP_FILE)) {
    const content = readFileSync(TEMP_FILE, 'utf8')
    log(`${TEMP_FILE} content: ${JSON.stringify(content)}`)
    fileOk = content.includes('hello') && content.includes('universe')
    log(`file content check: ${fileOk ? 'OK' : 'FAIL'} (hello + universe present)`)
  } else {
    log(`${TEMP_FILE} does not exist — file content check FAIL`)
  }

  // --- Replay determinism (oracle gate 1) -------------------------------
  const gridA = await replayBytes(bytes, { cols: COLS, rows: ROWS })
  const gridB = await replayBytes(bytes, { cols: COLS, rows: ROWS })
  const detDiff = diffGrids(gridA, gridB)
  log(
    `replay determinism: ${detDiff.equal ? 'OK' : 'FAIL'} (${gridA.rows} rows, cursor=(${gridA.cursor.x},${gridA.cursor.y}))`,
  )
  if (!detDiff.equal) {
    for (const r of detDiff.reasons.slice(0, 5)) log('  ' + r)
  }

  // --- Size sensitivity (oracle gate 2) ---------------------------------
  const gridNarrow = await replayBytes(bytes, { cols: 80, rows: ROWS })
  const sizeDiff = diffGrids(gridA, gridNarrow)
  log(
    `size sensitivity: ${!sizeDiff.equal ? 'OK (grids differ at diff cols)' : 'FAIL (grids identical across cols — suspicious)'}`,
  )

  // --- Save artifacts ---------------------------------------------------
  writeFileSync(
    GRID_JSON_OUT,
    JSON.stringify(
      {
        source: 'xterm-headless',
        cols: gridA.cols,
        rows: gridA.rows,
        cursor: gridA.cursor,
        lines: gridA.lines,
      },
      null,
      2,
    ),
    'utf8',
  )
  writeFileSync(GRID_TXT_OUT, formatGridAsText(gridA), 'utf8')
  log(`grid JSON -> ${GRID_JSON_OUT}`)
  log(`grid text -> ${GRID_TXT_OUT}`)

  // --- Verdict ---------------------------------------------------------
  const allOk = fileOk && detDiff.equal && !sizeDiff.equal
  log(allOk ? 'SCENARIO: OK' : 'SCENARIO: FAIL')
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
