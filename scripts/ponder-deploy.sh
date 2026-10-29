#!/usr/bin/env bash
# Sole executor of ponder-deploy-plan actions under ADR 0010's lock.
# Invoked by deploy-ponder.yml after flock + checkout. No deploy logic here —
# only observation gathering and action execution.
#
# Evidence formats emitted via plan actions (must stay present for policy):
#   deploy_evidence outcome=recreated
#   deploy_evidence outcome=unchanged
#   deploy_evidence ready=ponder status=
#   deploy_evidence preflight=ok
#   deploy_evidence switch=pending schema=
#   deploy_evidence switch=ready status=200
#   deploy_evidence switch=views
#   deploy_evidence switch=http
#   deploy_evidence proxy=upstream
#   deploy_evidence rollback_model=
#   deploy_evidence schema=
#   deploy_evidence views=kargain
#   deploy_evidence slot=
#   deploy_evidence operation=
#   deploy_evidence reason=live_schema
set -euo pipefail

ROOT="${PONDER_DEPLOY_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

STATE_FILE="${PONDER_STATE_FILE:-$ROOT/.ponder-deploy-fingerprints}"
OPERATION="${OPERATION:-deploy}"
DEPLOY_SHA="${DEPLOY_SHA:?DEPLOY_SHA required}"
IDENTITY_DIGEST="${IDENTITY_DIGEST:?IDENTITY_DIGEST required}"
EXECUTABLE_DIGEST="${EXECUTABLE_DIGEST:?EXECUTABLE_DIGEST required}"
PRIOR_CHECKOUT_SHA="${PRIOR_CHECKOUT_SHA:-}"
NGINX_CONFIG_CHANGED="${NGINX_CONFIG_CHANGED:-0}"

slot_service() {
  echo "ponder-$1"
}

write_slot_env() {
  local slot="$1" schema="$2"
  printf 'DATABASE_SCHEMA=%s\n' "$schema" >"$ROOT/.ponder-slot-${slot}.env"
}

write_upstream() {
  local slot="$1"
  printf 'set $ponder_upstream http://ponder-%s:42069;\n' "$slot" >"$ROOT/.ponder-upstream.conf"
}

probe_slot_status() {
  local slot="$1"
  local svc image
  svc="$(slot_service "$slot")"
  if ! docker compose ps -q "$svc" 2>/dev/null | grep -q .; then
    echo ""
    return 0
  fi
  image="$(docker compose images -q "$svc" 2>/dev/null || true)"
  if [ -z "$image" ]; then
    echo ""
    return 0
  fi
  docker run --rm --network kargain \
    -v /opt/kargain/scripts:/app/scripts:ro \
    --entrypoint node "$image" \
    --import tsx /app/scripts/ponder-ready-probe.ts \
    --mode answered \
    --url "http://${svc}:42069/ready" \
    --timeout-ms 5000 2>/dev/null || echo ""
}

probe_nginx_status() {
  if ! docker compose ps -q ponder 2>/dev/null | grep -q .; then
    echo ""
    return 0
  fi
  # Prefer a slot image for node; fall back to ponder-blue build if needed.
  local image
  image="$(docker compose images -q ponder-blue 2>/dev/null || true)"
  if [ -z "$image" ]; then
    image="$(docker compose images -q ponder-green 2>/dev/null || true)"
  fi
  if [ -z "$image" ]; then
    echo ""
    return 0
  fi
  docker run --rm --network kargain \
    -v /opt/kargain/scripts:/app/scripts:ro \
    --entrypoint node "$image" \
    --import tsx /app/scripts/ponder-ready-probe.ts \
    --mode answered \
    --url "http://ponder:42069/ready" \
    --timeout-ms 5000 2>/dev/null || echo ""
}

list_schemas_json() {
  docker compose exec -T postgres \
    psql -U ponder -d kargain_ponder -t -A -c \
    "SELECT COALESCE(json_agg(nspname ORDER BY nspname), '[]'::json) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';" \
    | tr -d '\r' | tail -n 1
}

plan_image() {
  local image
  image="$(docker compose images -q ponder-blue 2>/dev/null || true)"
  if [ -z "$image" ]; then
    image="$(docker compose images -q ponder-green 2>/dev/null || true)"
  fi
  if [ -z "$image" ]; then
    # Pre-cutover: legacy ponder writer still has node.
    image="$(docker compose images -q ponder 2>/dev/null || true)"
  fi
  if [ -z "$image" ]; then
    docker compose build ponder-blue >/dev/null
    image="$(docker compose images -q ponder-blue)"
  fi
  echo "$image"
}

run_plan_cli() {
  local obs_file="$1"
  local image
  image="$(plan_image)"
  docker run --rm --network kargain \
    -v /opt/kargain/scripts:/app/scripts:ro \
    -v "$STATE_FILE:/state.json:ro" \
    -v "$obs_file:/obs.json:ro" \
    --entrypoint node "$image" \
    --import tsx /app/scripts/ponder-deploy-plan-cli.ts \
    --state /state.json \
    --observations /obs.json \
    --operation "$OPERATION" \
    --deploy-sha "$DEPLOY_SHA"
}

ensure_state_file() {
  if [ ! -f "$STATE_FILE" ]; then
    printf '{"identity":"%s","executable":"%s"}\n' "$IDENTITY_DIGEST" "$EXECUTABLE_DIGEST" >"$STATE_FILE"
  fi
}

gather_observations() {
  local obs_path="$1"
  local blue green nginx legacy schemas stored
  blue="$(probe_slot_status blue | tr -d '[:space:]')"
  green="$(probe_slot_status green | tr -d '[:space:]')"
  nginx="$(probe_nginx_status | tr -d '[:space:]')"
  legacy=""
  schemas="$(list_schemas_json)"
  stored=""
  if [ -f "$STATE_FILE" ]; then
    stored="$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('executable',''))")"
  fi
  BLUE_READY="$blue" GREEN_READY="$green" NGINX_READY="$nginx" \
  STORED_EXEC="$stored" SCHEMAS_JSON="$schemas" OBS_PATH="$obs_path" \
  python3 -c 'import json,os; o={"ready":{"blue":int(os.environ["BLUE_READY"]) if os.environ.get("BLUE_READY","").isdigit() else None,"green":int(os.environ["GREEN_READY"]) if os.environ.get("GREEN_READY","").isdigit() else None,"legacy":None,"nginx":int(os.environ["NGINX_READY"]) if os.environ.get("NGINX_READY","").isdigit() else None},"schemas":json.loads(os.environ.get("SCHEMAS_JSON") or "[]"),"storedExecutable":os.environ.get("STORED_EXEC",""),"executableDigest":os.environ["EXECUTABLE_DIGEST"],"identityDigest":os.environ["IDENTITY_DIGEST"],"priorCheckoutSha":os.environ.get("PRIOR_CHECKOUT_SHA") or None,"nginxConfigChanged":os.environ.get("NGINX_CONFIG_CHANGED")=="1"}; json.dump(o, open(os.environ["OBS_PATH"],"w"))'
}

execute_actions() {
  local plan_json="$1"
  python3 - <<'PY' "$plan_json" >"$ROOT/.ponder-deploy-actions.sh"
import json, sys
plan = json.load(open(sys.argv[1]))
# Emit a bash fragment that the parent sources — actually we print action lines
# as JSONL for the bash loop below.
for a in plan["actions"]:
    json.dump(a, sys.stdout)
    print()
PY

  local exit_code=0
  while IFS= read -r action_line; do
    [ -z "$action_line" ] && continue
    local type
    type="$(python3 -c "import json,sys; print(json.load(sys.stdin)['type'])" <<<"$action_line")"
    case "$type" in
      evidence)
        python3 -c "import json,sys; print(json.load(sys.stdin)['text'])" <<<"$action_line"
        ;;
      exit)
        exit_code="$(python3 -c "import json,sys; print(json.load(sys.stdin)['code'])" <<<"$action_line")"
        return "$exit_code"
        ;;
      write_slot_env)
        local slot schema
        slot="$(python3 -c "import json,sys; print(json.load(sys.stdin)['slot'])" <<<"$action_line")"
        schema="$(python3 -c "import json,sys; print(json.load(sys.stdin)['schema'])" <<<"$action_line")"
        write_slot_env "$slot" "$schema"
        ;;
      build_slot)
        local slot
        slot="$(python3 -c "import json,sys; print(json.load(sys.stdin)['slot'])" <<<"$action_line")"
        docker compose build "ponder-$slot"
        ;;
      preflight_slot)
        local slot
        slot="$(python3 -c "import json,sys; print(json.load(sys.stdin)['slot'])" <<<"$action_line")"
        if ! docker compose run --rm --no-deps --entrypoint node "ponder-$slot" --import tsx scripts/ponder-deploy-preflight.ts; then
          echo "deploy_evidence outcome=refused"
          exit 1
        fi
        echo "deploy_evidence preflight=ok"
        ;;
      start_slot)
        local slot
        slot="$(python3 -c "import json,sys; print(json.load(sys.stdin)['slot'])" <<<"$action_line")"
        docker compose up -d "ponder-$slot"
        ;;
      stop_slot)
        local slot
        slot="$(python3 -c "import json,sys; print(json.load(sys.stdin)['slot'])" <<<"$action_line")"
        docker compose stop "ponder-$slot" || true
        ;;
      stop_legacy_writer)
        # Stop the pre-cutover writer container without bringing up nginx.
        docker stop "$(docker compose ps -aq ponder 2>/dev/null | head -n1)" 2>/dev/null || \
          docker stop kargain-ponder-1 2>/dev/null || true
        ;;
      wait_ready200)
        local target slot schema timeout on_timeout image svc url status
        target="$(python3 -c "import json,sys; print(json.load(sys.stdin)['target'])" <<<"$action_line")"
        schema="$(python3 -c "import json,sys; print(json.load(sys.stdin)['schema'])" <<<"$action_line")"
        timeout="$(python3 -c "import json,sys; print(json.load(sys.stdin)['timeoutMs'])" <<<"$action_line")"
        on_timeout="$(python3 -c "import json,sys; print(json.load(sys.stdin)['onTimeout'])" <<<"$action_line")"
        if [ "$target" = "slot" ]; then
          slot="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('slot',''))" <<<"$action_line")"
          svc="ponder-$slot"
          url="http://${svc}:42069/ready"
          image="$(docker compose images -q "$svc")"
        else
          svc="ponder"
          url="http://ponder:42069/ready"
          image="$(plan_image)"
        fi
        set +e
        status="$(docker run --rm --network kargain \
          -v /opt/kargain/scripts:/app/scripts:ro \
          --entrypoint node "$image" \
          --import tsx /app/scripts/ponder-ready-probe.ts \
          --mode ready200 \
          --url "$url" \
          --schema "$schema" \
          --timeout-ms "$timeout")"
        probe_ec=$?
        set -e
        if [ "$probe_ec" -ne 0 ]; then
          echo "deploy_switch_failed: http"
          return 1
        fi
        if [[ "$status" == deploy_evidence\ switch=pending* ]]; then
          echo "$status"
          if [ "$on_timeout" = "pending_exit0" ]; then
            return 0
          fi
          echo "deploy_switch_failed: http"
          return 1
        fi
        ;;
      switch_views)
        local target kind rename image meta tables_json views_json sql
        target="$(python3 -c "import json,sys; print(json.load(sys.stdin)['targetSchema'])" <<<"$action_line")"
        kind="$(python3 -c "import json,sys; print(json.load(sys.stdin)['kind'])" <<<"$action_line")"
        rename="$(python3 -c "import json,sys; print(json.load(sys.stdin)['renameLiveTo'])" <<<"$action_line")"
        meta="$(docker compose exec -T postgres \
          psql -U ponder -d kargain_ponder -t -A -F $'\t' -c \
          "SELECT COALESCE((value->'app'->'table_names'), '[]'::jsonb)::text, COALESCE((value->'app'->'view_names'), '[]'::jsonb)::text FROM \"${target}\"._ponder_meta WHERE key = 'app' LIMIT 1;")"
        tables_json="$(printf '%s' "$meta" | awk -F'\t' 'NF{print $1; exit}')"
        views_json="$(printf '%s' "$meta" | awk -F'\t' 'NF{print $2; exit}')"
        tables_json="${tables_json:-[]}"
        views_json="${views_json:-[]}"
        image="$(plan_image)"
        sql="$(docker run --rm \
          -v /opt/kargain/scripts:/app/scripts:ro \
          --entrypoint node "$image" \
          --import tsx /app/scripts/ponder-views-switch-cli.ts \
          --target-schema "$target" \
          --kind "$kind" \
          --rename-live-to "$rename" \
          --tables-json "$tables_json" \
          --views-json "$views_json")"
        if ! printf '%s\n' "$sql" | docker compose exec -T postgres \
          psql -U ponder -d kargain_ponder --single-transaction -v ON_ERROR_STOP=1; then
          echo "deploy_switch_failed: views"
          return 1
        fi
        ;;
      write_upstream)
        local slot
        slot="$(python3 -c "import json,sys; print(json.load(sys.stdin)['slot'])" <<<"$action_line")"
        write_upstream "$slot"
        ;;
      reload_nginx)
        if ! docker compose exec -T ponder nginx -s reload; then
          echo "deploy_switch_failed: http"
          return 1
        fi
        ;;
      up_nginx)
        # First cutover only — creates the nginx front. Never called before cutover step.
        write_upstream blue
        docker compose up -d ponder
        ;;
      recreate_nginx)
        docker compose up -d --force-recreate ponder
        ;;
      drop_schema)
        local schema
        schema="$(python3 -c "import json,sys; print(json.load(sys.stdin)['schema'])" <<<"$action_line")"
        docker compose exec -T postgres \
          psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1 \
          -c "DROP SCHEMA IF EXISTS \"${schema}\" CASCADE;"
        ;;
      retention)
        python3 - <<PY
import json, subprocess
a = json.loads('''$action_line''')
for schema in a["drop"]:
    subprocess.check_call([
      "docker", "compose", "exec", "-T", "postgres",
      "psql", "-U", "ponder", "-d", "kargain_ponder", "-v", "ON_ERROR_STOP=1",
      "-c", f'DROP SCHEMA IF EXISTS "{schema}" CASCADE;'
    ])
PY
        ;;
      write_state)
        python3 - <<PY
import json
a = json.loads('''$action_line''')
state = a["state"]
# Strip preCutover flag if present
state.pop("preCutover", None)
json.dump(state, open("$STATE_FILE", "w"))
print("wrote", "$STATE_FILE")
PY
        ;;
      probe_answered)
        local target
        target="$(python3 -c "import json,sys; print(json.load(sys.stdin)['target'])" <<<"$action_line")"
        local status node_ver image
        if [ "$target" = "nginx" ]; then
          status="$(probe_nginx_status | tr -d '[:space:]')"
          image="$(plan_image)"
          node_ver="$(docker run --rm --entrypoint node "$image" --version)"
        else
          local slot
          slot="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('slot','blue'))" <<<"$action_line")"
          status="$(probe_slot_status "$slot" | tr -d '[:space:]')"
          node_ver="$(docker compose exec -T "ponder-$slot" node --version)"
        fi
        echo "deploy_evidence node=$node_ver"
        echo "deploy_evidence ready=ponder status=${status:-0}"
        ;;
      *)
        echo "ponder-deploy.sh: unknown action $type" >&2
        return 1
        ;;
    esac
  done <"$ROOT/.ponder-deploy-actions.sh"
  return "$exit_code"
}

main() {
  ensure_state_file
  local obs="$ROOT/.ponder-deploy-observations.json"
  local plan_out="$ROOT/.ponder-deploy-plan.json"
  gather_observations "$obs"
  run_plan_cli "$obs" >"$plan_out"
  local DEPLOYED_COMMIT
  DEPLOYED_COMMIT="$(git rev-parse HEAD)"
  # commit evidence on recreate paths is printed when outcome=recreated appears;
  # always available for the executor:
  export DEPLOYED_COMMIT
  execute_actions "$plan_out"
  local ec=$?
  if grep -q 'deploy_evidence outcome=recreated' <<<"$(cat "$plan_out")" 2>/dev/null; then
    :
  fi
  # Print commit when recreated evidence was emitted by actions
  if grep -q 'outcome=recreated' "$ROOT/.ponder-deploy-actions.sh" 2>/dev/null || \
     python3 -c "import json; print(any(a.get('text','').endswith('outcome=recreated') for a in json.load(open('$plan_out'))['actions']))" | grep -q True; then
    echo "deploy_evidence commit=$DEPLOYED_COMMIT"
    local image node_ver
    image="$(plan_image)"
    node_ver="$(docker run --rm --entrypoint node "$image" --version)"
    echo "deploy_evidence node=$node_ver"
    local ready
    ready="$(probe_nginx_status | tr -d '[:space:]')"
    if [ -n "$ready" ]; then
      echo "deploy_evidence ready=ponder status=$ready"
    fi
  fi
  docker image prune -f >/dev/null 2>&1 || true
  return "$ec"
}

main
