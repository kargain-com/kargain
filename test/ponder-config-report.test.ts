/**
 * `formatPonderConfigReport` — transport through ponder-env owners; no URLs.
 * Env is an argument; suites never mutate process.env for the report path.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPonderConfigReport } from "../scripts/lib/ponder-config-report.ts";

const HUB = 84532;
const SPOKE = 11155111;

function commercialTransportEnv(
  extra?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    [`PONDER_RPC_URLS_${HUB}`]: "https://a.example/rpc",
    [`PONDER_RPC_URLS_${SPOKE}`]: "https://b.example/rpc",
    [`PONDER_GETLOGS_BLOCK_RANGE_${HUB}`]: "50000",
    [`PONDER_GETLOGS_BLOCK_RANGE_${SPOKE}`]: "30000",
    ...extra,
  } as NodeJS.ProcessEnv;
}

describe("ponder-config-report", () => {
  it("negative: missing PONDER_RPC_URLS_84532 prints missing_rpc_urls and key; ok false", () => {
    const env = commercialTransportEnv({
      [`PONDER_RPC_URLS_${HUB}`]: undefined,
    } as NodeJS.ProcessEnv);
    const { lines, ok } = formatPonderConfigReport(env);
    const text = lines.join("\n");
    assert.equal(ok, false);
    assert.match(text, /missing_rpc_urls PONDER_RPC_URLS_84532/);
    assert.equal(text.includes("://"), false);
  });

  it("negative: http then duplicate prints codes and keys; no URL", () => {
    const httpEnv = commercialTransportEnv({
      [`PONDER_RPC_URLS_${HUB}`]: "http://insecure.example/rpc",
    });
    const httpReport = formatPonderConfigReport(httpEnv);
    assert.equal(httpReport.ok, false);
    const httpText = httpReport.lines.join("\n");
    assert.match(httpText, /invalid_rpc_url PONDER_RPC_URLS_84532/);
    assert.equal(httpText.includes("://"), false);

    const dupEnv = commercialTransportEnv({
      [`PONDER_RPC_URLS_${HUB}`]:
        "https://a.example/rpc,https://a.example/rpc",
    });
    const dupReport = formatPonderConfigReport(dupEnv);
    assert.equal(dupReport.ok, false);
    const dupText = dupReport.lines.join("\n");
    assert.match(dupText, /duplicate_rpc_url PONDER_RPC_URLS_84532/);
    assert.equal(dupText.includes("://"), false);
  });

  it("valid lists and windows: ok true; output has no ://", () => {
    const { lines, ok } = formatPonderConfigReport(commercialTransportEnv());
    const text = lines.join("\n");
    assert.equal(ok, true);
    assert.equal(text.includes("://"), false);
    assert.match(text, /PONDER_RPC_URLS_84532: 1 providers/);
    assert.match(text, /PONDER_GETLOGS_BLOCK_RANGE_84532: 50000/);
    assert.match(text, /PONDER_RPC_URLS_11155111: 1 providers/);
    assert.match(text, /PONDER_GETLOGS_BLOCK_RANGE_11155111: 30000/);
    assert.doesNotMatch(text, new RegExp(String.raw`PONDER_RPC_URL_${HUB}\b`));
    assert.doesNotMatch(text, /NEXT_PUBLIC_RPC_BY_CHAIN/);
  });
});
