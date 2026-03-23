import type { Server as SocketIOServer, Socket } from 'socket.io'
import * as pty from 'node-pty'
import { validateSessionToken } from './auth'

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
      if (ptyProcess) {
        ptyProcess.kill()
        ptyProcess = null
      }

      // Enable UTF-8 on the target session before attaching —
      // sessions created without -U track columns in byte mode,
      // causing character position drift in xterm.js
      try {
        const { execSync } = require('child_process')
        execSync(`screen -S ${session} -X utf8 on`, { timeout: 2000 })
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

      ptyProcess.onData((data: string) => {
        if (!discarding) {
          socket.emit('terminal:output', data)
        }
      })

      setTimeout(() => {
        discarding = false
        // Resize to real size — actual change triggers SIGWINCH → full redraw
        ptyProcess?.resize(ptyCol, ptyRow)
      }, 50)

      ptyProcess.onExit(() => {
        socket.emit('terminal:exit')
        ptyProcess = null
      })
    })

    socket.on('terminal:input', (data: string) => {
      ptyProcess?.write(data)
    })

    socket.on('terminal:resize', ({ cols, rows }: { cols: number; rows: number }) => {
      ptyProcess?.resize(cols, rows)
    })

    socket.on('disconnect', () => {
      if (ptyProcess) {
        ptyProcess.kill()
        ptyProcess = null
      }
    })
  })
}
