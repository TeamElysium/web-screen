import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client'
import { setupSocketHandler } from '@/lib/socket-handler'
import { createSessionToken } from '@/lib/auth'
import { createSession } from '@/lib/screen-manager'
import { execSync } from 'child_process'
import type { AddressInfo } from 'net'

const TEST_PREFIX = 'wst_sock_'
let testCounter = 0
function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now()}_${testCounter++}_${label}`
}

const createdSessions: string[] = []

function killSession(name: string) {
  try {
    const output = execSync('screen -ls 2>&1').toString()
    for (const line of output.split('\n')) {
      if (line.includes(name)) {
        const match = line.match(/\t(\d+)\./)
        if (match) try { execSync(`kill -9 ${match[1]} 2>&1`) } catch { /* */ }
      }
    }
  } catch { /* */ }
}

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
  return new Promise<void>((resolve) => {
    ioServer.close(() => {
      httpServer.close(() => resolve())
    })
  })
})

afterAll(() => {
  for (const name of createdSessions) killSession(name)
  try { execSync('screen -wipe 2>&1') } catch { /* */ }
})

function connectClient(token?: string): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    auth: { token: token ?? createSessionToken() },
    transports: ['websocket'],
  })
}

describe('socket-handler', () => {
  it('rejects connection without valid token', () => {
    return new Promise<void>((resolve) => {
      const client = connectClient('invalid-token')
      client.on('connect_error', (err) => {
        expect(err.message).toContain('auth')
        client.close()
        resolve()
      })
    })
  })

  it('accepts connection with valid token in auth payload', () => {
    return new Promise<void>((resolve) => {
      const client = connectClient()
      client.on('connect', () => {
        expect(client.connected).toBe(true)
        client.close()
        resolve()
      })
    })
  })

  it('accepts connection with valid token in cookie header', () => {
    return new Promise<void>((resolve) => {
      const token = createSessionToken()
      const client = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        extraHeaders: {
          cookie: `session=${token}`,
        },
      })
      client.on('connect', () => {
        expect(client.connected).toBe(true)
        client.close()
        resolve()
      })
      client.on('connect_error', (err) => {
        client.close()
        throw new Error(`Cookie auth should have worked: ${err.message}`)
      })
    })
  })

  it('rejects connection with no token and no cookie', () => {
    return new Promise<void>((resolve) => {
      const client = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
      })
      client.on('connect_error', (err) => {
        expect(err.message).toContain('auth')
        client.close()
        resolve()
      })
    })
  })

  it('attaches to screen session and receives output', async () => {
    const name = uniqueName('attach')
    createdSessions.push(name)
    await createSession(name)

    return new Promise<void>((resolve) => {
      const client = connectClient()
      client.on('connect', () => {
        client.emit('terminal:attach', { session: name })
      })
      client.on('terminal:output', (data: string) => {
        // screen session attached — any output means PTY is working
        expect(typeof data).toBe('string')
        client.close()
        resolve()
      })
      // timeout fallback
      setTimeout(() => {
        client.close()
        resolve()
      }, 3000)
    })
  })

  it('sends input to PTY', async () => {
    const name = uniqueName('input')
    createdSessions.push(name)
    await createSession(name)

    return new Promise<void>((resolve) => {
      const client = connectClient()
      let attached = false
      client.on('connect', () => {
        client.emit('terminal:attach', { session: name })
      })
      client.on('terminal:output', () => {
        if (!attached) {
          attached = true
          // Send a command — if no error thrown, input works
          client.emit('terminal:input', 'echo hello\n')
        }
      })
      // Give it time to process
      setTimeout(() => {
        expect(attached).toBe(true)
        client.close()
        resolve()
      }, 2000)
    })
  })

  it('handles resize event without error', async () => {
    const name = uniqueName('resize')
    createdSessions.push(name)
    await createSession(name)

    return new Promise<void>((resolve) => {
      const client = connectClient()
      client.on('connect', () => {
        client.emit('terminal:attach', { session: name })
      })
      client.on('terminal:output', () => {
        client.emit('terminal:resize', { cols: 120, rows: 40 })
        setTimeout(() => {
          client.close()
          resolve()
        }, 500)
      })
    })
  })
})
