#!/usr/bin/env python3
"""strfry write-policy plugin — Kargain kind/content gate (stdlib only)."""

import json
import sys

ALLOWED_KINDS = frozenset({0, 1, 7, 30000, 30078, 30405, 31860})  # Vincent Commons reviews (F-2)
MAX_CONTENT_BYTES = 65536


def reject(event_id: str, msg: str) -> dict:
    return {"id": event_id, "action": "reject", "msg": msg}


def accept(event_id: str) -> dict:
    return {"id": event_id, "action": "accept"}


def evaluate(req: dict) -> dict:
    if req.get("type") != "new":
        return reject("", "blocked: invalid event")

    event = req.get("event")
    if not isinstance(event, dict):
        return reject("", "blocked: invalid event")

    event_id = event.get("id")
    if not isinstance(event_id, str) or not event_id:
        return reject("", "blocked: invalid event")

    kind = event.get("kind")
    if not isinstance(kind, int):
        return reject(event_id, "blocked: invalid event")

    if kind not in ALLOWED_KINDS:
        return reject(event_id, "blocked: kind not allowed")

    content = event.get("content", "")
    if not isinstance(content, str):
        return reject(event_id, "blocked: invalid event")

    if len(content.encode("utf-8")) > MAX_CONTENT_BYTES:
        return reject(event_id, "blocked: content exceeds 64 KB")

    return accept(event_id)


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps(reject("", "blocked: invalid event")), flush=True)
            continue

        if req.get("type") != "new":
            print("unexpected request type", file=sys.stderr)
            continue

        print(json.dumps(evaluate(req)), flush=True)


if __name__ == "__main__":
    main()
