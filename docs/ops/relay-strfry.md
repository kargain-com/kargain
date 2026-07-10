# strfry Nostr relay operations (VPS)

Self-hosted [strfry](https://github.com/hoytech/strfry) relay beside Ponder on the production VPS. **NS-5.3a** ships in-repo infra; **NS-5.3b** adds `wss://relay.kargain.com` first in client `NOSTR_RELAYS` via `publishSignedEvent`; **NS-5.3c** adds cron-safe sync/backup scripts (**NS-5.3c.1** fixes `compose exec` binary paths and sync log matching).

**Pinned release:** strfry **1.1.0** (`Dockerfile.strfry`).

**CLI note:** `docker compose exec` **ignores** the image `ENTRYPOINT`. The binary is at `/app/strfry` (config at `/app/strfry.conf`) and is **not** on `$PATH`. Always name the binary explicitly: `docker compose exec -T strfry /app/strfry --config /app/strfry.conf <subcommand> …`. Pipelines use `sh -c` inside the container (`exec -T strfry sh -c '…'`). Do **not** use `compose exec --entrypoint` (that flag exists on `compose run` only).

---

## Stack placement

| Item | Value |
|------|--------|
| Service | `strfry` in root `docker-compose.yml` |
| Docker network | `kargain` (same as postgres, ponder, cloudflared) |
| Internal URL | `http://strfry:7777` |
| Public URL | `wss://relay.kargain.com` (Cloudflare tunnel) |
| Storage | Docker volume `strfry_data` → `/data/` (LMDB) |
| Host ports | None — cloudflared reaches the container on the bridge network |

Write policy (`strfry/kargain-policy.py`) accepts only kinds **0, 1, 7, 30000, 30078, 30405** and rejects `content` over 64 KB. Protocol: [strfry plugins.md @ 1.1.0](https://github.com/hoytech/strfry/blob/1.1.0/docs/plugins.md).

---

## Deploy

On the VPS (repo root, same directory as `docker-compose.yml`):

```bash
git pull
docker compose build strfry
docker compose up -d strfry
docker compose logs -f strfry   # first-run LMDB init; expect "listening" on :7777
```

Restart after config-only changes (hot reload covers many `strfry.conf` keys; `db`, `bind`, and `port` require restart):

```bash
docker compose restart strfry
```

---

## Cloudflare tunnel hostname

In the Cloudflare Zero Trust dashboard (tunnel token in `CLOUDFLARE_TUNNEL_TOKEN`), map:

| Public hostname | Origin service |
|-----------------|----------------|
| `relay.kargain.com` | `http://strfry:7777` |

No change to the `cloudflared` service definition in compose — routing is configured in the tunnel UI. The hostname must resolve on the `kargain` Docker network (service name `strfry`).

---

## Smoke checks

**HTTP / NIP-11:**

```bash
# Liveness only (HTML landing page)
curl -si https://relay.kargain.com/ | head -20

# NIP-11 relay metadata
curl -si -H "Accept: application/nostr+json" https://relay.kargain.com/ | head -20
```

Expect HTTP 200; NIP-11 response mentions **Kargain relay**.

**WebSocket REQ** (requires [nak](https://github.com/fiatjaf/nak) or similar on the VPS):

```bash
nak req -k 1 --limit 1 wss://relay.kargain.com
```

Expect at least `EOSE` (events optional on empty relay).

**From inside the compose network** (before tunnel is wired):

```bash
docker compose exec strfry wget -qO- http://127.0.0.1:7777/ | head -5
```

---

## Backfill from public relays

### Why not kinds-only sync?

A filter like `{"kinds":[0,1,7,30000,30078,30405]}` matches the **entire Nostr network**. Public relays reject negentropy sync with:

`NEG-ERR "blocked: too many query results"`

Sync must filter by **`authors`**.

### Author set (self-maintaining)

Every Kargain identity has a kind **0** profile on our own relay — client publishes hit `wss://relay.kargain.com` first since NS-5.3b. The daily sync script discovers authors by scanning kind 0 on the local DB.

### Day-to-day sync (automated)

From repo root on the VPS:

```bash
./scripts/relay-sync.sh
```

The script:

1. Scans `{"kinds":[0]}` on the local relay and collects unique `pubkey` values (python3 inside the container).
2. Chunks authors (100 per sync call) and runs `sync --dir down` against each configured remote with `{"authors":[...]}`.
3. Logs `added:` summary lines; a failing remote logs a warning and does not abort the script.

### Pre-relay identities (one-time manual backfill)

Identities that published **before** strfry went live may not appear in the local kind 0 scan. Discover their pubkeys via browser devtools on any Nostr web client:

1. Open a client connected to a public relay (e.g. damus.io).
2. Send a `REQ` with filter: `{"kinds":[0],"#i":["ethereum:0x<lowercase-wallet-address>"]}`.
3. Collect the `pubkey` hex from matching kind 0 events.
4. Run a one-time manual sync per pubkey (or small author batch):

```bash
docker compose exec -T strfry /app/strfry --config /app/strfry.conf sync wss://relay.damus.io \
  --dir down --filter '{"authors":["<hex-pubkey>"]}'
```

Repeat for each pre-relay identity, then rely on `./scripts/relay-sync.sh` going forward.

### Manual author-based sync (single remote)

```bash
docker compose exec -T strfry /app/strfry --config /app/strfry.conf sync wss://relay.damus.io \
  --dir down --filter '{"authors":["<hex-pubkey-1>","<hex-pubkey-2>"]}'
```

Sync can be memory- and bandwidth-heavy; run one remote at a time when manual. Monitor `docker compose logs strfry`.

### Fallback — REQ download + import

For relays without negentropy support, pipe download into import (author filter, not kinds-only):

```bash
docker compose exec -T strfry sh -c \
  '/app/strfry --config /app/strfry.conf download wss://nos.lol \
    --filter "{\"authors\":[\"<hex-pubkey>\"]}" \
  | /app/strfry --config /app/strfry.conf import'
```

### Scan (inspect local DB)

```bash
docker compose exec -T strfry /app/strfry --config /app/strfry.conf scan '{"kinds":[0]}' | head
```

---

## Automation

Cron-safe scripts (no TTY; idempotent):

| Script | Purpose |
|--------|---------|
| [`scripts/relay-sync.sh`](../scripts/relay-sync.sh) | Author-filtered negentropy sync from public relays |
| [`scripts/relay-backup.sh`](../scripts/relay-backup.sh) | `export` → gzip; retain newest 8 backups |

**Install crontab** on the VPS (manual step after deploy; adjust user/home as needed):

```cron
15 4 * * * cd /opt/kargain && ./scripts/relay-sync.sh >> $HOME/relay-sync.log 2>&1
30 4 * * 0 cd /opt/kargain && ./scripts/relay-backup.sh >> $HOME/relay-backup.log 2>&1
```

Backup directory defaults to `./backups/relay` under repo root; override with `KARGAIN_RELAY_BACKUP_DIR`.

**Verify log rotation** (without waiting for the monthly schedule; requires `/etc/logrotate.d/kargain-relay` on the VPS):

```bash
sudo logrotate -d /etc/logrotate.d/kargain-relay   # dry-run — shows the plan, no changes
sudo logrotate -f /etc/logrotate.d/kargain-relay   # force a rotation now (smoke test)
ls -la ~/relay-*.log*
```

---

## Weekly backup (manual)

Same as the backup script:

```bash
./scripts/relay-backup.sh
```

Or directly:

```bash
mkdir -p ./backups/relay
docker compose exec -T strfry /app/strfry --config /app/strfry.conf export \
  | gzip > "./backups/relay/relay-$(date +%Y%m%d).jsonl.gz"
```

Retain backups off-box. For DB version upgrades, use fried export/import per [strfry README](https://github.com/hoytech/strfry/blob/1.1.0/README.md#db-upgrade).

---

## Upgrade strfry version

1. Bump `STRFRY_VERSION` / tag comment in `Dockerfile.strfry`.
2. `git pull && docker compose build strfry && docker compose up -d strfry`
3. If the binary reports an incompatible DB version, only `export` works until migration:

```bash
docker compose exec -T strfry /app/strfry --config /app/strfry.conf export --fried \
  > /var/backups/strfry-pre-upgrade.jsonl
docker compose stop strfry
# replace volume or move aside data.mdb per upstream docs
docker compose up -d strfry
docker compose exec -T strfry sh -c \
  '/app/strfry --config /app/strfry.conf import --fried < /var/backups/strfry-pre-upgrade.jsonl'
```

---

## Volume permissions

The container runs as UID **10001** (`strfry` user). If LMDB fails with permission errors on first start:

```bash
docker compose run --user root --rm strfry chown -R 10001:10001 /data
docker compose up -d strfry
```

---

## Related docs

- Topology: [REFERENCE.md §1](../REFERENCE.md#1-service-topology)
- Ponder ops: [indexer/OPERATIONS.md](../indexer/OPERATIONS.md)
