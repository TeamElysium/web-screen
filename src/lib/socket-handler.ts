import type { Server as SocketIOServer, Socket } from 'socket.io'
import * as pty from 'node-pty'
import { execFileSync } from 'child_process'
import { checkIP, getClientIPForServer } from './auth'
import { sessionExists, validateSessionName } from './screen-manager'

const SCREEN_DETACH_SEQUENCE = '\x01d'
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
        proc.write(SCREEN_DETACH_SEQUENCE)
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

      // Enable UTF-8 on the target session before attaching —
      // sessions created without -U track columns in byte mode,
      // causing character position drift in xterm.js
      try {
        execFileSync('screen', ['-S', session, '-X', 'utf8', 'on'], { timeout: 2000 })
      } catch {}

      const ptyCol = cols || 80
      const ptyRow = rows || 30
      const attachedSession = session

      currentSession = session
      console.log(`[server] terminal:attach session=${session} cols=${ptyCol} rows=${ptyRow}`)

      // Spawn PTY 1 col smaller — screen dumps old buffer at this size.
      // After discarding that stale output, resize to the real size so
      // screen sees an actual size change and sends a full redraw.
      const proc = pty.spawn('screen', ['-xU', session], {
        name: 'xterm-256color',
        cols: Math.max(ptyCol - 1, 1),
        rows: ptyRow,
        cwd: process.env.HOME,
      })
      ptyProcess = proc

      let discarding = true
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

      setTimeout(() => {
        discarding = false
        // Resize to real size — actual change triggers SIGWINCH → full redraw
        if (ptyProcess === proc) {
          proc.resize(ptyCol, ptyRow)
        }
      }, 50)

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

    socket.on('terminal:resize', ({ cols, rows }: { cols: number; rows: number }) => {
      const c = Math.floor(cols)
      const r = Math.floor(rows)
      if (c >= 1 && c <= 500 && r >= 1 && r <= 500 && ptyProcess) {
        ptyProcess.resize(c, r)
        // Force screen to redisplay after resize — ensures screen
        // redraws even if pty was already at this size, and avoids
        // the double-SIGWINCH issue from the cols-1 trick.
        if (currentSession) {
          try {
            execFileSync('screen', ['-S', currentSession, '-X', 'redisplay'], { timeout: 2000 })
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
