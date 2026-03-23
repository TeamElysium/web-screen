import { describe, it, expect, vi, beforeEach } from 'vitest'

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

describe('Terminal component logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not emit terminal:attach immediately — waits for connect event', async () => {
    const { io } = await import('socket.io-client')
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('my-session', document.createElement('div'))

    expect(io).toHaveBeenCalled()

    // terminal:attach must NOT be called directly — it should be inside a 'connect' handler
    expect(mockEmit).not.toHaveBeenCalledWith('terminal:attach', { session: 'my-session' })

    // Verify a 'connect' handler was registered
    const connectHandler = mockOn.mock.calls.find(
      (call: any[]) => call[0] === 'connect'
    )
    expect(connectHandler).toBeDefined()

    // Simulate the connect event firing — now terminal:attach should be emitted
    connectHandler![1]()
    expect(mockEmit).toHaveBeenCalledWith('terminal:attach', { session: 'my-session' })
    // Must also send initial resize so PTY matches actual terminal size
    expect(mockEmit).toHaveBeenCalledWith('terminal:resize', { cols: 80, rows: 30 })

    handle.cleanup()
  })

  it('sends terminal:resize immediately after attach on connect', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('narrow-session', document.createElement('div'))

    const connectHandler = mockOn.mock.calls.find(
      (call: any[]) => call[0] === 'connect'
    )
    connectHandler![1]()

    // Verify resize is sent with terminal's actual dimensions
    const emitCalls = mockEmit.mock.calls
    const attachIdx = emitCalls.findIndex(
      (call: any[]) => call[0] === 'terminal:attach'
    )
    const resizeIdx = emitCalls.findIndex(
      (call: any[]) => call[0] === 'terminal:resize'
    )
    expect(attachIdx).toBeGreaterThanOrEqual(0)
    expect(resizeIdx).toBeGreaterThan(attachIdx)
    expect(emitCalls[resizeIdx][1]).toEqual({ cols: 80, rows: 30 })

    handle.cleanup()
  })

  it('forwards terminal output to xterm write', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    createTerminalConnection('test-session', document.createElement('div'))

    // Find the 'terminal:output' handler registered via socket.on
    const outputHandler = mockOn.mock.calls.find(
      (call: any[]) => call[0] === 'terminal:output'
    )
    expect(outputHandler).toBeDefined()

    // Simulate server sending output
    outputHandler![1]('hello world')
    expect(mockWrite).toHaveBeenCalledWith('hello world')
  })

  it('sends terminal:input when user types', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    createTerminalConnection('test-session', document.createElement('div'))

    // Find the onData callback registered on the terminal
    expect(mockOnData).toHaveBeenCalled()
    const onDataCallback = mockOnData.mock.calls[0][0]

    // Simulate user typing
    onDataCallback('ls\n')
    expect(mockEmit).toHaveBeenCalledWith('terminal:input', 'ls\n')
  })

  it('disconnects socket and disposes terminal on cleanup', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('test-session', document.createElement('div'))
    handle.cleanup()

    expect(mockResizeObserverDisconnect).toHaveBeenCalled()
    expect(mockDisconnect).toHaveBeenCalled()
    expect(mockDispose).toHaveBeenCalled()
  })

  it('emits terminal:resize after setFontSize to sync PTY cols/rows', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('test-session', document.createElement('div'))

    mockEmit.mockClear()
    handle.setFontSize(20)

    expect(mockEmit).toHaveBeenCalledWith('terminal:resize', { cols: 80, rows: 30 })
    handle.cleanup()
  })

  it('sendInput emits terminal:input via socket', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('test-session', document.createElement('div'))
    handle.sendInput('\x1b')

    expect(mockEmit).toHaveBeenCalledWith('terminal:input', '\x1b')
    handle.cleanup()
  })
})
