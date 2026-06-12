#!/bin/sh
# scripts/wait-for-it.sh
# Minimal TCP-wait helper — waits for a host:port to accept connections
# before running the given command.
#
# Usage: ./wait-for-it.sh host:port [-t timeout] -- command args...
#
# Example (docker-compose entrypoint override):
#   ./scripts/wait-for-it.sh postgres:5432 -t 60 -- npx prisma migrate deploy

set -e

HOSTPORT="$1"
shift

TIMEOUT=30

while [ "$1" != "--" ] && [ -n "$1" ]; do
  case "$1" in
    -t) TIMEOUT="$2"; shift 2 ;;
    *)  shift ;;
  esac
done
shift || true # consume --

HOST="${HOSTPORT%%:*}"
PORT="${HOSTPORT##*:}"

echo "Waiting for $HOST:$PORT (timeout ${TIMEOUT}s)..."

START_TS=$(date +%s)
while ! nc -z "$HOST" "$PORT" 2>/dev/null; do
  NOW_TS=$(date +%s)
  ELAPSED=$((NOW_TS - START_TS))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "Timed out waiting for $HOST:$PORT after ${TIMEOUT}s"
    exit 1
  fi
  sleep 1
done

echo "$HOST:$PORT is available — proceeding"
exec "$@"
