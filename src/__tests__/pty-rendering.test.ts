import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import * as pty from 'node-pty'

/**
 * PTY 출력을 xterm.js headless 터미널에 통과시켜,
 * 네이티브 터미널과 웹 터미널의 렌더링 차이를 검증한다.
 *
 * 방법:
 *  1. node-pty로 PTY를 생성하고 포맷된 출력을 만든다
 *  2. 동일한 raw 출력을 두 xterm.js 터미널에 먹인다:
 *     - convertEol: false (네이티브 터미널과 동일)
 *     - convertEol: true  (현재 웹 터미널 설정)
 *  3. 두 버퍼를 비교한다
 */

function readBuffer(term: Terminal): string[] {
  const lines: string[] = []
  const buf = term.buffer.active
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i)
    if (line) lines.push(line.translateToString(true))
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
  }
  return lines
}

function writeAsync(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

function collectPtyOutput(cmd: string, args: string[], cols: number, rows: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    const proc = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME,
    })
    proc.onData((data) => chunks.push(data))
    proc.onExit(() => resolve(chunks.join('')))
    setTimeout(() => {
      proc.kill()
      reject(new Error('PTY timeout'))
    }, 5000)
  })
}

async function feedToTerminal(raw: string, opts: { convertEol: boolean; cols: number; rows: number }): Promise<string[]> {
  const term = new Terminal({
    cols: opts.cols,
    rows: opts.rows,
    convertEol: opts.convertEol,
    allowProposedApi: true,
  })
  await writeAsync(term, raw)
  return readBuffer(term)
}

describe('PTY output rendering: native vs web terminal', () => {
  const COLS = 80
  const ROWS = 24

  it('simple echo output matches between convertEol true and false', async () => {
    const raw = await collectPtyOutput('bash', ['-c', 'echo "hello world"; echo "line two"'], COLS, ROWS)

    const native = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })
    const web = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })

    expect(web).toEqual(native)
  })

  it('formatted table output (printf aligned columns) matches', async () => {
    const script = `
      printf "%-20s %5s %10s\\n" "NAME" "SIZE" "DATE"
      printf "%-20s %5s %10s\\n" "file_one.txt" "1234" "Mar 23"
      printf "%-20s %5s %10s\\n" "another_file.md" "567" "Mar 22"
      printf "%-20s %5s %10s\\n" "README.md" "89012" "Mar 21"
    `
    const raw = await collectPtyOutput('bash', ['-c', script], COLS, ROWS)

    const native = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })
    const web = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })

    expect(web).toEqual(native)
  })

  it('content with tabs renders the same', async () => {
    const script = `printf "col1\\tcol2\\tcol3\\nA\\tBB\\tCCC\\n"`
    const raw = await collectPtyOutput('bash', ['-c', script], COLS, ROWS)

    const native = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })
    const web = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })

    expect(web).toEqual(native)
  })

  it('unicode box-drawing characters align correctly', async () => {
    const script = `
      echo "┌──────────┬──────────┐"
      echo "│  Header  │  Value   │"
      echo "├──────────┼──────────┤"
      echo "│  Row 1   │  Data 1  │"
      echo "└──────────┴──────────┘"
    `
    const raw = await collectPtyOutput('bash', ['-c', script], COLS, ROWS)

    const native = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })
    const web = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })

    expect(web).toEqual(native)
  })

  it('mixed Korean and ASCII text aligns correctly', async () => {
    const script = `
      echo "이름        나이  도시"
      echo "홍길동      25    서울"
      echo "John        30    Busan"
      echo "김영희      28    대전"
    `
    const raw = await collectPtyOutput('bash', ['-c', script], COLS, ROWS)

    const native = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })
    const web = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })

    expect(web).toEqual(native)
  })

  it('ANSI colored output with indentation matches', async () => {
    const script = `
      echo -e "\\033[1;36m## Summary\\033[0m"
      echo ""
      echo "  Here is some indented text with a code block:"
      echo ""
      echo -e "  \\033[48;5;236m  const x = 42;                    \\033[0m"
      echo -e "  \\033[48;5;236m  console.log(x);                  \\033[0m"
      echo ""
      echo -e "  - Bullet point one"
      echo -e "  - Bullet point two with \\033[1mbold text\\033[0m"
    `
    const raw = await collectPtyOutput('bash', ['-c', script], COLS, ROWS)

    const native = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })
    const web = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })

    expect(web).toEqual(native)
  })

  it('long lines that wrap at terminal width match', async () => {
    const script = `python3 -c "print('A' * 120)"`
    const raw = await collectPtyOutput('bash', ['-c', script], COLS, ROWS)

    const native = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })
    const web = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })

    expect(web).toEqual(native)
  })
})

describe('Raw escape sequence rendering: convertEol impact', () => {
  const COLS = 80
  const ROWS = 24

  it('bare \\n (without \\r) causes column drift with convertEol=false', async () => {
    // PTY 없이 bare \n 직접 주입 — convertEol 차이 확인
    const raw = 'AAA\nBBB\nCCC'

    const withEol = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })
    const withoutEol = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })

    console.log('convertEol=true:', JSON.stringify(withEol))
    console.log('convertEol=false:', JSON.stringify(withoutEol))

    // convertEol=true: 각 줄 column 0부터 시작 (AAA / BBB / CCC)
    // convertEol=false: \n은 줄만 바꾸고 column 유지 → BBB는 column 3부터
    expect(withoutEol).not.toEqual(withEol)
  })

  it('\\r\\n produces identical output regardless of convertEol', async () => {
    const raw = 'AAA\r\nBBB\r\nCCC'

    const withEol = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })
    const withoutEol = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })

    expect(withEol).toEqual(withoutEol)
  })

  it('cursor movement sequences (CSI) are not affected by convertEol', async () => {
    const raw = '\x1b[1;1Hfirst line\x1b[2;1Hsecond line\x1b[3;5Hindented'

    const withEol = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })
    const withoutEol = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })

    expect(withEol).toEqual(withoutEol)
  })

  it('PTY output always contains \\r\\n (not bare \\n)', async () => {
    const raw = await collectPtyOutput('bash', ['-c', 'printf "line1\\nline2\\nline3"'], COLS, ROWS)

    const bareNewlines: number[] = []
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\n' && (i === 0 || raw[i - 1] !== '\r')) {
        bareNewlines.push(i)
      }
    }

    console.log('Raw PTY output (escaped):', JSON.stringify(raw))
    console.log('Bare \\n positions:', bareNewlines)

    expect(bareNewlines).toEqual([])
  })

  it('screen session PTY output — check for bare \\n', async () => {
    const sessionName = `test-crlf-${Date.now()}`
    const { execSync } = await import('child_process')

    try {
      execSync(`screen -dmS ${sessionName}`, { timeout: 3000 })
      await new Promise(r => setTimeout(r, 500))
      execSync(`screen -S ${sessionName} -X stuff 'printf "aaa\\nbbb\\nccc"\n'`, { timeout: 3000 })
      await new Promise(r => setTimeout(r, 1000))

      const raw = await new Promise<string>((resolve) => {
        const chunks: string[] = []
        const proc = pty.spawn('screen', ['-x', sessionName], {
          name: 'xterm-256color',
          cols: COLS,
          rows: ROWS,
        })
        proc.onData((data) => chunks.push(data))
        setTimeout(() => {
          proc.kill()
          resolve(chunks.join(''))
        }, 2000)
      })

      const bareNewlines: number[] = []
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '\n' && (i === 0 || raw[i - 1] !== '\r')) {
          bareNewlines.push(i)
        }
      }

      console.log('Screen raw output length:', raw.length)
      console.log('Bare \\n count in screen output:', bareNewlines.length)

      if (bareNewlines.length > 0) {
        console.log('⚠ SCREEN SENDS BARE \\n — convertEol AFFECTS RENDERING')
      } else {
        console.log('✓ Screen always sends \\r\\n — convertEol has no effect')
      }

      const withEol = await feedToTerminal(raw, { convertEol: true, cols: COLS, rows: ROWS })
      const withoutEol = await feedToTerminal(raw, { convertEol: false, cols: COLS, rows: ROWS })

      console.log('Screen render match:', JSON.stringify(withEol) === JSON.stringify(withoutEol))
      expect(withEol).toEqual(withoutEol)
    } finally {
      try { execSync(`screen -S ${sessionName} -X quit`, { timeout: 3000 }) } catch {}
    }
  }, 10000)
})

describe('Screen attach: PTY size vs rendered output size', () => {
  /**
   * screen은 attach 시 이전 윈도우 크기의 버퍼를 먼저 덤프할 수 있다.
   * PTY를 올바른 크기로 spawn하고 즉시 resize(SIGWINCH)를 보내면
   * screen이 새 크기로 redraw하여, 최종 출력이 PTY 크기와 일치해야 한다.
   */

  it('attach 후 출력이 PTY cols에 맞게 렌더링된다 (이전 버퍼 크기가 아님)', async () => {
    const sessionName = `test-ptysize-${Date.now()}`
    const { execSync } = await import('child_process')
    const SMALL_COLS = 60
    const BIG_COLS = 120
    const ROWS = 24

    try {
      // 1. screen 세션 생성 (작은 크기로)
      execSync(`screen -dmUS ${sessionName}`, { timeout: 3000 })
      await new Promise(r => setTimeout(r, 500))

      // 2. 작은 PTY로 attach해서 screen 윈도우 크기를 60으로 설정
      await new Promise<void>((resolve) => {
        const proc = pty.spawn('screen', ['-xU', sessionName], {
          name: 'xterm-256color',
          cols: SMALL_COLS,
          rows: ROWS,
        })
        // 긴 문자열 출력 — 60열에서는 wrap됨
        setTimeout(() => {
          proc.write('printf "' + 'A'.repeat(100) + '\\n"\r')
          setTimeout(() => { proc.write('\x01d'); setTimeout(() => { proc.kill(); resolve() }, 500) }, 500)
        }, 800)
      })

      // 3. 큰 PTY로 re-attach — spawn 직후 resize(SIGWINCH) 포함
      const raw = await new Promise<string>((resolve) => {
        const chunks: string[] = []
        const proc = pty.spawn('screen', ['-xU', sessionName], {
          name: 'xterm-256color',
          cols: BIG_COLS,
          rows: ROWS,
        })
        // Force SIGWINCH (socket-handler.ts와 동일한 패턴)
        proc.resize(BIG_COLS, ROWS)
        proc.onData((data) => chunks.push(data))
        setTimeout(() => { proc.kill(); resolve(chunks.join('')) }, 2000)
      })

      // 4. xterm.js headless로 렌더링
      const term = new Terminal({
        cols: BIG_COLS,
        rows: ROWS,
        allowProposedApi: true,
      })
      await writeAsync(term, raw)
      const lines = readBuffer(term)
      term.dispose()

      // 5. 검증: 'A' 100개 줄이 120열 터미널에서는 한 줄에 들어가야 함
      //    (60열에서 attach했을 때의 wrap이 남아있으면 안 됨)
      const aLines = lines.filter(l => l.includes('A'.repeat(20)))
      console.log('A-lines:', aLines.map(l => `[${l.trimEnd().length}] ${l.trimEnd().substring(0, 40)}...`))

      // 100개의 A가 하나의 연속 라인에 있어야 함 (60열 wrap이 아닌)
      const hasFullLine = aLines.some(l => l.includes('A'.repeat(100)))
      expect(hasFullLine).toBe(true)
    } finally {
      try { execSync(`screen -S ${sessionName} -X quit`, { timeout: 3000 }) } catch {}
    }
  }, 15000)

  it('MUTATION: resize(SIGWINCH) 없이 attach하면 이전 크기 버퍼가 남을 수 있다', async () => {
    const sessionName = `test-nosigwinch-${Date.now()}`
    const { execSync } = await import('child_process')
    const SMALL_COLS = 60
    const BIG_COLS = 120
    const ROWS = 24

    try {
      execSync(`screen -dmUS ${sessionName}`, { timeout: 3000 })
      await new Promise(r => setTimeout(r, 500))

      // 작은 크기로 attach해서 윈도우 설정
      await new Promise<void>((resolve) => {
        const proc = pty.spawn('screen', ['-xU', sessionName], {
          name: 'xterm-256color',
          cols: SMALL_COLS,
          rows: ROWS,
        })
        setTimeout(() => {
          proc.write('printf "' + 'A'.repeat(100) + '\\n"\r')
          setTimeout(() => { proc.write('\x01d'); setTimeout(() => { proc.kill(); resolve() }, 500) }, 500)
        }, 800)
      })

      // 큰 PTY로 attach하되, resize(SIGWINCH)를 보내지 않음
      const raw = await new Promise<string>((resolve) => {
        const chunks: string[] = []
        const proc = pty.spawn('screen', ['-xU', sessionName], {
          name: 'xterm-256color',
          cols: BIG_COLS,
          rows: ROWS,
        })
        // NO resize() call — no SIGWINCH
        proc.onData((data) => chunks.push(data))
        setTimeout(() => { proc.kill(); resolve(chunks.join('')) }, 2000)
      })

      const term = new Terminal({
        cols: BIG_COLS,
        rows: ROWS,
        allowProposedApi: true,
      })
      await writeAsync(term, raw)
      const lines = readBuffer(term)
      term.dispose()

      const aLines = lines.filter(l => l.includes('A'.repeat(20)))
      console.log('MUTATION A-lines (no SIGWINCH):', aLines.map(l => `[${l.trimEnd().length}] ${l.trimEnd().substring(0, 40)}...`))

      // SIGWINCH 없이도 screen이 redraw할 수 있지만,
      // 최소한 이 테스트가 동작을 기록함
      const hasFullLine = aLines.some(l => l.includes('A'.repeat(100)))
      if (!hasFullLine) {
        console.log('✓ MUTATION detected: without SIGWINCH, old buffer layout persists')
      } else {
        console.log('  screen redrew anyway (may depend on screen version/timing)')
      }
    } finally {
      try { execSync(`screen -S ${sessionName} -X quit`, { timeout: 3000 }) } catch {}
    }
  }, 15000)
})
