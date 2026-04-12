import { describe, it, expect, beforeAll } from 'vitest'
import {
  recordPtyCommand,
  replayBytes,
  diffGrids,
  type Grid,
} from '@/lib/oracle'

/**
 * Phase 0 oracle harness.
 *
 *  1. Round-trip identity:
 *     Record a synthetic TUI producer's PTY output while streaming it through
 *     an xterm.js headless instance (liveGrid). Replay the same raw bytes into
 *     a fresh instance (replayGrid). The two grids must be identical — this is
 *     the baseline sanity gate.
 *
 *  2. Mutation: corruptions of the recorded byte stream must produce grids
 *     that DIFFER from the baseline. If a mutation is undetected, the diff
 *     function is not tight enough and the whole harness is untrustworthy.
 *
 * The synthetic producer is deliberately "GUI-ish": it uses absolute cursor
 * positioning (CUP), in-place overwrites, SGR, CJK, and clear-screen — the
 * same categories Claude Code's TUI emits.
 */

const COLS = 80
const ROWS = 24

// bash -c script: CJK + SGR + cursor moves + in-place overwrites + alt screen.
// Kept short so the recording finishes well under the timeout.
const SYNTHETIC = [
  `printf '\\x1b[2J\\x1b[H'`, // ED2 + cursor home
  `printf 'alpha\\r\\n'`,
  `printf 'bravo with \\x1b[1;31mred\\x1b[0m bits\\r\\n'`,
  `printf '한글 테스트 ─┬─ box\\r\\n'`,
  `printf '\\x1b[6;1HOVERWRITTEN'`, // CUP 6,1
  `printf '\\x1b[6;1Hoverwrit3n!!'`, // overwrite same region
  `printf '\\x1b[10;20Hanchor'`, // CUP 10,20
  `printf '\\x1b[12;1H\\x1b[KDONE'`, // CUP 12,1 + EL + text
].join('; ')

async function record(): Promise<{ bytes: string; grid: Grid }> {
  const rec = await recordPtyCommand('bash', ['-c', SYNTHETIC], {
    cols: COLS,
    rows: ROWS,
    timeoutMs: 5000,
  })
  return { bytes: rec.bytes, grid: rec.liveGrid }
}

describe('oracle: record → replay round-trip', () => {
  it('liveGrid equals replayGrid (recording is complete)', async () => {
    const { bytes, grid } = await record()
    const replay = await replayBytes(bytes, { cols: COLS, rows: ROWS })
    const diff = diffGrids(grid, replay)
    if (!diff.equal) {
      console.error('round-trip diffs:\n' + diff.reasons.join('\n'))
    }
    expect(diff.equal).toBe(true)
  })

  it('replay is deterministic — two replays of the same bytes match', async () => {
    const { bytes } = await record()
    const a = await replayBytes(bytes, { cols: COLS, rows: ROWS })
    const b = await replayBytes(bytes, { cols: COLS, rows: ROWS })
    expect(diffGrids(a, b).equal).toBe(true)
  })
})

describe('oracle: mutation tests — diff must catch byte-stream corruption', () => {
  let baselineBytes: string
  let baselineGrid: Grid

  beforeAll(async () => {
    const r = await record()
    baselineBytes = r.bytes
    baselineGrid = r.grid
  })

  it('dropping a printable byte in the middle is detected', async () => {
    // Find a plain-ASCII printable byte to drop (avoid escape sequences)
    let dropIdx = -1
    for (let i = Math.floor(baselineBytes.length / 2); i < baselineBytes.length; i++) {
      const c = baselineBytes.charCodeAt(i)
      if (c >= 0x20 && c < 0x7f && baselineBytes[i] !== '\x1b') {
        dropIdx = i
        break
      }
    }
    expect(dropIdx).toBeGreaterThanOrEqual(0)
    const mutated = baselineBytes.slice(0, dropIdx) + baselineBytes.slice(dropIdx + 1)
    const grid = await replayBytes(mutated, { cols: COLS, rows: ROWS })
    const diff = diffGrids(baselineGrid, grid)
    if (diff.equal) {
      console.error(
        `dropped byte at ${dropIdx} (${JSON.stringify(baselineBytes[dropIdx])}) went undetected`,
      )
    }
    expect(diff.equal).toBe(false)
  })

  it('truncating the stream at 80% is detected', async () => {
    const mutated = baselineBytes.slice(0, Math.floor(baselineBytes.length * 0.8))
    const grid = await replayBytes(mutated, { cols: COLS, rows: ROWS })
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('appending a printable byte is detected', async () => {
    const mutated = baselineBytes + 'X'
    const grid = await replayBytes(mutated, { cols: COLS, rows: ROWS })
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })

  it('replacing "anchor" with "ANCHOR" produces exactly that diff', async () => {
    const idx = baselineBytes.indexOf('anchor')
    expect(idx).toBeGreaterThan(-1)
    const mutated =
      baselineBytes.slice(0, idx) + 'ANCHOR' + baselineBytes.slice(idx + 6)
    const grid = await replayBytes(mutated, { cols: COLS, rows: ROWS })
    const diff = diffGrids(baselineGrid, grid)
    expect(diff.equal).toBe(false)
    // The diff should mention line 9 (CUP 10,20 → zero-based row 9)
    expect(diff.reasons.some((r) => r.includes('line 9'))).toBe(true)
  })

  it('wrong terminal cols produces a different grid', async () => {
    const grid = await replayBytes(baselineBytes, { cols: 60, rows: ROWS })
    expect(diffGrids(baselineGrid, grid).equal).toBe(false)
  })
})
