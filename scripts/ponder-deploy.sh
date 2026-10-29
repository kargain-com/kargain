#!/usr/bin/env bash
# Sole executor of ponder-deploy-plan actions under ADR 0010's lock (ADR 0015 / #73).
# Invoked by deploy-ponder.yml after flock + checkout. No deploy logic here —
# only observation gathering and action execution.
#
# Evidence lines print only after the step that proves them (or via plan evidence).
# No || true on a step whose failure changes the outcome.
set -euo pipefail

ROOT="${PONDER_DEPLOY_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

STATE_FILE="${PONDER_STATE_FILE:?PONDER_STATE_FILE required}"
case "$STATE_FILE" in
  /*) ;;
  *)
    echo "deploy_state_invalid: PONDER_STATE_FILE must be absolute"
    exit 1
    ;;
esac

DEPLOY_SHA="${DEPLOY_SHA:?DEPLOY_SHA required}"
OPERATION="${OPERATION:?OPERATION required}"
EVENT_NAME="${EVENT_NAME:?EVENT_NAME required}"
IDENTITY_DIGEST="${IDENTITY_DIGEST:?IDENTITY_DIGEST required}"
EXECUTABLE_DIGEST="${EXECUTABLE_DIGEST:?EXECUTABLE_DIGEST required}"

case "$OPERATION" in
  deploy|hold|rollback) ;;
  *)
    echo "deploy_observation_failed: operation"
    exit 1
    ;;
esac
case "$EVENT_NAME" in
  push|workflow_dispatch) ;;
  *)
    echo "deploy_observation_failed: event_name"
    exit 1
    ;;
esac

LEGACY_IMAGE_TAG="kargain-ponder:legacy"
WORK="${ROOT}/.ponder-deploy-work"
UPSTREAM_FILE="${ROOT}/.ponder-upstream.conf"
# Policy-pinned evidence formats (printed by plan `evidence` actions / emit helpers):
# deploy_evidence outcome=recreated
# deploy_evidence outcome=unchanged
# deploy_evidence preflight=ok
# deploy_evidence ready=ponder status=
# deploy_evidence node=
DEPLOYED_COMMIT="$(git rev-parse HEAD)"
mkdir -p "$WORK"

# Host Node for CLIs — never builds a writer image for plan/state I/O (#73).
run_node() {
  (
    cd "$ROOT"
    node --import tsx "$@"
  )
}

slot_service() {
  echo "ponder-$1"
}

write_slot_env() {
  local slot="$1" schema="$2"
  printf 'DATABASE_SCHEMA=%s\n' "$schema" >"${ROOT}/.ponder-slot-${slot}.env"
}

write_upstream_target() {
  local slot="$1"
  case "$slot" in
    blue|green) ;;
    *)
      echo "deploy_observation_failed: upstream_slot"
      return 1
      ;;
  esac
  printf 'set $ponder_upstream http://ponder-%s:42069;\n' "$slot" >"$UPSTREAM_FILE"
}

save_upstream_backup() {
  if [ -f "$UPSTREAM_FILE" ]; then
    cp "$UPSTREAM_FILE" "$WORK/upstream.prev"
  else
    rm -f "$WORK/upstream.prev"
  fi
}

restore_upstream_backup() {
  if [ -f "$WORK/upstream.prev" ]; then
    cp "$WORK/upstream.prev" "$UPSTREAM_FILE"
    docker compose exec -T ponder nginx -s reload
  fi
}

nginx_config_digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${ROOT}/ops/nginx/ponder.conf" | awk '{print $1}'
  else
    shasum -a 256 "${ROOT}/ops/nginx/ponder.conf" | awk '{print $1}'
  fi
}

# Typed probe: status=<code> | no_answer | probe_failed (via ready-probe JSON).
probe_url_json() {
  local url="$1"
  local out ec
  set +e
  out="$(run_node scripts/ponder-ready-probe.ts \
    --mode answered \
    --format json \
    --url "$url" \
    --timeout-ms 5000 2>/dev/null)"
  ec=$?
  set -e
  if [ "$ec" -ne 0 ]; then
    if printf '%s' "$out" | grep -q '"kind"'; then
      printf '%s\n' "$out" | tail -n 1
    else
      printf '%s\n' '{"kind":"probe_failed","detail":"probe_cli_failed"}'
    fi
    return 0
  fi
  printf '%s\n' "$out" | tail -n 1
}

probe_slot_json() {
  local slot="$1"
  local svc
  svc="$(slot_service "$slot")"
  if ! docker compose ps -q "$svc" 2>/dev/null | grep -q .; then
    printf '%s\n' '{"kind":"no_answer"}'
    return 0
  fi
  # Reach slot on the compose network from a one-shot container that already exists
  # only when a writer image is present; otherwise host cannot resolve the name.
  # Prefer docker compose exec into the slot itself.
  if docker compose exec -T "$svc" true >/dev/null 2>&1; then
    local out ec
    set +e
    out="$(docker compose exec -T "$svc" node --import tsx /app/scripts/ponder-ready-probe.ts \
      --mode answered --format json --url "http://127.0.0.1:42069/ready" --timeout-ms 5000 2>/dev/null)"
    ec=$?
    set -e
    if [ "$ec" -ne 0 ]; then
      if printf '%s' "$out" | grep -q '"kind"'; then
        printf '%s\n' "$out" | tail -n 1
      else
        printf '%s\n' '{"kind":"probe_failed","detail":"slot_probe_failed"}'
      fi
      return 0
    fi
    printf '%s\n' "$out" | tail -n 1
    return 0
  fi
  printf '%s\n' '{"kind":"no_answer"}'
}

probe_nginx_json() {
  if ! nginx_pinned_up; then
    printf '%s\n' '{"kind":"no_answer"}'
    return 0
  fi
  # Host → published :42069 (no Docker network name literal in the probe URL).
  probe_url_json "http://127.0.0.1:42069/ready"
}

list_schemas() {
  docker compose exec -T postgres \
    psql -U ponder -d kargain_ponder -t -A -c \
    "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY 1;" \
    | tr -d '\r' | sed '/^$/d'
}

# Amendment rule 6: phase from labelled ponder container, not Compose file list.
compose_project_name() {
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    printf '%s\n' "$COMPOSE_PROJECT_NAME"
    return 0
  fi
  basename "$ROOT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-'
}

# Pinned nginx image from the repo Compose file (digest pin), not the merged
# override that may temporarily replace ponder with the legacy writer.
pinned_nginx_image() {
  docker compose -f "$ROOT/docker-compose.yml" config --images 2>/dev/null \
    | grep -E '^nginx:' | head -n1 | tr -d '\r'
}

labelled_ponder_id() {
  local project
  project="$(compose_project_name)"
  docker ps -aq \
    --filter "label=com.docker.compose.project=${project}" \
    --filter "label=com.docker.compose.service=ponder" \
    | head -n1 | tr -d '\r'
}

# Post-cutover iff labelled ponder container image is the pinned nginx image.
nginx_pinned_up() {
  local id pinned actual
  id="$(labelled_ponder_id)"
  [ -n "$id" ] || return 1
  pinned="$(pinned_nginx_image)"
  [ -n "$pinned" ] || return 1
  actual="$(docker inspect -f '{{.Config.Image}}' "$id" | tr -d '\r')"
  [ "$actual" = "$pinned" ]
}

# Pre-cutover: labelled ponder exists and is not the pinned nginx image.
pre_cutover_observed() {
  local id
  id="$(labelled_ponder_id)"
  [ -n "$id" ] || return 1
  if nginx_pinned_up; then
    return 1
  fi
  return 0
}

legacy_image_tagged() {
  docker image inspect "$LEGACY_IMAGE_TAG" >/dev/null 2>&1
}

legacy_image_id() {
  local id
  id="$(labelled_ponder_id)"
  if [ -n "$id" ] && ! nginx_pinned_up; then
    docker inspect -f '{{.Image}}' "$id" | tr -d '\r'
    return 0
  fi
  if legacy_image_tagged; then
    docker image inspect "$LEGACY_IMAGE_TAG" --format '{{.Id}}'
    return 0
  fi
  printf '\n'
}

action_field() {
  local field="$1"
  python3 - "$WORK/action.json" "$field" <<'PY'
import json, sys
obj = json.load(open(sys.argv[1]))
key = sys.argv[2]
val = obj.get(key)
if isinstance(val, bool):
    print("true" if val else "false")
elif val is None:
    print("")
elif isinstance(val, (dict, list)):
    print(json.dumps(val, separators=(",", ":")))
else:
    print(val)
PY
}

stop_writers_for_schema() {
  local schema="$1"
  local slot envf cur
  for slot in blue green; do
    envf="${ROOT}/.ponder-slot-${slot}.env"
    if [ -f "$envf" ]; then
      cur="$(grep -E '^DATABASE_SCHEMA=' "$envf" | head -n1 | cut -d= -f2- | tr -d '\r')"
      if [ "$cur" = "$schema" ]; then
        docker compose stop "ponder-${slot}" </dev/null >/dev/null
      fi
    fi
  done
}

# Low-level SQL drop — only invoked from retention (item 2). Quiet stdout.
retention_drop_one() {
  local schema="$1"
  stop_writers_for_schema "$schema"
  printf 'DROP SCHEMA IF EXISTS "%s" CASCADE;\n' "$schema" | docker compose exec -T postgres \
    psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1 -q >/dev/null
}

retention_apply_from_state() {
  list_schemas >"$WORK/schemas-retention.txt"
  PRE=0
  if pre_cutover_observed; then PRE=1; fi
  drop_json="$(run_node scripts/ponder-deploy-retention-cli.ts \
    --drop-list \
    --state "$STATE_FILE" \
    --schemas "$WORK/schemas-retention.txt" \
    --pre-cutover "$PRE")"
  python3 -c "import json,sys; print('\n'.join(json.loads(sys.argv[1])))" "$drop_json" \
    >"$WORK/retention-drop.txt"
  while IFS= read -r sch || [ -n "$sch" ]; do
    [ -z "$sch" ] && continue
    retention_drop_one "$sch"
  done <"$WORK/retention-drop.txt"
}

tear_down_new_pending() {
  local slot="$1"
  docker compose stop "ponder-${slot}" </dev/null >/dev/null
  PRE=0
  if pre_cutover_observed; then PRE=1; fi
  run_node scripts/ponder-deploy-state-cli.ts --clear-pending "$STATE_FILE" --pre-cutover "$PRE"
  # DROP only via retention keep set — refuses kargain while live/spare.
  retention_apply_from_state
}

restore_reused_on_timeout() {
  local slot="$1" failure_text="$2"
  echo "$failure_text"
  if [ -n "$slot" ]; then
    docker compose stop "ponder-${slot}" </dev/null >/dev/null || true
  fi
  # State was not mutated to consume the spare; leave nginx/live untouched.
  exit 1
}

gather_observations() {
  local pre=0 nginx_up=0 tagged=0
  if pre_cutover_observed; then pre=1; fi
  if nginx_pinned_up; then nginx_up=1; fi
  if legacy_image_tagged; then tagged=1; fi
  printf '%s' "$pre" >"$WORK/pre_cutover.txt"
  printf '%s' "$nginx_up" >"$WORK/nginx_pinned.txt"
  printf '%s' "$tagged" >"$WORK/legacy_tagged.txt"

  probe_slot_json blue >"$WORK/probe-blue.json"
  probe_slot_json green >"$WORK/probe-green.json"
  probe_nginx_json >"$WORK/probe-nginx.json"

  # probe_failed refuses before mutation
  for target in blue green nginx; do
    kind="$(python3 -c "import json; print(json.load(open('$WORK/probe-$target.json'))['kind'])")"
    if [ "$kind" = "probe_failed" ]; then
      echo "deploy_observation_failed: $target"
      exit 1
    fi
  done

  list_schemas >"$WORK/schemas.txt"
  legacy_image_id | tr -d '\r' >"$WORK/legacy_id.txt"
  nginx_config_digest >"$WORK/nginx_dig.txt"
  git rev-parse HEAD >"$WORK/deploy_commit.txt"

  python3 - "$WORK" "$DEPLOY_SHA" "$IDENTITY_DIGEST" "$EXECUTABLE_DIGEST" "$EVENT_NAME" <<'PY' >"$WORK/observations.json"
import json, pathlib, sys
work = pathlib.Path(sys.argv[1])
def read(name):
    return (work / name).read_text().replace("\r", "").rstrip("\n")
schemas = [s for s in read("schemas.txt").split("\n") if s]
legacy = read("legacy_id.txt")
pre = read("pre_cutover.txt") == "1"
nginx_up = read("nginx_pinned.txt") == "1"
tagged = read("legacy_tagged.txt") == "1"
running = []
for slot in ("blue", "green"):
    p = work / f"running-{slot}.txt"
    if p.exists() and p.read_text().strip() == "1":
        running.append(slot)
o = {
  "ready": {
    "blue": json.loads(read("probe-blue.json")),
    "green": json.loads(read("probe-green.json")),
    "nginx": json.loads(read("probe-nginx.json")),
  },
  "schemas": schemas,
  "executableDigest": sys.argv[4],
  "identityDigest": sys.argv[3],
  "deploySha": sys.argv[2],
  "deployCommit": read("deploy_commit.txt"),
  "nginxConfigDigest": read("nginx_dig.txt"),
  "eventName": sys.argv[5],
  "preCutoverObserved": pre,
  "nginxPinnedUp": nginx_up,
  "legacyImageId": legacy if legacy else None,
  "legacyImageTagged": tagged,
  "runningSlots": running,
  "slotImages": {"blue": None, "green": None},
}
print(json.dumps(o))
PY
}

for slot in blue green; do
  if docker compose ps -q "ponder-$slot" 2>/dev/null | grep -q .; then
    echo 1 >"$WORK/running-$slot.txt"
  else
    echo 0 >"$WORK/running-$slot.txt"
  fi
done

gather_observations

PRE="$(cat "$WORK/pre_cutover.txt")"
run_node scripts/ponder-deploy-plan-cli.ts \
  --state "$STATE_FILE" \
  --observations "$WORK/observations.json" \
  --operation "$OPERATION" \
  --pre-cutover "$PRE" >"$WORK/plan.json"

# Expand actions to jsonl on the host
python3 - "$WORK/plan.json" <<'PY' >"$WORK/actions.jsonl"
import json, sys
plan = json.load(open(sys.argv[1]))
for a in plan.get("actions") or []:
    print(json.dumps(a))
PY

exit_code=0
action_lines=()
while IFS= read -r action_line || [ -n "$action_line" ]; do
  [ -z "$action_line" ] && continue
  action_lines+=("$action_line")
done <"$WORK/actions.jsonl"

for action_line in "${action_lines[@]}"; do
  printf '%s\n' "$action_line" >"$WORK/action.json.tmp"
  mv -f "$WORK/action.json.tmp" "$WORK/action.json"
  type="$(action_field type)"

  case "$type" in
    evidence)
      text="$(action_field text)"
      echo "$text"
      # Named commit line once from git HEAD (policy pin); never $DEPLOY_SHA.
      if [[ "$text" == *"outcome=recreated"* ]] || [[ "$text" == *"outcome=unchanged"* ]]; then
        echo "deploy_evidence commit=$DEPLOYED_COMMIT"
      fi
      ;;
    exit)
      exit_code="$(action_field code)"
      exit "$exit_code"
      ;;
    write_slot_env)
      write_slot_env "$(action_field slot)" "$(action_field schema)"
      ;;
    build_image)
      commit="$(action_field commit)"
      docker build -f Dockerfile.ponder \
        --build-arg "KARGAIN_PONDER_COMMIT=$commit" \
        -t "kargain-ponder:$commit" \
        "$ROOT" </dev/null
      docker builder prune -f --filter until=72h </dev/null >&2
      docker image prune -f </dev/null >&2
      ;;
    tag_slot_image)
      slot="$(action_field slot)"
      commit="$(action_field commit)"
      if [ "$commit" = "legacy" ]; then
        docker tag "$LEGACY_IMAGE_TAG" "kargain-ponder-$slot"
      else
        docker tag "kargain-ponder:$commit" "kargain-ponder-$slot"
      fi
      ;;
    preflight_slot)
      slot="$(action_field slot)"
      expected="k_${DEPLOY_SHA}"
      if [ ! -f "$ROOT/.ponder-slot-$slot.env" ]; then
        echo "deploy_observation_failed: slot_env"
        exit 1
      fi
      actual="$(grep -E '^DATABASE_SCHEMA=' "$ROOT/.ponder-slot-$slot.env" | head -n1 | cut -d= -f2- | tr -d '\r')"
      if [ "$actual" != "$expected" ]; then
        echo "deploy_observation_failed: slot_schema"
        exit 1
      fi
      if ! docker compose run --rm --no-deps -T --entrypoint node "ponder-$slot" --import tsx scripts/ponder-deploy-preflight.ts </dev/null; then
        echo "deploy_evidence outcome=refused"
        exit 1
      fi
      ;;
    start_slot)
      slot="$(action_field slot)"
      docker compose up -d --no-build "ponder-$slot" </dev/null >/dev/null
      ;;
    stop_slot)
      slot="$(action_field slot)"
      docker compose stop "ponder-$slot" </dev/null >/dev/null
      ;;
    restart_slot)
      slot="$(action_field slot)"
      docker compose up -d --no-build --force-recreate "ponder-$slot" </dev/null >/dev/null
      ;;
    preserve_legacy_image)
      image_id="$(action_field imageId)"
      if [ -z "$image_id" ]; then
        image_id="$(legacy_image_id | tr -d '\r')"
      fi
      if [ -z "$image_id" ]; then
        echo "deploy_state_invalid: legacy_image_unknown"
        exit 1
      fi
      docker tag "$image_id" "$LEGACY_IMAGE_TAG"
      ;;
    stop_legacy_ponder)
      # Stop the labelled legacy writer by id (Compose file may already be post-cutover).
      _legacy_id="$(labelled_ponder_id)"
      if [ -n "$_legacy_id" ]; then
        docker stop "$_legacy_id" </dev/null
      fi
      ;;
    wait_answered)
      target="$(action_field target)"
      timeout_ms="$(action_field timeoutMs)"
      on_timeout="$(action_field onTimeout)"
      failure_text="$(action_field failureText)"
      if [ "$target" = "slot" ]; then
        slot="$(action_field slot)"
        # Discard probe status digits (item 5); detail stays on stderr.
        if ! docker compose exec -T "ponder-$slot" node --import tsx /app/scripts/ponder-ready-probe.ts \
          --mode answered --timeout-ms "$timeout_ms" --url "http://127.0.0.1:42069/ready" </dev/null >/dev/null; then
          if [ "$on_timeout" = "tear_down_new" ]; then
            echo "ponder_did_not_become_ready"
            tear_down_new_pending "$slot"
            exit 1
          fi
          if [ "$on_timeout" = "restore_reused" ]; then
            restore_reused_on_timeout "$slot" "${failure_text:-ponder_did_not_become_ready}"
          fi
          echo "ponder_did_not_become_ready"
          exit 1
        fi
      else
        if ! run_node scripts/ponder-ready-probe.ts \
          --mode answered --timeout-ms "$timeout_ms" --url "http://127.0.0.1:42069/ready" >/dev/null; then
          echo "ponder_did_not_become_ready"
          exit 1
        fi
      fi
      ;;
    wait_ready200)
      target="$(action_field target)"
      timeout_ms="$(action_field timeoutMs)"
      on_timeout="$(action_field onTimeout)"
      failure_text="$(action_field failureText)"
      schema="$(action_field schema)"
      if [ "$target" = "slot" ]; then
        slot="$(action_field slot)"
        set +e
        out="$(docker compose exec -T "ponder-$slot" node --import tsx /app/scripts/ponder-ready-probe.ts \
          --mode ready200 --timeout-ms "$timeout_ms" --schema "$schema" \
          --url "http://127.0.0.1:42069/ready" </dev/null 2>/dev/null)"
        ec=$?
        set -e
      else
        set +e
        out="$(run_node scripts/ponder-ready-probe.ts \
          --mode ready200 --timeout-ms "$timeout_ms" --schema "$schema" \
          --url "http://127.0.0.1:42069/ready" 2>/dev/null)"
        ec=$?
        set -e
      fi
      if [ "$ec" -ne 0 ]; then
        if [ "$on_timeout" = "pending_exit0" ]; then
          echo "deploy_evidence switch=pending schema=$schema"
          exit 0
        fi
        if [ "$on_timeout" = "restore_reused" ]; then
          restore_reused_on_timeout "${slot:-}" "${failure_text:-ponder_did_not_become_ready}"
        fi
        if [ "$target" = "nginx" ]; then
          echo "deploy_switch_failed: http"
          restore_upstream_backup
          exit 1
        fi
        echo "ponder_did_not_become_ready"
        exit 1
      fi
      # pending evidence line from probe (exit 0 with pending text)
      if printf '%s' "$out" | grep -q 'switch=pending'; then
        printf '%s\n' "$out"
        exit 0
      fi
      # Discard bare status digits (item 5).
      ;;
    write_upstream)
      slot="$(action_field slot)"
      save_upstream_backup
      write_upstream_target "$slot"
      ;;
    reload_nginx)
      if ! docker compose exec -T ponder nginx -s reload >/dev/null; then
        echo "deploy_switch_failed: http"
        restore_upstream_backup
        exit 1
      fi
      ;;
    up_nginx)
      docker compose up -d --no-build ponder </dev/null >/dev/null
      ;;
    recreate_nginx)
      docker compose up -d --no-build --force-recreate ponder </dev/null >/dev/null
      ;;
    retention)
      drop_json="$(action_field drop)"
      python3 -c "import json,sys; print('\n'.join(json.loads(sys.argv[1])))" "$drop_json" >"$WORK/retention-drop.txt"
      while IFS= read -r sch || [ -n "$sch" ]; do
        [ -z "$sch" ] && continue
        retention_drop_one "$sch"
      done <"$WORK/retention-drop.txt"
      ;;
    remove_images)
      imgs="$(action_field images)"
      python3 -c "import json,sys; print('\n'.join(json.loads(sys.argv[1])))" "$imgs" >"$WORK/rm-images.txt"
      while IFS= read -r img || [ -n "$img" ]; do
        [ -z "$img" ] && continue
        docker rmi "$img" </dev/null || true
      done <"$WORK/rm-images.txt"
      ;;
    write_state)
      # action_field dumps JSON; re-parse via python for write through owner
      python3 - "$WORK/action.json" <<'PY' >"$WORK/next-state.json"
import json, sys
obj = json.load(open(sys.argv[1]))
print(json.dumps(obj["state"]))
PY
      run_node scripts/ponder-deploy-state-cli.ts --write "$STATE_FILE" <"$WORK/next-state.json"
      ;;
    assert_spare_image)
      image="$(action_field image)"
      if ! docker image inspect "$image" >/dev/null 2>&1; then
        echo "deploy_rollback_failed: spare_image_missing"
        exit 1
      fi
      ;;
    *)
      echo "deploy_observation_failed: unknown_action_$type"
      exit 1
      ;;
  esac
done

exit 0
