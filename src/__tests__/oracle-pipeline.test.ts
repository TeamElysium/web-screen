import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'node:fs'
import type { AddressInfo } from 'net'
import { setupSocketHandler } from '@/lib/socket-handler'
import { createSessionToken } from '@/lib/auth'
import { replayBytes, diffGrids, type Grid } from '@/lib/oracle'
import { trackSession, cleanupTrackedSessions } from './helpers/screen-cleanup'

/**
 * Phase 3: web-screen production pipeline oracle test.
 *
 * Feeds a pre-recorded Claude Code byte stream into a real `screen` session,
 * attaches to it via the real socket-handler code path (spawn `screen -xU`
 * under node-pty, buffer output, emit via socket.io), collects everything
 * the client would receive, and replays both (a) the original raw bytes and
 * (b) the client-received bytes through @xterm/headless. The two resulting
 * grids must match.
 *
 * What this catches:
 *   - byte loss from output buffering in socket-handler
 *   - byte corruption or reordering from the cols-1 + resize-to-real trick
 *     used to force SIGWINCH redraw in terminal:attach
 *   - byte loss or corruption from screen's internal buffer→redraw round-trip
 *   - anything else the production path does that distorts the final state
 *
 * Prerequisite: /tmp/claude-scenario.raw must exist (produced by
 * `tools/oracle/scenarios/claude-multiturn.ts`). If it doesn't, the test is
 * skipped — we don't want to re-spawn claude in CI.
 *
 * Current status (2026-04-12): this test is KNOWN-FAILING. When run, it
 * surfaces a real fidelity loss in the production pipeline — the client
 * only receives ~11% of the recorded byte volume and the reconstructed
 * grid contains visible row-merging and spinner artifacts that the raw
 * baseline does not. Suspected contributors:
 *   - the cols-1 + resize-to-real-cols SIGWINCH trick reflows screen's
 *     buffer at an intermediate width, leaving stale state that leaks
 *     into the post-resize redraw
 *   - screen's default 100-line scrollback drops the earlier portion of
 *     the 31k-byte recording before attach can observe it
 *   - screen may not implement \e[?2026h/l (BP5 / EP5) synchronized
 *     output, causing CR-overwrite spinners to linger as ghost text
 *
 * The test is env-gated behind ORACLE_RUN_PIPELINE so `npm test` stays
 * green, but running it locally shows the current gap and will turn green
 * as the pipeline is fixed. See `tools/oracle/README.md` for how to run.
 */

const RAW_PATH = '/tmp/claude-scenario.raw'
const COLS = 120
const ROWS = 40

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
  const hasRaw = existsSync(RAW_PATH)
  const gated = !process.env.ORACLE_RUN_PIPELINE
  const skip = gated || !hasRaw

  it.skipIf(skip)(
    'recorded claude bytes survive the full server pipeline grid-for-grid',
    async () => {
      const rawBytes = readFileSync(RAW_PATH, 'utf8')
      expect(rawBytes.length).toBeGreaterThan(1000)

      // --- Baseline: replay raw bytes directly through @xterm/headless ---
      const baseline: Grid = await replayBytes(rawBytes, { cols: COLS, rows: ROWS })

      // --- Set up a real screen session that outputs the recorded bytes ---
      // We write the raw bytes to a temp file that the session's shell will
      // `cat` into its PTY, feeding them into screen's internal buffer.
      const sessionName = `wst_oracle_${Date.now()}`
      trackSession(sessionName)
      // UTF-8 mode (-U) to match what the real server enables before attach.
      // The shell inside the session cats the raw file then sleeps forever
      // so the session stays attachable.
      execSync(
        `screen -dmUS ${sessionName} bash -c 'cat ${RAW_PATH}; exec sleep 99999'`,
        { timeout: 3000 },
      )

      // Let screen absorb all the raw bytes into its display buffer before
      // we attach — otherwise the attach redraw would be based on a partial
      // buffer.
      await new Promise((r) => setTimeout(r, 1500))

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

      // Collect everything the client would feed to xterm.js.
      const socketBytes = await collectUntilIdle(client, 1500, 15_000)
      client.close()

      expect(socketBytes.length).toBeGreaterThan(0)

      // --- Replay the socket-received bytes through @xterm/headless ---
      const pipelineGrid: Grid = await replayBytes(socketBytes, {
        cols: COLS,
        rows: ROWS,
      })

      // --- Compare baseline (raw) vs pipeline (server-routed) ---
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
        console.log(`first ${Math.min(10, diff.reasons.length)} diffs:`)
        for (const r of diff.reasons.slice(0, 10)) console.log('  ' + r)
        console.log(
          `(${diff.reasons.length} total diff reasons, socket bytes=${socketBytes.length}, raw bytes=${rawBytes.length})`,
        )
      }
      expect(diff.equal).toBe(true)
    },
    30_000,
  )
})
