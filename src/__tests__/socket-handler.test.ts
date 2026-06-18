/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client'
import { setupSocketHandler } from '@/lib/socket-handler'
import { createSession, sessionExists } from '@/lib/screen-manager'
import { trackSession, cleanupTrackedSessions } from './helpers/screen-cleanup'
import type { AddressInfo } from 'net'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { screenArgs, screenCommand } from '@/lib/screen-command'

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

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function screenListLine(name: string): string {
  try {
    const output = execFileSync(screenCommand(), screenArgs(['-ls']), { encoding: 'utf8', timeout: 3000 })
    return output.split('\n').find(line => line.includes(name)) ?? ''
  } catch (err) {
    const output = err && typeof err === 'object'
      ? `${(err as { stdout?: string }).stdout ?? ''}${(err as { stderr?: string }).stderr ?? ''}`
      : ''
    return output.split('\n').find(line => line.includes(name)) ?? ''
  }
}

async function waitForScreenStatus(name: string, status: 'Attached' | 'Detached'): Promise<void> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (screenListLine(name).includes(`(${status})`)) return
    await wait(100)
  }
  throw new Error(`Timed out waiting for ${name} to become ${status}`)
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

  it('detaches instead of killing a session when the browser disconnects', async () => {
    const name = uniqueName('autodetach')
    const dir = mkdtempSync(join(tmpdir(), 'wst-screenrc-'))
    const screenRc = join(dir, 'screenrc')
    writeFileSync(screenRc, 'autodetach off\n')
    trackSession(name)

    try {
      execFileSync(screenCommand(), [
        '-c',
        screenRc,
        '-dmUS',
        name,
        'bash',
        '-lc',
        'while true; do sleep 60; done',
      ], { timeout: 3000 })

      const client = connectClient()
      await new Promise<void>((resolve) => {
        client.on('connect', () => {
          client.emit('terminal:attach', { session: name })
          resolve()
        })
      })

      await waitForScreenStatus(name, 'Attached')
      client.close()
      await wait(2500)

      expect(await sessionExists(name)).toBe(true)
    } finally {
      try {
        execFileSync(screenCommand(), screenArgs(['-S', name, '-X', 'quit']), { timeout: 3000 })
      } catch {}
      rmSync(dir, { recursive: true, force: true })
    }
  }, 10000)
})
