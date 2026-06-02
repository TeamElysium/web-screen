import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { io } from 'socket.io-client'

const REDRAW_SETTLE_MS = 200
const REDRAW_MAX_HIDE_MS = 500

export interface TerminalHandle {
  cleanup: () => void
  sendInput: (data: string) => void
  getBufferText: () => string
  getFontSize: () => number
  setFontSize: (size: number) => void
  scrollUp: () => void
  scrollDown: () => void
  /** Called before physical keyboard input is sent. Return modified data, or null to suppress. */
  onBeforeInput: ((data: string) => string | null) | null
}

export function createTerminalConnection(
  session: string,
  container: HTMLElement,
): TerminalHandle {
  const term = new Terminal({
    cursorBlink: true,
    convertEol: false,
    allowProposedApi: true,
    scrollback: 1000,
  })

  const fitAddon = new FitAddon()
  const unicode11Addon = new Unicode11Addon()
  term.loadAddon(fitAddon)
  term.loadAddon(unicode11Addon)
  term.unicode.activeVersion = '11'
  term.open(container)

  let socket: ReturnType<typeof io> | null = null
  let ptyCols = term.cols
  let ptyRows = term.rows
  let firstOutput = true
  let redrawing = false  // true during initial connect and resize
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let maxHideTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) clearTimeout(timer)
  }

  const revealTerminal = () => {
    clearTimer(settleTimer)
    clearTimer(maxHideTimer)
    settleTimer = null
    maxHideTimer = null
    container.style.opacity = '1'
    redrawing = false
  }

  const scheduleSettleReveal = () => {
    clearTimer(settleTimer)
    settleTimer = setTimeout(revealTerminal, REDRAW_SETTLE_MS)
  }

  const startRedraw = () => {
    redrawing = true
    container.style.opacity = '0'
    clearTimer(settleTimer)
    clearTimer(maxHideTimer)
    settleTimer = null
    maxHideTimer = setTimeout(revealTerminal, REDRAW_MAX_HIDE_MS)
  }

  startRedraw()

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

      // Only manage settle timer during redraw (connect/resize)
      if (redrawing) {
        scheduleSettleReveal()
      }

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

    socket.on('terminal:detached', () => {
      term.write('\r\n[Detached]\r\n')
    })
  })

  const handle: TerminalHandle = {} as TerminalHandle

  term.onData((data: string) => {
    if (handle.onBeforeInput) {
      const modified = handle.onBeforeInput(data)
      if (modified === null) return
      socket?.emit('terminal:input', modified)
    } else {
      socket?.emit('terminal:input', data)
    }
  })

  let resizeDebounce: ReturnType<typeof setTimeout> | null = null

  const handleResize = () => {
    fitAddon.fit()
    term.scrollToBottom()
    if (term.cols !== ptyCols || term.rows !== ptyRows) {
      ptyCols = term.cols
      ptyRows = term.rows
      // Hide briefly during TUI redraw, but never wait forever for quiet output.
      startRedraw()
      // Debounce: only send final size after resizing settles
      if (resizeDebounce) clearTimeout(resizeDebounce)
      resizeDebounce = setTimeout(() => {
        resizeDebounce = null
        // Re-fit in case container changed during debounce
        fitAddon.fit()
        ptyCols = term.cols
        ptyRows = term.rows
        scheduleSettleReveal()
        socket?.emit('terminal:resize', { cols: term.cols, rows: term.rows })
      }, 100)
    }
  }

  const resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(container)

  Object.assign(handle, {
    onBeforeInput: null,
    cleanup: () => {
      resizeObserver.disconnect()
      clearTimer(settleTimer)
      clearTimer(maxHideTimer)
      clearTimer(resizeDebounce)
      socket?.emit('terminal:detach')
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
    scrollUp: () => { term.scrollLines(-5) },
    scrollDown: () => { term.scrollLines(5) },
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
  })

  return handle
}
