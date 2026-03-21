import { describe, it, expect, vi, beforeEach } from 'vitest'

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

    expect(mockDisconnect).toHaveBeenCalled()
    expect(mockDispose).toHaveBeenCalled()
  })

  it('sendInput emits terminal:input via socket', async () => {
    const { createTerminalConnection } = await import('@/lib/terminal-client')

    const handle = createTerminalConnection('test-session', document.createElement('div'))
    handle.sendInput('\x1b')

    expect(mockEmit).toHaveBeenCalledWith('terminal:input', '\x1b')
    handle.cleanup()
  })
})
