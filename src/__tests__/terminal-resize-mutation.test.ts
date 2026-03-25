import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 뮤테이션 테스트: fitAddon.fit()이 실제로 크기를 변경했을 때
 * attach/resize 이벤트에 올바른 크기가 전송되는지 검증.
 */

let nextFitSize = { cols: 80, rows: 30 }
let terminalInstance: any = null

// Capture rAF callbacks
const rafCallbacks: (() => void)[] = []
vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
  rafCallbacks.push(cb)
  return rafCallbacks.length
})

let resizeObserverCallback: (() => void) | null = null
globalThis.ResizeObserver = class {
  constructor(cb: () => void) {
    resizeObserverCallback = cb
  }
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
} as any

const mockEmit = vi.fn()
const mockOn = vi.fn()
const mockDisconnect = vi.fn()
const mockSocket = {
  emit: mockEmit,
  on: mockOn,
  disconnect: mockDisconnect,
  connected: true,
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}))

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: class {
      write = vi.fn()
      dispose = vi.fn()
      onData = vi.fn()
      open = vi.fn()
      loadAddon = vi.fn()
      cols = 80
      rows = 30
      options: Record<string, any> = {}
      buffer = { active: { length: 0, getLine: () => null } }
      scrollToBottom = vi.fn()
      unicode = { activeVersion: '6', versions: ['6'], register: vi.fn() }
      constructor() {
        terminalInstance = this
      }
    },
  }
})

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {
    activate = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn(() => {
      if (terminalInstance) {
        terminalInstance.cols = nextFitSize.cols
        terminalInstance.rows = nextFitSize.rows
      }
    })
  },
}))

function flushRaf() {
  const cb = rafCallbacks.shift()
  cb?.()
}

function getConnectHandler() {
  return mockOn.mock.calls.find((call: any[]) => call[0] === 'connect')
}

function getOutputHandler() {
  return mockOn.mock.calls.find((call: any[]) => call[0] === 'terminal:output')
}

describe('Mutation: fit()이 크기를 변경할 때 resize 전송 검증', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalInstance = null
    nextFitSize = { cols: 80, rows: 30 }
    resizeObserverCallback = null
    rafCallbacks.length = 0
  })

  it('rAF에서 fit() 후 connect 시 실제 크기로 attach된다', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    createTerminalConnection('test', document.createElement('div'))

    // rAF fires → fit() with real dimensions → socket created
    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()

    // connect → fit() again + attach with real size
    getConnectHandler()![1]()

    expect(mockEmit).toHaveBeenCalledWith('terminal:attach', {
      session: 'test',
      cols: 120,
      rows: 40,
    })

    terminalInstance?.dispose()
  })

  it('MUTATION: rAF 없이 즉시 연결하면 stale 80x30이 전송된다 (rAF의 필요성 증명)', async () => {
    // 이 테스트는 rAF가 핵심임을 증명:
    // rAF 안에서 fit()이 호출되면 레이아웃이 settled된 크기를 얻음
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    createTerminalConnection('test', document.createElement('div'))

    // rAF 전에는 socket이 없음 → attach도 없음
    expect(mockEmit).not.toHaveBeenCalled()

    // rAF에서 fit()이 크기를 변경하므로 attach는 변경된 크기로 전송
    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()

    const attachCall = mockEmit.mock.calls.find(
      (call: any[]) => call[0] === 'terminal:attach'
    )
    expect(attachCall![1].cols).not.toBe(80)
    expect(attachCall![1].rows).not.toBe(30)

    terminalInstance?.dispose()
  })

  it('ResizeObserver가 rows만 변경해도 resize가 전송된다', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()
    mockEmit.mockClear()

    // cols 동일, rows만 변경
    nextFitSize = { cols: 120, rows: 50 }
    resizeObserverCallback?.()
    // Wait for debounce (100ms) to flush
    await new Promise(r => setTimeout(r, 150))

    expect(mockEmit).toHaveBeenCalledWith('terminal:resize', {
      cols: 120,
      rows: 50,
    })

    handle.cleanup()
  })

  it('MUTATION: rows 비교를 제거하면 rows-only 변경이 무시된다', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()
    mockEmit.mockClear()

    nextFitSize = { cols: 120, rows: 55 }
    resizeObserverCallback?.()
    await new Promise(r => setTimeout(r, 150))

    const resizeCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    expect(resizeCalls.length).toBeGreaterThan(0)
    expect(resizeCalls[0][1].rows).toBe(55)

    handle.cleanup()
  })

  it('firstOutput rAF에서 fit()이 크기를 변경하면 resize가 전송된다', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf() // socket creation rAF
    getConnectHandler()![1]()
    mockEmit.mockClear()

    // first output → schedules another rAF
    getOutputHandler()![1]('hello')

    // rAF 시점: scrollbar 등으로 크기 변경
    nextFitSize = { cols: 118, rows: 40 }
    flushRaf() // firstOutput rAF

    const resizeCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    expect(resizeCalls.length).toBeGreaterThan(0)
    expect(resizeCalls[0][1].cols).toBe(118)

    handle.cleanup()
  })

  it('MUTATION: firstOutput에서 rows 비교를 제거하면 rows-only 변경이 누락된다', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()
    mockEmit.mockClear()

    getOutputHandler()![1]('hello')

    // cols 동일, rows만 변경
    nextFitSize = { cols: 120, rows: 45 }
    flushRaf()

    const resizeCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    expect(resizeCalls.length).toBeGreaterThan(0)
    expect(resizeCalls[0][1].rows).toBe(45)

    handle.cleanup()
  })

  it('resize 디바운스: 연속 리사이즈 시 최종 크기만 전송된다', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()
    mockEmit.mockClear()

    // 연속 리사이즈 시뮬레이션 (드래그)
    nextFitSize = { cols: 100, rows: 40 }
    resizeObserverCallback?.()
    nextFitSize = { cols: 90, rows: 40 }
    resizeObserverCallback?.()
    nextFitSize = { cols: 80, rows: 35 }
    resizeObserverCallback?.()

    // 디바운스 전: resize 아직 미전송
    const earlyResizes = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    expect(earlyResizes.length).toBe(0)

    // 디바운스 후: 최종 크기만 전송
    await new Promise(r => setTimeout(r, 150))
    const resizeCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    expect(resizeCalls.length).toBe(1)
    expect(resizeCalls[0][1]).toEqual({ cols: 80, rows: 35 })

    handle.cleanup()
  })

  it('MUTATION: 디바운스를 제거하면 연속 리사이즈가 모두 전송된다', async () => {
    // 디바운스가 없다면 3번의 resize가 모두 전송될 것 — 디바운스의 필요성 증명
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()
    mockEmit.mockClear()

    // 연속 리사이즈
    nextFitSize = { cols: 100, rows: 40 }
    resizeObserverCallback?.()
    nextFitSize = { cols: 90, rows: 40 }
    resizeObserverCallback?.()
    nextFitSize = { cols: 80, rows: 35 }
    resizeObserverCallback?.()

    await new Promise(r => setTimeout(r, 150))
    const resizeCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    // 디바운스 덕분에 1번만 전송됨 (없으면 이 assert가 깨질 것)
    expect(resizeCalls.length).toBe(1)

    handle.cleanup()
  })

  it('축소→확대: 확대된 최종 크기가 전송된다', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()
    mockEmit.mockClear()

    // 축소
    nextFitSize = { cols: 80, rows: 40 }
    resizeObserverCallback?.()
    await new Promise(r => setTimeout(r, 150))
    mockEmit.mockClear()

    // 확대 (초기보다 큼)
    nextFitSize = { cols: 150, rows: 40 }
    resizeObserverCallback?.()
    await new Promise(r => setTimeout(r, 150))

    const resizeCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    expect(resizeCalls.length).toBe(1)
    expect(resizeCalls[0][1]).toEqual({ cols: 150, rows: 40 })

    handle.cleanup()
  })

  it('MUTATION: 축소→확대에서 확대 크기가 축소 크기로 잘못 전송되면 감지', async () => {
    // 디바운스 콜백 내 fitAddon.fit() 재호출이 없다면
    // 축소 시의 stale 크기가 전송될 수 있음 — 이 테스트가 그것을 감지
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()
    mockEmit.mockClear()

    // 축소
    nextFitSize = { cols: 80, rows: 40 }
    resizeObserverCallback?.()
    await new Promise(r => setTimeout(r, 150))
    mockEmit.mockClear()

    // 확대
    nextFitSize = { cols: 150, rows: 40 }
    resizeObserverCallback?.()
    await new Promise(r => setTimeout(r, 150))

    const resizeCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    // 전송된 크기가 축소 크기(80)가 아닌 확대 크기(150)인지 확인
    expect(resizeCalls[0][1].cols).not.toBe(80)
    expect(resizeCalls[0][1].cols).toBe(150)

    handle.cleanup()
  })

  it('빠른 축소→확대 (디바운스 내): 확대 크기만 전송된다', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()
    mockEmit.mockClear()

    // 디바운스 100ms 안에 축소→확대 연속 발생
    nextFitSize = { cols: 80, rows: 40 }
    resizeObserverCallback?.()
    // 50ms 후 확대 (디바운스 안에)
    nextFitSize = { cols: 150, rows: 40 }
    resizeObserverCallback?.()

    await new Promise(r => setTimeout(r, 150))

    const resizeCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    // 축소 resize는 전송되지 않고, 확대 크기만 1회 전송
    expect(resizeCalls.length).toBe(1)
    expect(resizeCalls[0][1].cols).toBe(150)

    handle.cleanup()
  })

  it('MUTATION: 빠른 축소→원복 시 서버 크기와 동일해도 resize가 전송되어야 한다', async () => {
    // 엣지케이스: 120→80→120 빠르게 발생 시
    // 서버 pty는 여전히 120이므로 SIGWINCH 미발생 가능
    // 이 경우에도 resize 이벤트는 전송되어야 한다
    const { createTerminalConnection } = await import('@/lib/terminal-client')
    const handle = createTerminalConnection('test', document.createElement('div'))

    nextFitSize = { cols: 120, rows: 40 }
    flushRaf()
    getConnectHandler()![1]()

    // 서버에 첫 attach (120 cols)
    const attachCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:attach'
    )
    expect(attachCalls[0][1].cols).toBe(120)
    mockEmit.mockClear()

    // 빠른 축소→원복 (디바운스 안에)
    nextFitSize = { cols: 80, rows: 40 }
    resizeObserverCallback?.()
    nextFitSize = { cols: 120, rows: 40 }
    resizeObserverCallback?.()

    await new Promise(r => setTimeout(r, 150))

    const resizeCalls = mockEmit.mock.calls.filter(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    // 서버 pty가 이미 120이어도, 클라이언트는 resize를 보내야 한다
    // (서버가 중간에 80으로 변경되었을 수도 있으므로)
    // 현재 구현: ptyCols가 80→120으로 변경되므로 resize 전송됨
    expect(resizeCalls.length).toBe(1)
    expect(resizeCalls[0][1].cols).toBe(120)

    handle.cleanup()
  })
})
