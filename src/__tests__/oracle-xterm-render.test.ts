import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { execSync } from 'child_process'
import type { AddressInfo } from 'net'
import { Terminal } from '@xterm/headless'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import * as pty from 'node-pty'
import { setupSocketHandler } from '@/lib/socket-handler'
import { createSessionToken } from '@/lib/auth'
import { diffGrids, snapshotGrid, type Grid } from '@/lib/oracle'
import { trackSession, cleanupTrackedSessions } from './helpers/screen-cleanup'

const COLS = 80
const ROWS = 24

const PRODUCER = [
  `printf '\\x1b[2J\\x1b[H'`,
  `printf 'alpha\\r\\n'`,
  `printf 'bravo with \\x1b[1;31mred\\x1b[0m bits\\r\\n'`,
  `printf '한글 테스트 ─┬─ box\\r\\n'`,
  `printf '\\x1b[6;1HOVERWRITTEN'`,
  `printf '\\x1b[6;1Hoverwrit3n!!'`,
  `printf '\\x1b[10;20Hanchor'`,
  `printf '\\x1b[12;1H\\x1b[KDONE'`,
  `exec sleep 99999`,
].join('; ')

const PRODUCER_BYTES = (() => {
  let s = ''
  s += '\x1b[2J\x1b[H'
  s += 'alpha\r\n'
  s += 'bravo with \x1b[1;31mred\x1b[0m bits\r\n'
  s += '한글 테스트 ─┬─ box\r\n'
  s += '\x1b[6;1HOVERWRITTEN'
  s += '\x1b[6;1Hoverwrit3n!!'
  s += '\x1b[10;20Hanchor'
  s += '\x1b[12;1H\x1b[KDONE'
  return s
})()

// Synthetic Claude Code TUI-like producer: exercises alt-screen, box drawing,
// heavy SGR, streaming overwrites, erase operations, spinner simulation,
// multi-panel layout — the patterns that cause real redraw regressions.
// No alt-screen: screen intercepts \x1b[?1049h and manages it internally,
// so the attach PTY never sees the raw sequence. This producer sticks to
// CUP + SGR + box drawing + erase — sequences screen passes through faithfully.
const COMPLEX_PRODUCER = (() => {
  const lines: string[] = []
  const boxW = 60

  lines.push('\x1b[2J\x1b[H')

  // Header bar with bold + inverse SGR (COLS-1 to avoid wrap during cols-1 resize trick)
  lines.push('\x1b[1;7m' + ' Claude Code '.padEnd(COLS - 1) + '\x1b[0m')

  // Box-drawing panel (tool use display)
  lines.push('\x1b[3;3H\x1b[36m┌' + '─'.repeat(boxW - 2) + '┐\x1b[0m')
  lines.push('\x1b[4;3H\x1b[36m│\x1b[0m \x1b[1;33mWrite\x1b[0m src/index.ts' + ' '.repeat(boxW - 24) + '\x1b[36m│\x1b[0m')
  lines.push('\x1b[5;3H\x1b[36m│\x1b[0m' + ' '.repeat(boxW - 2) + '\x1b[36m│\x1b[0m')
  // Diff-like content inside box
  lines.push('\x1b[6;3H\x1b[36m│\x1b[0m  \x1b[32m+ export function hello(): string {\x1b[0m' + ' '.repeat(boxW - 40) + '\x1b[36m│\x1b[0m')
  lines.push('\x1b[7;3H\x1b[36m│\x1b[0m  \x1b[32m+   return "hello world"\x1b[0m' + ' '.repeat(boxW - 28) + '\x1b[36m│\x1b[0m')
  lines.push('\x1b[8;3H\x1b[36m│\x1b[0m  \x1b[32m+ }\x1b[0m' + ' '.repeat(boxW - 7) + '\x1b[36m│\x1b[0m')
  lines.push('\x1b[9;3H\x1b[36m└' + '─'.repeat(boxW - 2) + '┘\x1b[0m')

  // Streaming response text with SGR
  lines.push('\x1b[11;1HI\'ll create the file with the hello function.')
  lines.push('\x1b[12;1H\x1b[2mTokens: 1.2k in, 340 out\x1b[0m')

  // Spinner simulation: overwrite same position 3 times
  lines.push('\x1b[14;1H\x1b[33m⠋\x1b[0m Working...')
  lines.push('\x1b[14;1H\x1b[33m⠙\x1b[0m Working...')
  lines.push('\x1b[14;1H\x1b[33m⠹\x1b[0m Working...')
  lines.push('\x1b[14;1H\x1b[32m✓\x1b[0m Done      ')

  // Second panel — another tool use
  lines.push('\x1b[16;3H\x1b[36m┌' + '─'.repeat(boxW - 2) + '┐\x1b[0m')
  lines.push('\x1b[17;3H\x1b[36m│\x1b[0m \x1b[1;33mRead\x1b[0m package.json' + ' '.repeat(boxW - 23) + '\x1b[36m│\x1b[0m')
  lines.push('\x1b[18;3H\x1b[36m│\x1b[0m  \x1b[2m1 line (contents hidden)\x1b[0m' + ' '.repeat(boxW - 29) + '\x1b[36m│\x1b[0m')
  lines.push('\x1b[19;3H\x1b[36m└' + '─'.repeat(boxW - 2) + '┘\x1b[0m')

  // CJK in streaming response
  lines.push('\x1b[21;1H파일을 성공적으로 생성했습니다.')
  lines.push('\x1b[22;1H\x1b[1;4mNext steps:\x1b[0m run \x1b[36m`npm test`\x1b[0m to verify.')

  // Status bar at bottom (COLS-1 to avoid wrap during cols-1 resize trick)
  lines.push(`\x1b[${ROWS};1H\x1b[7m` + ' > '.padEnd(COLS - 1) + '\x1b[0m')

  return lines.join('')
})()

import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const COMPLEX_PRODUCER_FILE = join(tmpdir(), `wst-complex-producer-${process.pid}.bin`)

function makeBrowserTerminal(cols: number, rows: number): Terminal {
  const term = new Terminal({
    cols,
    rows,
    convertEol: true,
    allowProposedApi: true,
    scrollback: 0,
  })
  const unicode11 = new Unicode11Addon()
  term.loadAddon(unicode11)
  term.unicode.activeVersion = '11'
  return term
}

function writeAsync(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, () => resolve()))
}

async function replayAsBrowser(
  bytes: string,
  cols: number,
  rows: number,
): Promise<Grid> {
  const term = makeBrowserTerminal(cols, rows)
  try {
    await writeAsync(term, bytes)
    return snapshotGrid(term)
  } finally {
    term.dispose()
  }
}

let httpServer: ReturnType<typeof createServer>
let ioServer: SocketIOServer
let port: number

beforeEach(() => {
  vi.stubEnv('PASSWORD', 'testpass')
  vi.stubEnv('ALLOWED_IPS', '')

  httpServer = createServer()
  ioServer = new SocketIOServer(httpServer)
  setupSocketHandler(ioServer)

  return new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port
      resolve()
    })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  cleanupTrackedSessions()
  try { unlinkSync(COMPLEX_PRODUCER_FILE) } catch {}
  return new Promise<void>((resolve) => {
    ioServer.close(() => {
      httpServer.close(() => resolve())
    })
  })
})

function connectClient(): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    auth: { token: createSessionToken() },
    transports: ['websocket'],
  })
}

async function collectUntilIdle(
  client: ClientSocket,
  idleMs: number,
  maxMs: number,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: string[] = []
    let lastAt = Date.now()
    let done = false

    const onOutput = (data: string) => {
      chunks.push(data)
      lastAt = Date.now()
    }
    const onExit = () => {
      if (!done) {
        done = true
        resolve(chunks.join(''))
      }
    }
    client.on('terminal:output', onOutput)
    client.on('terminal:exit', onExit)

    const startedAt = Date.now()
    const tick = () => {
      if (done) return
      const idle = Date.now() - lastAt
      if (idle >= idleMs || Date.now() - startedAt >= maxMs) {
        done = true
        client.off('terminal:output', onOutput)
        client.off('terminal:exit', onExit)
        resolve(chunks.join(''))
      } else {
        setTimeout(tick, 100)
      }
    }
    setTimeout(tick, 100)
  })
}

describe('oracle: xterm.js browser-equivalent rendering', () => {
  it('pipeline output renders correctly in browser-configured xterm', async () => {
    const baseline = await replayAsBrowser(PRODUCER_BYTES, COLS, ROWS)

    const sessionName = `wst_xterm_${Date.now()}`
    trackSession(sessionName)
    execSync(
      `screen -dmUS ${sessionName} bash -c ${JSON.stringify(PRODUCER)}`,
      { timeout: 3000 },
    )
    await new Promise((r) => setTimeout(r, 500))

    const client = connectClient()
    await new Promise<void>((res, rej) => {
      client.on('connect', () => res())
      client.on('connect_error', rej)
    })

    client.emit('terminal:attach', {
      session: sessionName,
      cols: COLS,
      rows: ROWS,
    })

    const socketBytes = await collectUntilIdle(client, 800, 6000)
    client.close()

    expect(socketBytes.length).toBeGreaterThan(0)

    const pipelineGrid = await replayAsBrowser(socketBytes, COLS, ROWS)

    const diff = diffGrids(baseline, pipelineGrid)
    if (!diff.equal) {
      console.log('=== xterm render diff ===')
      for (const r of diff.reasons.slice(0, 10)) console.log('  ' + r)
      console.log(`(${diff.reasons.length} total diffs)`)
    }
    expect(diff.equal).toBe(true)
  }, 15_000)

  it('CJK wide chars render identically with Unicode11Addon', async () => {
    const cjkBytes =
      '\x1b[2J\x1b[H' +
      '가나다라마바사\r\n' +
      'ABCD\x1b[2;10H한글\r\n' +
      '\x1b[3;1H混合テスト mixed'

    const baseline = await replayAsBrowser(cjkBytes, COLS, ROWS)

    expect(baseline.lines[0]).toContain('가나다라마바사')
    expect(baseline.lines[1]).toContain('한글')
    expect(baseline.lines[2]).toContain('混合テスト mixed')

    const replay = await replayAsBrowser(cjkBytes, COLS, ROWS)
    expect(diffGrids(baseline, replay).equal).toBe(true)
  })

  it('convertEol: bare LF handled like browser terminal', async () => {
    const lfBytes = '\x1b[2J\x1b[Hline1\nline2\nline3'

    const browserGrid = await replayAsBrowser(lfBytes, COLS, ROWS)

    expect(browserGrid.lines[0].trimEnd()).toBe('line1')
    expect(browserGrid.lines[1].trimEnd()).toBe('line2')
    expect(browserGrid.lines[2].trimEnd()).toBe('line3')

    const rawTerm = new Terminal({
      cols: COLS,
      rows: ROWS,
      convertEol: false,
      allowProposedApi: true,
    })
    await new Promise<void>((resolve) => rawTerm.write(lfBytes, () => resolve()))
    const rawGrid = snapshotGrid(rawTerm)
    rawTerm.dispose()

    const diff = diffGrids(browserGrid, rawGrid)
    expect(diff.equal).toBe(false)
  })
})

describe('oracle: mutation tests — browser xterm diff catches corruption', () => {
  let baselineGrid: Grid

  beforeAll(async () => {
    baselineGrid = await replayAsBrowser(PRODUCER_BYTES, COLS, ROWS)
  })

  it('dropping a printable byte is detected', async () => {
    let dropIdx = -1
    for (let i = Math.floor(PRODUCER_BYTES.length / 2); i < PRODUCER_BYTES.length; i++) {
      const c = PRODUCER_BYTES.charCodeAt(i)
      if (c >= 0x20 && c < 0x7f && PRODUCER_BYTES[i] !== '\x1b') {
        dropIdx = i
        break
      }
    }
    expect(dropIdx).toBeGreaterThanOrEqual(0)
    const mutated = PRODUCER_BYTES.slice(0, dropIdx) + PRODUCER_BYTES.slice(dropIdx + 1)
    const grid = await replayAsBrowser(mutated, COLS, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('truncating at 80% is detected', async () => {
    const mutated = PRODUCER_BYTES.slice(0, Math.floor(PRODUCER_BYTES.length * 0.8))
    const grid = await replayAsBrowser(mutated, COLS, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('appending extra text is detected', async () => {
    const grid = await replayAsBrowser(PRODUCER_BYTES + 'EXTRA', COLS, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('swapping CJK for ASCII is detected', async () => {
    const mutated = PRODUCER_BYTES.replace('한글', 'AB')
    const grid = await replayAsBrowser(mutated, COLS, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('wrong terminal size is detected', async () => {
    const grid = await replayAsBrowser(PRODUCER_BYTES, 60, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })
})

describe('oracle: complex Claude Code TUI rendering', () => {
  let baselineGrid: Grid

  beforeAll(async () => {
    baselineGrid = await replayAsBrowser(COMPLEX_PRODUCER, COLS, ROWS)
  })

  it('complex TUI renders expected content', () => {
    expect(baselineGrid.lines[0]).toContain('Claude Code')
    expect(baselineGrid.lines[2]).toContain('┌')
    expect(baselineGrid.lines[3]).toContain('Write')
    expect(baselineGrid.lines[5]).toContain('+ export function hello')
    expect(baselineGrid.lines[8]).toContain('└')
    expect(baselineGrid.lines[13]).toContain('✓')
    expect(baselineGrid.lines[13]).toContain('Done')
    expect(baselineGrid.lines[20]).toContain('파일을 성공적으로')
    expect(baselineGrid.lines[21]).toContain('Next steps:')
    expect(baselineGrid.lines[21]).toContain('npm test')
  })

  it('replay is deterministic', async () => {
    const replay = await replayAsBrowser(COMPLEX_PRODUCER, COLS, ROWS)
    expect(diffGrids(baselineGrid, replay).equal).toBe(true)
  })

  it('complex TUI survives full pipeline (screen baseline)', async () => {
    writeFileSync(COMPLEX_PRODUCER_FILE, COMPLEX_PRODUCER, 'utf8')
    const catCmd = `cat ${JSON.stringify(COMPLEX_PRODUCER_FILE)}; exec sleep 99999`

    // Baseline: same content through screen, direct node-pty attach
    // (no socket-handler). This isolates what socket-handler adds/loses.
    const baseSession = `wst_cbase_${Date.now()}`
    trackSession(baseSession)
    execSync(
      `screen -dmUS ${baseSession} bash -c ${JSON.stringify(catCmd)}`,
      { timeout: 3000 },
    )
    await new Promise((r) => setTimeout(r, 500))

    const baseChunks: string[] = []
    const basePty = pty.spawn('screen', ['-xU', baseSession], {
      name: 'xterm-256color',
      cols: Math.max(COLS - 1, 1),
      rows: ROWS,
      cwd: process.env.HOME,
    })
    let baseDiscarding = true
    basePty.onData((d: string) => {
      if (!baseDiscarding) baseChunks.push(d)
    })
    await new Promise((r) => setTimeout(r, 50))
    baseDiscarding = false
    basePty.resize(COLS, ROWS)
    await new Promise((r) => setTimeout(r, 1500))
    basePty.kill()

    const baseBytes = baseChunks.join('')
    expect(baseBytes.length).toBeGreaterThan(0)
    const screenBaseline = await replayAsBrowser(baseBytes, COLS, ROWS)

    // Pipeline: same content through screen + socket-handler + socket.io
    const pipeSession = `wst_cpipe_${Date.now()}`
    trackSession(pipeSession)
    execSync(
      `screen -dmUS ${pipeSession} bash -c ${JSON.stringify(catCmd)}`,
      { timeout: 3000 },
    )
    await new Promise((r) => setTimeout(r, 500))

    const client = connectClient()
    await new Promise<void>((res, rej) => {
      client.on('connect', () => res())
      client.on('connect_error', rej)
    })

    client.emit('terminal:attach', {
      session: pipeSession,
      cols: COLS,
      rows: ROWS,
    })

    const socketBytes = await collectUntilIdle(client, 800, 6000)
    client.close()

    expect(socketBytes.length).toBeGreaterThan(0)

    const pipelineGrid = await replayAsBrowser(socketBytes, COLS, ROWS)

    // Verify the screen baseline has expected content
    const hasContent = screenBaseline.lines.some(l => l.includes('Claude Code'))
      && screenBaseline.lines.some(l => l.includes('export function hello'))
      && screenBaseline.lines.some(l => l.includes('파일을 성공적으로'))
    expect(hasContent).toBe(true)

    const diff = diffGrids(screenBaseline, pipelineGrid)
    if (!diff.equal) {
      console.log('=== complex TUI pipeline diff (vs screen baseline) ===')
      for (const r of diff.reasons.slice(0, 15)) console.log('  ' + r)
      console.log(`(${diff.reasons.length} total diffs)`)
    }
    expect(diff.equal).toBe(true)
  }, 20_000)

  it('mutation: corrupted box drawing is detected', async () => {
    const mutated = COMPLEX_PRODUCER.replace('┌', '+')
    const grid = await replayAsBrowser(mutated, COLS, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('mutation: missing spinner final state is detected', async () => {
    const mutated = COMPLEX_PRODUCER.replace('✓', '⠹')
    const grid = await replayAsBrowser(mutated, COLS, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('mutation: corrupted diff panel content is detected', async () => {
    const mutated = COMPLEX_PRODUCER.replace('export function hello', 'export function HELLO')
    const grid = await replayAsBrowser(mutated, COLS, ROWS)
    const diff = diffGrids(baselineGrid, grid)
    expect(diff.equal).toBe(false)
    expect(diff.reasons.some((r) => r.includes('line 5'))).toBe(true)
  })

  it('mutation: missing CJK response text is detected', async () => {
    const mutated = COMPLEX_PRODUCER.replace('파일을 성공적으로 생성했습니다.', 'File created.')
    const grid = await replayAsBrowser(mutated, COLS, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('mutation: truncated stream (no status bar) is detected', async () => {
    const statusBarSeq = `\x1b[${ROWS};1H`
    const idx = COMPLEX_PRODUCER.lastIndexOf(statusBarSeq)
    expect(idx).toBeGreaterThan(0)
    const mutated = COMPLEX_PRODUCER.slice(0, idx)
    const grid = await replayAsBrowser(mutated, COLS, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('mutation: second panel removed is detected', async () => {
    const panel2Start = COMPLEX_PRODUCER.indexOf('\x1b[16;3H')
    const panel2End = COMPLEX_PRODUCER.indexOf('\x1b[21;1H')
    expect(panel2Start).toBeGreaterThan(0)
    expect(panel2End).toBeGreaterThan(panel2Start)
    const mutated = COMPLEX_PRODUCER.slice(0, panel2Start) + COMPLEX_PRODUCER.slice(panel2End)
    const grid = await replayAsBrowser(mutated, COLS, ROWS)
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })
})

// Helper: attach to a screen session via direct node-pty (same cols-1 trick
// as socket-handler) and collect the redraw at the given size.
// Stops collecting before detaching so [detached] text doesn't pollute output.
// Uses screen -d to detach cleanly without writing to the session's buffer.
async function collectScreenRedraw(
  sessionName: string,
  cols: number,
  rows: number,
): Promise<string> {
  const chunks: string[] = []
  const p = pty.spawn('screen', ['-xU', sessionName], {
    name: 'xterm-256color',
    cols: Math.max(cols - 1, 1),
    rows,
    cwd: process.env.HOME,
  })
  let collecting = false
  p.onData((d: string) => {
    if (collecting) chunks.push(d)
  })
  await new Promise((r) => setTimeout(r, 50))
  collecting = true
  p.resize(cols, rows)
  await new Promise((r) => setTimeout(r, 1500))
  collecting = false
  // Detach via screen command to avoid Broken pipe in session buffer
  try {
    execSync(`screen -S ${sessionName} -d`, { timeout: 2000 })
  } catch {}
  await new Promise((r) => setTimeout(r, 200))
  try { p.kill() } catch {}
  return chunks.join('')
}

describe('oracle: resize rendering', () => {
  const NEW_COLS = 120
  const NEW_ROWS = 40

  it('content renders correctly after resize (80x24 → 120x40)', async () => {
    const sessionName = `wst_rsz_${Date.now()}`
    trackSession(sessionName)
    execSync(
      `screen -dmUS ${sessionName} bash -c ${JSON.stringify(PRODUCER)}`,
      { timeout: 3000 },
    )
    await new Promise((r) => setTimeout(r, 500))

    // Baseline: direct attach at the NEW size
    const baseBytes = await collectScreenRedraw(sessionName, NEW_COLS, NEW_ROWS)
    expect(baseBytes.length).toBeGreaterThan(0)
    const baseline = await replayAsBrowser(baseBytes, NEW_COLS, NEW_ROWS)

    // Pipeline: attach at initial size, then resize via socket-handler
    const client = connectClient()
    await new Promise<void>((res, rej) => {
      client.on('connect', () => res())
      client.on('connect_error', rej)
    })

    // Initial attach at 80x24
    client.emit('terminal:attach', { session: sessionName, cols: COLS, rows: ROWS })
    await collectUntilIdle(client, 800, 6000)

    // Now resize to 120x40
    const resizeChunks: string[] = []
    let resizeDone = false
    let lastAt = Date.now()
    client.on('terminal:output', (data: string) => {
      resizeChunks.push(data)
      lastAt = Date.now()
    })

    client.emit('terminal:resize', { cols: NEW_COLS, rows: NEW_ROWS })

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (resizeDone) return
        if (Date.now() - lastAt >= 800 || Date.now() - lastAt >= 6000) {
          resizeDone = true
          resolve()
        } else {
          setTimeout(tick, 100)
        }
      }
      setTimeout(tick, 100)
    })
    client.close()

    const resizeBytes = resizeChunks.join('')
    expect(resizeBytes.length).toBeGreaterThan(0)

    // Replay: start at initial size, write initial bytes, resize, write resize bytes
    const term = makeBrowserTerminal(COLS, ROWS)
    // We don't replay initial bytes — the resize redraw is a complete screen repaint.
    // Just replay the resize output at the new size.
    term.resize(NEW_COLS, NEW_ROWS)
    await writeAsync(term, resizeBytes)
    const resizeGrid = snapshotGrid(term)
    term.dispose()

    // Content must match baseline at new size
    const diff = diffGrids(baseline, resizeGrid)
    if (!diff.equal) {
      console.log('=== resize rendering diff ===')
      for (const r of diff.reasons.slice(0, 10)) console.log('  ' + r)
      console.log(`(${diff.reasons.length} total diffs)`)
    }
    expect(diff.equal).toBe(true)
  }, 20_000)

  it('complex TUI renders correctly after resize', async () => {
    writeFileSync(COMPLEX_PRODUCER_FILE, COMPLEX_PRODUCER, 'utf8')
    const catCmd = `cat ${JSON.stringify(COMPLEX_PRODUCER_FILE)}; exec sleep 99999`

    const sessionName = `wst_rszc_${Date.now()}`
    trackSession(sessionName)
    execSync(
      `screen -dmUS ${sessionName} bash -c ${JSON.stringify(catCmd)}`,
      { timeout: 3000 },
    )
    await new Promise((r) => setTimeout(r, 500))

    // Baseline: direct attach at new size
    const baseBytes = await collectScreenRedraw(sessionName, NEW_COLS, NEW_ROWS)
    expect(baseBytes.length).toBeGreaterThan(0)
    const baseline = await replayAsBrowser(baseBytes, NEW_COLS, NEW_ROWS)

    // Verify baseline has expected content at new size
    expect(baseline.lines.some(l => l.includes('Claude Code'))).toBe(true)
    expect(baseline.lines.some(l => l.includes('export function hello'))).toBe(true)
    expect(baseline.lines.some(l => l.includes('파일을 성공적으로'))).toBe(true)

    // Pipeline: attach at initial size, then resize
    const client = connectClient()
    await new Promise<void>((res, rej) => {
      client.on('connect', () => res())
      client.on('connect_error', rej)
    })

    client.emit('terminal:attach', { session: sessionName, cols: COLS, rows: ROWS })
    await collectUntilIdle(client, 800, 6000)

    const resizeChunks: string[] = []
    let lastAt = Date.now()
    client.on('terminal:output', (data: string) => {
      resizeChunks.push(data)
      lastAt = Date.now()
    })

    client.emit('terminal:resize', { cols: NEW_COLS, rows: NEW_ROWS })

    await new Promise<void>((resolve) => {
      const startedAt = Date.now()
      const tick = () => {
        if (Date.now() - lastAt >= 800 || Date.now() - startedAt >= 6000) {
          resolve()
        } else {
          setTimeout(tick, 100)
        }
      }
      setTimeout(tick, 100)
    })
    client.close()

    const resizeBytes = resizeChunks.join('')
    expect(resizeBytes.length).toBeGreaterThan(0)

    const term = makeBrowserTerminal(COLS, ROWS)
    term.resize(NEW_COLS, NEW_ROWS)
    await writeAsync(term, resizeBytes)
    const resizeGrid = snapshotGrid(term)
    term.dispose()

    const diff = diffGrids(baseline, resizeGrid)
    if (!diff.equal) {
      console.log('=== complex TUI resize diff ===')
      for (const r of diff.reasons.slice(0, 10)) console.log('  ' + r)
      console.log(`(${diff.reasons.length} total diffs)`)
    }
    expect(diff.equal).toBe(true)
  }, 20_000)

  it('resize to smaller size preserves visible content', async () => {
    const SMALL_COLS = 60
    const SMALL_ROWS = 20

    const sessionName = `wst_rszs_${Date.now()}`
    trackSession(sessionName)
    execSync(
      `screen -dmUS ${sessionName} bash -c ${JSON.stringify(PRODUCER)}`,
      { timeout: 3000 },
    )
    await new Promise((r) => setTimeout(r, 500))

    // Baseline: direct attach at small size
    const baseBytes = await collectScreenRedraw(sessionName, SMALL_COLS, SMALL_ROWS)
    const baseline = await replayAsBrowser(baseBytes, SMALL_COLS, SMALL_ROWS)

    // Pipeline: attach at 80x24, then shrink
    const client = connectClient()
    await new Promise<void>((res, rej) => {
      client.on('connect', () => res())
      client.on('connect_error', rej)
    })

    client.emit('terminal:attach', { session: sessionName, cols: COLS, rows: ROWS })
    await collectUntilIdle(client, 800, 6000)

    const resizeChunks: string[] = []
    let lastAt = Date.now()
    client.on('terminal:output', (data: string) => {
      resizeChunks.push(data)
      lastAt = Date.now()
    })

    client.emit('terminal:resize', { cols: SMALL_COLS, rows: SMALL_ROWS })

    await new Promise<void>((resolve) => {
      const startedAt = Date.now()
      const tick = () => {
        if (Date.now() - lastAt >= 800 || Date.now() - startedAt >= 6000) {
          resolve()
        } else {
          setTimeout(tick, 100)
        }
      }
      setTimeout(tick, 100)
    })
    client.close()

    const resizeBytes = resizeChunks.join('')
    expect(resizeBytes.length).toBeGreaterThan(0)

    const term = makeBrowserTerminal(COLS, ROWS)
    term.resize(SMALL_COLS, SMALL_ROWS)
    await writeAsync(term, resizeBytes)
    const resizeGrid = snapshotGrid(term)
    term.dispose()

    const diff = diffGrids(baseline, resizeGrid)
    if (!diff.equal) {
      console.log('=== shrink resize diff ===')
      for (const r of diff.reasons.slice(0, 10)) console.log('  ' + r)
      console.log(`(${diff.reasons.length} total diffs)`)
    }
    expect(diff.equal).toBe(true)
  }, 20_000)

  it('same-size resize still produces correct redraw', async () => {
    const sessionName = `wst_rszz_${Date.now()}`
    trackSession(sessionName)
    execSync(
      `screen -dmUS ${sessionName} bash -c ${JSON.stringify(PRODUCER)}`,
      { timeout: 3000 },
    )
    await new Promise((r) => setTimeout(r, 500))

    // Baseline: direct attach at same size
    const baseBytes = await collectScreenRedraw(sessionName, COLS, ROWS)
    const baseline = await replayAsBrowser(baseBytes, COLS, ROWS)

    // Pipeline: attach, then resize to SAME size
    const client = connectClient()
    await new Promise<void>((res, rej) => {
      client.on('connect', () => res())
      client.on('connect_error', rej)
    })

    client.emit('terminal:attach', { session: sessionName, cols: COLS, rows: ROWS })
    await collectUntilIdle(client, 800, 6000)

    const resizeChunks: string[] = []
    let lastAt = Date.now()
    client.on('terminal:output', (data: string) => {
      resizeChunks.push(data)
      lastAt = Date.now()
    })

    client.emit('terminal:resize', { cols: COLS, rows: ROWS })

    await new Promise<void>((resolve) => {
      const startedAt = Date.now()
      const tick = () => {
        if (Date.now() - lastAt >= 800 || Date.now() - startedAt >= 6000) {
          resolve()
        } else {
          setTimeout(tick, 100)
        }
      }
      setTimeout(tick, 100)
    })
    client.close()

    const resizeBytes = resizeChunks.join('')
    expect(resizeBytes.length).toBeGreaterThan(0)

    const term = makeBrowserTerminal(COLS, ROWS)
    await writeAsync(term, resizeBytes)
    const resizeGrid = snapshotGrid(term)
    term.dispose()

    const diff = diffGrids(baseline, resizeGrid)
    if (!diff.equal) {
      console.log('=== same-size resize diff ===')
      for (const r of diff.reasons.slice(0, 10)) console.log('  ' + r)
      console.log(`(${diff.reasons.length} total diffs)`)
    }
    expect(diff.equal).toBe(true)
  }, 20_000)
})
