#!/usr/bin/env tsx
/**
 * Pipeline fidelity probe.
 *
 * Runs the production pipeline test against /tmp/claude-scenario.raw under
 * several configurations to narrow down the root cause of the ~89% byte
 * drop + row merging + spinner leakage surfaced by oracle-pipeline.test.ts.
 *
 * Variables explored:
 *   - screen scrollback: default (100) vs 5000
 *   - cols-1 + resize trick: enabled vs disabled (spawn at real cols)
 *   - \e[?2026h/l synchronized output sequences: kept vs stripped before cat
 *   - session pre-sized to COLS x ROWS before cat: yes vs no
 *
 * Findings (2026-04-12, running against /tmp/claude-scenario.raw):
 *
 *   All seven tested configurations report EXACTLY 33 diff rows against the
 *   @xterm/headless baseline. Byte counts vary (3536 with cols1 off, 6217
 *   with cols1 on — the latter emits two redraws) but the diff row count is
 *   stable. None of the variables above closes the gap.
 *
 *   Direct inspection of the bytes screen emits on attach shows cursor-
 *   forward positioning (CUF) into cells that already hold ghost content
 *   from Claude's intermediate streaming frames — specifically the
 *   "Metamorphosing… (thinking)" and "Proofing…" spinner text and "Tip:"
 *   help panels that should have been overdrawn by later frames. This is
 *   screen's own internal buffer state being faithfully re-emitted; the
 *   corruption happens at byte *consumption* time, not re-emission time.
 *
 *   In contrast, @xterm/headless and iTerm2 both produce the clean final
 *   state (verified in Phase 1 cross-check, 40/40 rows identical). That
 *   isolates the divergence to *screen's* VT parser differing from
 *   xterm.js / iTerm2 on some aspect of Claude's streaming pattern
 *   (likely CUF-positioned overwrites of wide-char or multi-byte text,
 *   where screen's cell model leaves gaps that xterm/iTerm do not).
 *
 *   Practical consequence: the web-screen redraw gap on Claude Code is
 *   inherent to screen, not to socket-handler's buffering or the cols-1
 *   SIGWINCH trick. Fixing it either requires (a) patching screen, (b)
 *   replacing screen with a multiplexer that fully supports xterm sync
 *   mode and Claude's cell update pattern (e.g. tmux 3.4+), or (c)
 *   accepting it as a known limitation and documenting it.
 *
 * For each configuration the probe:
 *   1. spins up a fresh screen session with the chosen settings
 *   2. cats (optionally-stripped) raw bytes into the session
 *   3. attaches via node-pty directly (bypassing socket-handler so we can
 *      choose whether to apply the cols-1 trick)
 *   4. collects all onData output until idle
 *   5. replays those bytes through @xterm/headless
 *   6. diffs against the @xterm/headless baseline (raw -> grid directly)
 *   7. reports byte count and diff row count
 *
 * Usage:
 *   npx tsx tools/oracle/scenarios/pipeline-probe.ts
 *
 * Requires /tmp/claude-scenario.raw (from claude-multiturn.ts).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { spawn as ptySpawn } from 'node-pty'
import { replayBytes, diffGrids, type Grid } from '../../../src/lib/oracle'

const RAW_PATH = '/tmp/claude-scenario.raw'
const COLS = 120
const ROWS = 40
const IDLE_MS = 1500
const MAX_MS = 10_000

if (!existsSync(RAW_PATH)) {
  console.error(`missing ${RAW_PATH} — run claude-multiturn.ts first`)
  process.exit(2)
}

interface Config {
  name: string
  scrollback: number | null // null = screen default
  cols1Trick: boolean
  stripSyncMode: boolean
  presizeSession: boolean   // set screen window size to COLSxROWS before cat
}

const CONFIGS: Config[] = [
  { name: 'A baseline',                    scrollback: null, cols1Trick: true,  stripSyncMode: false, presizeSession: false },
  { name: 'B scrollback 5000',             scrollback: 5000, cols1Trick: true,  stripSyncMode: false, presizeSession: false },
  { name: 'C cols1 off',                   scrollback: null, cols1Trick: false, stripSyncMode: false, presizeSession: false },
  { name: 'D strip sync mode',             scrollback: null, cols1Trick: true,  stripSyncMode: true,  presizeSession: false },
  { name: 'F presize session 120x40',      scrollback: null, cols1Trick: true,  stripSyncMode: false, presizeSession: true  },
  { name: 'G presize + scrollback 5000',   scrollback: 5000, cols1Trick: true,  stripSyncMode: false, presizeSession: true  },
  { name: 'H presize + all three',         scrollback: 5000, cols1Trick: false, stripSyncMode: true,  presizeSession: true  },
]

function stripSync(bytes: string): string {
  return bytes.replace(/\x1b\[\?2026[hl]/g, '')
}

async function collectUntilIdle(
  onData: (cb: (d: string) => void) => void,
  idleMs: number,
  maxMs: number,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: string[] = []
    let lastAt = Date.now()
    onData((d) => {
      chunks.push(d)
      lastAt = Date.now()
    })
    const start = Date.now()
    const tick = () => {
      const idle = Date.now() - lastAt
      if (idle >= idleMs || Date.now() - start >= maxMs) {
        resolve(chunks.join(''))
      } else {
        setTimeout(tick, 100)
      }
    }
    setTimeout(tick, 100)
  })
}

async function runPipeline(
  sessionName: string,
  cfg: Config,
): Promise<{ bytes: string; grid: Grid }> {
  const initCols = cfg.cols1Trick ? COLS - 1 : COLS
  const proc = ptySpawn('screen', ['-xU', sessionName], {
    name: 'xterm-256color',
    cols: initCols,
    rows: ROWS,
    cwd: process.env.HOME,
  })
  if (cfg.cols1Trick) {
    setTimeout(() => {
      try { proc.resize(COLS, ROWS) } catch { /* ignore */ }
    }, 80)
  }
  const bytes = await collectUntilIdle((cb) => proc.onData(cb), IDLE_MS, MAX_MS)
  try { proc.kill() } catch { /* ignore */ }
  const grid = await replayBytes(bytes, { cols: COLS, rows: ROWS })
  return { bytes, grid }
}

function setupSession(
  sessionName: string,
  cfg: Config,
  rawFile: string,
): void {
  // Create a detached session whose first window runs a bash that cats the
  // recording and then blocks on sleep so the session stays attachable.
  // This mirrors the oracle-pipeline.test.ts fixture and ensures the cat
  // actually executes (shell-level, not via `stuff`).
  execSync(
    `screen -dmUS ${sessionName} bash -c 'cat ${rawFile}; exec sleep 99999'`,
    { timeout: 3000 },
  )
  if (cfg.scrollback !== null) {
    execSync(
      `screen -S ${sessionName} -X scrollback ${cfg.scrollback}`,
      { timeout: 3000 },
    )
  }
  if (cfg.presizeSession) {
    execSync(
      `screen -S ${sessionName} -X width ${COLS} ${ROWS}`,
      { timeout: 3000 },
    )
  }
}

function killSession(sessionName: string): void {
  try {
    execSync(`screen -S ${sessionName} -X quit 2>&1`, { timeout: 3000 })
  } catch { /* ignore */ }
}

async function main(): Promise<void> {
  const rawOriginal = readFileSync(RAW_PATH, 'utf8')
  console.log(`raw bytes: ${rawOriginal.length}`)
  const baseline = await replayBytes(rawOriginal, { cols: COLS, rows: ROWS })
  console.log(
    `baseline: ${baseline.cols}x${baseline.rows}, cursor (${baseline.cursor.x}, ${baseline.cursor.y})`,
  )

  const results: Array<{
    name: string
    socketBytes: number
    diffRows: number
    firstDiff: string
  }> = []

  // Prepare raw files (stripped / not)
  const strippedPath = '/tmp/claude-scenario.stripped.raw'
  writeFileSync(strippedPath, stripSync(rawOriginal), 'utf8')

  for (const cfg of CONFIGS) {
    const sessionName = `wst_probe_${Date.now()}_${cfg.name.split(' ')[0]}`
    const rawFile = cfg.stripSyncMode ? strippedPath : RAW_PATH

    console.error(`\n=== ${cfg.name} ===`)
    console.error(
      `  scrollback=${cfg.scrollback ?? 'default'}, ` +
        `cols1Trick=${cfg.cols1Trick}, strip=${cfg.stripSyncMode}`,
    )
    try {
      setupSession(sessionName, cfg, rawFile)
      // Let cat finish and screen absorb it.
      await new Promise((r) => setTimeout(r, 1500))

      // Dump screen's internal visible buffer via hardcopy to see what
      // screen ACTUALLY has before we attach. This is the independent
      // reference for "what screen thinks the final state is".
      const hcPath = `/tmp/probe.hardcopy.${cfg.name.split(' ')[0]}.txt`
      try {
        execSync(`screen -S ${sessionName} -X hardcopy ${hcPath}`, { timeout: 3000 })
        const hc = readFileSync(hcPath, 'utf8')
        const nonEmpty = hc.split('\n').filter((l) => l.trim() !== '').length
        console.error(`  hardcopy: ${hc.length} bytes, ${nonEmpty} non-empty lines`)
      } catch (e) {
        console.error(`  hardcopy failed: ${e}`)
      }

      const { bytes, grid } = await runPipeline(sessionName, cfg)
      const diff = diffGrids(baseline, grid)
      const diffRows = diff.reasons.filter((r) => r.startsWith('line ')).length

      // Save both grids side-by-side for inspection on the first config
      if (cfg.name.startsWith('A ')) {
        const lines: string[] = []
        lines.push(`BASELINE (xterm/headless replay of raw ${RAW_PATH})`)
        lines.push('+' + '-'.repeat(COLS) + '+')
        for (const l of baseline.lines) lines.push('|' + l + '|')
        lines.push('+' + '-'.repeat(COLS) + '+')
        lines.push('')
        lines.push(`PIPELINE (screen + node-pty attach, config: ${cfg.name})`)
        lines.push('+' + '-'.repeat(COLS) + '+')
        for (const l of grid.lines) lines.push('|' + l + '|')
        lines.push('+' + '-'.repeat(COLS) + '+')
        writeFileSync('/tmp/probe.side-by-side.txt', lines.join('\n'), 'utf8')
        console.error(`  side-by-side -> /tmp/probe.side-by-side.txt`)
      }

      let firstDiff = ''
      for (const r of diff.reasons) {
        if (r.startsWith('line ')) {
          firstDiff = r.split('\n')[0]
          break
        }
      }
      results.push({
        name: cfg.name,
        socketBytes: bytes.length,
        diffRows,
        firstDiff,
      })
      console.error(
        `  bytes=${bytes.length}, diffRows=${diffRows}, cursor ` +
          `(${grid.cursor.x},${grid.cursor.y})`,
      )
      if (firstDiff) console.error(`  first diff: ${firstDiff.slice(0, 100)}`)
    } finally {
      killSession(sessionName)
    }
  }

  try { unlinkSync(strippedPath) } catch { /* ignore */ }

  console.log('\n=== results matrix ===')
  console.log('cfg                                               | bytes | diffRows')
  console.log('--------------------------------------------------+-------+---------')
  for (const r of results) {
    console.log(
      `${r.name.padEnd(50)}| ${String(r.socketBytes).padStart(5)} | ${String(r.diffRows).padStart(7)}`,
    )
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
