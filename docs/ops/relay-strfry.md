# strfry Nostr relay operations (VPS)

Self-hosted [strfry](https://github.com/hoytech/strfry) relay beside Ponder on the production VPS. **NS-5.3a** ships in-repo infra; **NS-5.3b** adds `wss://relay.kargain.com` first in client `NOSTR_RELAYS` via `publishSignedEvent`.

**Pinned release:** strfry **1.1.0** (`Dockerfile.strfry`).

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

After deploy, import historical Kargain events from the public relays the app currently uses (`lib/nostr/relays.ts`). Filter to policy kinds only:

```bash
KINDS_FILTER='{"kinds":[0,1,7,30000,30078,30405]}'
```

**Preferred — negentropy sync** (when remote relay supports it):

```bash
docker compose exec strfry strfry sync wss://relay.damus.io --filter "$KINDS_FILTER"
docker compose exec strfry strfry sync wss://relay.nostr.band --filter "$KINDS_FILTER"
docker compose exec strfry strfry sync wss://nos.lol --filter "$KINDS_FILTER"
docker compose exec strfry strfry sync wss://relay.snort.social --filter "$KINDS_FILTER"
docker compose exec strfry strfry sync wss://relay.primal.net --filter "$KINDS_FILTER"
```

**Fallback — REQ download + import** for relays without negentropy:

```bash
docker compose exec strfry sh -c \
  'strfry download wss://nos.lol --filter "{\"kinds\":[0,1,7,30000,30078,30405]}" | strfry import'
```

Sync can be memory- and bandwidth-heavy on an empty DB; run one relay at a time and monitor `docker compose logs strfry`.

---

## Weekly backup

Export LMDB contents to JSONL (cron-friendly):

```bash
docker compose exec -T strfry strfry export \
  > /var/backups/kargain-strfry-$(date +%Y%m%d).jsonl
```

Retain backups off-box. For DB version upgrades, use fried export/import per [strfry README](https://github.com/hoytech/strfry/blob/1.1.0/README.md#db-upgrade).

---

## Upgrade strfry version

1. Bump `STRFRY_VERSION` / tag comment in `Dockerfile.strfry`.
2. `git pull && docker compose build strfry && docker compose up -d strfry`
3. If the binary reports an incompatible DB version, only `strfry export` works until migration:

```bash
docker compose exec -T strfry strfry export --fried > /var/backups/strfry-pre-upgrade.jsonl
docker compose stop strfry
# replace volume or move aside data.mdb per upstream docs
docker compose up -d strfry
docker compose exec -T strfry sh -c 'strfry import --fried < /path/to/strfry-pre-upgrade.jsonl'
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
