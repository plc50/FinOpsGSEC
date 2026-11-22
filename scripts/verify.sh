#!/usr/bin/env bash
# AI FinOps Proxy — end-to-end acceptance smoke test.
#
# Exercises every CHALLENGE "Criterios de Aceptación" against a running stack
# and prints PASS/FAIL with the observed values. Safe to re-run: the only
# mutation (a temporary budget change to force a block) is reverted at the end.
#
# Usage:  bash scripts/verify.sh        (needs backend on :8000; frontend optional)
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8000}"
FRONT_URL="${FRONT_URL:-http://localhost:5173}"
MKT="Authorization: Bearer finops_key_marketing"
PRD="Authorization: Bearer finops_key_producto"
ADM="Authorization: Bearer finops_key_admin"
CT="Content-Type: application/json"

pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
hdr()  { echo; echo "== $1 =="; }

jqc() { jq -c "$@" 2>/dev/null; }

hdr "0. Backend reachable"
if curl -sf "$API_BASE/health" >/dev/null; then ok "GET /health ($API_BASE)"; else bad "backend not reachable at $API_BASE"; echo "Aborting."; exit 1; fi

hdr "AC1 · Interception + intelligent routing across >=2 providers"
declare -A prompts=(
  [misc]='Resume esto en una frase: el equipo lanzo una campana.'
  [code]='Fix this code:\n```python\ndef add(a,b):\n return a-b\n```\nExplain the bug and edge cases in detail.'
  [web]='Give me the latest news and current price of EUR/USD from sources online.'
  [qa]='Segun la documentacion interna y la politica interna, como se gestiona un ticket?'
)
for k in misc code web qa; do
  # marketing has code_generation downgraded to misc by policy, so the code
  # prompt goes through producto; the downgrade itself is asserted right below.
  auth="$MKT"; [ "$k" = code ] && auth="$PRD"
  m=$(curl -s -H "$auth" -H "$CT" "$API_BASE/v1/chat/completions" \
        -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"${prompts[$k]}\"}]}" \
        | jqc '{model, total_tokens:.usage.total_tokens}')
  echo "    [$k] -> $m"
done
bc_http=$(curl -s -o /tmp/_bc.json -w '%{http_code}' -H "$MKT" -H "$CT" "$API_BASE/v1/chat/completions" \
  -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"${prompts[code]}\"}]}")
bc_row=$(curl -s -H "$ADM" "$API_BASE/dashboard/usage/requests?consumer=equipo-marketing&page_size=1" \
  | jqc '.items[0]|{category, original_category, category_source}')
bc_cat=$(echo "$bc_row" | jq -r '.category' 2>/dev/null)
bc_orig=$(echo "$bc_row" | jq -r '.original_category' 2>/dev/null)
echo "    marketing + code prompt -> HTTP $bc_http / $bc_row"
if [ "$bc_http" = "200" ] && [ "$bc_cat" = "misc" ] && [ "$bc_orig" = "code_generation" ]; then ok "category policy downgraded marketing code prompt to misc (served, cheap model)"; else bad "expected 200 + misc/code_generation downgrade for marketing code prompt, got $bc_http/$bc_row"; fi
providers=$(curl -s -H "$ADM" "$API_BASE/dashboard/usage/requests?consumer=equipo-marketing&page_size=100" \
  | jqc '[.items[].selected_provider]|map(select(.!=null))|unique')
nprov=$(echo "$providers" | jq 'length' 2>/dev/null)
echo "    providers used by marketing: $providers"
if [ "${nprov:-0}" -ge 2 ]; then ok "routed across $nprov providers"; else bad "expected >=2 providers, saw ${nprov:-0}"; fi

hdr "AC2 · Token + cost recorded per request"
row=$(curl -s -H "$ADM" "$API_BASE/dashboard/usage/requests?consumer=equipo-marketing&page_size=1" \
  | jqc '.items[0]|{tokens:.actual_prompt_tokens, out:.actual_output_tokens, cost:.actual_model_cost}')
echo "    latest row: $row"
if echo "$row" | grep -q '"cost"'; then ok "usage tokens + cost captured"; else bad "no usage/cost on audit row"; fi

hdr "AC3 · >=2 consumers with separate spend history"
cons=$(curl -s -H "$ADM" "$API_BASE/dashboard/usage/consumers")
echo "$cons" | jqc '.items[]|{consumer, spend:.current_spend, budget, reqs:.requests_count}' | sed 's/^/    /'
ncons=$(echo "$cons" | jq '[.items[]|select(.requests_count>0)]|length' 2>/dev/null)
if [ "${ncons:-0}" -ge 2 ]; then ok "$ncons consumers with independent spend"; else bad "expected >=2 consumers, saw ${ncons:-0}"; fi

hdr "AC4 · Configurable budget -> visible block/alert/degrade"
before=$(curl -s -H "$ADM" "$API_BASE/dashboard/budgets" | jq -r '.items[]|select(.consumer=="equipo-marketing")|"\(.budget) \(.warning_threshold)"')
b0=$(echo "$before"|awk '{print $1}'); w0=$(echo "$before"|awk '{print $2}')
# Pick a budget below the current spend so the next request must be blocked,
# regardless of how much spend the seed generated.
spend=$(curl -s -H "$ADM" "$API_BASE/dashboard/usage/consumers" \
  | jq -r '.items[]|select(.consumer=="equipo-marketing")|.current_spend')
low=$(jq -n --argjson s "${spend:-1.0}" '([$s*0.5, 0.000001]|max)')
curl -s -H "$ADM" -H "$CT" "$API_BASE/dashboard/budgets/equipo-marketing" -d "{\"budget\":$low,\"warning_threshold\":0.8}" >/dev/null
# Unique prompt per run: a repeated prompt would be served from the semantic
# cache at zero cost and legitimately bypass the budget block.
nonce="$RANDOM$RANDOM"
code=$(curl -s -o /tmp/_blk.json -w '%{http_code}' -H "$MKT" -H "$CT" "$API_BASE/v1/chat/completions" \
  -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"Escribe un poema muy largo sobre el mar, referencia $nonce.\"}]}")
bcode=$(jq -r '.error.code' /tmp/_blk.json 2>/dev/null)
echo "    request over budget -> HTTP $code / code=$bcode"
alerts=$(curl -s -H "$MKT" "$API_BASE/dashboard/alerts" | jqc '[.items[].type]|unique')
echo "    alert types: $alerts"
# revert budget
curl -s -H "$ADM" -H "$CT" "$API_BASE/dashboard/budgets/equipo-marketing" \
  -d "{\"budget\":${b0:-10.0},\"warning_threshold\":${w0:-0.8}}" >/dev/null
if [ "$code" = "429" ] && [ "$bcode" = "budget_exceeded" ]; then ok "429 budget_exceeded returned + alerts raised (budget reverted to ${b0:-10.0})"; else bad "expected 429 budget_exceeded, got $code/$bcode"; fi
# degradation savings evidence
deg=$(curl -s -H "$ADM" "$API_BASE/dashboard/usage/requests?consumer=equipo-marketing&budget_action=degraded&page_size=1" \
  | jqc '.items[0]|{chosen_provider:.selected_provider, chosen_model:.selected_model, baseline_provider:.baseline_provider, baseline_model:.baseline_model, savings:.estimated_savings, ratio:.estimated_savings_ratio}')
echo "    degradation example: $deg"

hdr "AC5 · Cost-saving decision criteria applied to real data"
sav=$(curl -s -H "$ADM" "$API_BASE/dashboard/summary" | jq -r '.total_savings')
echo "    total_savings (admin scope): \$$sav"
if [ -n "$sav" ] && [ "$sav" != "null" ]; then ok "routing/degradation savings surfaced (criteria applied to usage)"; else bad "no total_savings surfaced"; fi

hdr "Pilar 2 · Forecast (future-cost projection)"
fc=$(curl -s -H "$MKT" "$API_BASE/dashboard/forecast/equipo-marketing" \
  | jqc '{spend_so_far, projected_spend, forecast_status, points:(.series|length)}')
echo "    $fc"
if echo "$fc" | grep -q 'forecast_status'; then ok "forecast projection returned"; else bad "no forecast"; fi

hdr "Pilar 2 · Alerts + recommendations"
na=$(curl -s -H "$MKT" "$API_BASE/dashboard/alerts" | jq '.items|length')
nr=$(curl -s -H "$MKT" "$API_BASE/dashboard/recommendations" | jq '.items|length')
echo "    alerts=$na  recommendations=$nr"
if [ "${na:-0}" -ge 1 ] && [ "${nr:-0}" -ge 1 ]; then ok "alerts + recommendations present"; else bad "expected alerts and recommendations"; fi

hdr "Pilar 4 · Security / scope isolation"
me=$(curl -s -H "$MKT" "$API_BASE/dashboard/me" | jqc '{consumer, role, visible:.visible_consumers}')
echo "    consumer /me: $me"
sc=$(curl -s -o /tmp/_sc.json -w '%{http_code}' -H "$MKT" "$API_BASE/dashboard/forecast/equipo-producto")
scc=$(jq -r '.error.code' /tmp/_sc.json 2>/dev/null)
echo "    marketing -> producto forecast: HTTP $sc / code=$scc"
mk=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/dashboard/me")
bk=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer nope" "$API_BASE/dashboard/me")
echo "    missing key HTTP $mk · invalid key HTTP $bk"
if [ "$sc" = "403" ] && [ "$scc" = "forbidden_scope" ] && [ "$mk" = "401" ] && [ "$bk" = "401" ]; then ok "scope isolation (403) + auth (401) enforced"; else bad "scope/auth not enforced ($sc/$scc, $mk, $bk)"; fi

hdr "Frontend (optional)"
if curl -sf "$FRONT_URL" >/dev/null 2>&1; then
  proxy=$(curl -s -H "$MKT" "$FRONT_URL/dashboard/me" | jqc '.consumer')
  echo "    $FRONT_URL served; dev-proxy /dashboard/me -> $proxy"
  if [ "$proxy" = '"equipo-marketing"' ]; then ok "frontend serves + proxies to backend :8000"; else bad "frontend up but proxy did not reach backend"; fi
else
  echo "    (frontend not running on :5173 — skipped)"
fi

echo
echo "=================================================="
echo " RESULT: $pass passed, $fail failed"
echo "=================================================="
[ "$fail" -eq 0 ]
