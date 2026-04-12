#!/usr/bin/env python3
"""Capture the visible grid of the current iTerm2 session to a JSON file.

Usage:
    ./.venv/bin/python capture_iterm2.py OUTPUT.json

Preconditions:
    1. iTerm2 Python API enabled
       (Preferences > General > Magic > Enable Python API).
    2. iTerm2 has at least one open window/tab/session.
    3. On first run iTerm2 will show an auth dialog — click "Allow".

Output JSON:
    {
      "session_id": str,
      "cols": int,
      "rows": int,
      "cursor": {"x": int, "y": int},
      "lines": [str, ...]   # visible rows, length == number_of_lines
    }
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import iterm2

_OUT_PATH: Path | None = None


async def main(connection: iterm2.Connection) -> None:
    assert _OUT_PATH is not None
    app = await iterm2.async_get_app(connection)
    if app is None:
        sys.exit("error: iTerm2 app not available")
    window = app.current_terminal_window
    if window is None:
        sys.exit("error: no current iTerm2 window")
    session = window.current_tab.current_session
    if session is None:
        sys.exit("error: no current iTerm2 session")

    cols = await session.async_get_variable("columns")
    rows = await session.async_get_variable("rows")
    contents = await session.async_get_screen_contents()
    cursor = contents.cursor_coord

    lines = [contents.line(i).string for i in range(contents.number_of_lines)]

    result = {
        "session_id": session.session_id,
        "cols": cols,
        "rows": rows,
        "cursor": {"x": cursor.x, "y": cursor.y},
        "lines": lines,
    }
    _OUT_PATH.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"captured {contents.number_of_lines} lines "
        f"(grid {cols}x{rows}) -> {_OUT_PATH}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: capture_iterm2.py OUTPUT.json")
    _OUT_PATH = Path(sys.argv[1]).resolve()
    iterm2.run_until_complete(main)
