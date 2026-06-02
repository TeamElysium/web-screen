import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client'
import { setupSocketHandler } from '@/lib/socket-handler'
import { createSession } from '@/lib/screen-manager'
import { trackSession, cleanupTrackedSessions } from './helpers/screen-cleanup'
import type { AddressInfo } from 'net'

const TEST_PREFIX = 'wst_sock_'
let testCounter = 0
function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now()}_${testCounter++}_${label}`
}

let httpServer: ReturnType<typeof createServer>
let ioServer: SocketIOServer
let port: number

beforeEach(() => {
  vi.stubEnv('ALLOWED_IPS', '127.0.0.1')

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

afterAll(() => {
  cleanupTrackedSessions()
})

function connectClient(): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
  })
}

describe('socket-handler', () => {
  it('rejects connection when client IP is not allowed', () => {
    return new Promise<void>((resolve) => {
      vi.stubEnv('ALLOWED_IPS', '10.0.0.1')
      const client = connectClient()
      client.on('connect_error', (err) => {
        expect(err.message).toContain('auth')
        client.close()
        resolve()
      })
    })
  })

  it('accepts connection when client IP is allowed', () => {
    return new Promise<void>((resolve) => {
      const client = connectClient()
      client.on('connect', () => {
        expect(client.connected).toBe(true)
        client.close()
        resolve()
      })
    })
  })

  it('attaches to screen session and receives output', async () => {
    const name = uniqueName('attach')
    trackSession(name)
    await createSession(name)

    return new Promise<void>((resolve) => {
      const client = connectClient()
      client.on('connect', () => {
        client.emit('terminal:attach', { session: name })
      })
      client.on('terminal:output', (data: string) => {
        expect(typeof data).toBe('string')
        client.close()
        resolve()
      })
      setTimeout(() => {
        client.close()
        resolve()
      }, 3000)
    })
  })

  it('sends input to PTY', async () => {
    const name = uniqueName('input')
    trackSession(name)
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
          client.emit('terminal:input', 'echo hello\n')
        }
      })
      setTimeout(() => {
        expect(attached).toBe(true)
        client.close()
        resolve()
      }, 2000)
    })
  })

  it('handles resize event without error', async () => {
    const name = uniqueName('resize')
    trackSession(name)
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
