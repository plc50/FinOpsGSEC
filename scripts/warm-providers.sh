#!/usr/bin/env bash
# AI FinOps Proxy - pre-warm the local OpenAI-compatible TabbyAPI demo provider.
#
# Usage: bash scripts/warm-providers.sh
#        TABBY_API_BASE=http://127.0.0.1:5000/v1 TABBY_MODEL=gemma-4-12B-it-exl3 bash scripts/warm-providers.sh
set -uo pipefail

TABBY_API_BASE="${TABBY_API_BASE:-http://127.0.0.1:5000/v1}"
TABBY_MODEL="${TABBY_MODEL:-gemma-4-12B-it-exl3}"

endpoint="${TABBY_API_BASE%/}/chat/completions"
tmp_file="/tmp/finops_tabby_warm.json"

printf 'Warming TabbyAPI model %s at %s ... ' "$TABBY_MODEL" "$endpoint"
t0=$(date +%s)
code=$(curl -s -o "$tmp_file" -w '%{http_code}' -m 300 \
  "$endpoint" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$TABBY_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}],\"stream\":false,\"max_tokens\":1}")
dt=$(( $(date +%s) - t0 ))

if [ "$code" = "200" ]; then
  echo "loaded in ${dt}s."
  exit 0
fi

echo "FAILED (HTTP $code). Is TabbyAPI running and is the exact model loaded?"
if [ -s "$tmp_file" ]; then
  head -40 "$tmp_file"
fi
exit 1
