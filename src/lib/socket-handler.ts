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

    socket.on('terminal:attach', ({ session }: { session: string }) => {
      if (ptyProcess) {
        ptyProcess.kill()
        ptyProcess = null
      }

      ptyProcess = pty.spawn('screen', ['-x', session], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME,
      })

      ptyProcess.onData((data: string) => {
        socket.emit('terminal:output', data)
      })

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
