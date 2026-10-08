#!/usr/bin/env bash
set -u
PROJECT="lumina-staging-509411"
REGION="asia-southeast1"
SERVICE="lumina-bridge"
PORT="8089"
BASE="http://127.0.0.1:${PORT}"
A="a19a0000-0000-4000-8000-000000000001"
B="b19b0000-0000-4000-8000-000000000002"
PA="r19-owner-a@example.test"
PB="r19-owner-b@example.test"
PV="r19-viewer-a@example.test"
RUN="$(date -u +%Y%m%dT%H%M%SZ)"
fail(){ echo "QA FAILED: $1"; exit 1; }
cleanup(){ [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true; }
trap cleanup EXIT
cd ~/lumina-bridge || fail "repo missing"
gcloud run services proxy "$SERVICE" --project="$PROJECT" --region="$REGION" --port="$PORT" >qa/results/r19-proxy-${RUN}.log 2>&1 & PID=$!
for _ in $(seq 1 20); do code=$(curl -sS -o /tmp/r19-health.json -w '%{http_code}' "$BASE/api/v1/health" 2>/dev/null || true); [ "$code" = 200 ] && break; sleep 1; done
[ "${code:-}" = 200 ] || fail "proxy"

echo '1) unauthenticated denied'
code=$(curl -sS -o /tmp/r19-unauth.json -w '%{http_code}' "$BASE/api/v1/lists"); [ "$code" = 401 ] || fail "unauthenticated expected 401 got $code"

echo '2) client A create list'
code=$(curl -sS -o /tmp/r19-list-a.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Lumina-Test-Principal: $PA" -H "X-Lumina-Client-Id: $A" --data "{\"name\":\"R19 A $RUN\"}" "$BASE/api/v1/lists"); [ "$code" = 201 ] || fail "A create list $code"; LA=$(jq -r '.data.id' /tmp/r19-list-a.json); [ "$(jq -r '.data.client_id' /tmp/r19-list-a.json)" = "$A" ] || fail "A list wrong client"

echo '3) principal A cannot select client B'
code=$(curl -sS -o /tmp/r19-cross-select.json -w '%{http_code}' -H "X-Lumina-Test-Principal: $PA" -H "X-Lumina-Client-Id: $B" "$BASE/api/v1/lists"); [ "$code" = 403 ] || fail "cross select expected 403 got $code"

echo '4) client B list view excludes A list'
code=$(curl -sS -o /tmp/r19-lists-b.json -w '%{http_code}' -H "X-Lumina-Test-Principal: $PB" -H "X-Lumina-Client-Id: $B" "$BASE/api/v1/lists"); [ "$code" = 200 ] || fail "B list query"; jq -e --arg id "$LA" '[.data[].id] | index($id) == null' /tmp/r19-lists-b.json >/dev/null || fail "A list leaked to B"

echo '5) viewer can search but cannot write'
code=$(curl -sS -o /tmp/r19-view-search.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Lumina-Test-Principal: $PV" -H "X-Lumina-Client-Id: $A" --data '{"limit":1}' "$BASE/api/v1/search/people"); [ "$code" = 200 ] || fail "viewer search"
code=$(curl -sS -o /tmp/r19-view-write.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Lumina-Test-Principal: $PV" -H "X-Lumina-Client-Id: $A" --data '{"name":"viewer must fail"}' "$BASE/api/v1/lists"); [ "$code" = 403 ] || fail "viewer write expected 403 got $code"

echo '6) body client mismatch denied'
key="r19-mismatch-$RUN"
code=$(curl -sS -o /tmp/r19-mismatch.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Lumina-Test-Principal: $PA" -H "X-Lumina-Client-Id: $A" --data "{\"client_id\":\"$B\",\"idempotency_key\":\"$key\",\"rows\":[{\"source_record_id\":\"$key\",\"full_name\":\"Mismatch QA\"}]}" "$BASE/api/v1/imports"); [ "$code" = 403 ] || fail "client mismatch expected 403 got $code"

echo '7) same idempotency key works independently in A and B'
key="r19-shared-$RUN"
for spec in "$PA $A A" "$PB $B B"; do set -- $spec; p=$1; c=$2; suffix=$3; code=$(curl -sS -o "/tmp/r19-import-$suffix.json" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Lumina-Test-Principal: $p" -H "X-Lumina-Client-Id: $c" --data "{\"idempotency_key\":\"$key\",\"rows\":[{\"source_record_id\":\"$key-$suffix\",\"full_name\":\"R19 Tenant $suffix $RUN\",\"email\":\"r19.$suffix.$RUN@example.test\"}]}" "$BASE/api/v1/imports"); [ "$code" = 201 ] || fail "tenant $suffix import expected 201 got $code"; done
JA=$(jq -r '.import_job_id' /tmp/r19-import-A.json)

echo '8) B cannot read A import job'
code=$(curl -sS -o /tmp/r19-cross-job.json -w '%{http_code}' -H "X-Lumina-Test-Principal: $PB" -H "X-Lumina-Client-Id: $B" "$BASE/api/v1/import-jobs/$JA"); [ "$code" = 404 ] || fail "cross import job expected 404 got $code"
code=$(curl -sS -o /tmp/r19-own-job.json -w '%{http_code}' -H "X-Lumina-Test-Principal: $PA" -H "X-Lumina-Client-Id: $A" "$BASE/api/v1/import-jobs/$JA"); [ "$code" = 200 ] || fail "own job expected 200 got $code"

echo 'R19 AUTHORIZATION QA PASSED'
