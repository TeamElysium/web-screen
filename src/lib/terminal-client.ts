import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { io } from 'socket.io-client'

export interface TerminalHandle {
  cleanup: () => void
  sendInput: (data: string) => void
  getBufferText: () => string
}

export function createTerminalConnection(
  session: string,
  container: HTMLElement,
): TerminalHandle {
  const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(container)
  fitAddon.fit()

  // Don't pass auth token — let the browser send the session cookie
  // automatically. Socket.io server will read it from handshake headers.
  const socket = io({
    transports: ['websocket'],
  })

  // Wait for connection before emitting attach
  socket.on('connect', () => {
    socket.emit('terminal:attach', { session })
    socket.emit('terminal:resize', { cols: term.cols, rows: term.rows })
  })

  socket.on('terminal:output', (data: string) => {
    term.write(data)
  })

  socket.on('terminal:exit', () => {
    term.write('\r\n[Session ended]\r\n')
  })

  term.onData((data: string) => {
    socket.emit('terminal:input', data)
  })

  let ptyCols = term.cols
  const handleResize = () => {
    fitAddon.fit()
    term.scrollToBottom()
    // cols 변경 시에만 PTY resize 전송 — rows만 변하면(키보드 올라옴/내려감)
    // PTY에 알리지 않아 screen redraw 없이 xterm 로컬 뷰포트만 조정
    if (term.cols !== ptyCols) {
      ptyCols = term.cols
      socket.emit('terminal:resize', { cols: term.cols, rows: term.rows })
    }
  }

  const resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(container)

  return {
    cleanup: () => {
      resizeObserver.disconnect()
      socket.disconnect()
      term.dispose()
    },
    sendInput: (data: string) => {
      socket.emit('terminal:input', data)
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
