import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { execSync } from 'child_process'
import type { AddressInfo } from 'net'
import { setupSocketHandler } from '@/lib/socket-handler'
import { createSessionToken } from '@/lib/auth'
import { replayBytes, diffGrids, type Grid } from '@/lib/oracle'
import { trackSession, cleanupTrackedSessions } from './helpers/screen-cleanup'

/**
 * Phase 3: web-screen production pipeline oracle test.
 *
 * Spins up a real screen session whose first window runs a deterministic
 * TUI-like producer (ED2 + CUP + EL + SGR + plain text — the kinds of
 * sequences every standards-compliant VT parser agrees on). Attaches to
 * the session via the real socket-handler code path (cols-1 + resize-to-
 * real SIGWINCH trick, setImmediate output buffering, socket.io emit),
 * collects what the client would receive, replays it through @xterm/headless
 * and compares the final grid to a baseline computed by feeding the raw
 * producer bytes directly into @xterm/headless.
 *
 * What this catches:
 *   - byte loss from output buffering in socket-handler
 *   - byte reordering / drop from the cols-1 + resize-to-real flow
 *   - any screen→attach→client distortion for the sequences this producer
 *     exercises (absolute cursor positioning, erase-to-EOL, SGR)
 *
 * What this deliberately does NOT exercise:
 *   Streaming TUIs that rely on xterm synchronized-output mode
 *   (\e[?2026h/l), CUF-based overdraw, wide-char cell model edge cases,
 *   etc. Those produce different bytes *depending on what terminal they
 *   detect*, so feeding a direct-terminal recording into screen does not
 *   faithfully reproduce what screen would see in production — and any
 *   "fidelity gap" you measure that way is an artifact of the test
 *   setup, not a pipeline bug. Use `tools/oracle/scenarios/
 *   record-claude-in-screen.ts` to record a true in-screen stream if you
 *   need to compare that class of workload.
 */

const COLS = 80
const ROWS = 24

// bash -c script: CLS + CUP + in-place content + EL + final text + sleep.
// Sticks to sequences that screen, xterm.js and iTerm2 all agree on, so
// there is no oracle ambiguity — any grid disagreement observed in this
// test is a real pipeline transport issue.
const PRODUCER = [
  `printf '\\x1b[2J\\x1b[H'`,        // ED2 + home
  `printf 'alpha\\r\\n'`,
  `printf 'bravo with \\x1b[1;31mred\\x1b[0m bits\\r\\n'`,
  `printf '\\x1b[6;1HOVERWRITTEN'`,    // CUP 6,1
  `printf '\\x1b[6;1Hoverwrit3n!!'`,   // overwrite same region
  `printf '\\x1b[10;20Hanchor'`,       // CUP 10,20
  `printf '\\x1b[12;1H\\x1b[KDONE'`,   // CUP 12,1 + EL + text
  `exec sleep 99999`,
].join('; ')

// Same bytes the producer ends up writing to its PTY (without the
// surrounding shell). Used as the oracle baseline. Keep in sync with the
// PRODUCER variable above — they must describe the same output stream.
const PRODUCER_BYTES = (() => {
  let s = ''
  s += '\x1b[2J\x1b[H'
  s += 'alpha\r\n'
  s += 'bravo with \x1b[1;31mred\x1b[0m bits\r\n'
  s += '\x1b[6;1HOVERWRITTEN'
  s += '\x1b[6;1Hoverwrit3n!!'
  s += '\x1b[10;20Hanchor'
  s += '\x1b[12;1H\x1b[KDONE'
  return s
})()

let httpServer: ReturnType<typeof createServer>
let ioServer: SocketIOServer
let port: number

beforeEach(() => {
  vi.stubEnv('PASSWORD', 'testpass')
  vi.stubEnv('ALLOWED_IPS', '')

  httpServer = createServer()
  ioServer = new SocketIOServer(httpServer)
  setupSocketHandler(ioServer)

  return new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port
      resolve()
    })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  cleanupTrackedSessions()
  return new Promise<void>((resolve) => {
    ioServer.close(() => {
      httpServer.close(() => resolve())
    })
  })
})

function connectClient(): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    auth: { token: createSessionToken() },
    transports: ['websocket'],
  })
}

/** Gather socket terminal:output events until quiet for `idleMs` or `maxMs`. */
async function collectUntilIdle(
  client: ClientSocket,
  idleMs: number,
  maxMs: number,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: string[] = []
    let lastAt = Date.now()
    let done = false

    const onOutput = (data: string) => {
      chunks.push(data)
      lastAt = Date.now()
    }
    const onExit = () => {
      if (!done) {
        done = true
        resolve(chunks.join(''))
      }
    }
    client.on('terminal:output', onOutput)
    client.on('terminal:exit', onExit)

    const startedAt = Date.now()
    const tick = () => {
      if (done) return
      const idle = Date.now() - lastAt
      if (idle >= idleMs || Date.now() - startedAt >= maxMs) {
        done = true
        client.off('terminal:output', onOutput)
        client.off('terminal:exit', onExit)
        resolve(chunks.join(''))
      } else {
        setTimeout(tick, 100)
      }
    }
    setTimeout(tick, 100)
  })
}

describe('oracle: production pipeline (screen + socket-handler)', () => {
  it('synthetic producer grid survives the full server pipeline', async () => {
    // --- Baseline: xterm/headless replay of the raw producer bytes ---
    const baseline: Grid = await replayBytes(PRODUCER_BYTES, {
      cols: COLS,
      rows: ROWS,
    })

    // --- Set up a real screen session running the producer ---
    const sessionName = `wst_oracle_${Date.now()}`
    trackSession(sessionName)
    execSync(
      `screen -dmUS ${sessionName} bash -c ${JSON.stringify(PRODUCER)}`,
      { timeout: 3000 },
    )

    // Give screen a moment to parse the producer's output into its buffer
    // before we attach.
    await new Promise((r) => setTimeout(r, 500))

    // --- Attach via the real socket-handler path ---
    const client = connectClient()
    await new Promise<void>((res, rej) => {
      client.on('connect', () => res())
      client.on('connect_error', rej)
    })

    client.emit('terminal:attach', {
      session: sessionName,
      cols: COLS,
      rows: ROWS,
    })

    const socketBytes = await collectUntilIdle(client, 800, 6000)
    client.close()

    expect(socketBytes.length).toBeGreaterThan(0)

    // --- Replay the socket-received bytes and compare ---
    const pipelineGrid: Grid = await replayBytes(socketBytes, {
      cols: COLS,
      rows: ROWS,
    })

    const diff = diffGrids(baseline, pipelineGrid)
    if (!diff.equal) {
      console.log(
        `baseline ${baseline.cols}x${baseline.rows} cursor ` +
          `(${baseline.cursor.x},${baseline.cursor.y})`,
      )
      console.log(
        `pipeline ${pipelineGrid.cols}x${pipelineGrid.rows} cursor ` +
          `(${pipelineGrid.cursor.x},${pipelineGrid.cursor.y})`,
      )
      for (const r of diff.reasons.slice(0, 10)) console.log('  ' + r)
      console.log(
        `(${diff.reasons.length} diffs; socket=${socketBytes.length}B, ` +
          `baseline=${PRODUCER_BYTES.length}B)`,
      )
    }
    expect(diff.equal).toBe(true)
  }, 15_000)
})
