import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  arUriToHttp,
  arweaveGateway,
  IRYS_DEVNET_GATEWAY,
} from "../lib/storage/ar-gateway.ts";

describe("ar-gateway", () => {
  it("uses Irys gateway on Base Sepolia", () => {
    assert.equal(arweaveGateway(84532), IRYS_DEVNET_GATEWAY);
    assert.equal(
      arUriToHttp("ar://FUxumruhy44a2RRToEgpKrZ9J1Xv2VecKJXWzuRk6wC3", 84532),
      `${IRYS_DEVNET_GATEWAY}/FUxumruhy44a2RRToEgpKrZ9J1Xv2VecKJXWzuRk6wC3`,
    );
  });

  it("uses arweave.net on Base mainnet", () => {
    assert.equal(arweaveGateway(8453), "https://arweave.net");
  });
});
