#!/usr/bin/env bash
set -u

PROJECT="lumina-staging-509411"
REGION="asia-southeast1"
SERVICE="lumina-bridge"
QUEUE="lumina-imports"
PORT="8088"
BASE="http://127.0.0.1:${PORT}"
RUN_TAG="$(date -u +%Y%m%dT%H%M%SZ)"

fail() {
  echo
  echo "QA FAILED: $1"
  echo "Cloud Shell is fine; send the output above this message."
  exit 1
}

pass() { echo "PASS: $1"; }

post_json() {
  local path="$1"
  local payload="$2"
  local outfile="$3"
  curl -sS -o "$outfile" -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    --data "$payload" "${BASE}${path}"
}

cleanup() {
  if [ -n "${PROXY_PID:-}" ]; then
    kill "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd ~/lumina-bridge || fail "lumina-bridge directory missing"
mkdir -p qa/results

printf '\n============================================================\n'
printf ' LUMINA R17 + R18 FULL PRODUCT QA\n'
printf ' Run: %s\n' "$RUN_TAG"
printf '============================================================\n\n'

# 1. Private service health
echo "===== 1. PRIVATE CLOUD RUN HEALTH ====="
gcloud run services proxy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --port="$PORT" \
  >"qa/results/r17-r18-proxy-${RUN_TAG}.log" 2>&1 &
PROXY_PID=$!

READY=0
for _ in $(seq 1 20); do
  CODE="$(curl -sS -o "qa/results/health-${RUN_TAG}.json" -w '%{http_code}' "${BASE}/api/v1/health" 2>/dev/null || true)"
  if [ "$CODE" = "200" ]; then READY=1; break; fi
  sleep 1
done
[ "$READY" = "1" ] || fail "Cloud Run proxy did not become ready"
jq . "qa/results/health-${RUN_TAG}.json"
jq -e '.status=="ok" and .api=="connected" and .database=="connected"' "qa/results/health-${RUN_TAG}.json" >/dev/null || fail "Health check failed"
pass "private Cloud Run health"

# 2. Interpreter v2
echo
echo "===== 2. TYPO / UNDERSTOOD-AS INTERPRETER ====="
INTERPRET_PAYLOAD='{"input":"titel: Sales Dirctor, contry: Singapor, indstry: fintech"}'
CODE="$(post_json /api/v1/search/interpret "$INTERPRET_PAYLOAD" "qa/results/interpret-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq . "qa/results/interpret-${RUN_TAG}.json"
[ "$CODE" = "200" ] || fail "interpreter HTTP status"
jq -e '
  .status=="ok" and
  .data.q==null and
  .data.filters.title=="Sales Dirctor" and
  .data.filters.country=="Singapor" and
  .data.filters.industry=="fintech" and
  .data.interpreter_version=="r17-deterministic-v2" and
  (.data.understood_as|length)>0
' "qa/results/interpret-${RUN_TAG}.json" >/dev/null || fail "interpreter assertion"
pass "typo-tolerant interpreter v2"

# 3. Find canonical person
echo
echo "===== 3. CANONICAL PERSON SEARCH ====="
CODE="$(post_json /api/v1/search/people '{"limit":1,"offset":0}' "qa/results/search-one-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq '{status,count,first:.data[0]}' "qa/results/search-one-${RUN_TAG}.json"
[ "$CODE" = "200" ] || fail "people search HTTP status"
PERSON_ID="$(jq -r '.data[0].id // empty' "qa/results/search-one-${RUN_TAG}.json")"
PERSON_NAME="$(jq -r '.data[0].full_name // empty' "qa/results/search-one-${RUN_TAG}.json")"
[ -n "$PERSON_ID" ] || fail "no canonical Person returned"
[ -n "$PERSON_NAME" ] || fail "selected Person has no name"
pass "canonical Person search"

# 4. Targeted smart search
echo
echo "===== 4. TARGETED SMART SEARCH ====="
PAYLOAD="$(jq -nc --arg q "$PERSON_NAME" '{q:$q,limit:10,offset:0}')"
CODE="$(post_json /api/v1/search/people "$PAYLOAD" "qa/results/search-targeted-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq '{status,understood_as,interpreted_query,count,first:.data[0]}' "qa/results/search-targeted-${RUN_TAG}.json"
[ "$CODE" = "200" ] || fail "targeted search HTTP status"
jq -e --arg id "$PERSON_ID" '[.data[].id] | index($id) != null' "qa/results/search-targeted-${RUN_TAG}.json" >/dev/null || fail "targeted search did not return selected Person"
pass "targeted smart search"

# 5. Saved Target
echo
echo "===== 5. SAVED TARGET ====="
TARGET_NAME="R17 QA Target ${RUN_TAG}"
PAYLOAD="$(jq -nc --arg name "$TARGET_NAME" --arg original "$PERSON_NAME" --arg q "$PERSON_NAME" '{name:$name,original_input:$original,interpreted_query:{q:$q,filters:{}}}')"
CODE="$(post_json /api/v1/saved-targets "$PAYLOAD" "qa/results/target-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq . "qa/results/target-${RUN_TAG}.json"
[ "$CODE" = "201" ] || fail "Saved Target creation"
TARGET_ID="$(jq -r '.data.id // empty' "qa/results/target-${RUN_TAG}.json")"
[ -n "$TARGET_ID" ] || fail "Saved Target ID missing"
pass "Saved Target creation"

CODE="$(curl -sS -o "qa/results/targets-${RUN_TAG}.json" -w '%{http_code}' "${BASE}/api/v1/saved-targets")"
[ "$CODE" = "200" ] || fail "Saved Target history HTTP status"
jq -e --arg id "$TARGET_ID" '[.data[].id] | index($id) != null' "qa/results/targets-${RUN_TAG}.json" >/dev/null || fail "Saved Target history missing new target"
pass "Saved Target history"

# 6. Freeze target -> list
echo
echo "===== 6. FROZEN LEAD LIST ====="
LIST_NAME="R17 QA Frozen ${RUN_TAG}"
PAYLOAD="$(jq -nc --arg target "$TARGET_ID" --arg name "$LIST_NAME" '{target_id:$target,name:$name}')"
CODE="$(post_json /api/v1/lists/from-target "$PAYLOAD" "qa/results/frozen-list-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq . "qa/results/frozen-list-${RUN_TAG}.json"
[ "$CODE" = "201" ] || fail "Saved Target freeze"
LIST_ID="$(jq -r '.data.id // empty' "qa/results/frozen-list-${RUN_TAG}.json")"
MEMBER_COUNT="$(jq -r '.member_count // 0' "qa/results/frozen-list-${RUN_TAG}.json")"
[ -n "$LIST_ID" ] || fail "frozen List ID missing"
[ "$MEMBER_COUNT" -ge 1 ] || fail "frozen List has no members"
pass "Saved Target -> frozen Lead List"

CODE="$(curl -sS -o "qa/results/list-members-${RUN_TAG}.json" -w '%{http_code}' "${BASE}/api/v1/lists/${LIST_ID}/members?limit=100&offset=0")"
[ "$CODE" = "200" ] || fail "frozen list member query"
FROZEN_MEMBER_ID="$(jq -r '.data[0].id // empty' "qa/results/list-members-${RUN_TAG}.json")"
[ -n "$FROZEN_MEMBER_ID" ] || fail "frozen list member missing"
pass "frozen membership query"

# 7. Manual list + click-to-add
echo
echo "===== 7. MANUAL LIST + CLICK-TO-ADD ====="
MANUAL_NAME="R17 QA Manual ${RUN_TAG}"
PAYLOAD="$(jq -nc --arg name "$MANUAL_NAME" '{name:$name,description:"R17 click-to-add QA"}')"
CODE="$(post_json /api/v1/lists "$PAYLOAD" "qa/results/manual-list-${RUN_TAG}.json")"
[ "$CODE" = "201" ] || fail "manual List creation"
MANUAL_LIST_ID="$(jq -r '.data.id // empty' "qa/results/manual-list-${RUN_TAG}.json")"
[ -n "$MANUAL_LIST_ID" ] || fail "manual List ID missing"
PAYLOAD="$(jq -nc --arg id "$PERSON_ID" '{person_ids:[$id]}')"
CODE="$(post_json "/api/v1/lists/${MANUAL_LIST_ID}/members" "$PAYLOAD" "qa/results/add-member-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq . "qa/results/add-member-${RUN_TAG}.json"
[ "$CODE" = "200" ] || fail "click-to-add HTTP status"
[ "$(jq -r '.added // 0' "qa/results/add-member-${RUN_TAG}.json")" -eq 1 ] || fail "click-to-add did not add Person"
pass "click-to-add"

# 8. Campaign + list import + history
echo
echo "===== 8. CAMPAIGN + HISTORY ====="
CAMPAIGN_NAME="R18 QA Campaign ${RUN_TAG}"
PAYLOAD="$(jq -nc --arg name "$CAMPAIGN_NAME" '{name:$name,status:"active"}')"
CODE="$(post_json /api/v1/campaigns "$PAYLOAD" "qa/results/campaign-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq . "qa/results/campaign-${RUN_TAG}.json"
[ "$CODE" = "201" ] || fail "Campaign creation"
CAMPAIGN_ID="$(jq -r '.data.id // empty' "qa/results/campaign-${RUN_TAG}.json")"
[ -n "$CAMPAIGN_ID" ] || fail "Campaign ID missing"

PAYLOAD="$(jq -nc --arg list "$LIST_ID" '{list_id:$list,stage:"Prospecting",status:"Queued",note:"R18 full QA"}')"
CODE="$(post_json "/api/v1/campaigns/${CAMPAIGN_ID}/import-list" "$PAYLOAD" "qa/results/campaign-import-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq . "qa/results/campaign-import-${RUN_TAG}.json"
[ "$CODE" = "200" ] || fail "Campaign list import"
[ "$(jq -r '.affected // 0' "qa/results/campaign-import-${RUN_TAG}.json")" -ge 1 ] || fail "Campaign import affected zero people"

CODE="$(curl -sS -o "qa/results/campaign-history-${RUN_TAG}.json" -w '%{http_code}' "${BASE}/api/v1/people/${FROZEN_MEMBER_ID}/campaign-history")"
[ "$CODE" = "200" ] || fail "campaign history HTTP status"
jq -e --arg id "$CAMPAIGN_ID" '[.data[].campaign_id] | index($id) != null' "qa/results/campaign-history-${RUN_TAG}.json" >/dev/null || fail "campaign missing from Person history"
pass "Campaign import + Person history"

# 9. CSV export
echo
echo "===== 9. CSV EXPORT ====="
PAYLOAD="$(jq -nc --arg list "$LIST_ID" --arg campaign "$CAMPAIGN_ID" '{list_id:$list,campaign_id:$campaign,format:"csv"}')"
CODE="$(post_json /api/v1/exports "$PAYLOAD" "qa/results/csv-export-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq . "qa/results/csv-export-${RUN_TAG}.json"
[ "$CODE" = "201" ] || fail "CSV export creation"
CSV_EXPORT_ID="$(jq -r '.data.id // empty' "qa/results/csv-export-${RUN_TAG}.json")"
CSV_PATH="$(jq -r '.download_path // empty' "qa/results/csv-export-${RUN_TAG}.json")"
[ -n "$CSV_PATH" ] || fail "CSV download path missing"
CODE="$(curl -sS -o "qa/results/lumina-r18-${RUN_TAG}.csv" -w '%{http_code}' "${BASE}${CSV_PATH}")"
[ "$CODE" = "200" ] || fail "CSV download"

python3 - "qa/results/lumina-r18-${RUN_TAG}.csv" <<'PY'
import csv, sys
expected = [
'Contact Full Name','First Name','Last Name','Title','Department','Seniority',
'Company Name - Cleaned','Website','List','Contact LI Profile URL','Email 1',
'Email 1 Validation','ContactPhone1','CompanyPhone1','ContactPhone2','Contact City',
'Contact Country','Company Street 1','Company City','Company State','Company Post Code',
'Company Country','Company Description','Company Founded Date','Company Industry',
'Company LI Profile Url','Company Revenue Range','Company Staff Count Range','Stage','Note'
]
with open(sys.argv[1], encoding='utf-8-sig', newline='') as f:
    rows=list(csv.reader(f))
if not rows or rows[0] != expected or len(rows) < 2:
    print('CSV schema/data validation failed')
    print(rows[0] if rows else 'EMPTY')
    sys.exit(1)
print('CSV headers:', len(rows[0]))
print('CSV data rows:', len(rows)-1)
print('CSV 30-column schema: OK')
PY
[ "$?" = "0" ] || fail "CSV 30-column validation"
pass "CSV fixed 30-column export"

# 10. XLSX export
echo
echo "===== 10. XLSX EXPORT ====="
PAYLOAD="$(jq -nc --arg list "$LIST_ID" --arg campaign "$CAMPAIGN_ID" '{list_id:$list,campaign_id:$campaign,format:"xlsx"}')"
CODE="$(post_json /api/v1/exports "$PAYLOAD" "qa/results/xlsx-export-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq . "qa/results/xlsx-export-${RUN_TAG}.json"
[ "$CODE" = "201" ] || fail "XLSX export creation"
XLSX_EXPORT_ID="$(jq -r '.data.id // empty' "qa/results/xlsx-export-${RUN_TAG}.json")"
XLSX_PATH="$(jq -r '.download_path // empty' "qa/results/xlsx-export-${RUN_TAG}.json")"
[ -n "$XLSX_PATH" ] || fail "XLSX download path missing"
CODE="$(curl -sS -o "qa/results/lumina-r18-${RUN_TAG}.xlsx" -w '%{http_code}' "${BASE}${XLSX_PATH}")"
[ "$CODE" = "200" ] || fail "XLSX download"

QA_XLSX="qa/results/lumina-r18-${RUN_TAG}.xlsx" node --input-type=module <<'NODE'
import ExcelJS from 'exceljs';
const expected = [
'Contact Full Name','First Name','Last Name','Title','Department','Seniority',
'Company Name - Cleaned','Website','List','Contact LI Profile URL','Email 1',
'Email 1 Validation','ContactPhone1','CompanyPhone1','ContactPhone2','Contact City',
'Contact Country','Company Street 1','Company City','Company State','Company Post Code',
'Company Country','Company Description','Company Founded Date','Company Industry',
'Company LI Profile Url','Company Revenue Range','Company Staff Count Range','Stage','Note'
];
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(process.env.QA_XLSX);
const sheet = wb.getWorksheet('Leads');
if (!sheet) { console.error('Leads worksheet missing'); process.exit(1); }
const headers = sheet.getRow(1).values.slice(1);
if (headers.length !== expected.length || headers.some((v,i)=>v!==expected[i]) || sheet.rowCount < 2) {
  console.error('XLSX schema/data validation failed');
  console.error(headers);
  process.exit(1);
}
console.log('XLSX headers:', headers.length);
console.log('XLSX data rows:', sheet.rowCount-1);
console.log('XLSX 30-column schema: OK');
NODE
[ "$?" = "0" ] || fail "XLSX 30-column validation"
pass "XLSX fixed 30-column export"

# 11. Export history
echo
echo "===== 11. EXPORT HISTORY ====="
CODE="$(curl -sS -o "qa/results/export-history-${RUN_TAG}.json" -w '%{http_code}' "${BASE}/api/v1/exports")"
[ "$CODE" = "200" ] || fail "export history HTTP status"
jq -e --arg csv "$CSV_EXPORT_ID" --arg xlsx "$XLSX_EXPORT_ID" '([.data[].id]|index($csv)!=null) and ([.data[].id]|index($xlsx)!=null)' "qa/results/export-history-${RUN_TAG}.json" >/dev/null || fail "export history missing QA jobs"
pass "tracked export history"

# 12. R16 regression
echo
echo "===== 12. R16 IMPORT REGRESSION ====="
REG_KEY="r17r18-regression-${RUN_TAG}"
REG_EMAIL="r17r18.regression.${RUN_TAG}@example.com"
PAYLOAD="$(jq -nc --arg key "$REG_KEY" --arg email "$REG_EMAIL" --arg name "R17 R18 Regression ${RUN_TAG}" '{filename:"r17-r18-regression.json",source_name:"R17/R18 Regression QA",idempotency_key:$key,rows:[{source_record_id:$key,full_name:$name,email:$email}]}')"
CODE="$(post_json /api/v1/imports "$PAYLOAD" "qa/results/r16-regression-${RUN_TAG}.json")"
echo "HTTP_STATUS:$CODE"
jq . "qa/results/r16-regression-${RUN_TAG}.json"
[ "$CODE" = "201" ] || fail "R16 sync import regression"
CODE="$(post_json /api/v1/imports "$PAYLOAD" "qa/results/r16-replay-${RUN_TAG}.json")"
echo "REPLAY_HTTP_STATUS:$CODE"
jq . "qa/results/r16-replay-${RUN_TAG}.json"
[ "$CODE" = "200" ] || fail "R16 replay HTTP status"
jq -e '.replayed==true' "qa/results/r16-replay-${RUN_TAG}.json" >/dev/null || fail "R16 replay flag"
pass "R16 importer + idempotency preserved"

# 13. Final visibility and infra state
echo
echo "===== 13. FINAL PRODUCT VISIBILITY ====="
curl -sS "${BASE}/api/v1/lists" | jq --arg id "$LIST_ID" '{status,qa_list:[.data[]|select(.id==$id)][0]}'
curl -sS "${BASE}/api/v1/campaigns" | jq --arg id "$CAMPAIGN_ID" '{status,qa_campaign:[.data[]|select(.id==$id)][0]}'

echo
echo "===== 14. CLOUD TASK QUEUE ====="
gcloud tasks list --queue="$QUEUE" --location="$REGION" --project="$PROJECT"

echo
echo "===== 15. DEPLOYED REVISION ====="
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='table(status.latestReadyRevisionName,status.traffic[0].percent)'

printf '\n============================================================\n'
printf ' R17 + R18 FULL PRODUCT QA PASSED\n'
printf '============================================================\n'
printf 'Saved Target: %s\n' "$TARGET_ID"
printf 'Frozen List:  %s\n' "$LIST_ID"
printf 'Campaign:     %s\n' "$CAMPAIGN_ID"
printf 'CSV Export:   %s\n' "$CSV_EXPORT_ID"
printf 'XLSX Export:  %s\n' "$XLSX_EXPORT_ID"
printf 'Results dir:  ~/lumina-bridge/qa/results\n'
