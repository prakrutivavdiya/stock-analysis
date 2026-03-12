#!/bin/bash
# StockPilot — start backend + frontend dev servers
set -e

REPO="$(cd "$(dirname "$0")" && pwd)"

# Kill any existing instances
pkill -f "uvicorn backend.main" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

echo "Starting backend on http://127.0.0.1:8000 ..."
cd "$REPO"
backend/.venv/bin/uvicorn backend.main:app --reload --port 8000 --host 127.0.0.1 > /tmp/stockpilot-backend.log 2>&1 &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:5174 ..."
cd "$REPO/frontend"
npm run dev > /tmp/stockpilot-frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait for backend to become ready (up to 15s)
echo -n "Waiting for backend"
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1:8000/api/v1/health > /dev/null 2>&1; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "  Backend  (PID $BACKEND_PID) → http://127.0.0.1:8000   logs: /tmp/stockpilot-backend.log"
echo "  Frontend (PID $FRONTEND_PID) → http://localhost:5174   logs: /tmp/stockpilot-frontend.log"
echo ""
echo "Press Ctrl+C to stop both servers."

# Wait and forward Ctrl+C to both processes
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
