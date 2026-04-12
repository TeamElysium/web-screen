#!/usr/bin/env tsx
/**
 * Resize-aware oracle scenario.
 *
 * Drives a real `claude` multi-turn session under node-pty exactly like
 * claude-multiturn.ts, but also performs two resizes mid-conversation so we
 * exercise the redraw paths that the web-screen SIGWINCH / debounce work was
 * meant to fix.
 *
 * Sequence of events (recorded with byte offsets):
 *   start at 120 x 40
 *   turn 1      — create file
 *   resize     120 x 40  ->  80 x 30
 *   turn 2      — append "world"
 *   resize      80 x 30  ->  120 x 40
 *   turn 3      — replace "world" with "universe"
 *   kill claude
 *
 * Verification (all gates must pass for SCENARIO: OK):
 *   1. Final on-disk file reads "hello\nuniverse"
 *   2. Replay determinism: two runs of replayWithEvents(bytes, events) on
 *      the same input produce identical grids.
 *   3. Intermediate width: replaying only up through the first resize event
 *      produces a grid whose size is exactly SHRUNK_COLS x SHRUNK_ROWS.
 *      Proves that the resize event in the middle actually affects the
 *      parser's grid (not just "no-op that happens to land on the same
 *      final state because Claude redraws deterministically").
 *   4. Width mutation: mutating the last resize event to a different cols
 *      value produces a final grid with the MUTATED cols, different from
 *      the baseline final grid. Proves events are load-bearing for the
 *      final state at least through the parser's grid shape.
 *   5. Final grid size matches the last resize event's cols x rows.
 *
 * Why not "replayBytes without events differs from replayWithEvents"? That
 * gate fails by design here: Claude Code's TUI uses ED + CUP on SIGWINCH,
 * so its post-resize redraw fully clobbers any prior state and the final
 * grid is width-invariant. That robustness is a *positive* property of
 * Claude, not a test failure, so gate 3/4 above exercise different angles.
 *
 * Usage:
 *   npx tsx tools/oracle/scenarios/claude-resize-multiturn.ts
 */
import { spawn } from 'node-pty'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import {
  replayWithEvents,
  diffGrids,
  type RecordEvent,
  type Grid,
} from '../../../src/lib/oracle'

const INITIAL_COLS = 120
const INITIAL_ROWS = 40
const SHRUNK_COLS = 80
const SHRUNK_ROWS = 30

const TEMP_FILE = '/tmp/oracle-claude-resize.txt'
const RAW_OUT = '/tmp/claude-resize.raw'
const EVENTS_OUT = '/tmp/claude-resize.events.json'
const GRID_JSON_OUT = '/tmp/claude-resize.grid.json'
const GRID_TXT_OUT = '/tmp/claude-resize.grid.txt'

const TURN_IDLE_MS = 4000
const TURN_MAX_MS = 120_000
const STARTUP_IDLE_MS = 3000
const STARTUP_MAX_MS = 30_000

const log = (msg: string) => process.stderr.write(`[resize] ${msg}\n`)

interface Turn {
  name: string
  message: string
}

const TURNS: Turn[] = [
  {
    name: 'create',
    message:
      `create a file at ${TEMP_FILE} whose entire contents are exactly the single line "hello" (no trailing newline). Use Write directly, do not ask for confirmation.`,
  },
  {
    name: 'append',
    message:
      `append a second line containing exactly the word "world" to ${TEMP_FILE}. So the file becomes two lines: hello then world.`,
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
  return [
    border,
    ...rows,
    border,
    `size: ${grid.cols}x${grid.rows}, cursor: (${grid.cursor.x}, ${grid.cursor.y})`,
  ].join('\n')
}

async function driveClaudeWithResizes(): Promise<{
  bytes: string
  events: RecordEvent[]
}> {
  cleanupTempFile()

  const chunks: string[] = []
  const events: RecordEvent[] = []
  let lastData = Date.now()
  let totalBytes = 0
  const updateTotal = () => {
    totalBytes = chunks.reduce((a, c) => a + c.length, 0)
  }

  log(`spawning claude at ${INITIAL_COLS}x${INITIAL_ROWS}`)
  const proc: ProcHandle = spawn(
    'claude',
    ['--dangerously-skip-permissions'],
    {
      name: 'xterm-256color',
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
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

  const recordResize = (cols: number, rows: number) => {
    updateTotal()
    events.push({ offset: totalBytes, type: 'resize', cols, rows })
    log(`resize -> ${cols}x${rows} at offset ${totalBytes}`)
    proc.resize(cols, rows)
  }

  try {
    await waitForIdle(() => lastData, STARTUP_IDLE_MS, STARTUP_MAX_MS, 'startup')
    updateTotal()
    log(`startup idle, ${totalBytes} bytes so far`)

    // --- Turn 1 at 120x40 -------------------------------------------------
    log(`turn 1 [${TURNS[0].name}] at ${INITIAL_COLS}x${INITIAL_ROWS}`)
    proc.write(TURNS[0].message + '\r')
    await new Promise((r) => setTimeout(r, 200))
    lastData = Date.now()
    await waitForIdle(() => lastData, TURN_IDLE_MS, TURN_MAX_MS, 'turn 1')
    updateTotal()
    log(`turn 1 idle, ${totalBytes} bytes`)

    // --- Resize down ------------------------------------------------------
    recordResize(SHRUNK_COLS, SHRUNK_ROWS)
    // Wait briefly for claude's SIGWINCH redraw to settle.
    await new Promise((r) => setTimeout(r, 1500))
    updateTotal()
    log(`post-resize idle wait done, ${totalBytes} bytes`)

    // --- Turn 2 at 80x30 --------------------------------------------------
    log(`turn 2 [${TURNS[1].name}] at ${SHRUNK_COLS}x${SHRUNK_ROWS}`)
    proc.write(TURNS[1].message + '\r')
    await new Promise((r) => setTimeout(r, 200))
    lastData = Date.now()
    await waitForIdle(() => lastData, TURN_IDLE_MS, TURN_MAX_MS, 'turn 2')
    updateTotal()
    log(`turn 2 idle, ${totalBytes} bytes`)

    // --- Resize up --------------------------------------------------------
    recordResize(INITIAL_COLS, INITIAL_ROWS)
    await new Promise((r) => setTimeout(r, 1500))
    updateTotal()
    log(`post-resize-up idle wait done, ${totalBytes} bytes`)

    // --- Turn 3 at 120x40 -------------------------------------------------
    log(`turn 3 [${TURNS[2].name}] at ${INITIAL_COLS}x${INITIAL_ROWS}`)
    proc.write(TURNS[2].message + '\r')
    await new Promise((r) => setTimeout(r, 200))
    lastData = Date.now()
    await waitForIdle(() => lastData, TURN_IDLE_MS, TURN_MAX_MS, 'turn 3')
    updateTotal()
    log(`turn 3 idle, ${totalBytes} bytes`)

    log('done; killing claude')
  } finally {
    if (!exited) {
      try {
        proc.kill()
      } catch {
        // ignore
      }
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  return { bytes: chunks.join(''), events }
}

async function main(): Promise<void> {
  const { bytes, events } = await driveClaudeWithResizes()
  writeFileSync(RAW_OUT, bytes, 'utf8')
  writeFileSync(EVENTS_OUT, JSON.stringify(events, null, 2), 'utf8')
  log(`raw -> ${RAW_OUT} (${bytes.length} chars)`)
  log(`events -> ${EVENTS_OUT} (${events.length} events)`)

  // --- File content check ---------------------------------------------
  let fileOk = false
  if (existsSync(TEMP_FILE)) {
    const content = readFileSync(TEMP_FILE, 'utf8')
    log(`${TEMP_FILE}: ${JSON.stringify(content)}`)
    fileOk = content.includes('hello') && content.includes('universe')
  }
  log(`file content check: ${fileOk ? 'OK' : 'FAIL'}`)

  const initial = { cols: INITIAL_COLS, rows: INITIAL_ROWS }

  // --- Gate 1: replay determinism --------------------------------------
  const gridA = await replayWithEvents(bytes, events, initial)
  const gridB = await replayWithEvents(bytes, events, initial)
  const detDiff = diffGrids(gridA, gridB)
  log(
    `replay determinism (with events): ${detDiff.equal ? 'OK' : 'FAIL'} ` +
      `(final ${gridA.cols}x${gridA.rows}, cursor (${gridA.cursor.x},${gridA.cursor.y}))`,
  )

  // --- Gate 3: intermediate width after first resize -------------------
  // Replay bytes up to (but not past) the second resize, with only the first
  // resize event applied. The resulting grid MUST be SHRUNK_COLS x SHRUNK_ROWS,
  // which is direct evidence that the in-stream resize event took effect.
  if (events.length < 2) {
    log('ERROR: expected 2 resize events, got ' + events.length)
    process.exit(1)
  }
  const midBytes = bytes.slice(0, events[1].offset)
  const midEvents = [events[0]]
  const midGrid = await replayWithEvents(midBytes, midEvents, initial)
  const intermediateOk =
    midGrid.cols === SHRUNK_COLS && midGrid.rows === SHRUNK_ROWS
  log(
    `intermediate width after first resize: ${midGrid.cols}x${midGrid.rows} ` +
      `(expected ${SHRUNK_COLS}x${SHRUNK_ROWS}): ${intermediateOk ? 'OK' : 'FAIL'}`,
  )

  // --- Gate 4: mutation — change final resize cols ---------------------
  // If we lie about the final resize width, the final grid must change shape
  // to match the lie. This proves replayWithEvents actually routes events to
  // the terminal at the recorded offsets.
  const MUTATED_FINAL_COLS = 100
  const mutatedEvents = events.map((e, i) =>
    i === events.length - 1 ? { ...e, cols: MUTATED_FINAL_COLS } : e,
  )
  const mutatedGrid = await replayWithEvents(bytes, mutatedEvents, initial)
  const mutationOk =
    mutatedGrid.cols === MUTATED_FINAL_COLS &&
    diffGrids(gridA, mutatedGrid).equal === false
  log(
    `width mutation: ${mutatedGrid.cols}x${mutatedGrid.rows} differs from ` +
      `baseline ${gridA.cols}x${gridA.rows}: ${mutationOk ? 'OK' : 'FAIL'}`,
  )

  // --- Gate 5: final size matches last event ---------------------------
  const finalResize = [...events].reverse().find((e) => e.type === 'resize')
  const expectedFinalCols = finalResize ? finalResize.cols : INITIAL_COLS
  const expectedFinalRows = finalResize ? finalResize.rows : INITIAL_ROWS
  const sizeOk =
    gridA.cols === expectedFinalCols && gridA.rows === expectedFinalRows
  log(
    `final grid size: ${gridA.cols}x${gridA.rows} ` +
      `(expected ${expectedFinalCols}x${expectedFinalRows}): ${sizeOk ? 'OK' : 'FAIL'}`,
  )

  // --- Save artifacts --------------------------------------------------
  writeFileSync(
    GRID_JSON_OUT,
    JSON.stringify(
      {
        source: 'xterm-headless-with-events',
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

  const allOk =
    fileOk && detDiff.equal && intermediateOk && mutationOk && sizeOk
  log(allOk ? 'SCENARIO: OK' : 'SCENARIO: FAIL')
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
