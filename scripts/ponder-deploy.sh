#!/usr/bin/env bash
# Host side of the Ponder deploy (ADR 0016 §e, §h–§j).
#
#   scripts/ponder-deploy.sh <deploy|rollback> <compose project> <image repository>
#
# Run from the checkout of the commit to deploy, with the ADR 0010 lock held
# by the caller on fd 9. Host commands: git, flock (caller), docker and bash
# builtins only. Every decision is made by scripts/ponder-deploy-step.ts in
# the `ponder-deploy` service; this script executes the one-line action it
# writes and hands back the status and output.
set -euo pipefail
shopt -s inherit_errexit

operation=${1:?operation}
project=${2:?compose project}
repo=${3:?image repository}
case "$operation" in
  deploy | rollback) ;;
  *)
    printf 'ponder-deploy: unknown operation %s\n' "$operation" >&2
    exit 2
    ;;
esac

# Pre-ADR 0016 deploy record; read once by the first run, then deleted.
# Name built in parts so the removal grep stays empty (ADR §f still adopts it).
legacy_file="$(printf '%s%s' '.ponder-deploy-' 'fingerprints')"
action_file=.ponder-deploy/run/action
export PONDER_IMAGE_REPOSITORY="$repo"
compose=(docker compose -p "$project")
commit=$(git rev-parse HEAD)

# Host must own the bind-mount directory before the tooling container writes
# into it; otherwise Docker Desktop can leave the mount empty to the host.
mkdir -p .ponder-deploy/run

# Clean build context: only the commit's tracked files reach the image.
git archive "$commit" | docker build -f Dockerfile.ponder \
  --label "com.kargain.ponder.repository=$repo" -t "$repo:deploy" -

step() {
  "${compose[@]}" --profile deploy run --rm -T ponder-deploy \
    node --import tsx scripts/ponder-deploy-step.ts "$@"
}

env_lines() {
  local kind=$1 ref=$2 line
  while IFS= read -r line; do
    if [ -n "$line" ]; then printf '%s %s\n' "$kind" "$line"; fi
  done < <(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$ref")
}

observe() {
  local cid="" ref id line=""
  IFS= read -r cid < <("${compose[@]}" ps -a -q ponder) || true
  if [ -n "$cid" ]; then
    printf 'container %s %s\n' "$cid" "$(docker inspect -f '{{.Image}}' "$cid")"
    env_lines container_env "$cid"
  else
    printf 'container_missing\n'
  fi
  for ref in "$@"; do
    if id=$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null); then
      printf 'image %s %s\n' "$ref" "$id"
      env_lines "image_env $ref" "$ref"
    else
      printf 'image_missing %s\n' "$ref"
    fi
  done
  if [ -f "$legacy_file" ]; then
    IFS= read -r line < "$legacy_file" || true
    printf 'legacy_file %s\n' "$line"
  fi
}

# Writer image: FROM the source image, plus the schema its identity names.
derive() {
  local source=$1 tag=$2 schema=$3 label_commit=$4 label_indexing=$5 label_executable=$6
  docker tag "$source" "$repo:derive"
  printf 'FROM %s\nENV DATABASE_SCHEMA=%s\n' "$repo:derive" "$schema" |
    docker build -q \
      --label "com.kargain.ponder.repository=$repo" \
      --label "com.kargain.ponder.commit=$label_commit" \
      --label "com.kargain.ponder.indexing=$label_indexing" \
      --label "com.kargain.ponder.executable=$label_executable" \
      -t "$tag" - >/dev/null
  docker rmi "$repo:derive" >/dev/null
}

step --begin "$operation" "$commit" "$repo" </dev/null
while :; do
  IFS=' ' read -r verb rest <"$action_file"
  read -r -a argv <<<"$rest"
  status=0
  out=""
  case "$verb" in
    exit) exit "${argv[0]}" ;;
    observe) out=$(observe "${argv[@]}") ;;
    derive) out=$(derive "${argv[@]}") ;;
    tag) out=$(docker tag "${argv[0]}" "$repo:writer") ;;
    recreate) out=$("${compose[@]}" up -d --no-build --force-recreate ponder) ;;
    node) out=$("${compose[@]}" exec -T ponder node --version) || status=$? ;;
    tags) out=$(docker image ls --format '{{.Tag}}' "$repo") ;;
    rmi) out=$(docker rmi "${argv[0]}") ;;
    prune)
      out=$(docker image prune -f --filter "label=com.kargain.ponder.repository=$repo")
      docker builder prune -f --filter until=72h >/dev/null
      ;;
    delete_legacy_file) out=$(git clean -f -x -q -- "$legacy_file") ;;
    *)
      printf 'ponder-deploy: unknown action %s\n' "$verb" >&2
      exit 2
      ;;
  esac
  printf '%s' "$out" | step --resume "$status"
done
