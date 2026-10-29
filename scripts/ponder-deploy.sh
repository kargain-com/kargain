#!/usr/bin/env bash
# Sole executor of ponder-deploy-plan actions under ADR 0010's lock.
# Invoked by deploy-ponder.yml after flock + checkout. No deploy logic here —
# only observation gathering and action execution.
#
# Evidence lines are printed only when executing plan `evidence` actions, or
# after a step that measured the value (C1). Never invent status=0.
set -euo pipefail

ROOT="${PONDER_DEPLOY_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

# R13: $PONDER_STATE_FILE is the only state path; one container mount (C_STATE) serves
# every read and write.
STATE_FILE="${PONDER_STATE_FILE:?PONDER_STATE_FILE required}"
case "$STATE_FILE" in
  /*) ;;
  *)
    echo "deploy_state_invalid: PONDER_STATE_FILE must be absolute"
    exit 1
    ;;
esac
OPERATION="${OPERATION:-deploy}"
DEPLOY_SHA="${DEPLOY_SHA:?DEPLOY_SHA required}"
IDENTITY_DIGEST="${IDENTITY_DIGEST:?IDENTITY_DIGEST required}"
EXECUTABLE_DIGEST="${EXECUTABLE_DIGEST:?EXECUTABLE_DIGEST required}"
PRIOR_CHECKOUT_SHA="${PRIOR_CHECKOUT_SHA:-}"
# R8: no default — a missing event must not become the permissive one.
EVENT_NAME="${EVENT_NAME:?EVENT_NAME required}"
case "$EVENT_NAME" in
  push|workflow_dispatch) ;;
  *)
    echo "deploy_observation_failed: event_name"
    exit 1
    ;;
esac
LEGACY_IMAGE_TAG="kargain-ponder-legacy:cutover"
WORK="${ROOT}/.ponder-deploy-work"
UPSTREAM_FILE="${ROOT}/.ponder-upstream.conf"
# Container paths (A5: host mounts derive from ROOT).
C_SCRIPTS="/app/scripts"
C_WORK="/work"
C_STATE="/ponder-deploy-state.json"

mkdir -p "$WORK"

# --- helpers -----------------------------------------------------------------

slot_service() {
  echo "ponder-$1"
}

pick_node_service() {
  if docker compose images -q ponder-blue 2>/dev/null | grep -q .; then
    echo "ponder-blue"
    return 0
  fi
  if docker compose images -q ponder-green 2>/dev/null | grep -q .; then
    echo "ponder-green"
    return 0
  fi
  docker compose build ponder-blue >/dev/null
  echo "ponder-blue"
}

# Run node CLI with scripts + work + the one state file mounted (A4/A5/R13).
# Usage: run_node <args...>, or: printf data | run_node ...
run_node() {
  local svc
  svc="$(pick_node_service)"
  # </dev/null: compose run must not consume stdin (execute_actions reads actions.jsonl).
  docker compose run --rm --no-deps -T \
    -v "$ROOT/scripts:/app/scripts:ro" \
    -v "$WORK:/work" \
    -v "$STATE_FILE:${C_STATE}" \
    --entrypoint node \
    "$svc" \
    --import tsx \
    "$@" </dev/null
}

write_slot_env() {
  local slot="$1" schema="$2"
  printf 'DATABASE_SCHEMA=%s\n' "$schema" >"${ROOT}/.ponder-slot-${slot}.env"
}

write_upstream_target() {
  local target="$1"
  local host
  case "$target" in
    blue|green) host="ponder-${target}" ;;
    legacy) host="ponder-legacy" ;;
    *)
      echo "ponder-deploy.sh: bad upstream target $target" >&2
      return 1
      ;;
  esac
  printf 'set $ponder_upstream http://%s:42069;\n' "$host" >"$UPSTREAM_FILE"
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
    docker compose exec -T ponder nginx -s reload 2>/dev/null || true
  fi
}

nginx_config_digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${ROOT}/ops/nginx/ponder.conf" | awk '{print $1}'
  else
    shasum -a 256 "${ROOT}/ops/nginx/ponder.conf" | awk '{print $1}'
  fi
}

probe_url_json() {
  local url="$1"
  set +e
  local out ec
  out="$(run_node "${C_SCRIPTS}/ponder-ready-probe.ts" \
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
      printf '%s\n' '{"kind":"probe_failed","detail":"compose_run_failed"}'
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
  probe_url_json "http://${svc}:42069/ready"
}

probe_nginx_json() {
  if ! docker compose ps -q ponder 2>/dev/null | grep -q .; then
    printf '%s\n' '{"kind":"no_answer"}'
    return 0
  fi
  probe_url_json "http://ponder:42069/ready"
}

list_schemas_json() {
  docker compose exec -T postgres \
    psql -U ponder -d kargain_ponder -t -A -c \
    "SELECT COALESCE(json_agg(nspname ORDER BY nspname), '[]'::json) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';" \
    | tr -d '\r' | tail -n 1
}

# R1: database facts about schema kargain — base tables and the schema its views read.
# The SQL and the row parser are owned by ponder-deploy-state; this only runs them.
observe_kargain() {
  local sql row
  sql="$(run_node "${C_SCRIPTS}/ponder-deploy-state-cli.ts" --kargain-observation-sql)" || {
    echo "deploy_observation_failed: kargain_observation"
    exit 1
  }
  row="$(printf '%s\n' "$sql" | docker compose exec -T postgres \
    psql -U ponder -d kargain_ponder -t -A -F '|' -v ON_ERROR_STOP=1 \
    | tr -d '\r' | tail -n 1)" || {
    echo "deploy_observation_failed: kargain_observation"
    exit 1
  }
  printf '%s\n' "$row" >"$WORK/kargain_row.txt"
  if ! run_node "${C_SCRIPTS}/ponder-deploy-state-cli.ts" \
    --kargain-observation "${C_WORK}/kargain_row.txt" >"$WORK/kargain_obs.json"; then
    echo "deploy_observation_failed: kargain_observation"
    exit 1
  fi
}

# True when any container of the compose service is running or restarting.
service_active() {
  local ids id st
  ids="$(docker compose --profile legacy ps -aq "$1" | tr -d '\r')"
  for id in $ids; do
    st="$(docker inspect -f '{{.State.Status}}' "$id")"
    case "$st" in
      running|restarting) return 0 ;;
    esac
  done
  return 1
}

# True when the active `ponder` container is the nginx front (not a pre-#71 writer).
ponder_is_nginx() {
  local id
  id="$(docker compose ps -q ponder | head -n1 | tr -d '\r')"
  [ -n "$id" ] || return 1
  case "$(docker inspect -f '{{.Config.Image}}' "$id")" in
    nginx:*) return 0 ;;
  esac
  return 1
}

# R2: name the container that writes schema kargain: `ponder` (pre-#71 writer) or
# `ponder-legacy` (after a first-cutover rollback); empty when none runs. Sets
# KARGAIN_WRITER (not a command substitution: a refusal must print and exit this shell).
KARGAIN_WRITER=""
observe_kargain_writer() {
  local legacy=0 plain=0
  if service_active ponder-legacy; then legacy=1; fi
  if service_active ponder && ! ponder_is_nginx; then plain=1; fi
  if [ "$legacy" = "1" ] && [ "$plain" = "1" ]; then
    echo "deploy_observation_failed: kargain_writer"
    exit 1
  fi
  if [ "$legacy" = "1" ]; then
    KARGAIN_WRITER="ponder-legacy"
  elif [ "$plain" = "1" ]; then
    KARGAIN_WRITER="ponder"
  else
    KARGAIN_WRITER=""
  fi
}

legacy_image_id() {
  local id
  id="$(docker compose images -q ponder 2>/dev/null || true)"
  if [ -n "$id" ]; then
    if docker image inspect "$id" --format '{{json .Config}}' 2>/dev/null | grep -qi nginx; then
      :
    else
      printf '%s\n' "$id"
      return 0
    fi
  fi
  if docker image inspect "$LEGACY_IMAGE_TAG" >/dev/null 2>&1; then
    docker image inspect "$LEGACY_IMAGE_TAG" --format '{{.Id}}'
    return 0
  fi
  printf '\n'
}

action_field() {
  local field="$1"
  # Host-side read: avoids Docker Desktop bind-mount races where a just-written
  # action.json is truncated or briefly missing inside `compose run`.
  (
    cd "$ROOT"
    node --import tsx scripts/ponder-deploy-state-cli.ts \
      --action-field "$WORK/action.json" "$field"
  ) | tr -d '\r' | tail -n 1
}

stop_writers_for_schema() {
  local schema="$1"
  local slot envf cur
  for slot in blue green; do
    envf="${ROOT}/.ponder-slot-${slot}.env"
    if [ -f "$envf" ]; then
      cur="$(grep -E '^DATABASE_SCHEMA=' "$envf" | head -n1 | cut -d= -f2- | tr -d '\r')"
      if [ "$cur" = "$schema" ]; then
        docker compose stop "ponder-${slot}" </dev/null || return 1
      fi
    fi
  done
}

# Fail closed: every step returns non-zero explicitly (callers may run under `if !`,
# where `set -e` is off). The keep set is read from the state file at execution (R9).
drop_schema_via_owner() {
  local schema="$1"
  local sql
  stop_writers_for_schema "$schema" || return 1
  sql="$(run_node "${C_SCRIPTS}/ponder-deploy-retention-cli.ts" \
    --state "${C_STATE}" --drop-schema "$schema")" || return 1
  printf '%s\n' "$sql" | docker compose exec -T postgres \
    psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1 || return 1
}

# R14: teardown of the slot started in THIS run. Fails closed: every step prints its
# named line and returns non-zero; success only when pending is cleared in the state file.
# The state is cleared before the drop so the keep set the retention owner reads at
# execution no longer holds the schema being dropped.
tear_down_new_pending() {
  local slot="$1" schema="$2"
  if ! docker compose stop "ponder-${slot}" </dev/null; then
    echo "deploy_teardown_failed: stop"
    return 1
  fi
  if ! run_node "${C_SCRIPTS}/ponder-deploy-state-cli.ts" --clear-pending "${C_STATE}"; then
    echo "deploy_teardown_failed: pending_not_cleared"
    return 1
  fi
  if ! drop_schema_via_owner "$schema"; then
    echo "deploy_teardown_failed: drop_schema"
    return 1
  fi
}

emit_measured_commit() {
  DEPLOYED_COMMIT="${DEPLOYED_COMMIT:-$(git rev-parse HEAD)}"
  echo "deploy_evidence commit=$DEPLOYED_COMMIT"
}

emit_measured_node() {
  local slot="$1"
  local node_ver
  node_ver="$(docker compose exec -T "ponder-$slot" node --version | tr -d '\r')"
  echo "deploy_evidence node=$node_ver"
}

emit_measured_ready() {
  local probe code
  probe="$(probe_nginx_json)"
  printf '%s\n' "$probe" >"$WORK/ready-probe.json"
  code="$(run_node -e "
    const j = JSON.parse(require('fs').readFileSync('${C_WORK}/ready-probe.json', 'utf8'));
    if (j.kind === 'status') process.stdout.write(String(j.code));
  ")"
  if [ -n "$code" ]; then
    echo "deploy_evidence ready=ponder status=$code"
  fi
}

# --- observations + plan -----------------------------------------------------

require_state_file() {
  # A2: missing/unreadable → deploy_state_invalid; never invent.
  if [ ! -f "$STATE_FILE" ]; then
    echo "deploy_state_invalid: state file missing"
    exit 1
  fi
  if ! run_node "${C_SCRIPTS}/ponder-deploy-state-cli.ts" --read "${C_STATE}" \
    >"$WORK/state.file.json" 2>"$WORK/state.read.err"; then
    echo "deploy_state_invalid: state file unreadable"
    cat "$WORK/state.read.err" >&2 || true
    exit 1
  fi
}

gather_observations() {
  local obs_path="$1"
  local blue green nginx schemas legacy stored nginx_dig deploy_commit
  blue="$(probe_slot_json blue | tr -d '\r' | tail -n 1)"
  green="$(probe_slot_json green | tr -d '\r' | tail -n 1)"
  nginx="$(probe_nginx_json | tr -d '\r' | tail -n 1)"
  schemas="$(list_schemas_json)"
  observe_kargain
  observe_kargain_writer
  legacy="$(legacy_image_id | tr -d '\r' | tail -n 1)"
  nginx_dig="$(nginx_config_digest)"
  deploy_commit="$(git rev-parse HEAD)"
  stored="$(run_node -e "
    const s = JSON.parse(require('fs').readFileSync('${C_WORK}/state.file.json', 'utf8'));
    process.stdout.write(typeof s.executable === 'string' ? s.executable : '');
  ")"

  printf '%s\n' "$blue" >"$WORK/probe-blue.json"
  printf '%s\n' "$green" >"$WORK/probe-green.json"
  printf '%s\n' "$nginx" >"$WORK/probe-nginx.json"
  printf '%s\n' "$schemas" >"$WORK/schemas.json"
  # Host-side facts for the in-container assembler. Do not rely on `docker compose
  # run` inheriting the shell environment — it does not (A1/D1 rehearsal).
  printf '%s\n' "$KARGAIN_WRITER" >"$WORK/kargain_writer.txt"
  printf '%s\n' "$legacy" >"$WORK/legacy_id.txt"
  printf '%s\n' "$stored" >"$WORK/stored_exec.txt"
  printf '%s\n' "$nginx_dig" >"$WORK/nginx_dig.txt"
  printf '%s\n' "$DEPLOY_SHA" >"$WORK/deploy_sha.txt"
  printf '%s\n' "$deploy_commit" >"$WORK/deploy_commit.txt"
  printf '%s\n' "$IDENTITY_DIGEST" >"$WORK/identity_digest.txt"
  printf '%s\n' "$EXECUTABLE_DIGEST" >"$WORK/executable_digest.txt"
  printf '%s\n' "${PRIOR_CHECKOUT_SHA:-}" >"$WORK/prior_checkout_sha.txt"
  printf '%s\n' "$EVENT_NAME" >"$WORK/event_name.txt"

  run_node -e '
    const fs = require("fs");
    const read = (p) => fs.readFileSync(p, "utf8").replace(/\r?\n$/, "");
    const prior = read("/work/prior_checkout_sha.txt");
    const legacy = read("/work/legacy_id.txt");
    const o = {
      ready: {
        blue: JSON.parse(fs.readFileSync("/work/probe-blue.json", "utf8")),
        green: JSON.parse(fs.readFileSync("/work/probe-green.json", "utf8")),
        nginx: JSON.parse(fs.readFileSync("/work/probe-nginx.json", "utf8")),
      },
      schemas: JSON.parse(fs.readFileSync("/work/schemas.json", "utf8")),
      storedExecutable: read("/work/stored_exec.txt"),
      executableDigest: read("/work/executable_digest.txt"),
      identityDigest: read("/work/identity_digest.txt"),
      deploySha: read("/work/deploy_sha.txt"),
      deployCommit: read("/work/deploy_commit.txt"),
      priorCheckoutSha: prior.length === 40 ? prior : null,
      nginxConfigDigest: read("/work/nginx_dig.txt"),
      eventName: read("/work/event_name.txt"),
      legacyImageId: legacy.length > 0 ? legacy : null,
      ...(() => {
        const k = JSON.parse(fs.readFileSync("/work/kargain_obs.json", "utf8"));
        return {
          kargainHasBaseTables: k.kargainHasBaseTables,
          kargainViewsTarget: k.kargainViewsTarget,
        };
      })(),
      kargainWriter: read("/work/kargain_writer.txt") || null,
    };
    fs.writeFileSync("/work/observations.json", JSON.stringify(o) + "\n");
  '
  # macOS cp refuses identical source/dest (gather writes WORK/observations.json).
  if [ "$obs_path" != "$WORK/observations.json" ]; then
    cp "$WORK/observations.json" "$obs_path"
  fi
}

run_plan_cli() {
  local obs_file="$1"
  local out_file="$2"
  # The plan CLI reads the same single state mount (C_STATE) as every other step.
  local svc
  svc="$(pick_node_service)"
  docker compose run --rm --no-deps -T \
    -v "$ROOT/scripts:/app/scripts:ro" \
    -v "$WORK:/work" \
    -v "$STATE_FILE:${C_STATE}:ro" \
    -v "$obs_file:/obs.json:ro" \
    --entrypoint node \
    "$svc" \
    --import tsx /app/scripts/ponder-deploy-plan-cli.ts \
    --state "${C_STATE}" \
    --observations /obs.json \
    --operation "$OPERATION" \
    --deploy-sha "$DEPLOY_SHA" </dev/null >"$out_file"
}

# --- action execution --------------------------------------------------------

execute_actions() {
  local plan_json="$1"
  if [ "$plan_json" != "$WORK/plan.json" ]; then
    cp "$plan_json" "$WORK/plan.json"
  fi
  run_node -e '
    const fs = require("fs");
    const plan = JSON.parse(fs.readFileSync("/work/plan.json", "utf8"));
    const lines = (plan.actions || []).map((a) => JSON.stringify(a));
    fs.writeFileSync("/work/actions.jsonl", lines.join("\n") + (lines.length ? "\n" : ""));
  '

  local exit_code=0
  local measured_recreate=0
  local live_slot_for_evidence=""

  # Load actions into an array first — `docker compose build/run` can consume stdin
  # (bake definitions), which would starve a `while read` over actions.jsonl.
  local action_lines=()
  while IFS= read -r action_line || [ -n "$action_line" ]; do
    [ -z "$action_line" ] && continue
    action_lines+=("$action_line")
  done <"$WORK/actions.jsonl"

  local action_line
  for action_line in "${action_lines[@]}"; do
    # Atomic replace: Docker Desktop volume mounts can expose a partial write to
    # a concurrent `compose run` reader (truncated JSON → SyntaxError).
    printf '%s\n' "$action_line" >"$WORK/action.json.tmp"
    mv -f "$WORK/action.json.tmp" "$WORK/action.json"
    local type
    type="$(action_field type)"

    case "$type" in
      evidence)
        local text
        text="$(action_field text)"
        echo "$text"
        if [[ "$text" == *"outcome=recreated"* ]]; then
          measured_recreate=1
        fi
        if [[ "$text" == deploy_evidence\ slot=* ]]; then
          live_slot_for_evidence="${text#deploy_evidence slot=}"
        fi
        ;;
      exit)
        exit_code="$(action_field code)"
        if [ "$measured_recreate" = "1" ] && [ "$exit_code" = "0" ]; then
          emit_measured_commit
          if [ -n "$live_slot_for_evidence" ]; then
            emit_measured_node "$live_slot_for_evidence" || true
          fi
          emit_measured_ready || true
        fi
        return "$exit_code"
        ;;
      write_slot_env)
        write_slot_env "$(action_field slot)" "$(action_field schema)"
        ;;
      build_slot)
        local slot label
        slot="$(action_field slot)"
        label="$(action_field label)"
        docker compose build --build-arg "KARGAIN_PONDER_COMMIT=$label" "ponder-$slot" </dev/null
        # R17: bound disk after slot builds. Dangling images only (never -a); the
        # preserved legacy image is tagged, so image prune cannot reach it.
        docker builder prune -f --filter until=72h </dev/null
        docker image prune -f </dev/null
        ;;
      preflight_slot)
        local slot expected actual
        slot="$(action_field slot)"
        expected="k_${DEPLOY_SHA}"
        if [ ! -f "$ROOT/.ponder-slot-$slot.env" ]; then
          echo "deploy_evidence outcome=refused"
          echo "deploy_preflight refused: DATABASE_SCHEMA missing"
          exit 1
        fi
        actual="$(grep -E '^DATABASE_SCHEMA=' "$ROOT/.ponder-slot-$slot.env" | head -n1 | cut -d= -f2- | tr -d '\r')"
        if [ "$actual" != "$expected" ]; then
          echo "deploy_evidence outcome=refused"
          echo "deploy_preflight refused: DATABASE_SCHEMA want=$expected got=$actual"
          exit 1
        fi
        if ! docker compose run --rm --no-deps -T --entrypoint node "ponder-$slot" --import tsx scripts/ponder-deploy-preflight.ts </dev/null; then
          echo "deploy_evidence outcome=refused"
          exit 1
        fi
        echo "deploy_evidence preflight=ok"
        ;;
      start_slot)
        slot="$(action_field slot)"
        docker compose up -d "ponder-$slot" </dev/null
        ;;
      stop_slot)
        slot="$(action_field slot)"
        docker compose stop "ponder-$slot" </dev/null
        ;;
      stop_legacy_writer)
        # R2: stop exactly the observed writer of kargain; fail closed.
        local writer
        writer="$(action_field writer)"
        case "$writer" in
          ponder|ponder-legacy) ;;
          *)
            echo "deploy_state_invalid: legacy_writer"
            return 1
            ;;
        esac
        docker compose --profile legacy stop "$writer" </dev/null
        if service_active "$writer"; then
          echo "deploy_switch_failed: legacy_writer_running"
          return 1
        fi
        ;;
      preserve_legacy_image)
        local image_id
        image_id="$(action_field imageId)"
        if [ -z "$image_id" ]; then
          image_id="$(legacy_image_id | tr -d '\r')"
        fi
        if [ -z "$image_id" ]; then
          echo "deploy_state_invalid: legacy_image_unknown"
          return 1
        fi
        docker tag "$image_id" "$LEGACY_IMAGE_TAG"
        printf '%s\n' "$image_id" >"$WORK/legacy-image-id"
        ;;
      remove_legacy_image_tag)
        # R4: the first-cutover rollback is no longer possible; drop the preserved tag.
        # A leftover tag only costs disk, so a failed removal is named, not fatal.
        if docker image inspect "$LEGACY_IMAGE_TAG" >/dev/null 2>&1; then
          if ! docker rmi "$LEGACY_IMAGE_TAG" </dev/null; then
            echo "deploy_warning: legacy_image_tag_not_removed"
          fi
        fi
        ;;
      start_legacy_writer)
        # R5: the tag must resolve to exactly state.legacy_image; compose cannot build it.
        local image want have
        image="$(action_field image)"
        want=""
        have=""
        if [ -n "$image" ]; then
          want="$(docker image inspect "$image" --format '{{.Id}}' 2>/dev/null)" || want=""
        fi
        have="$(docker image inspect "$LEGACY_IMAGE_TAG" --format '{{.Id}}' 2>/dev/null)" || have=""
        if [ -z "$want" ] || [ "$want" != "$have" ]; then
          echo "deploy_rollback_failed: legacy_image_missing"
          return 1
        fi
        printf 'DATABASE_SCHEMA=kargain\n' >"$ROOT/.ponder-slot-legacy.env"
        docker compose --profile legacy up -d --no-build ponder-legacy </dev/null
        ;;
      wait_answered)
        local target slot timeout on_timeout url status ec fail_ev
        target="$(action_field target)"
        timeout="$(action_field timeoutMs)"
        on_timeout="$(action_field onTimeout)"
        fail_ev="$(action_field failEvidence)"
        case "$target" in
          slot)
            slot="$(action_field slot)"
            url="http://ponder-${slot}:42069/ready"
            ;;
          legacy) url="http://ponder-legacy:42069/ready" ;;
          *) url="http://ponder:42069/ready" ;;
        esac
        set +e
        status="$(run_node "${C_SCRIPTS}/ponder-ready-probe.ts" \
          --mode answered \
          --url "$url" \
          --timeout-ms "$timeout" 2>/dev/null)"
        ec=$?
        set -e
        if [ "$ec" -ne 0 ]; then
          echo "${fail_ev:-ponder_did_not_become_ready}"
          if [ "$on_timeout" = "tear_down_new" ] && [ "$target" = "slot" ]; then
            # R14: a failed teardown prints its named line and aborts here (set -e);
            # a clean one falls through to this run's own failure.
            tear_down_new_pending "$slot" "k_${DEPLOY_SHA}"
          fi
          return 1
        fi
        ;;
      wait_ready200)
        local target slot schema timeout on_timeout url status ec fail_ev
        target="$(action_field target)"
        schema="$(action_field schema)"
        timeout="$(action_field timeoutMs)"
        on_timeout="$(action_field onTimeout)"
        fail_ev="$(action_field failEvidence)"
        case "$target" in
          slot)
            slot="$(action_field slot)"
            url="http://ponder-${slot}:42069/ready"
            ;;
          legacy) url="http://ponder-legacy:42069/ready" ;;
          *) url="http://ponder:42069/ready" ;;
        esac
        set +e
        status="$(run_node "${C_SCRIPTS}/ponder-ready-probe.ts" \
          --mode ready200 \
          --url "$url" \
          --schema "$schema" \
          --timeout-ms "$timeout")"
        ec=$?
        set -e
        if [ "$ec" -ne 0 ]; then
          echo "${fail_ev:-ponder_did_not_become_ready}"
          if [ "$target" = "nginx" ] || [ "${fail_ev}" = "deploy_switch_failed: http" ]; then
            restore_upstream_backup
          fi
          return 1
        fi
        if [[ "$status" == deploy_evidence\ switch=pending* ]]; then
          if [ "$on_timeout" = "pending_exit0" ]; then
            echo "$status"
            return 0
          fi
          echo "${fail_ev:-deploy_switch_failed: http}"
          if [ "$target" = "nginx" ]; then
            restore_upstream_backup
          fi
          return 1
        fi
        ;;
      switch_views)
        local target kind rename meta tables_json views_json sql
        target="$(action_field targetSchema)"
        kind="$(action_field kind)"
        rename="$(action_field renameLiveTo)"
        if [ "$kind" = "first_cutover_rollback" ]; then
          sql="$(run_node "${C_SCRIPTS}/ponder-views-switch-cli.ts" \
            --target-schema "$target" \
            --kind "$kind" \
            --rename-live-to "$rename")"
        else
          # B1: value->'table_names' (not value->'app'->...)
          set +e
          meta="$(docker compose exec -T postgres \
            psql -U ponder -d kargain_ponder -t -A -F $'\t' -c \
            "SELECT (value->'table_names')::text, (value->'view_names')::text FROM \"${target}\"._ponder_meta WHERE key = 'app' LIMIT 1;")"
          local meta_ec=$?
          set -e
          if [ "$meta_ec" -ne 0 ] || [ -z "$(printf '%s' "$meta" | tr -d '[:space:]')" ]; then
            echo "deploy_switch_failed: views_meta"
            return 1
          fi
          tables_json="$(printf '%s' "$meta" | awk -F'\t' 'NF{print $1; exit}')"
          views_json="$(printf '%s' "$meta" | awk -F'\t' 'NF{print $2; exit}')"
          printf '%s\n' "$tables_json" >"$WORK/meta-tables.json"
          printf '%s\n' "${views_json:-null}" >"$WORK/meta-views.json"
          set +e
          sql="$(run_node "${C_SCRIPTS}/ponder-views-switch-cli.ts" \
            --target-schema "$target" \
            --kind "$kind" \
            --rename-live-to "$rename" \
            --tables-json "$(cat "$WORK/meta-tables.json")" \
            --views-json "$(cat "$WORK/meta-views.json")")"
          local cli_ec=$?
          set -e
          if [ "$cli_ec" -ne 0 ]; then
            echo "deploy_switch_failed: views_meta"
            return 1
          fi
        fi
        if ! printf '%s\n' "$sql" | docker compose exec -T postgres \
          psql -U ponder -d kargain_ponder --single-transaction -v ON_ERROR_STOP=1; then
          echo "deploy_switch_failed: views"
          return 1
        fi
        ;;
      write_upstream)
        save_upstream_backup
        write_upstream_target "$(action_field slot)"
        ;;
      reload_nginx)
        if ! docker compose exec -T ponder nginx -s reload; then
          echo "deploy_switch_failed: http"
          restore_upstream_backup
          return 1
        fi
        ;;
      up_nginx)
        # A front that already runs (re-cutover after a first-cutover rollback) re-reads
        # the upstream file only on reload; a freshly created one reads it at start.
        local front_running=0
        if service_active ponder && ponder_is_nginx; then
          front_running=1
        fi
        docker compose up -d ponder </dev/null
        if [ "$front_running" = "1" ]; then
          if ! docker compose exec -T ponder nginx -s reload; then
            echo "deploy_switch_failed: http"
            restore_upstream_backup
            return 1
          fi
        fi
        ;;
      recreate_nginx)
        docker compose up -d --force-recreate ponder </dev/null
        measured_recreate=1
        emit_measured_commit
        ;;
      drop_schema)
        drop_schema_via_owner "$(action_field schema)"
        ;;
      retention)
        run_node -e '
          const fs = require("fs");
          const a = JSON.parse(fs.readFileSync("/work/action.json", "utf8"));
          fs.writeFileSync("/work/retention-drop.json", JSON.stringify(a.drop || []) + "\n");
        '
        local drop_list schema
        drop_list="$(run_node -e '
          const d = JSON.parse(require("fs").readFileSync("/work/retention-drop.json", "utf8"));
          process.stdout.write(d.join("\n"));
        ')"
        while IFS= read -r schema || [ -n "$schema" ]; do
          [ -z "$schema" ] && continue
          stop_writers_for_schema "$schema"
        done <<<"$drop_list"
        local sql
        sql="$(run_node "${C_SCRIPTS}/ponder-deploy-retention-cli.ts" \
          --state "${C_STATE}" --drop-schemas-file "${C_WORK}/retention-drop.json")"
        if [ -n "$(printf '%s' "$sql" | tr -d '[:space:]')" ]; then
          printf '%s\n' "$sql" | docker compose exec -T postgres \
            psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1
        fi
        ;;
      write_state)
        # C3: only through state owner CLI.
        run_node "${C_SCRIPTS}/ponder-deploy-state-cli.ts" \
          --action-state-write "${C_WORK}/action.json" "${C_STATE}"
        ;;
      check_schema_absent)
        local schema exists
        schema="$(action_field schema)"
        exists="$(docker compose exec -T postgres \
          psql -U ponder -d kargain_ponder -t -A -c \
          "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = '${schema}');" \
          | tr -d '\r' | tail -n 1 | tr '[:upper:]' '[:lower:]')"
        case "$exists" in
          t|true|1)
            echo "deploy_state_invalid: schema_exists ${schema}"
            return 1
            ;;
        esac
        ;;
      assert_slot_image_label)
        local slot want got
        slot="$(action_field slot)"
        want="$(action_field commit)"
        got="$(docker image inspect "$(docker compose images -q "ponder-${slot}")" \
          --format '{{index .Config.Labels "kargain.ponder.commit"}}' 2>/dev/null || true)"
        if [ "$got" != "$want" ]; then
          echo "deploy_rollback_failed: previous_image_mismatch"
          return 1
        fi
        ;;
      probe_answered)
        local target slot status_json code node_ver
        target="$(action_field target)"
        if [ "$target" = "nginx" ]; then
          status_json="$(probe_nginx_json)"
          # R15: the live slot comes from state; none → no node= line (no default slot).
          slot="$(run_node "${C_SCRIPTS}/ponder-deploy-state-cli.ts" --live-slot "${C_STATE}" | tr -d '\r' | tail -n 1)"
        else
          slot="$(action_field slot)"
          status_json="$(probe_slot_json "$slot")"
        fi
        if [ -n "$slot" ] && docker compose ps -q "ponder-$slot" 2>/dev/null | grep -q .; then
          node_ver="$(docker compose exec -T "ponder-$slot" node --version | tr -d '\r')"
          echo "deploy_evidence node=$node_ver"
        fi
        printf '%s\n' "$status_json" >"$WORK/probe-answered.json"
        code="$(run_node -e "
          const j = JSON.parse(require('fs').readFileSync('/work/probe-answered.json', 'utf8'));
          if (j.kind === 'status') process.stdout.write(String(j.code));
        ")"
        if [ -n "$code" ]; then
          echo "deploy_evidence ready=ponder status=$code"
        fi
        ;;
      *)
        echo "ponder-deploy.sh: unknown action $type" >&2
        return 1
        ;;
    esac
  done
  return "$exit_code"
}

main() {
  require_state_file
  local obs="$WORK/observations.json"
  local plan_out="$WORK/plan.json"
  gather_observations "$obs"
  run_plan_cli "$obs" "$plan_out"
  execute_actions "$plan_out"
  local ec=$?
  return "$ec"
}

main
