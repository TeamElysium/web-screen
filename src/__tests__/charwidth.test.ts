import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import * as pty from 'node-pty'

/**
 * Unicode 문자 너비(wcwidth) 비교 테스트
 *
 * screen/PTY의 wcwidth와 xterm.js의 wcwidth가 다르면,
 * 같은 줄이라도 커서 위치가 달라져서 정렬이 틀어진다.
 *
 * 방법: 같은 문자를 PTY(bash의 wcwidth) + xterm.js headless에 각각 먹여서
 * 커서 위치를 비교한다.
 */

function writeAsync(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

/** xterm.js headless에서 문자가 차지하는 셀 수 */
async function xtermCharWidth(char: string): Promise<number> {
  const term = new Terminal({ cols: 80, rows: 10, allowProposedApi: true })
  await writeAsync(term, char)
  const width = term.buffer.active.cursorX
  term.dispose()
  return width
}

/** PTY를 통해 문자가 차지하는 셀 수 측정 (xterm headless로 PTY 출력을 캡처) */
async function ptyCharWidth(char: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // printf로 문자를 출력 → PTY driver가 wcwidth 기반으로 커서 이동
    // xterm headless에서 PTY 출력을 받아 커서 위치 확인
    const term = new Terminal({ cols: 80, rows: 10, allowProposedApi: true })

    const proc = pty.spawn('bash', ['-c', `printf '%s' '${char}'`], {
      name: 'xterm-256color',
      cols: 80,
      rows: 10,
    })

    let allData = ''
    proc.onData((data) => {
      allData += data
    })

    proc.onExit(() => {
      const writeAndRead = async () => {
        await writeAsync(term, allData)
        // bash prompt 등 잡음 없이 문자의 커서 위치만 읽기
        // PTY 출력에는 bash prompt + 문자가 포함될 수 있으므로
        // 문자 직후의 커서 X 위치를 읽는다
        const width = term.buffer.active.cursorX
        term.dispose()
        resolve(width)
      }
      writeAndRead().catch(reject)
    })

    setTimeout(() => {
      proc.kill()
      reject(new Error('PTY timeout'))
    }, 3000)
  })
}

// Claude CLI에서 indent/정렬에 사용될 수 있는 문자들
const CHARS_TO_TEST = [
  // Ambiguous width 문자 — screen과 xterm.js가 다를 가능성 높음
  { char: '→', name: 'RIGHTWARDS ARROW', code: 'U+2192' },
  { char: '⏺', name: 'BLACK CIRCLE FOR RECORD', code: 'U+23FA' },
  { char: '❯', name: 'HEAVY RIGHT-POINTING ANGLE', code: 'U+276F' },
  { char: '─', name: 'BOX HORIZONTAL', code: 'U+2500' },
  { char: '│', name: 'BOX VERTICAL', code: 'U+2502' },
  { char: '•', name: 'BULLET', code: 'U+2022' },
  { char: '✓', name: 'CHECK MARK', code: 'U+2713' },
  { char: '⚠', name: 'WARNING SIGN', code: 'U+26A0' },

  // 특수 공백 문자 — indent에 사용될 수 있음
  { char: '\u00A0', name: 'NO-BREAK SPACE', code: 'U+00A0' },
  { char: '\u2002', name: 'EN SPACE', code: 'U+2002' },
  { char: '\u2003', name: 'EM SPACE', code: 'U+2003' },
  { char: '\u2007', name: 'FIGURE SPACE', code: 'U+2007' },
  { char: '\u2009', name: 'THIN SPACE', code: 'U+2009' },
  { char: '\u200B', name: 'ZERO-WIDTH SPACE', code: 'U+200B' },
  { char: '\u3000', name: 'IDEOGRAPHIC SPACE (전각 공백)', code: 'U+3000' },

  // 기본 참조 문자
  { char: '한', name: 'KOREAN (한)', code: 'U+D55C' },
  { char: 'A', name: 'ASCII A', code: 'U+0041' },
  { char: ' ', name: 'REGULAR SPACE', code: 'U+0020' },
]

describe('Character width: xterm.js vs PTY (wcwidth)', () => {
  for (const { char, name, code } of CHARS_TO_TEST) {
    it(`${code} ${name}: xterm.js width matches PTY width`, async () => {
      const xtermWidth = await xtermCharWidth(char)
      const ptyWidth = await ptyCharWidth(char)

      console.log(`${code} '${char.replace(/\s/, '·')}' (${name}): xterm=${xtermWidth}, pty=${ptyWidth}`)

      if (xtermWidth !== ptyWidth) {
        console.log(`  ⚠ WIDTH MISMATCH! xterm=${xtermWidth} cells, pty=${ptyWidth} cells`)
        console.log(`  → ${Math.abs(xtermWidth - ptyWidth)} cell(s) of drift per occurrence`)
      }

      expect(xtermWidth, `${name} width mismatch: xterm=${xtermWidth}, pty=${ptyWidth}`).toBe(ptyWidth)
    })
  }
})
