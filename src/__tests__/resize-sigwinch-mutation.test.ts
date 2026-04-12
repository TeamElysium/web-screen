/**
 * 뮤테이션 테스트: resize 후 screen -X redisplay로 강제 리드로우하는지 검증.
 *
 * node-pty와 child_process를 mock하여 resize + redisplay 호출 패턴을 확인.
 * redisplay가 없으면 같은 크기 resize 시 screen이 리드로우하지 않는 버그 발생.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockResize = vi.fn()
const mockKill = vi.fn()
const mockWrite = vi.fn()
const mockOnData = vi.fn()
const mockOnExit = vi.fn()
const mockExecFileSync = vi.fn()

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
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
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

describe('resize + screen redisplay (강제 리드로우)', () => {
  it('resize 시 pty.resize 1회 + screen -X redisplay 호출', async () => {
    const client = connectClient()
    await new Promise<void>(r => client.on('connect', r))

    client.emit('terminal:attach', { session: 'mysession', cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 100))
    mockResize.mockClear()
    mockExecFileSync.mockClear()

    client.emit('terminal:resize', { cols: 120, rows: 40 })
    await new Promise(r => setTimeout(r, 50))

    // resize 1회
    expect(mockResize).toHaveBeenCalledTimes(1)
    expect(mockResize).toHaveBeenCalledWith(120, 40)

    // screen -X redisplay 호출
    const redisplayCalls = mockExecFileSync.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('redisplay')
    )
    expect(redisplayCalls.length, 'redisplay should be called once').toBe(1)
    expect(redisplayCalls[0][1]).toContain('mysession')

    client.close()
  })

  it('같은 크기 resize에도 redisplay가 호출된다', async () => {
    const client = connectClient()
    await new Promise<void>(r => client.on('connect', r))

    client.emit('terminal:attach', { session: 'mysession', cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 100))
    mockResize.mockClear()
    mockExecFileSync.mockClear()

    // 같은 크기로 resize
    client.emit('terminal:resize', { cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 50))

    expect(mockResize).toHaveBeenCalledWith(80, 24)

    const redisplayCalls = mockExecFileSync.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('redisplay')
    )
    expect(redisplayCalls.length, 'redisplay even on same-size resize').toBe(1)

    client.close()
  })

  it('MUTATION: redisplay 제거 시 감지 (screen이 리드로우하지 않음)', async () => {
    const client = connectClient()
    await new Promise<void>(r => client.on('connect', r))

    client.emit('terminal:attach', { session: 'mysession', cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 100))
    mockExecFileSync.mockClear()

    client.emit('terminal:resize', { cols: 100, rows: 30 })
    await new Promise(r => setTimeout(r, 50))

    // redisplay가 호출되어야 함 — 제거하면 이 테스트가 실패
    const redisplayCalls = mockExecFileSync.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('redisplay')
    )
    expect(redisplayCalls.length, 'redisplay must be called on resize').toBeGreaterThan(0)

    client.close()
  })

  it('redisplay에 올바른 세션 이름이 전달된다', async () => {
    const client = connectClient()
    await new Promise<void>(r => client.on('connect', r))

    client.emit('terminal:attach', { session: 'my-custom-session', cols: 80, rows: 24 })
    await new Promise(r => setTimeout(r, 100))
    mockExecFileSync.mockClear()

    client.emit('terminal:resize', { cols: 100, rows: 30 })
    await new Promise(r => setTimeout(r, 50))

    const redisplayCall = mockExecFileSync.mock.calls.find(
      (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('redisplay')
    )
    expect(redisplayCall).toBeTruthy()
    expect(redisplayCall![1]).toEqual(['-S', 'my-custom-session', '-X', 'redisplay'])

    client.close()
  })
})
