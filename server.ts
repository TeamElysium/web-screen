import { config } from 'dotenv'
config()
import { createServer } from 'http'
import next from 'next'
import { Server as SocketIOServer } from 'socket.io'
import { setupSocketHandler } from './src/lib/socket-handler'
import { CLIENT_IP_HEADER, checkIP, getClientIPForServer } from './src/lib/auth'

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const clientIP = getClientIPForServer(req.headers, req.socket.remoteAddress)
    req.headers[CLIENT_IP_HEADER] = clientIP

    if (!checkIP(clientIP)) {
      res.statusCode = 403
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Forbidden')
      return
    }

    handle(req, res)
  })

  const io = new SocketIOServer(httpServer, {
    maxHttpBufferSize: 64 * 1024, // 64KB
  })
  setupSocketHandler(io)

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`)
  })
})
