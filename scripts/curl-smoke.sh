#!/usr/bin/env bash
set -euo pipefail

KEY="${NAKA_SERVER_KEY:?Set NAKA_SERVER_KEY}"
API="${NAKA_API_URL:?Set NAKA_API_URL}"
TOKEN="${1:?Usage: $0 <launch-token> [world-id]}"
WORLD_ID="${2:-}"

echo "1) POST /internal/worlds/identify"
curl -sS -X POST "$API/internal/worlds/identify" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}" | head -c 600
echo ""

if [ -n "$WORLD_ID" ]; then
  echo "2) GET /internal/worlds/$WORLD_ID"
  curl -sS "$API/internal/worlds/$WORLD_ID" \
    -H "Authorization: Bearer $KEY" | head -c 600
  echo ""
fi
