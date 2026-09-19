#!/usr/bin/env python3
"""
Watches the project for changes and rebuilds the site automatically.

Runs alongside nginx inside the container. Watches everything under the
project root EXCEPT dist/ (the build output itself — watching it would
cause an infinite rebuild loop) and a couple of housekeeping folders.

Uses a POLLING observer rather than the OS-event (inotify) observer.
Inotify events don't reliably cross the bind-mount boundary on Docker
Desktop for Windows/Mac (the change happens on the host filesystem, and
the container never gets told about it), so we check the filesystem
directly every POLL_INTERVAL seconds instead. Slightly more CPU than
pure event-watching, but it's negligible for a project this size and it
works everywhere, on every platform, with no configuration.
"""

import os
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers.polling import PollingObserver

from build import build, ROOT

IGNORE_PREFIXES = ("dist", ".git", "__pycache__")
DEBOUNCE_SECONDS = 0.6
POLL_INTERVAL = float(os.environ.get("WATCH_POLL_INTERVAL", "1.5"))


def is_ignored(path: Path) -> bool:
    try:
        rel = path.relative_to(ROOT)
    except ValueError:
        return True
    return rel.parts and rel.parts[0] in IGNORE_PREFIXES


class RebuildHandler(FileSystemEventHandler):
    def __init__(self):
        self._last_triggered = 0.0

    def on_any_event(self, event):
        if event.is_directory:
            # A directory's mtime changes whenever anything inside it
            # changes — including dist/ being rewritten by our own build,
            # which would otherwise make the watcher trigger itself
            # forever. Only real file events matter here.
            return

        path = Path(event.src_path)
        if is_ignored(path):
            return

        now = time.time()
        # Coalesce the burst of events a single save can generate
        # (temp file, write, rename, etc.) into one rebuild.
        if now - self._last_triggered < DEBOUNCE_SECONDS:
            return
        self._last_triggered = now

        time.sleep(0.2)  # let the editor finish writing before we read
        try:
            build()
            print(f"[watch] rebuilt after change: {path.relative_to(ROOT)}", flush=True)
        except Exception as e:
            print(f"[watch] build failed: {e}", flush=True)


def main():
    observer = PollingObserver(timeout=POLL_INTERVAL)
    observer.schedule(RebuildHandler(), str(ROOT), recursive=True)
    observer.start()
    print(f"[watch] watching for changes under {ROOT} (polling every {POLL_INTERVAL}s)", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
