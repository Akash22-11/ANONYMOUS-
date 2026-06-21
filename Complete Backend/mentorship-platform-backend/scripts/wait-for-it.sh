#!/bin/sh
set -e

usage() {
  echo "Usage: $0 host:port [-t timeout] [-- command [args...]]" >&2
  exit 1
}

[ $# -ge 1 ] || usage
HOSTPORT="$1"
shift
TIMEOUT=30

while [ -n "$1" ] && [ "$1" != "--" ]; do
  case "$1" in
    -t)
      [ -n "$2" ] || usage
      TIMEOUT="$2"
      shift 2
      ;;
    *) shift ;;
  esac
done
shift || true

case "$TIMEOUT" in
  ''|*[!0-9]*) echo "Invalid timeout: $TIMEOUT" >&2; exit 1 ;;
esac

command -v nc >/dev/null 2>&1 || { echo "nc not found" >&2; exit 1; }

case "$HOSTPORT" in
  *:*) ;;
  *) echo "Expected host:port, got '$HOSTPORT'" >&2; exit 1 ;;
esac

HOST="${HOSTPORT%%:*}"
PORT="${HOSTPORT##*:}"

echo "Waiting for $HOST:$PORT (timeout ${TIMEOUT}s)..."
START_TS=$(date +%s)
while ! nc -z -w 1 "$HOST" "$PORT" 2>/dev/null; do
  NOW_TS=$(date +%s)
  ELAPSED=$((NOW_TS - START_TS))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "Timed out waiting for $HOST:$PORT after ${TIMEOUT}s"
    exit 1
  fi
  sleep 1
done

echo "$HOST:$PORT is available - proceeding"
exec "$@"
