/**
 * ProtocolOwner brand — entity owner type wall.
 *
 * Compile control: ProtocolOwner is not assignable to `` `0x${string}` ``
 * without isEvmHexAddress narrowing. Behavioural: mint refuses bad/empty;
 * EVM checksum round-trip; messaging leaf still narrows.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { isEvmHexAddress } from "../lib/passport/passport-owner.ts";
import {
  mintEvmProtocolOwner,
  mintProtocolOwner,
} from "../lib/web3/protocol-address.ts";
import { commercialSvmNamespaceIds } from "../lib/web3/commercial-active.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LISTING_ISLAND = path.join(
  ROOT,
  "components/marketplace/listing-detail-client-island.tsx",
);
const TX_ERROR_MESSAGE = path.join(
  ROOT,
  "lib/marketplace/tx-error-message.ts",
);

function runAssignabilityProbe(source: string): {
  status: number | null;
  out: string;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-protocol-owner-"));
  const probe = path.join(tmp, "probe.ts");
  const tsconfigPath = path.join(tmp, "tsconfig.json");
  try {
    fs.writeFileSync(
      tsconfigPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022"],
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "ESNext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            allowImportingTsExtensions: true,
            typeRoots: [path.join(ROOT, "node_modules/@types")],
            paths: {
              "@/*": [path.join(ROOT, "*")],
            },
            baseUrl: ROOT,
          },
          files: [probe],
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(probe, source);
    const result = spawnSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "-p", tsconfigPath],
      { cwd: ROOT, encoding: "utf8" },
    );
    return {
      status: result.status,
      out: `${result.stdout}\n${result.stderr}`,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("ProtocolOwner brand (entity owner type wall)", () => {
  it("mintEvmProtocolOwner checksums without a namespace; refuses garbage", () => {
    assert.equal(mintEvmProtocolOwner(""), null);
    assert.equal(mintEvmProtocolOwner("not-a-protocol-address!!!"), null);
    const checksummed = mintEvmProtocolOwner(
      "0x1111111111111111111111111111111111111111",
    );
    assert.ok(checksummed);
    assert.equal(checksummed, "0x1111111111111111111111111111111111111111");
    const lower = mintEvmProtocolOwner(
      "0x1111111111111111111111111111111111111111".toLowerCase(),
    );
    assert.equal(lower, checksummed);
  });

  it("tx-error-message uses mintEvmProtocolOwner — hub namespace plant is red", () => {
    const live = fs.readFileSync(TX_ERROR_MESSAGE, "utf8");
    assert.match(live, /mintEvmProtocolOwner/);
    assert.doesNotMatch(live, /mintProtocolOwner\s*\(/);
    assert.doesNotMatch(live, /84_532|84532/);

    const planted = live.replace(
      /mintEvmProtocolOwner\s*\(\s*raw\s*\)/,
      "mintProtocolOwner(84_532, raw)",
    );
    assert.notEqual(planted, live, "plant must rewrite the EVM-only mint call");
    assert.match(planted, /84_532/);
    assert.equal(
      /mintEvmProtocolOwner\s*\(\s*raw\s*\)/.test(planted),
      false,
      "planted hub-namespace mint must turn the leaf pin red",
    );
  });

  it("mint refuses empty and non-protocol strings; EVM checksum round-trips", () => {
    assert.equal(mintProtocolOwner(84532, ""), null);
    assert.equal(mintProtocolOwner(84532, "not-a-protocol-address!!!"), null);

    const checksummed = mintProtocolOwner(
      84532,
      "0x1111111111111111111111111111111111111111",
    );
    assert.ok(checksummed);
    assert.equal(checksummed, "0x1111111111111111111111111111111111111111");
    // Lowercase ingress still yields checksum form.
    const lower = mintProtocolOwner(
      84532,
      "0x1111111111111111111111111111111111111111".toLowerCase(),
    );
    assert.equal(lower, checksummed);
  });

  it("mint refuses EVM hex on SVM namespace; accepts base58 pubkey", () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    assert.equal(
      mintProtocolOwner(ns, "0x1111111111111111111111111111111111111111"),
      null,
      "EVM hex must not mint as ProtocolOwner on SVM",
    );
    const sys = mintProtocolOwner(ns, "11111111111111111111111111111111");
    assert.ok(sys);
    assert.equal(sys, "11111111111111111111111111111111");
  });

  it("ProtocolOwner is not assignable to 0x without narrow — tsc RED; narrow GREEN", () => {
    const red = runAssignabilityProbe(`
import type { ProtocolOwner } from "@/lib/web3/protocol-address";
declare const owner: ProtocolOwner;
const hex: \`0x\${string}\` = owner;
void hex;
`);
    assert.notEqual(
      red.status,
      0,
      `expected bare ProtocolOwner→0x assign to fail tsc; out:\n${red.out}`,
    );
    assert.match(red.out, /not assignable/i);

    const green = runAssignabilityProbe(`
import type { ProtocolOwner } from "@/lib/web3/protocol-address";
import { isEvmHexAddress } from "@/lib/passport/passport-owner";
declare const owner: ProtocolOwner;
if (isEvmHexAddress(owner)) {
  const hex: \`0x\${string}\` = owner;
  void hex;
}
`);
    assert.equal(
      green.status,
      0,
      `expected isEvmHexAddress narrow to pass tsc; out:\n${green.out}`,
    );
  });

  it("isEvmHexAddress narrows a minted EVM ProtocolOwner to 0x", () => {
    const owner = mintProtocolOwner(
      84532,
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
    assert.ok(owner);
    assert.equal(isEvmHexAddress(owner), true);
    if (!isEvmHexAddress(owner)) return;
    const hex: `0x${string}` = owner;
    assert.match(hex, /^0x[0-9a-fA-F]{40}$/);
  });

  it("listing messaging peer still narrows via isEvmHexAddress — plant drop turns red", () => {
    const live = fs.readFileSync(LISTING_ISLAND, "utf8");
    assert.match(
      live,
      /isEvmHexAddress\s*\(\s*peer\s*\)/,
      "live listing island must narrow contact peer with isEvmHexAddress",
    );
    assert.match(live, /contactPeer:\s*`0x\$\{string\}`/);

    // Plant: assign peer to contactPeer without the narrow.
    const planted = live.replace(
      /if \(peer == null \|\| !isEvmHexAddress\(peer\)\) return undefined;\s*return peer;/,
      "if (peer == null) return undefined;\n    return peer as `0x${string}`;",
    );
    assert.notEqual(
      planted,
      live,
      "plant must rewrite the messaging peer narrow",
    );
    assert.equal(
      /isEvmHexAddress\s*\(\s*peer\s*\)/.test(planted),
      false,
      "planted drop of isEvmHexAddress must turn the leaf pin red",
    );
    assert.equal(
      /isEvmHexAddress\s*\(\s*peer\s*\)/.test(live),
      true,
      "live must retain isEvmHexAddress narrow",
    );
  });

  it("mint is the sole ProtocolOwner constructor — no product as ProtocolOwner", () => {
    // Scan product roots for `as ProtocolOwner` outside the mint site.
    const roots = ["app", "components", "hooks", "lib"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(ent.name)) continue;
        const rel = path.relative(ROOT, full);
        if (rel === "lib/web3/protocol-address.ts") continue;
        const text = fs.readFileSync(full, "utf8");
        if (/as\s+ProtocolOwner\b/.test(text)) hits.push(rel);
      }
    };
    for (const r of roots) walk(path.join(ROOT, r));
    assert.deepEqual(
      hits,
      [],
      `no product as ProtocolOwner outside mint; hits: ${hits.join(", ")}`,
    );
  });
});
