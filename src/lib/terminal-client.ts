import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { io } from 'socket.io-client'

export interface TerminalHandle {
  cleanup: () => void
  sendInput: (data: string) => void
  getBufferText: () => string
  getFontSize: () => number
  setFontSize: (size: number) => void
}

export function createTerminalConnection(
  session: string,
  container: HTMLElement,
): TerminalHandle {
  const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    allowProposedApi: true,
  })

  const fitAddon = new FitAddon()
  const unicode11Addon = new Unicode11Addon()
  term.loadAddon(fitAddon)
  term.loadAddon(unicode11Addon)
  term.unicode.activeVersion = '11'
  term.open(container)

  // Constrain xterm's root element to fill the container exactly.
  // Without this, xterm's DOM (including scrollback buffer) expands
  // beyond the container, causing page-level overflow.
  const xtermEl = container.querySelector('.xterm') as HTMLElement
  if (xtermEl) {
    xtermEl.style.height = '100%'
    xtermEl.style.overflow = 'hidden'
  }

  let socket: ReturnType<typeof io> | null = null
  let ptyCols = term.cols
  let ptyRows = term.rows
  let firstOutput = true

  // xterm needs at least one render frame after open() before fitAddon can
  // measure character cell dimensions. If we fit() + connect immediately,
  // fit() returns stale 80x30 defaults. Wait one frame so xterm renders,
  // then fit and connect with accurate dimensions.
  requestAnimationFrame(() => {
    fitAddon.fit()
    ptyCols = term.cols
    ptyRows = term.rows

    socket = io({ transports: ['websocket'] })

    socket.on('connect', () => {
      fitAddon.fit()
      ptyCols = term.cols
      ptyRows = term.rows
      socket!.emit('terminal:attach', { session, cols: term.cols, rows: term.rows })
    })

    socket.on('terminal:output', (data: string) => {
      term.write(data)
      if (firstOutput) {
        firstOutput = false
        requestAnimationFrame(() => {
          const colsBefore = term.cols
          const rowsBefore = term.rows
          fitAddon.fit()
          if (term.cols !== colsBefore || term.rows !== rowsBefore) {
            ptyCols = term.cols
            ptyRows = term.rows
            socket?.emit('terminal:resize', { cols: term.cols, rows: term.rows })
          }
        })
      }
    })

    socket.on('terminal:exit', () => {
      term.write('\r\n[Session ended]\r\n')
    })
  })

  term.onData((data: string) => {
    socket?.emit('terminal:input', data)
  })

  const handleResize = () => {
    fitAddon.fit()
    term.scrollToBottom()
    if (term.cols !== ptyCols || term.rows !== ptyRows) {
      ptyCols = term.cols
      ptyRows = term.rows
      socket?.emit('terminal:resize', { cols: term.cols, rows: term.rows })
    }
  }

  const resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(container)

  return {
    cleanup: () => {
      resizeObserver.disconnect()
      socket?.disconnect()
      term.dispose()
    },
    sendInput: (data: string) => {
      socket?.emit('terminal:input', data)
    },
    getFontSize: () => term.options.fontSize ?? 14,
    setFontSize: (size: number) => {
      term.options.fontSize = size
      fitAddon.fit()
      socket?.emit('terminal:resize', { cols: term.cols, rows: term.rows })
    },
    getBufferText: () => {
      const buf = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i)
        if (line) lines.push(line.translateToString(true))
      }
      // trim trailing empty lines
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop()
      }
      return lines.join('\n')
    },
  }
}
