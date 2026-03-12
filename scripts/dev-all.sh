#!/usr/bin/env bash
# dev-all.sh — Start all three services (Edda, Karvi, Thyra) for local development.
# Usage: ./scripts/dev-all.sh
# Requires: Edda (Rust/cargo), Karvi (Node.js), Thyra (Bun)
#
# Environment variables (with defaults):
#   EDDA_PORT=3463    KARVI_PORT=3461    THYRA_PORT=3462
#   EDDA_DIR=../edda  KARVI_DIR=../karvi
#
# Stops all child processes on Ctrl+C.

set -euo pipefail

EDDA_PORT="${EDDA_PORT:-3463}"
KARVI_PORT="${KARVI_PORT:-3461}"
THYRA_PORT="${THYRA_PORT:-3462}"

EDDA_DIR="${EDDA_DIR:-../edda}"
KARVI_DIR="${KARVI_DIR:-../karvi}"
THYRA_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Colors for log prefixes
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PIDS=()

cleanup() {
  echo ""
  echo "Stopping all services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "All services stopped."
}

trap cleanup EXIT INT TERM

log_prefix() {
  local color="$1" name="$2"
  sed "s/^/${color}[${name}]${NC} /"
}

# --- Validate directories ---
for dir_var in EDDA_DIR KARVI_DIR; do
  dir="${!dir_var}"
  if [ ! -d "$dir" ]; then
    echo "ERROR: ${dir_var}=${dir} does not exist. Set ${dir_var} to the correct path."
    exit 1
  fi
done

# --- Start Edda (Rust) ---
echo -e "${RED}[edda]${NC} Starting on :${EDDA_PORT} from ${EDDA_DIR}"
(
  cd "$EDDA_DIR"
  EDDA_PORT="$EDDA_PORT" cargo run 2>&1 | log_prefix "$RED" "edda"
) &
PIDS+=($!)

# --- Start Karvi (Node.js) ---
echo -e "${GREEN}[karvi]${NC} Starting on :${KARVI_PORT} from ${KARVI_DIR}"
(
  cd "$KARVI_DIR"
  PORT="$KARVI_PORT" node server/server.js 2>&1 | log_prefix "$GREEN" "karvi"
) &
PIDS+=($!)

# --- Wait for Edda + Karvi to be ready ---
echo "Waiting for Edda and Karvi to start..."
for i in $(seq 1 30); do
  edda_ok=false
  karvi_ok=false
  curl -sf "http://localhost:${EDDA_PORT}/api/health" > /dev/null 2>&1 && edda_ok=true
  curl -sf "http://localhost:${KARVI_PORT}/api/health" > /dev/null 2>&1 && karvi_ok=true
  if $edda_ok && $karvi_ok; then
    echo "Edda and Karvi are ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "WARNING: Timed out waiting for Edda/Karvi health. Starting Thyra anyway."
  fi
  sleep 1
done

# --- Start Thyra (Bun) ---
echo -e "${BLUE}[thyra]${NC} Starting on :${THYRA_PORT} from ${THYRA_DIR}"
(
  cd "$THYRA_DIR"
  THYRA_PORT="$THYRA_PORT" \
  KARVI_URL="http://localhost:${KARVI_PORT}" \
  EDDA_URL="http://localhost:${EDDA_PORT}" \
  bun run dev 2>&1 | log_prefix "$BLUE" "thyra"
) &
PIDS+=($!)

echo ""
echo "=== All services starting ==="
echo "  Edda:  http://localhost:${EDDA_PORT}"
echo "  Karvi: http://localhost:${KARVI_PORT}"
echo "  Thyra: http://localhost:${THYRA_PORT}"
echo ""
echo "Press Ctrl+C to stop all."
echo ""

# Wait for any child to exit
wait
