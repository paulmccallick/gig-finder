#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
api_port=${DEV_API_PORT:-3101}
api_pid=""
client_pid=""

stop() {
  status=${1:-0}
  trap - EXIT INT TERM
  [ -z "$api_pid" ] || kill "$api_pid" 2>/dev/null || true
  [ -z "$client_pid" ] || kill "$client_pid" 2>/dev/null || true
  [ -z "$api_pid" ] || wait "$api_pid" 2>/dev/null || true
  [ -z "$client_pid" ] || wait "$client_pid" 2>/dev/null || true
  exit "$status"
}

trap 'stop $?' EXIT
trap 'stop 130' INT
trap 'stop 143' TERM

cd "$repository_root"

AI_SDK_DEVTOOLS=${AI_SDK_DEVTOOLS:-true} PORT="$api_port" \
  bun --watch src/web/server.ts &
api_pid=$!

PORT="$api_port" \
  bun x vite --config src/web/vite.config.ts --host 127.0.0.1 &
client_pid=$!

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$client_pid" 2>/dev/null; do
  sleep 1
done

set +e
if ! kill -0 "$api_pid" 2>/dev/null; then
  wait "$api_pid"
  status=$?
else
  wait "$client_pid"
  status=$?
fi
set -e
stop "$status"
