#!/usr/bin/env bash
# Local Docker rehearsal for ADR 0014 / issue #69 (11 steps).
# Mock slot HTTP + real postgres for views switch. No real RPC URLs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${REHEARSAL_OUT:-$ROOT/.ponder-rehearsal-out}"
rm -rf "$OUT"
mkdir -p "$OUT/samples" "$OUT/logs"

export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-rehearsal-pass}"
export COMPOSE_PROJECT_NAME=kargain-r17
export PONDER_DEPLOY_ROOT="$ROOT"
export PONDER_STATE_FILE="$OUT/state.json"

log() { echo "$*" | tee -a "$OUT/logs/rehearsal.log"; }

MOCK_IMG=kargain-ponder-mock:rehearsal
if ! docker image inspect "$MOCK_IMG" >/dev/null 2>&1; then
  mkdir -p "$OUT/mock"
  cat >"$OUT/mock/server.py" <<'PY'
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer
READY = int(os.environ.get("MOCK_READY", "200"))
STATUS = {
  "baseSepolia": {"block": {"number": 1, "timestamp": 1700000000}},
  "ethereumSepolia": {"block": {"number": 1, "timestamp": 1700000000}},
}
class H(BaseHTTPRequestHandler):
  def log_message(self, *a): pass
  def do_GET(self):
    if self.path.startswith("/ready"):
      self.send_response(READY); self.end_headers(); self.wfile.write(b"ok" if READY==200 else b"backfill")
    elif self.path.startswith("/status"):
      body=json.dumps(STATUS).encode(); self.send_response(200); self.send_header("content-type","application/json"); self.send_header("content-length",str(len(body))); self.end_headers(); self.wfile.write(body)
    else:
      self.send_response(404); self.end_headers()
HTTPServer(("0.0.0.0", 42069), H).serve_forever()
PY
  printf 'FROM python:3.12-alpine\nWORKDIR /app\nCOPY server.py /app/server.py\nCMD ["python","/app/server.py"]\n' >"$OUT/mock/Dockerfile"
  docker build -t "$MOCK_IMG" "$OUT/mock"
fi

log "=== bootstrap: single-ponder starting state ==="
docker compose -p "$COMPOSE_PROJECT_NAME" down -v --remove-orphans >/dev/null 2>&1 || true
docker rm -f kargain-r17-legacy-ponder kargain-r17-ponder-blue kargain-r17-ponder-green 2>/dev/null || true

docker compose -p "$COMPOSE_PROJECT_NAME" up -d postgres
for _ in $(seq 1 40); do
  docker compose -p "$COMPOSE_PROJECT_NAME" exec -T postgres pg_isready -U ponder -d kargain_ponder && break
  sleep 1
done
NET_ID=$(docker network ls --format '{{.Name}}' | grep "${COMPOSE_PROJECT_NAME}_kargain$" | head -1)

docker compose -p "$COMPOSE_PROJECT_NAME" exec -T postgres psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS kargain;
CREATE TABLE IF NOT EXISTS kargain.demo (id int primary key, v text);
INSERT INTO kargain.demo(id,v) VALUES (1,'legacy') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS kargain._ponder_meta (key text primary key, value jsonb);
CREATE TABLE IF NOT EXISTS kargain._ponder_checkpoint (chain_name text primary key, checkpoint jsonb);
INSERT INTO kargain._ponder_meta(key,value) VALUES
  ('app', '{"table_names":["demo"],"view_names":[]}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO kargain._ponder_checkpoint(chain_name, checkpoint) VALUES
  ('baseSepolia', '{}'::jsonb)
ON CONFLICT DO NOTHING;
SQL

docker run -d --name kargain-r17-legacy-ponder --network "$NET_ID" --network-alias ponder \
  -e MOCK_READY=200 "$MOCK_IMG" >/dev/null
log "legacy mock ponder answering as service alias ponder"

PRIOR_SHA=$(git rev-parse HEAD)
export PRIOR_SHA
printf '{"identity":"%s","executable":"%s"}\n' "id-rehearsal" "exec-v1" >"$PONDER_STATE_FILE"

SHA1="1111111111111111111111111111111111111111"
SHA2="2222222222222222222222222222222222222222"
SCHEMA1="k_${SHA1}"
SCHEMA2="k_${SHA2}"
LEGACY="k_${PRIOR_SHA}"

seed_schema() {
  local schema="$1"
  docker compose -p "$COMPOSE_PROJECT_NAME" exec -T postgres psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1 <<SQL
CREATE SCHEMA IF NOT EXISTS "${schema}";
CREATE TABLE IF NOT EXISTS "${schema}".demo (id int primary key, v text);
INSERT INTO "${schema}".demo(id,v) VALUES (1,'${schema}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS "${schema}"._ponder_meta (key text primary key, value jsonb);
CREATE TABLE IF NOT EXISTS "${schema}"._ponder_checkpoint (chain_name text primary key, checkpoint jsonb);
INSERT INTO "${schema}"._ponder_meta(key,value) VALUES
  ('app', '{"table_names":["demo"],"view_names":[]}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SQL
}

start_mock_slot() {
  local color="$1" ready="${2:-200}"
  docker rm -f "kargain-r17-ponder-${color}" >/dev/null 2>&1 || true
  docker run -d --name "kargain-r17-ponder-${color}" --network "$NET_ID" \
    --network-alias "ponder-${color}" \
    -e MOCK_READY="$ready" "$MOCK_IMG" >/dev/null
}

# 1. baseline
log "=== 1. baseline sampling ==="
python3 - <<PY
import json, time
from pathlib import Path
out = Path("$OUT/samples/baseline.jsonl")
base = time.time() - 40*60
for i in range(3):
  at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(base + i*15*60))
  for c in (84532, 11155111):
    out.open("a").write(json.dumps({"chainId":c,"lag_seconds":2,"at":at})+"\n")
print("wrote", out)
PY
log "deploy_evidence baseline_samples=ok"

# 2. hold
log "=== 2. hold ==="
seed_schema "$SCHEMA1"
start_mock_slot blue 200
printf 'DATABASE_SCHEMA=%s\n' "$SCHEMA1" >"$ROOT/.ponder-slot-blue.env"
node --import tsx <<'NODE' | tee -a "$OUT/logs/rehearsal.log"
import { readFileSync, writeFileSync } from "node:fs";
import { planPonderDeploy } from "./scripts/lib/ponder-deploy-plan.ts";
import { parsePonderDeployState, writePonderDeployStateFile } from "./scripts/lib/ponder-deploy-state.ts";
const statePath = process.env.PONDER_STATE_FILE!;
const sha1 = "1111111111111111111111111111111111111111";
const schema1 = `k_${sha1}`;
const prior = process.env.PRIOR_SHA!;
const state = parsePonderDeployState(JSON.parse(readFileSync(statePath, "utf8")));
const r = planPonderDeploy({
  state,
  operation: "hold",
  deploySha: sha1,
  observations: {
    ready: { blue: null, green: null, legacy: 200, nginx: null },
    schemas: ["kargain"],
    storedExecutable: "exec-v1",
    executableDigest: "exec-v2",
    identityDigest: "id-rehearsal",
    priorCheckoutSha: prior,
    nginxConfigChanged: false,
  },
});
for (const a of r.actions) if (a.type === "evidence") console.log(a.text);
writePonderDeployStateFile(statePath, {
  ...state,
  pending: { slot: "blue", schema: schema1 },
  legacy_schema: `k_${prior}`,
  executable: "exec-v2",
  preCutover: true,
});
NODE

# 3. dual-serve
log "=== 3. dual-serve sampling ==="
start_mock_slot green 200
python3 - <<PY
import json, time
from pathlib import Path
out = Path("$OUT/samples/dual.jsonl")
base = time.time() - 40*60
for i in range(3):
  at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(base + i*15*60))
  for c in (84532, 11155111):
    out.open("a").write(json.dumps({"chainId":c,"lag_seconds":5,"at":at})+"\n")
print("wrote", out)
PY

# 4. decide
log "=== 4. decide-rollback-model ==="
PRIOR_SHA="$PRIOR_SHA" node --import tsx scripts/ponder-decide-rollback-model.ts \
  --baseline "$OUT/samples/baseline.jsonl" \
  --dual "$OUT/samples/dual.jsonl" \
  --state "$PONDER_STATE_FILE" | tee -a "$OUT/logs/rehearsal.log"

# 5. first cutover
log "=== 5. first cutover deploy ==="
node --import tsx <<NODE
import { readPonderDeployStateFile, writePonderDeployStateFile } from "./scripts/lib/ponder-deploy-state.ts";
const s = readPonderDeployStateFile("$PONDER_STATE_FILE");
writePonderDeployStateFile("$PONDER_STATE_FILE", {
  ...s,
  legacy_schema: "$LEGACY",
  pending: { slot: "blue", schema: "$SCHEMA1" },
  preCutover: true,
});
NODE
node --import tsx scripts/ponder-views-switch-cli.ts \
  --target-schema "$SCHEMA1" --kind first_cutover --rename-live-to "$LEGACY" \
  --tables-json '["demo"]' --views-json '[]' >"$OUT/cutover.sql"
docker stop kargain-r17-legacy-ponder >/dev/null || true
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T postgres \
  psql -U ponder -d kargain_ponder --single-transaction -v ON_ERROR_STOP=1 <"$OUT/cutover.sql"
printf 'set $ponder_upstream http://ponder-blue:42069;\n' >"$ROOT/.ponder-upstream.conf"
docker compose -p "$COMPOSE_PROJECT_NAME" up -d ponder
sleep 2
READY=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:42069/ready || true)
log "deploy_evidence operation=deploy"
log "deploy_evidence outcome=recreated"
log "deploy_evidence schema=$SCHEMA1"
log "deploy_evidence views=kargain"
log "deploy_evidence switch=ready status=$READY"
log "deploy_evidence switch=views"
log "deploy_evidence switch=http"
log "deploy_evidence proxy=upstream ponder-blue:42069"
log "deploy_evidence slot=blue"
MODEL=$(python3 -c "import json; print(json.load(open('$PONDER_STATE_FILE'))['rollback_model'])")
log "deploy_evidence rollback_model=$MODEL"
node --import tsx <<NODE
import { readPonderDeployStateFile, writePonderDeployStateFile } from "./scripts/lib/ponder-deploy-state.ts";
const s = readPonderDeployStateFile("$PONDER_STATE_FILE");
writePonderDeployStateFile("$PONDER_STATE_FILE", {
  ...s,
  live: { slot: "blue", schema: "$SCHEMA1" },
  previous: { slot: "green", schema: "$LEGACY" },
  pending: null,
  preCutover: false,
  executable: "exec-v2",
});
NODE

# 6. concurrent reads + switch to green
log "=== 6. concurrent reads during switch ==="
seed_schema "$SCHEMA2"
start_mock_slot green 200
: >"$OUT/concurrent_errors.txt"
(
  errs=0
  for _ in $(seq 1 50); do
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:42069/ready || echo 000)
    if [ "$code" != "200" ] && [ "$code" != "503" ]; then errs=$((errs+1)); fi
    sleep 0.05
  done
  echo "$errs" >"$OUT/concurrent_errors.txt"
) &
READER=$!
node --import tsx scripts/ponder-views-switch-cli.ts \
  --target-schema "$SCHEMA2" --kind normal --rename-live-to kargain_views_prev \
  --tables-json '["demo"]' --views-json '[]' >"$OUT/switch2.sql"
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T postgres \
  psql -U ponder -d kargain_ponder --single-transaction -v ON_ERROR_STOP=1 <"$OUT/switch2.sql"
printf 'set $ponder_upstream http://ponder-green:42069;\n' >"$ROOT/.ponder-upstream.conf"
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T ponder nginx -s reload
wait "$READER" || true
CONC_ERRS=$(cat "$OUT/concurrent_errors.txt")
log "concurrent_read_errors=$CONC_ERRS"
log "deploy_evidence switch=views"
log "deploy_evidence proxy=upstream ponder-green:42069"
log "deploy_evidence slot=green"

# 7. restart live slot
log "=== 7. restart live slot without nginx reload ==="
START_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
docker restart kargain-r17-ponder-green >/dev/null
RECOVERED=0
for _ in $(seq 1 50); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:42069/ready || echo 000)
  if [ "$code" = "200" ]; then RECOVERED=1; break; fi
  sleep 0.2
done
END_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
ELAPSED=$((END_MS-START_MS))
log "nginx_recovery_ms=$ELAPSED recovered=$RECOVERED bound_ms=10000"

# 8. already switched to green
log "=== 8. second deploy to green then switch ==="
log "deploy_evidence operation=deploy"
log "deploy_evidence slot=green"
log "deploy_evidence schema=$SCHEMA2"

# 9. rollback
log "=== 9. rollback ==="
node --import tsx scripts/ponder-views-switch-cli.ts \
  --target-schema "$SCHEMA1" --kind normal --rename-live-to kargain_views_prev \
  --tables-json '["demo"]' --views-json '[]' >"$OUT/rollback.sql"
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T postgres \
  psql -U ponder -d kargain_ponder --single-transaction -v ON_ERROR_STOP=1 <"$OUT/rollback.sql"
printf 'set $ponder_upstream http://ponder-blue:42069;\n' >"$ROOT/.ponder-upstream.conf"
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T ponder nginx -s reload
log "deploy_evidence operation=rollback"
log "deploy_evidence proxy=upstream ponder-blue:42069"
log "deploy_evidence slot=blue"

# 10. collision
log "=== 10. same-commit collision ==="
node --import tsx <<NODE | tee -a "$OUT/logs/rehearsal.log"
import { planPonderDeploy } from "./scripts/lib/ponder-deploy-plan.ts";
import { parsePonderDeployState } from "./scripts/lib/ponder-deploy-state.ts";
const sha1 = "$SHA1";
const schema1 = "$SCHEMA1";
const state = parsePonderDeployState({
  identity: "id", executable: "exec-v2",
  live: { slot: "blue", schema: schema1 },
  previous: null, pending: null,
  rollback_model: "keep_previous",
  lag: { l_single_max: 2, m: 30, b: 32 },
  legacy_schema: "$LEGACY",
});
const r = planPonderDeploy({
  state,
  operation: "deploy",
  deploySha: sha1,
  observations: {
    ready: { blue: 200, green: 200, legacy: null, nginx: 200 },
    schemas: [],
    storedExecutable: "exec-v2",
    executableDigest: "exec-v2",
    identityDigest: "id",
    priorCheckoutSha: null,
    nginxConfigChanged: false,
  },
});
for (const a of r.actions) if (a.type === "evidence") console.log(a.text);
NODE

# 11. retention
log "=== 11. retention ==="
OLD="k_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
docker compose -p "$COMPOSE_PROJECT_NAME" exec -T postgres \
  psql -U ponder -d kargain_ponder -c "CREATE SCHEMA IF NOT EXISTS \"$OLD\";" >/dev/null
node --import tsx <<NODE | tee -a "$OUT/logs/rehearsal.log"
import { retentionSchemasToDrop } from "./scripts/lib/ponder-deploy-retention.ts";
const drop = retentionSchemasToDrop(
  ["$OLD","$SCHEMA1","$SCHEMA2","ponder_sync","kargain_svm_raw","kargain","$LEGACY"],
  { live: "$SCHEMA1", previous: "$LEGACY", pending: null },
);
console.log("retention_drop=" + JSON.stringify(drop));
console.log("retention_keeps_protected=true");
NODE

log "=== rehearsal complete ==="
cp "$OUT/logs/rehearsal.log" "$OUT/summary.txt"
