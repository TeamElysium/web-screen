/**
 * 뮤테이션 테스트: resize 시 cols-1 트릭이 SIGWINCH를 강제 발생시키는지 검증.
 *
 * node-pty를 mock하여 ptyProcess.resize() 호출 패턴을 직접 확인.
 * cols-1 트릭이 없으면 같은 크기 resize 시 SIGWINCH가 발생하지 않아
 * screen이 리드로우하지 않는 버그가 발생.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockResize = vi.fn()
const mockKill = vi.fn()
const mockWrite = vi.fn()
const mockOnData = vi.fn()
const mockOnExit = vi.fn()

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    resize: mockResize,
    kill: mockKill,
    write: mockWrite,
    onData: mockOnData,
    onExit: mockOnExit,
    pid: 12345,
  })),
}))

vi.mock('../lib/auth', () => ({
  validateSessionToken: () => true,
}))

vi.mock('../lib/screen-manager', () => ({
  validateSessionName: () => true,
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}))

import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client'
import { setupSocketHandler } from '../lib/socket-handler'
import type { AddressInfo } from 'net'

let httpServer: ReturnType<typeof createServer>
let ioServer: SocketIOServer
let port: number

beforeEach(async () => {
  vi.clearAllMocks()

  httpServer = createServer()
  ioServer = new SocketIOServer(httpServer)
  setupSocketHandler(ioServer)

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port
      resolve()
    })
  })
})

import { afterEach } from 'vitest'
afterEach(async () => {
  await new Promise<void>((resolve) => {
    ioServer.close(() => httpServer.close(() => resolve()))
  })
})

function connectClient(): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    auth: { token: 'any' },
    transports: ['websocket'],
  })
}

describe('resize cols-1 trick (SIGWINCH 강제 발생)', () => {
  it('resize 시 pty.resize가 2번 호출된다 (cols-1, cols)', async () => {
    const client = connectClient()
    await new Promise<void>(r => client.on('connect', r))

    client.emit('terminal:attach', { session: 'test', cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 100))
    mockResize.mockClear()

    client.emit('terminal:resize', { cols: 120, rows: 40 })
    await new Promise(r => setTimeout(r, 50))

    expect(mockResize).toHaveBeenCalledTimes(2)
    expect(mockResize).toHaveBeenNthCalledWith(1, 119, 40)  // cols-1
    expect(mockResize).toHaveBeenNthCalledWith(2, 120, 40)  // real cols

    client.close()
  })

  it('같은 크기 resize에도 pty.resize가 2번 호출된다', async () => {
    const client = connectClient()
    await new Promise<void>(r => client.on('connect', r))

    client.emit('terminal:attach', { session: 'test', cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 100))
    mockResize.mockClear()

    // 80x24로 다시 resize (같은 크기)
    client.emit('terminal:resize', { cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 50))

    // cols-1 트릭으로 79→80 크기 변경이 보장됨
    expect(mockResize).toHaveBeenCalledTimes(2)
    expect(mockResize).toHaveBeenNthCalledWith(1, 79, 24)
    expect(mockResize).toHaveBeenNthCalledWith(2, 80, 24)

    client.close()
  })

  it('MUTATION: cols-1 호출이 없으면 같은 크기에서 SIGWINCH 미발생 (테스트 실패해야 함)', async () => {
    // 이 테스트는 cols-1 트릭을 제거하면 실패:
    // pty.resize(80, 24)만 호출되어 CalledTimes가 1이 됨
    const client = connectClient()
    await new Promise<void>(r => client.on('connect', r))

    client.emit('terminal:attach', { session: 'test', cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 100))
    mockResize.mockClear()

    client.emit('terminal:resize', { cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 50))

    // 2번 호출 = cols-1 트릭이 동작 중
    // 1번 호출 = cols-1 트릭이 제거됨 (MUTATION detected!)
    const callCount = mockResize.mock.calls.length
    expect(callCount, 'cols-1 trick must call resize twice').toBe(2)

    // 첫 번째 호출이 cols-1인지 확인
    const firstCall = mockResize.mock.calls[0]
    expect(firstCall[0], 'first resize must be cols-1').toBe(79)

    client.close()
  })

  it('cols=1일 때 cols-1은 최소 1을 유지한다', async () => {
    const client = connectClient()
    await new Promise<void>(r => client.on('connect', r))

    client.emit('terminal:attach', { session: 'test', cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 100))
    mockResize.mockClear()

    client.emit('terminal:resize', { cols: 1, rows: 24 })
    await new Promise(r => setTimeout(r, 50))

    expect(mockResize).toHaveBeenNthCalledWith(1, 1, 24)  // max(1-1, 1) = 1
    expect(mockResize).toHaveBeenNthCalledWith(2, 1, 24)

    client.close()
  })
})
