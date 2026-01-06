#!/usr/bin/env bash
# Kill processes bound to a set of TCP ports to avoid conflicts with pre-existing dev services.

set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
cd "$script_dir"

default_ports=(8890 8001 8005 8006)

if [ "$#" -gt 0 ]; then
  ports=("$@")
else
  ports=("${default_ports[@]}")
fi

for port in "${ports[@]}"; do
  if ! [[ "$port" =~ ^[0-9]+$ ]]; then
    echo "Skipping invalid port: $port" >&2
    continue
  fi

  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)

  if [ -z "$pids" ]; then
    echo "No process detected on port $port"
    continue
  fi

  echo "Terminating processes on port $port: $pids"
  # Attempt graceful termination first.
  kill $pids 2>/dev/null || true
  sleep 1

  # Force kill any remaining processes still attached to the port.
  remaining=()
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      remaining+=("$pid")
    fi
  done

  if [ "${#remaining[@]}" -gt 0 ]; then
    echo "Force killing lingering processes on port $port: ${remaining[*]}"
    kill -9 "${remaining[@]}" 2>/dev/null || true
  fi

done
