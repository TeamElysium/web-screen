import type { Server as SocketIOServer, Socket } from 'socket.io'
import * as pty from 'node-pty'
import { execFileSync } from 'child_process'
import { checkIP, getClientIPForServer } from './auth'
import { sessionExists, validateSessionName } from './screen-manager'
import {
  attachSpec,
  backendArgs,
  backendCommand,
  cancelScrollArgs,
  detachSequence,
  prepareAttachArgs,
  resizeSessionArgs,
  scrollPositionArgs,
  scrollSessionArgs,
  terminalBackendKind,
} from './terminal-backend'

const DETACH_FALLBACK_KILL_MS = 2000

export function setupSocketHandler(io: SocketIOServer): void {
  io.use((socket, next) => {
    const clientIP = getClientIPForServer(socket.handshake.headers, socket.handshake.address)

    if (!checkIP(clientIP)) {
      return next(new Error('auth failed'))
    }
    next()
  })

  io.on('connection', (socket: Socket) => {
    let ptyProcess: pty.IPty | null = null
    let currentSession: string | null = null
    const intentionallyDetached = new WeakSet<pty.IPty>()

    const detachPty = () => {
      if (!ptyProcess) return

      const proc = ptyProcess
      if (intentionallyDetached.has(proc)) return

      intentionallyDetached.add(proc)
      try {
        proc.write(detachSequence())
      } catch {
        try {
          proc.kill()
        } catch {}
      }

      setTimeout(() => {
        if (ptyProcess === proc) {
          try {
            proc.kill()
          } catch {}
          ptyProcess = null
        }
      }, DETACH_FALLBACK_KILL_MS)
    }

    socket.on('terminal:attach', ({ session, cols, rows }: { session: string; cols?: number; rows?: number }) => {
      try {
        validateSessionName(session)
      } catch {
        socket.emit('terminal:exit')
        return
      }

      if (ptyProcess) {
        detachPty()
      }

      const prepareArgs = prepareAttachArgs(session)
      if (prepareArgs) {
        // Screen sessions created without -U track columns in byte mode,
        // causing character position drift in xterm.js.
        try {
          execFileSync(backendCommand(), backendArgs(prepareArgs), { timeout: 2000 })
        } catch {}
      }

      const ptyCol = cols || 80
      const ptyRow = rows || 30
      const attachedSession = session

      currentSession = session
      console.log(`[server] terminal:attach backend=${terminalBackendKind()} session=${session} cols=${ptyCol} rows=${ptyRow}`)

      const spec = attachSpec(session, ptyCol, ptyRow)
      const proc = pty.spawn(spec.command, spec.args, {
        name: 'xterm-256color',
        cols: spec.cols,
        rows: spec.rows,
        cwd: process.env.HOME,
      })
      ptyProcess = proc

      let discarding = spec.discardInitialOutput
      let outputBuf = ''
      let flushScheduled = false

      const flushOutput = () => {
        flushScheduled = false
        if (outputBuf) {
          socket.emit('terminal:output', outputBuf)
          outputBuf = ''
        }
      }

      proc.onData((data: string) => {
        if (!discarding) {
          outputBuf += data
          if (!flushScheduled) {
            flushScheduled = true
            setImmediate(flushOutput)
          }
        }
      })

      if (spec.discardInitialOutput) {
        setTimeout(() => {
          discarding = false
          // Screen: resize to real size after dropping stale buffer output.
          if (ptyProcess === proc && spec.resizeAfterAttach) {
            proc.resize(ptyCol, ptyRow)
          }
        }, 50)
      }

      proc.onExit(async () => {
        const wasIntentionalDetach = intentionallyDetached.has(proc)
        intentionallyDetached.delete(proc)
        if (ptyProcess === proc) {
          ptyProcess = null
        }
        if (wasIntentionalDetach) return

        // Flush remaining buffered output before signaling exit
        if (outputBuf) {
          socket.emit('terminal:output', outputBuf)
          outputBuf = ''
        }

        const stillExists = await sessionExists(attachedSession)
        socket.emit(stillExists ? 'terminal:detached' : 'terminal:exit')
      })
    })

    socket.on('terminal:input', (data: unknown) => {
      if (typeof data === 'string' && data.length <= 4096) {
        ptyProcess?.write(data)
      }
    })

    socket.on('terminal:scroll', (data: unknown) => {
      if (!currentSession) return

      const direction = typeof data === 'object' && data !== null && 'direction' in data
        ? (data as { direction?: unknown }).direction
        : null
      if (direction !== 'up' && direction !== 'down') return

      const args = scrollSessionArgs(currentSession, direction)
      if (!args) return

      try {
        execFileSync(backendCommand(), backendArgs(args), { timeout: 2000 })

        if (direction === 'down') {
          const positionArgs = scrollPositionArgs(currentSession)
          const cancelArgs = cancelScrollArgs(currentSession)
          if (!positionArgs || !cancelArgs) return

          const output = execFileSync(
            backendCommand(),
            backendArgs(positionArgs),
            { encoding: 'utf8', timeout: 2000 },
          )
          const [paneInMode, scrollPosition] = output.trim().split(/\s+/)
          if (paneInMode === '1' && scrollPosition === '0') {
            execFileSync(backendCommand(), backendArgs(cancelArgs), { timeout: 2000 })
          }
        }
      } catch {}
    })

    socket.on('terminal:resize', ({ cols, rows }: { cols: number; rows: number }) => {
      const c = Math.floor(cols)
      const r = Math.floor(rows)
      if (c >= 1 && c <= 500 && r >= 1 && r <= 500 && ptyProcess) {
        ptyProcess.resize(c, r)
        // Ask the backend to reconcile its virtual size after PTY resize.
        if (currentSession) {
          try {
            execFileSync(
              backendCommand(),
              backendArgs(resizeSessionArgs(currentSession, c, r)),
              { timeout: 2000 },
            )
          } catch {}
        }
      }
    })

    socket.on('terminal:detach', () => {
      detachPty()
    })

    socket.on('disconnect', () => {
      detachPty()
    })
  })
}
