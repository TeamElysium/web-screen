import { createServer } from 'http'
import next from 'next'
import { Server as SocketIOServer } from 'socket.io'
import { setupSocketHandler } from './src/lib/socket-handler'

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res)
  })

  const io = new SocketIOServer(httpServer)
  setupSocketHandler(io)

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`)
  })
})
