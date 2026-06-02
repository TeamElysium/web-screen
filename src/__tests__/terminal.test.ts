import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture rAF callbacks to fire them manually
const rafCallbacks: (() => void)[] = []
vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
  rafCallbacks.push(cb)
  return rafCallbacks.length
})

// Mock ResizeObserver (not available in jsdom)
const mockResizeObserverDisconnect = vi.fn()
globalThis.ResizeObserver = class {
  constructor(_cb: () => void) {}
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = mockResizeObserverDisconnect
} as any

// Mock socket.io-client
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

// Mock xterm.js
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockOnData = vi.fn()
const mockOpen = vi.fn()
const mockLoadAddon = vi.fn()

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: class {
      write = mockWrite
      dispose = mockDispose
      onData = mockOnData
      open = mockOpen
      loadAddon = mockLoadAddon
      cols = 80
      rows = 30
      options: Record<string, any> = {}
      buffer = { active: { length: 0, getLine: () => null } }
      scrollToBottom = vi.fn()
      unicode = { activeVersion: '6', versions: ['6'], register: vi.fn() }
    },
  }
})

vi.mock('@xterm/addon-unicode11', () => {
  return {
    Unicode11Addon: class {
      activate = vi.fn()
      dispose = vi.fn()
    },
  }
})

vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: class {
      fit = vi.fn()
    },
  }
})

/** Flush the first rAF (socket creation) */
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

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('Terminal component logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rafCallbacks.length = 0
  })

  it('does not emit terminal:attach immediately — waits for rAF + connect', async () => {
    const { io } = await import('socket.io-client')
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('my-session', document.createElement('div'))

    // Before rAF: no socket created, no emit
    expect(io).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()

    // After rAF: socket created but not yet connected
    flushRaf()
    expect(io).toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalledWith('terminal:attach', expect.anything())

    // After connect event: attach emitted with dimensions
    const connectHandler = getConnectHandler()
    expect(connectHandler).toBeDefined()
    connectHandler![1]()
    expect(mockEmit).toHaveBeenCalledWith('terminal:attach', {
      session: 'my-session',
      cols: 80,
      rows: 30,
    })

    handle.cleanup()
  })

  it('sends cols/rows with terminal:attach on connect', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('narrow-session', document.createElement('div'))
    flushRaf()

    const connectHandler = getConnectHandler()
    connectHandler![1]()

    expect(mockEmit).toHaveBeenCalledWith('terminal:attach', {
      session: 'narrow-session',
      cols: 80,
      rows: 30,
    })

    handle.cleanup()
  })

  it('forwards terminal output to xterm write', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    createTerminalConnection('test-session', document.createElement('div'))
    flushRaf()

    const outputHandler = getOutputHandler()
    expect(outputHandler).toBeDefined()

    outputHandler![1]('hello world')
    expect(mockWrite).toHaveBeenCalledWith('hello world')
  })

  it('reveals terminal even when redraw output never settles', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const container = document.createElement('div')
    const handle = createTerminalConnection('test-session', container)
    try {
      expect(container.style.opacity).toBe('0')
      flushRaf()

      const outputHandler = getOutputHandler()
      expect(outputHandler).toBeDefined()

      outputHandler![1]('frame 1')
      await wait(190)
      outputHandler![1]('frame 2')
      await wait(190)
      outputHandler![1]('frame 3')
      expect(container.style.opacity).toBe('0')

      await wait(130)
      expect(container.style.opacity).toBe('1')
    } finally {
      handle.cleanup()
    }
  })

  it('sends terminal:input when user types', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    createTerminalConnection('test-session', document.createElement('div'))
    flushRaf()

    // onData is registered synchronously (outside rAF)
    expect(mockOnData).toHaveBeenCalled()
    const onDataCallback = mockOnData.mock.calls[0][0]

    onDataCallback('ls\n')
    expect(mockEmit).toHaveBeenCalledWith('terminal:input', 'ls\n')
  })

  it('disconnects socket and disposes terminal on cleanup', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('test-session', document.createElement('div'))
    flushRaf()
    handle.cleanup()

    expect(mockResizeObserverDisconnect).toHaveBeenCalled()
    expect(mockDisconnect).toHaveBeenCalled()
    expect(mockDispose).toHaveBeenCalled()
  })

  it('emits terminal:resize after setFontSize to sync PTY cols/rows', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('test-session', document.createElement('div'))
    flushRaf()

    mockEmit.mockClear()
    handle.setFontSize(20)

    expect(mockEmit).toHaveBeenCalledWith('terminal:resize', { cols: 80, rows: 30 })
    handle.cleanup()
  })

  it('sendInput emits terminal:input via socket', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('test-session', document.createElement('div'))
    flushRaf()
    handle.sendInput('\x1b')

    expect(mockEmit).toHaveBeenCalledWith('terminal:input', '\x1b')
    handle.cleanup()
  })
})
