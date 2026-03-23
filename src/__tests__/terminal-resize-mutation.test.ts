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
})
