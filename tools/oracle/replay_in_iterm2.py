#!/usr/bin/env python3
"""Replay a raw PTY byte file into a freshly-created iTerm2 window whose
session is exactly COLS x ROWS in size, then dump the resulting grid as JSON.

Key ideas
---------
1. We do NOT re-run the producer command. We take the exact bytes that were
   captured once (e.g. ``/tmp/claude-scenario.raw``) and inject them into
   iTerm2's parser. Both iTerm2 and @xterm/headless then see the *same* input,
   so any grid difference is a real parser disagreement — not producer
   non-determinism (streaming, timestamps, etc.).

2. ``Session.async_inject`` bypasses the PTY and the shell, so there is no
   prompt to strip afterwards. The grid reflects only the injected bytes.

3. A new iTerm2 window is created for each run via a ``LocalWriteOnlyProfile``
   with explicit ``Rows`` and ``Columns`` so the target size is exact without
   any pixel-frame math. The window stays open afterwards so the user can
   visually eyeball the result alongside the JSON dump.

Preconditions
-------------
* iTerm2 running, Python API enabled (see tools/oracle/README.md).

Usage
-----
    .venv/bin/python replay_in_iterm2.py RAW_BIN OUT_JSON COLS ROWS

Example
-------
    .venv/bin/python replay_in_iterm2.py \\
        /tmp/claude-scenario.raw /tmp/claude-scenario.iterm2.json 120 40
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import iterm2

_RAW: Path | None = None
_OUT: Path | None = None
_COLS: int = 0
_ROWS: int = 0


def load_raw_bytes(path: Path) -> bytes:
    """Load raw PTY bytes. Accepts either a raw binary file or a grid JSON
    dump produced by record-grid.ts (which stores bytes in a `rawBytes` field
    as a UTF-8 string)."""
    data = path.read_bytes()
    # Quick heuristic: JSON objects start with '{' (after optional BOM/WS).
    stripped = data.lstrip()
    if stripped.startswith(b"{"):
        try:
            obj = json.loads(data)
            if isinstance(obj, dict) and "rawBytes" in obj:
                return obj["rawBytes"].encode("utf-8")
        except json.JSONDecodeError:
            pass
    return data


async def main(connection: iterm2.Connection) -> None:
    assert _RAW is not None and _OUT is not None
    raw = load_raw_bytes(_RAW)

    # Use a long-lived command whose pty has `echo` disabled at the line
    # discipline level. This is critical: when the injected byte stream
    # contains terminal capability queries (XTVERSION, DA1, DA2), iTerm2
    # responds by writing bytes to the pty slave. With default pty echo
    # enabled, those response bytes get reflected back as "output the
    # program wrote" and iTerm2 renders them as visible text, contaminating
    # the grid. We therefore disable both `echo` and `icanon` (canonical
    # line mode) before blocking forever on `sleep`. `exec` replaces the
    # bash process so no extra shell is left hanging around.
    profile = iterm2.LocalWriteOnlyProfile()
    profile.set_use_custom_command("Yes")
    profile.set_command("/bin/bash -c 'stty -echo -icanon; exec sleep 99999'")

    window = await iterm2.Window.async_create(
        connection, profile_customizations=profile
    )
    if window is None:
        sys.exit("error: failed to create iTerm2 window")
    # Right after creation, `window.current_tab` may still be None because
    # the object tree hasn't refreshed; fetch the session directly from the
    # window's tab list, which is populated synchronously.
    if not window.tabs or not window.tabs[0].sessions:
        sys.exit("error: new window has no tabs/sessions")
    session = window.tabs[0].sessions[0]

    # Give iTerm2 a moment to finish laying out the new window, then resize
    # the session to the exact grid we need via the Python API.
    await asyncio.sleep(0.3)
    await session.async_set_grid_size(iterm2.util.Size(_COLS, _ROWS))
    await asyncio.sleep(0.3)

    cols = int(await session.async_get_variable("columns"))
    rows = int(await session.async_get_variable("rows"))
    if cols != _COLS or rows != _ROWS:
        sys.exit(
            f"error: session size after resize is {cols}x{rows}, "
            f"expected {_COLS}x{_ROWS}"
        )
    print(
        f"new iTerm2 window {cols}x{rows}; injecting {len(raw)} bytes",
        file=sys.stderr,
    )

    # RIS — full terminal reset so we start from a clean, mode-default state.
    await session.async_inject(b"\x1bc")
    await asyncio.sleep(0.2)

    # Inject the entire stream in a single async_inject call. Splitting into
    # smaller chunks has been observed to corrupt parser state at chunk
    # boundaries for some TUI streams (notably Claude Code's mass
    # \e[?2026h/l synchronized-output markers), causing spurious divergences
    # during cross-check. A single call preserves parser continuity.
    await session.async_inject(raw)
    # Let the parser settle.
    await asyncio.sleep(1.0)

    contents = await session.async_get_screen_contents()
    cursor = contents.cursor_coord
    lines = [contents.line(i).string for i in range(contents.number_of_lines)]

    out = {
        "source": "iterm2-inject",
        "cols": cols,
        "rows": rows,
        "cursor": {"x": cursor.x, "y": cursor.y},
        "lines": lines,
    }
    _OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {_OUT}: {len(lines)} lines", file=sys.stderr)
    print(
        "iTerm2 window left open so you can eyeball the rendered result.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit("usage: replay_in_iterm2.py RAW_BIN OUT_JSON COLS ROWS")
    _RAW = Path(sys.argv[1]).resolve()
    _OUT = Path(sys.argv[2]).resolve()
    _COLS = int(sys.argv[3])
    _ROWS = int(sys.argv[4])
    iterm2.run_until_complete(main)
