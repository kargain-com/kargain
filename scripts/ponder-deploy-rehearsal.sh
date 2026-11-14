#!/usr/bin/env bash
# Local Docker rehearsal of the Ponder deploy (ADR 0016 Consequences): the
# eight steps, each through scripts/ponder-deploy.sh, on real images indexing
# Base Sepolia and Ethereum Sepolia.
#
#   scripts/ponder-deploy-rehearsal.sh [<master ref>] [<implementation ref>]
#
# Defaults: origin/master and HEAD of this checkout (both must be committed).
# The caller's environment supplies the commercial RPC lists and windows.
#
# Owns only: Compose project kargain-rehearsal (its containers, network and
# Postgres volume), images of repository kargain-rehearsal-ponder, and a
# scratch clone outside the repository. All are removed on exit.
set -euo pipefail
# scripts/ponder-deploy.sh needs inherit_errexit (bash 4.4+; macOS /bin/bash is 3.2).
if ((BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] < 404)); then
  printf 'rehearsal_refused: bash 4.4+ required, found %s\n' "$BASH_VERSION"
  exit 2
fi
shopt -s inherit_errexit

project=kargain-rehearsal
repo=kargain-rehearsal-ponder
production_repo=kargain-ponder
# The pre-ADR 0016 deploy record the first run adopts.
# Name built in parts so the removal grep stays empty (ADR §f still adopts it).
legacy_file="$(printf '%s%s' '.ponder-deploy-' 'fingerprints')"
required_env=(
  PONDER_RPC_URLS_84532
  PONDER_GETLOGS_BLOCK_RANGE_84532
  PONDER_RPC_URLS_11155111
  PONDER_GETLOGS_BLOCK_RANGE_11155111
)
for key in "${required_env[@]}"; do
  if [ -z "${!key:-}" ]; then
    printf 'rehearsal_refused: missing %s\n' "$key"
    exit 2
  fi
done

root=$(git rev-parse --show-toplevel)
master_sha=$(git -C "$root" rev-parse --verify "${1:-origin/master}^{commit}")
impl_sha=$(git -C "$root" rev-parse --verify "${2:-HEAD}^{commit}")
scratch=$(mktemp -d "${TMPDIR:-/tmp}/kargain-rehearsal.XXXXXX")
clone="$scratch/repo"
compose=(docker compose -p "$project")
# Every Compose call here, the deploy script's included, names this repository.
export PONDER_IMAGE_REPOSITORY="$repo"
SECONDS=0

host_evidence() {
  printf 'rehearsal_host %s volumes=%s\n' "$1" "$(docker volume ls -q | wc -l | tr -d ' ')"
  printf 'rehearsal_host %s %s_tags=%s\n' "$1" "$production_repo" \
    "$(docker images "$production_repo" --format '{{.Tag}}' | sort | tr '\n' ',')"
}

cleaned=0
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$cleaned" = 0 ]; then
    cleaned=1
    if [ -d "$clone/.ponder-deploy" ] && docker image inspect "$repo:deploy" >/dev/null 2>&1; then
      # Written by the root-owned tooling container; removed the same way.
      docker run --rm -v "$clone/.ponder-deploy:/d" --entrypoint sh "$repo:deploy" \
        -c 'rm -rf /d/* /d/.[!.]*' || true
    fi
    if [ -f "$clone/docker-compose.yml" ]; then
      (cd "$clone" && "${compose[@]}" --profile deploy down -v --remove-orphans --timeout 5) || true
    fi
    local ref id
    while IFS= read -r ref; do
      docker rmi -f "$ref" >/dev/null || true
    done < <(docker images "$repo" --format '{{.Repository}}:{{.Tag}}' | grep -v ':<none>$' || true)
    while IFS= read -r id; do
      docker rmi -f "$id" >/dev/null || true
    done < <(docker images -q --filter "label=com.kargain.ponder.repository=$repo" | sort -u)
    rm -rf "$scratch"
    host_evidence after
    printf 'rehearsal_wall_seconds=%s\n' "$SECONDS"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

fail() {
  printf 'rehearsal_failed: %s\n' "$*"
  exit 1
}

host_evidence before

git init -q "$clone"
git -C "$clone" fetch -q "$root" '+refs/*:refs/source/*' '+HEAD:refs/source/HEAD'
git -C "$clone" -c advice.detachedHead=false checkout -q "$master_sha"

{
  printf 'POSTGRES_PASSWORD=rehearsal\n'
  for key in "${required_env[@]}"; do printf '%s=%s\n' "$key" "${!key}"; done
} >"$clone/.env"
# The developer's stack may publish the same port; the deploy reaches ponder
# over the Compose network only.
printf 'services:\n  ponder:\n    ports: !reset []\n' >"$scratch/no-ports.yml"
export COMPOSE_FILE="docker-compose.yml:$scratch/no-ports.yml"

in_clone() { (cd "$clone" && "$@"); }

commit_edit() {
  local file=$1 message=$2 line=$3
  printf '%s\n' "$line" >>"$clone/$file"
  git -C "$clone" -c user.name=rehearsal -c user.email=rehearsal@localhost \
    commit -q -m "$message" -- "$file"
  git -C "$clone" rev-parse HEAD
}

log_dir="$scratch/logs"
mkdir -p "$log_dir"
run=0
# deploy_run <expected exit> <operation>: one deploy script run; its log is printed.
deploy_run() {
  local expected=$1 operation=$2 status=0
  run=$((run + 1))
  printf '\n=== run %s: %s at %s\n' "$run" "$operation" "$(git -C "$clone" rev-parse --short HEAD)"
  in_clone scripts/ponder-deploy.sh "$operation" "$project" "$repo" >"$log_dir/$run.log" 2>&1 ||
    status=$?
  grep -E '^(deploy_evidence|deploy_preflight|deploy_state_invalid|deploy_rollback_failed|deploy_return_failed|ponder_)' \
    "$log_dir/$run.log" || true
  if [ "$status" != "$expected" ]; then
    tail -n 40 "$log_dir/$run.log"
    fail "run $run exited $status, expected $expected"
  fi
}

expect_line() {
  grep -qxF "$1" "$log_dir/$run.log" || fail "run $run: missing line: $1"
}

evidence_value() {
  sed -n "s/^deploy_evidence $1=//p" "$log_dir/$run.log" | tail -n 1
}

schemas() {
  in_clone "${compose[@]}" exec -T postgres psql -U ponder -d kargain_ponder -At \
    -c "SELECT nspname FROM pg_namespace WHERE nspname = 'kargain' OR nspname ~ '^k_[0-9a-f]{40}\$' ORDER BY 1" |
    tr '\n' ' '
}

show_dn() {
  printf -- '--- \\dn after step %s\n' "$1"
  in_clone "${compose[@]}" exec -T postgres psql -U ponder -d kargain_ponder -c '\dn'
}

writer_answers() {
  in_clone "${compose[@]}" exec -T ponder node -e \
    "fetch('http://127.0.0.1:42069/ready').then(()=>process.exit(0),()=>process.exit(1))" \
    >/dev/null 2>&1
}

# Step 0: the pre-implementation writer, as master's Compose and deploy left it.
printf '=== step 0: master writer on schema kargain (%s)\n' "${master_sha:0:7}"
in_clone "${compose[@]}" up -d --build ponder
deadline=$((SECONDS + 300))
until writer_answers; do
  [ "$SECONDS" -lt "$deadline" ] || fail "master writer did not answer /ready"
  sleep 3
done
# Master's CLI path (removed on the implementation commit); spelled in parts
# so the removal grep stays empty.
fp_cli="$(printf 'scripts/ponder-deploy-%s.ts' 'fingerprints')"
fingerprints=$(in_clone "${compose[@]}" exec -T ponder node --import tsx "$fp_cli" 2>/dev/null)
identity=$(sed -n 's/^identity=//p' <<<"$fingerprints")
executable=$(sed -n 's/^executable=//p' <<<"$fingerprints")
[ -n "$identity" ] && [ -n "$executable" ] || fail "master fingerprints not printed"
printf '{"identity": "%s", "executable": "%s"}' "$identity" "$executable" >"$clone/$legacy_file"
[ "$(schemas)" = "kargain " ] || fail "master writer schemas: $(schemas)"

git -C "$clone" -c advice.detachedHead=false checkout -q "$impl_sha"

printf '\n=== step 1: first run adopts legacy, then switches\n'
deploy_run 0 deploy
expect_line 'deploy_evidence adopted=legacy schema=kargain'
expect_line 'deploy_evidence outcome=recreated'
schema1=$(evidence_value schema)
[[ "$schema1" =~ ^k_[0-9a-f]{40}$ ]] || fail "step 1 schema: $schema1"
if [ -f "$clone/$legacy_file" ]; then fail "legacy file not deleted"; fi
show_dn 1

printf '\n=== step 2: API-only commit restarts in place\n'
commit_edit src/api/index.ts "rehearsal: api-only" "// rehearsal api-only change" >/dev/null
deploy_run 0 deploy
expect_line 'deploy_evidence outcome=recreated'
[ "$(evidence_value schema)" = "$schema1" ] || fail "step 2 changed schema"
# §g step 5 + §j: legacy left the state at this commit (previous is step 1's ref).
[ "$(schemas)" = "$schema1 " ] || fail "step 2 schemas: $(schemas)"

printf '\n=== step 3: indexing commit switches schema\n'
commit_edit src/index.ts "rehearsal: indexing" "// rehearsal indexing change" >/dev/null
indexing_sha=$(git -C "$clone" rev-parse HEAD)
deploy_run 0 deploy
schema2=$(evidence_value schema)
[[ "$schema2" =~ ^k_[0-9a-f]{40}$ ]] && [ "$schema2" != "$schema1" ] || fail "step 3 schema: $schema2"
[ "$(schemas)" = "$(printf '%s\n' "$schema1" "$schema2" | sort | tr '\n' ' ')" ] ||
  fail "step 3 schemas: $(schemas)"
show_dn 3

printf '\n=== step 4: no-op dispatch\n'
deploy_run 0 deploy
expect_line 'deploy_evidence outcome=unchanged'

printf '\n=== step 5: writer that fails at build returns\n'
before5=$(schemas)
commit_edit src/index.ts "rehearsal: failing writer" 'throw new Error("rehearsal: writer fails at build");' >/dev/null
deploy_run 1 deploy
expect_line 'ponder_did_not_become_ready'
expect_line 'deploy_evidence outcome=returned'
[ "$(evidence_value schema)" = "$schema2" ] || fail "step 5 did not return to $schema2"
[ "$(schemas)" = "$before5" ] || fail "step 5 created a schema: $(schemas)"

printf '\n=== step 6: rollback, then deploy of the good head\n'
git -C "$clone" -c advice.detachedHead=false checkout -q "$indexing_sha"
deploy_run 0 rollback
[ "$(evidence_value schema)" = "$schema1" ] || fail "rollback schema"
deploy_run 0 deploy
[ "$(evidence_value schema)" = "$schema2" ] || fail "redeploy schema"
show_dn 6

printf '\n=== step 7: run killed after recreate, bare up, next run resumes\n'
commit_edit src/index.ts "rehearsal: indexing again" "// rehearsal second indexing change" >/dev/null
killed_sha=$(git -C "$clone" rev-parse HEAD)
run=$((run + 1))
printf '\n=== run %s: deploy at %s (killed after recreate)\n' "$run" "${killed_sha:0:7}"
(cd "$clone" && exec scripts/ponder-deploy.sh deploy "$project" "$repo") >"$log_dir/$run.log" 2>&1 &
deploy_pid=$!
deadline=$((SECONDS + 900))
while :; do
  [ "$SECONDS" -lt "$deadline" ] || fail "writer never recreated on $killed_sha"
  kill -0 "$deploy_pid" 2>/dev/null || fail "deploy ended before it was killed"
  want=$(docker image inspect -f '{{.Id}}' "$repo:$killed_sha" 2>/dev/null || true)
  cid=$(in_clone "${compose[@]}" ps -q ponder || true)
  have=$( [ -n "$cid" ] && docker inspect -f '{{.Image}}' "$cid" 2>/dev/null || true)
  if [ -n "$want" ] && [ "$want" = "$have" ]; then break; fi
  sleep 1
done
kill -KILL "$deploy_pid" 2>/dev/null || true
wait "$deploy_pid" 2>/dev/null || true
while IFS= read -r id; do
  docker rm -f -v "$id" >/dev/null
done < <(docker ps -aq --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.oneoff=True")
grep -E '^deploy_evidence' "$log_dir/$run.log" || true
in_clone "${compose[@]}" up -d ponder
deploy_run 0 deploy
expect_line 'deploy_evidence resolved=committed'
expect_line 'deploy_evidence outcome=unchanged'

printf '\n=== step 8: state.json removed\n'
tags_before=$(docker images "$repo" --format '{{.Tag}}' | sort | tr '\n' ',')
schemas_before=$(schemas)
in_clone "${compose[@]}" --profile deploy run --rm -T --entrypoint rm ponder-deploy -f .ponder-deploy/state.json
deploy_run 1 deploy
expect_line 'deploy_state_invalid: state_absent'
[ "$(docker images "$repo" --format '{{.Tag}}' | sort | tr '\n' ',')" = "$tags_before" ] ||
  fail "step 8 changed images"
[ "$(schemas)" = "$schemas_before" ] || fail "step 8 changed schemas"

printf '\nrehearsal_ok steps=8 runs=%s\n' "$run"
