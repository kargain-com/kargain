import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LISTING_CARD_FIRST_VIEWPORT_COUNT,
  LISTING_CARD_GRID_PRO,
  LISTING_CARD_GRID_WIDE,
} from "@/lib/marketplace/listing-card-grid";
import {
  CONTENT_IMAGE_DEFAULT_GATEWAY_BASES,
  CONTENT_IMAGE_MINIMUM_CACHE_TTL_SECONDS,
  contentImageRemoteHosts,
} from "@/lib/storage/next-image-config";
import {
  ARWEAVE_MAINNET_GATEWAY,
  IRYS_DEVNET_GATEWAY,
} from "@/lib/storage/ar-gateway";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = path.join(ROOT, "components");

/** Non-content plates that may keep native `<img>`. */
const RAW_IMG_ALLOWLIST = new Set([
  "components/identity/identity-avatar.tsx",
  "components/ui/ens-avatar.tsx",
  "components/ui/qr-code.tsx",
  "components/shell/chain-icon.tsx",
  "components/passport/photo-thumb-grid.tsx",
  "components/passport/metadata-change-summary.tsx",
]);

/** Content photo surfaces — must render via ContentImage only. */
const CONTENT_PHOTO_FILES = [
  "components/marketplace/listing-card.tsx",
  "components/auction/auction-card.tsx",
  "components/profile/profile-passport-card.tsx",
  "components/passport/passport-photo-gallery.tsx",
  "components/challenges/challenge-row.tsx",
  "components/media/content-image.tsx",
];

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsx(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

describe("content image policy", () => {
  it("pins first-viewport count to max WIDE/PRO first-row columns", () => {
    assert.match(LISTING_CARD_GRID_WIDE, /xl:grid-cols-3/);
    assert.match(LISTING_CARD_GRID_PRO, /lg:grid-cols-3/);
    assert.equal(LISTING_CARD_FIRST_VIEWPORT_COUNT, 3);
  });

  it("pins immutable content image cache TTL and default gateway hosts", () => {
    assert.equal(CONTENT_IMAGE_MINIMUM_CACHE_TTL_SECONDS, 31_536_000);
    assert.deepEqual(
      [...CONTENT_IMAGE_DEFAULT_GATEWAY_BASES].sort(),
      [ARWEAVE_MAINNET_GATEWAY, IRYS_DEVNET_GATEWAY].sort(),
    );
    const hosts = contentImageRemoteHosts({});
    assert.deepEqual(
      hosts,
      [
        new URL(ARWEAVE_MAINNET_GATEWAY).hostname,
        new URL(IRYS_DEVNET_GATEWAY).hostname,
      ].sort(),
    );
  });

  it("appends build-time gateway override host to remote allowlist", () => {
    const hosts = contentImageRemoteHosts({
      NEXT_PUBLIC_ARWEAVE_GATEWAY: "https://custom.example/gateway/",
    });
    assert.ok(hosts.includes("custom.example"));
    assert.ok(hosts.includes("gateway.irys.xyz"));
    assert.ok(hosts.includes("arweave.net"));
  });

  it("forbids raw <img> in components outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of walkTsx(COMPONENTS)) {
      const key = rel(file);
      if (RAW_IMG_ALLOWLIST.has(key)) continue;
      if (key === "components/media/content-image.tsx") continue;
      const text = fs.readFileSync(file, "utf8");
      if (/<img[\s>]/.test(text)) offenders.push(key);
    }
    assert.deepEqual(
      offenders,
      [],
      `raw <img> outside allowlist:\n${offenders.join("\n")}`,
    );
  });

  it("requires ContentImage as the sole content-photo renderer", () => {
    for (const key of CONTENT_PHOTO_FILES) {
      const text = fs.readFileSync(path.join(ROOT, key), "utf8");
      assert.doesNotMatch(
        text,
        /<img[\s>]/,
        `${key} must not use raw <img>`,
      );
      if (key === "components/media/content-image.tsx") {
        assert.match(text, /from\s+["']next\/image["']/);
        continue;
      }
      assert.match(
        text,
        /from\s+["']@\/components\/media\/content-image["']/,
        `${key} must import ContentImage`,
      );
      assert.match(text, /\bContentImage\b/);
      assert.doesNotMatch(
        text,
        /from\s+["']next\/image["']/,
        `${key} must not import next/image directly`,
      );
    }

    assert.ok(
      !fs.existsSync(
        path.join(ROOT, "components/marketplace/listing-detail-gallery.tsx"),
      ),
      "listing-detail-gallery must stay deleted (dual path)",
    );
  });

  it("wires next.config images from next-image-config", () => {
    const config = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    assert.match(config, /contentImageRemotePatterns/);
    assert.match(config, /CONTENT_IMAGE_MINIMUM_CACHE_TTL_SECONDS/);
    assert.match(config, /minimumCacheTTL/);
  });
});
