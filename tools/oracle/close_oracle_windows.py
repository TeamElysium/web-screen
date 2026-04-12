#!/usr/bin/env python3
"""Close all iTerm2 windows that were created by replay_in_iterm2.py.

Our replay script launches a bash shell running `stty -echo -icanon; exec
sleep 99999` as the session's foreground program. We identify our windows by
finding sessions whose foreground command name contains "sleep", and close
only those windows. This avoids touching the user's other iTerm2 windows.
"""
from __future__ import annotations

import asyncio
import sys

import iterm2


async def main(connection: iterm2.Connection) -> None:
    app = await iterm2.async_get_app(connection)
    if app is None:
        sys.exit("error: iTerm2 app not available")

    closed = 0
    inspected = 0
    for window in list(app.windows):
        inspected += 1
        # Consider the window an "oracle window" if any session in it is
        # running sleep as its foreground command.
        is_oracle = False
        for tab in window.tabs:
            for session in tab.sessions:
                try:
                    cmd = await session.async_get_variable("jobName")
                except Exception:
                    cmd = None
                if isinstance(cmd, str) and cmd.strip() in ("sleep", "bash"):
                    is_oracle = True
                    break
            if is_oracle:
                break
        if is_oracle:
            try:
                await window.async_close(force=True)
                closed += 1
            except Exception as e:
                print(f"warn: failed to close window: {e}", file=sys.stderr)
    print(
        f"inspected {inspected} windows, closed {closed} oracle windows",
        file=sys.stderr,
    )


if __name__ == "__main__":
    iterm2.run_until_complete(main)
