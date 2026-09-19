#!/bin/sh
set -e

echo "[entrypoint] building site..."
python3 build.py

echo "[entrypoint] starting nginx..."
nginx -g 'daemon off;' &

echo "[entrypoint] starting file watcher..."
exec python3 watch.py
