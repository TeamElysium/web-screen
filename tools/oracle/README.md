# Terminal Oracle (Phase 0)

Goal: capture the visible grid of a PTY session as a baseline so we can later
verify that replayed or re-routed byte streams produce an *identical* final
screen — every character at every position. This is the foundation for
debugging the web-screen redraw pipeline without trusting any single parser as
the sole ground truth.

## Layout

```
tools/oracle/
  capture_iterm2.py     # iTerm2 side: dump current session's grid to JSON
  record-grid.ts        # @xterm/headless side: run a cmd, dump grid to JSON
  compare-grids.ts      # diff two grid JSONs (iTerm2 or xterm format)
  .venv/                # python venv with the `iterm2` package
src/lib/oracle.ts                          # core TS module (record/replay/diff)
src/__tests__/oracle-roundtrip.test.ts     # round-trip + mutation tests
```

## One-time setup

1. Install iTerm2: `brew install --cask iterm2` *(already done)*.
2. Launch iTerm2 once so it creates its preferences file.
3. Enable the Python API server:

       defaults write com.googlecode.iterm2 EnableAPIServer -bool true

   Then **⌘Q + reopen** iTerm2 (the flag is read at startup).
4. Verify iTerm2 → Settings → General → Magic → **Enable Python API** is on.
5. Python deps are in `./.venv` (installed via `python3 -m venv .venv && .venv/bin/pip install iterm2`).

## Automated self-check (vitest)

```bash
npx vitest run src/__tests__/oracle-roundtrip.test.ts
```

Seven tests. Two verify round-trip identity (streamed live grid equals a fresh
replay of the same bytes, and replay is deterministic across runs). Five are
**mutation tests** that intentionally corrupt the recorded byte stream (drop a
byte, truncate, append, substitute, wrong cols) and assert the diff catches it.

The mutation tests have themselves been verified by temporarily breaking
`diffGrids` to always return `{equal: true}`: in that state, all five mutation
tests fail and the two identity tests still pass — confirming each assertion
is load-bearing.

## Cross-check against iTerm2 (the "am I chasing a parser bug?" gate)

Because the vitest tests compare @xterm/headless against itself, they are
self-referential: a parser bug that is consistent with itself would pass.
To break that loop, cross-check against iTerm2 — the terminal the user
actually uses.

### Workflow

Pick a short, deterministic command (something that exits cleanly and leaves
a stable screen). Example: `bash -c 'printf "\x1b[2J\x1b[H"; echo hi; printf "\x1b[5;10Hanchor"; printf "\x1b[10;1HDONE"'`.

1. **xterm/headless side** — record + dump:

       npx tsx tools/oracle/record-grid.ts 80 24 /tmp/xterm.json -- \
         bash -c 'printf "\x1b[2J\x1b[H"; echo hi; printf "\x1b[5;10Hanchor"; printf "\x1b[10;1HDONE"'

2. **iTerm2 side** — in an iTerm2 tab of the **same cols/rows** (80×24), run
   exactly the same command manually. Leave the tab focused.

3. **Capture iTerm2's grid** (from any terminal):

       ./tools/oracle/.venv/bin/python tools/oracle/capture_iterm2.py /tmp/iterm2.json

   First run: click **Allow** on the iTerm2 auth dialog.

4. **Diff**:

       npx tsx tools/oracle/compare-grids.ts /tmp/iterm2.json /tmp/xterm.json

   - `OK` → both parsers agree on this stream ⇒ @xterm/headless is a
     trustworthy oracle for this class of output.
   - `DIFF` → there is a real parser disagreement. The diff lines show which
     row/column disagree and what each side has. This points to either an
     @xterm/headless bug or an edge case (wide-char, pending wrap, BCE) worth
     isolating.

### Notes on comparison caveats

- **Shell prompt**: if you launch the command under an interactive iTerm2
  shell, the final grid will include the prompt redraw after command exit.
  The node-pty recording side exits with the command and has no prompt.
  Either run the command as the shell's only work (e.g. open iTerm2 with
  `iTerm → New Tab → hand-type` only this command) or ignore rows clearly
  belonging to the shell in the diff output.
- **Size match**: both sides MUST use the same `cols × rows`. iTerm2 shows
  its current size in the tab title; pass the same numbers to `record-grid.ts`.
- **Cursor**: after a command exits, the shell repositions the cursor. Cursor
  diffs are usually expected in this workflow; focus on line content.

## What this gives us

A **three-layer** oracle trust structure:

1. **Self-consistency** (vitest, auto): proves the parser is deterministic and
   the diff function is tight.
2. **Cross-parser** (manual, iTerm2 vs @xterm/headless): proves the parser
   agrees with a real terminal the user actually uses — breaks the
   self-reference loop.
3. (future) **Third parser** (libvterm/pyte): only needed if cross-parser
   disagreements show up and we need a tiebreaker.

Once layer 2 is green on representative Claude Code TUI recordings, we can
use `replayBytes` + `diffGrids` as a regression oracle for the web-screen
pipeline: feed the same `raw.bin` through the production socket path, re-parse
what the client would see, and assert grid equality against the baseline.

## Production pipeline test (env-gated)

`src/__tests__/oracle-pipeline.test.ts` runs the *full* web-screen server
path against `/tmp/claude-scenario.raw`: it spawns a real `screen` session
that `cat`s the recording, attaches to it via the production `socket-handler`
code path (cols-1 + resize-to-real SIGWINCH trick, setImmediate output
buffering), collects every `terminal:output` the client would receive, and
replays those bytes through @xterm/headless. The resulting grid is compared
to the @xterm/headless baseline from the raw bytes themselves.

This test is **skipped by default** — it is currently KNOWN-FAILING and
documents a real fidelity loss (~89% byte drop, row merging, spinner
leakage) in the production pipeline. Run it locally to reproduce the
current gap or to verify a fix:

    ORACLE_RUN_PIPELINE=1 npx vitest run src/__tests__/oracle-pipeline.test.ts

Requires `/tmp/claude-scenario.raw` to exist — produce it by running
`tools/oracle/scenarios/claude-multiturn.ts` first.
