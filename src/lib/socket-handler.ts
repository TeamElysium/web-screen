import type { Server as SocketIOServer, Socket } from 'socket.io'
import * as pty from 'node-pty'
import { execFileSync } from 'child_process'
import { validateSessionToken } from './auth'
import { validateSessionName } from './screen-manager'

export function setupSocketHandler(io: SocketIOServer): void {
  // Auth middleware — read session token from cookie or auth payload
  io.use((socket, next) => {
    // Try auth payload first, then cookie header
    let token = socket.handshake.auth?.token
    if (!token) {
      const cookieHeader = socket.handshake.headers?.cookie || ''
      const match = cookieHeader.match(/(?:^|;\s*)session=([^;]*)/)
      token = match ? match[1] : ''
    }
    if (!token || !validateSessionToken(token)) {
      return next(new Error('auth failed'))
    }
    next()
  })

  io.on('connection', (socket: Socket) => {
    let ptyProcess: pty.IPty | null = null

    socket.on('terminal:attach', ({ session, cols, rows }: { session: string; cols?: number; rows?: number }) => {
      try {
        validateSessionName(session)
      } catch {
        socket.emit('terminal:exit')
        return
      }

      if (ptyProcess) {
        ptyProcess.kill()
        ptyProcess = null
      }

      // Enable UTF-8 on the target session before attaching —
      // sessions created without -U track columns in byte mode,
      // causing character position drift in xterm.js
      try {
        execFileSync('screen', ['-S', session, '-X', 'utf8', 'on'], { timeout: 2000 })
      } catch {}

      const ptyCol = cols || 80
      const ptyRow = rows || 30

      console.log(`[server] terminal:attach session=${session} cols=${ptyCol} rows=${ptyRow}`)

      // Spawn PTY 1 col smaller — screen dumps old buffer at this size.
      // After discarding that stale output, resize to the real size so
      // screen sees an actual size change and sends a full redraw.
      ptyProcess = pty.spawn('screen', ['-xU', session], {
        name: 'xterm-256color',
        cols: Math.max(ptyCol - 1, 1),
        rows: ptyRow,
        cwd: process.env.HOME,
      })

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

      ptyProcess.onData((data: string) => {
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
        ptyProcess?.resize(ptyCol, ptyRow)
      }, 50)

      ptyProcess.onExit(() => {
        // Flush remaining buffered output before signaling exit
        if (outputBuf) {
          socket.emit('terminal:output', outputBuf)
          outputBuf = ''
        }
        socket.emit('terminal:exit')
        ptyProcess = null
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
        // Resize to cols-1 first, then to real cols — guarantees a size
        // change even if pty is already at the requested size, forcing
        // SIGWINCH so screen always redraws for the correct dimensions.
        ptyProcess.resize(Math.max(c - 1, 1), r)
        ptyProcess.resize(c, r)
      }
    })

    socket.on('disconnect', () => {
      if (ptyProcess) {
        ptyProcess.kill()
        ptyProcess = null
      }
    })
  })
}
