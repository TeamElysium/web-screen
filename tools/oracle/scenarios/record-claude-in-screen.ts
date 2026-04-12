#!/usr/bin/env tsx
/**
 * Record a Claude Code multi-turn session that runs *inside* a real `screen`
 * session, via the same attach path the web-screen server uses.
 *
 * Why this exists — the earlier recording (claude-multiturn.ts) ran claude
 * directly under node-pty with no screen in between. That captures the
 * bytes claude emits to a *direct xterm* (with sync mode, full streaming
 * TUI, etc.). Feeding those bytes into screen via `cat` is NOT what happens
 * in production: in production claude is inside screen, so claude queries
 * screen's capabilities and emits a screen-adapted byte stream. Using the
 * direct-xterm recording to test the screen-attach pipeline was therefore
 * comparing incompatible references and the resulting "pipeline
 * corruption" finding was an artifact of that mismatch.
 *
 * This script records the right thing:
 *   1. Create a detached screen session
 *   2. Launch `claude --dangerously-skip-permissions` inside the session
 *   3. Attach via node-pty and drive the same 3-turn conversation
 *      (create / append / replace), collecting every byte that comes out
 *      the attach pty — exactly what web-screen's socket-handler would see
 *      minus its own buffering
 *   4. Save: raw.bin (attach bytes), grid.json (xterm/headless replay)
 *
 * Output:
 *   /tmp/claude-in-screen.raw          raw bytes from the attach pty
 *   /tmp/claude-in-screen.grid.json    grid after replay through xterm/headless
 *   /tmp/claude-in-screen.grid.txt     human-readable grid rendering
 *
 * Run it only if you're ready for a real multi-turn claude session to run
 * (~2 minutes, real API calls).
 */
import { execSync } from 'node:child_process'
import { spawn as ptySpawn } from 'node-pty'
import { writeFileSync, existsSync, unlinkSync, readFileSync } from 'node:fs'
import { replayBytes, type Grid } from '../../../src/lib/oracle'

const COLS = 120
const ROWS = 40
const TEMP_FILE = '/tmp/oracle-claude-in-screen.txt'
const RAW_OUT = '/tmp/claude-in-screen.raw'
const GRID_JSON_OUT = '/tmp/claude-in-screen.grid.json'
const GRID_TXT_OUT = '/tmp/claude-in-screen.grid.txt'

const STARTUP_IDLE_MS = 4000
const STARTUP_MAX_MS = 30_000
const TURN_IDLE_MS = 4000
const TURN_MAX_MS = 120_000

const log = (msg: string) => process.stderr.write(`[in-screen] ${msg}\n`)

const TURNS = [
  {
    name: 'create',
    message:
      `create a file at ${TEMP_FILE} whose entire contents are exactly the single line "hello" (no trailing newline). Use Write directly — do not ask for confirmation.`,
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

function cleanupTempFile() {
  try {
    if (existsSync(TEMP_FILE)) unlinkSync(TEMP_FILE)
  } catch {
    // ignore
  }
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
    const sinceStart = Date.now() - start
    if (sinceLast >= idleMs) return
    if (sinceStart >= maxMs) {
      log(`WARN: ${label} exceeded ${maxMs}ms without going idle`)
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

function formatGridAsText(grid: Grid): string {
  const border = '+' + '-'.repeat(grid.cols) + '+'
  const rows = grid.lines.map((l) => '|' + l + '|')
  return [
    border,
    ...rows,
    border,
    `${grid.cols}x${grid.rows} cursor (${grid.cursor.x},${grid.cursor.y})`,
  ].join('\n')
}

async function main(): Promise<void> {
  cleanupTempFile()

  const sessionName = `wst_claude_${Date.now()}`
  log(`creating screen session: ${sessionName}`)

  // Start claude INSIDE the screen session, with the right TERM so screen
  // gets the actual behavior users see.
  execSync(
    `screen -dmUS ${sessionName} bash -c 'claude --dangerously-skip-permissions'`,
    { timeout: 3000 },
  )

  // Give claude a moment to start inside the session before we attach.
  await new Promise((r) => setTimeout(r, 1500))

  const chunks: string[] = []
  let lastData = Date.now()
  let preDetachChunkCount = 0

  log(`attaching with node-pty at ${COLS}x${ROWS}`)
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
  proc.onExit(() => {
    exited = true
    log('attach pty exited')
  })

  try {
    log(`waiting up to ${STARTUP_MAX_MS}ms for claude startup`)
    await waitForIdle(() => lastData, STARTUP_IDLE_MS, STARTUP_MAX_MS, 'startup')
    log(`startup idle, ${chunks.reduce((a, c) => a + c.length, 0)} bytes so far`)

    for (let i = 0; i < TURNS.length; i++) {
      const turn = TURNS[i]
      log(`turn ${i + 1}/${TURNS.length} [${turn.name}]`)
      proc.write(turn.message + '\r')
      await new Promise((r) => setTimeout(r, 200))
      lastData = Date.now()
      await waitForIdle(() => lastData, TURN_IDLE_MS, TURN_MAX_MS, `turn ${i + 1}`)
      log(`turn ${i + 1} idle, ${chunks.reduce((a, c) => a + c.length, 0)} bytes`)
    }

    log('done with turns')
  } finally {
    // Mark end of the "in-TUI" byte stream BEFORE we tell screen to
    // detach. Claude runs inside alt-screen (\e[?1049h); screen's detach
    // emits \e[?1049l which restores the main screen and clobbers the
    // Claude TUI content, so anything after this point is useless for a
    // user-facing baseline.
    preDetachChunkCount = chunks.length

    try { proc.write('\x01d') } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300))
    if (!exited) {
      try { proc.kill() } catch { /* ignore */ }
    }
    // Kill the screen session now that we have the recording.
    try {
      execSync(`screen -S ${sessionName} -X quit 2>&1`, { timeout: 3000 })
    } catch {
      // ignore
    }
  }

  const fullBytes = chunks.join('')
  const preDetachBytes = chunks.slice(0, preDetachChunkCount).join('')
  writeFileSync(RAW_OUT, preDetachBytes, 'utf8')
  writeFileSync(RAW_OUT + '.full', fullBytes, 'utf8')
  const bytes = preDetachBytes
  log(
    `raw (pre-detach) -> ${RAW_OUT} (${bytes.length} chars, ` +
      `${fullBytes.length - bytes.length} post-detach trimmed)`,
  )

  if (existsSync(TEMP_FILE)) {
    const content = readFileSync(TEMP_FILE, 'utf8')
    log(`${TEMP_FILE} content: ${JSON.stringify(content)}`)
  } else {
    log(`${TEMP_FILE} does NOT exist — claude may not have completed`)
  }

  const grid = await replayBytes(bytes, { cols: COLS, rows: ROWS })
  writeFileSync(
    GRID_JSON_OUT,
    JSON.stringify(
      {
        source: 'claude-in-screen-xterm-headless',
        cols: grid.cols,
        rows: grid.rows,
        cursor: grid.cursor,
        lines: grid.lines,
      },
      null,
      2,
    ),
    'utf8',
  )
  writeFileSync(GRID_TXT_OUT, formatGridAsText(grid), 'utf8')
  log(`grid -> ${GRID_JSON_OUT}`)
  log(`grid text -> ${GRID_TXT_OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
