import { Terminal } from '@xterm/headless'
import * as pty from 'node-pty'

/**
 * Terminal oracle: capture/replay/diff PTY output as an xterm.js headless grid.
 *
 * Purpose — verify that a raw PTY byte stream, when replayed into a fresh
 * parser, produces the same final cell grid as a separately captured baseline.
 * This is the Phase 0 sanity gate for the redraw-regression test harness.
 */

export interface Grid {
  cols: number
  rows: number
  /** One string per visible row, padded to `cols` columns (no right-trim). */
  lines: string[]
  cursor: { x: number; y: number }
}

export interface TerminalOptions {
  cols: number
  rows: number
  /** Default false — raw PTY passthrough, no LF→CRLF conversion. */
  convertEol?: boolean
}

function makeTerminal(opts: TerminalOptions): Terminal {
  return new Terminal({
    cols: opts.cols,
    rows: opts.rows,
    convertEol: opts.convertEol ?? false,
    allowProposedApi: true,
  })
}

export function snapshotGrid(term: Terminal): Grid {
  const buf = term.buffer.active
  const rows = term.rows
  const cols = term.cols
  const lines: string[] = []
  for (let i = 0; i < rows; i++) {
    const line = buf.getLine(buf.baseY + i)
    lines.push(line ? line.translateToString(false) : ' '.repeat(cols))
  }
  return {
    cols,
    rows,
    lines,
    cursor: { x: buf.cursorX, y: buf.cursorY },
  }
}

function writeAsync(term: Terminal, data: string | Uint8Array): Promise<void> {
  return new Promise((resolve) => term.write(data as string, () => resolve()))
}

export async function replayBytes(
  bytes: string | Uint8Array,
  opts: TerminalOptions,
): Promise<Grid> {
  const term = makeTerminal(opts)
  try {
    await writeAsync(term, bytes)
    return snapshotGrid(term)
  } finally {
    term.dispose()
  }
}

/**
 * An event recorded alongside a byte stream. `offset` is the byte position in
 * the stream at which the event happened (inclusive on the right — bytes
 * before `offset` were written to the terminal under the OLD state, bytes at
 * and after `offset` under the NEW state).
 */
export interface RecordEvent {
  offset: number
  type: 'resize'
  cols: number
  rows: number
}

/**
 * Replay `bytes` interleaved with `events`. Events must be sorted by
 * ascending `offset`. `initial` is the terminal size at offset 0. A resize
 * event causes a `term.resize(cols, rows)` call at that byte boundary.
 */
export async function replayWithEvents(
  bytes: string,
  events: RecordEvent[],
  initial: TerminalOptions,
): Promise<Grid> {
  const term = makeTerminal(initial)
  try {
    let cursor = 0
    for (const e of events) {
      const boundary = Math.min(Math.max(e.offset, 0), bytes.length)
      if (boundary > cursor) {
        await writeAsync(term, bytes.slice(cursor, boundary))
        cursor = boundary
      }
      if (e.type === 'resize') {
        term.resize(e.cols, e.rows)
      }
    }
    if (cursor < bytes.length) {
      await writeAsync(term, bytes.slice(cursor))
    }
    return snapshotGrid(term)
  } finally {
    term.dispose()
  }
}

export interface GridDiff {
  equal: boolean
  reasons: string[]
}

export function diffGrids(expected: Grid, actual: Grid): GridDiff {
  const reasons: string[] = []
  if (expected.cols !== actual.cols || expected.rows !== actual.rows) {
    reasons.push(
      `size mismatch: ${expected.cols}x${expected.rows} vs ${actual.cols}x${actual.rows}`,
    )
  }
  if (
    expected.cursor.x !== actual.cursor.x ||
    expected.cursor.y !== actual.cursor.y
  ) {
    reasons.push(
      `cursor: (${expected.cursor.x},${expected.cursor.y}) vs (${actual.cursor.x},${actual.cursor.y})`,
    )
  }
  const nRows = Math.max(expected.lines.length, actual.lines.length)
  for (let i = 0; i < nRows; i++) {
    const e = expected.lines[i] ?? ''
    const a = actual.lines[i] ?? ''
    if (e !== a) {
      reasons.push(`line ${i}:\n  expected: ${JSON.stringify(e)}\n  actual:   ${JSON.stringify(a)}`)
    }
  }
  return { equal: reasons.length === 0, reasons }
}

export interface RecordResult {
  /** Concatenated raw PTY output (exactly what the terminal received). */
  bytes: string
  /** Grid captured from a live xterm instance streamed during recording. */
  liveGrid: Grid
}

export interface RecordOptions extends TerminalOptions {
  /** Abort recording if the process does not exit within this many ms. */
  timeoutMs?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Spawn `cmd` under node-pty, stream output into a live headless terminal,
 * and also collect the raw bytes. Returns both when the process exits.
 */
export async function recordPtyCommand(
  cmd: string,
  args: string[],
  opts: RecordOptions,
): Promise<RecordResult> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const chunks: string[] = []
  const term = makeTerminal(opts)
  const pendingWrites: Promise<void>[] = []

  const proc = pty.spawn(cmd, args, {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd ?? process.env.HOME,
    env: { ...process.env, ...(opts.env ?? {}) },
  })

  proc.onData((data) => {
    chunks.push(data)
    pendingWrites.push(writeAsync(term, data))
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // ignore
        }
        reject(new Error(`recordPtyCommand: timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      proc.onExit(() => {
        clearTimeout(timer)
        resolve()
      })
    })
    await Promise.all(pendingWrites)
    const liveGrid = snapshotGrid(term)
    return { bytes: chunks.join(''), liveGrid }
  } finally {
    term.dispose()
  }
}
