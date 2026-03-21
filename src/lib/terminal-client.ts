import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { io } from 'socket.io-client'

export function createTerminalConnection(
  session: string,
  container: HTMLElement,
): () => void {
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

  const handleResize = () => {
    fitAddon.fit()
    socket.emit('terminal:resize', { cols: term.cols, rows: term.rows })
  }
  window.addEventListener('resize', handleResize)

  return () => {
    window.removeEventListener('resize', handleResize)
    socket.disconnect()
    term.dispose()
  }
}
