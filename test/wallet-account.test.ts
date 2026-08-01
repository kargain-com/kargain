import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allProtocolAddresses,
  supportsPersonalSignIdentity,
  classifyBytecode,
  explorerAddressUrl,
  isMessageablePeer,
  isMessageablePeerOnCommercialChains,
  isProtocolAddress,
  isProtocolAddressOnCommercialChains,
  messagingWalletError,
} from "../lib/web3/wallet-account.ts";
import { kargainTimelockAddress } from "../lib/web3/deployment-addresses.ts";
import { COMMERCIAL_ACTIVE } from "../lib/web3/commercial-active.ts";
import { SEPOLIA_HISTORICAL_DENYLIST } from "../lib/web3/sepolia-addresses.ts";
import { SEPOLIA_FALLBACK } from "../scripts/lib/load-deployment.ts";

const SEPOLIA_DEPLOYER = SEPOLIA_FALLBACK.deployer;
const SPOKE = COMMERCIAL_ACTIVE[11155111]!;

describe("classifyBytecode", () => {
  it("classifies clean EOA", () => {
    assert.equal(classifyBytecode("0x"), "eoa");
    assert.equal(classifyBytecode("0x0"), "eoa");
    assert.equal(classifyBytecode(null), "eoa");
  });

  it("classifies EIP-7702 delegated account", () => {
    assert.equal(classifyBytecode("0xef0100abcdef"), "eip7702");
  });

  it("classifies contract account", () => {
    assert.equal(classifyBytecode("0x6001600052"), "contract");
  });
});

describe("isProtocolAddress", () => {
  it("flags marketplace escrow on Base Sepolia", () => {
    assert.equal(
      isProtocolAddress("0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19", 84532),
      true,
    );
  });

  it("flags spoke KarPassport on Ethereum Sepolia", () => {
    assert.equal(isProtocolAddress(SPOKE.karPassport, 11155111), true);
  });

  it("flags spoke KarPassport as historical on Base Sepolia", () => {
    assert.equal(isProtocolAddress(SPOKE.karPassport, 84532), true);
  });

  it("does not flag arbitrary EOA", () => {
    assert.equal(
      isProtocolAddress("0xcfe194fea9727bD04dA8F78c2362680986e02dF1", 84532),
      false,
    );
  });

  it("does not flag Sepolia deployer EOA", () => {
    assert.equal(isProtocolAddress(SEPOLIA_DEPLOYER, 84532), false);
    assert.equal(isMessageablePeer(SEPOLIA_DEPLOYER, 84532), true);
  });

  it("upgradeAuthority is Timelock48h on v2 Sepolia fallback", () => {
    assert.notEqual(
      SEPOLIA_FALLBACK.upgradeAuthority.toLowerCase(),
      SEPOLIA_DEPLOYER.toLowerCase(),
    );
    assert.equal(
      SEPOLIA_FALLBACK.upgradeAuthority.toLowerCase(),
      SEPOLIA_FALLBACK.timelock!.toLowerCase(),
    );
  });
});

describe("isProtocolAddressOnCommercialChains", () => {
  it("flags hub historical marketplace via commercial union", () => {
    const legacyMarketplace = SEPOLIA_HISTORICAL_DENYLIST[11];
    assert.equal(
      isProtocolAddressOnCommercialChains(legacyMarketplace),
      true,
    );
  });

  it("flags spoke KarPassport via commercial union", () => {
    assert.equal(
      isProtocolAddressOnCommercialChains(SPOKE.karPassport),
      true,
    );
  });

  it("does not flag ordinary EOA", () => {
    assert.equal(
      isProtocolAddressOnCommercialChains(
        "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
      ),
      false,
    );
  });

  it("does not flag deployer EOA", () => {
    assert.equal(isProtocolAddressOnCommercialChains(SEPOLIA_DEPLOYER), false);
  });
});

describe("kargainTimelockAddress", () => {
  it("returns Timelock48h fallback on Base Sepolia", () => {
    assert.equal(
      kargainTimelockAddress(84532)?.toLowerCase(),
      SEPOLIA_FALLBACK.timelock!.toLowerCase(),
    );
  });

  it("timelock is never in the static protocol denylist", () => {
    const timelock = kargainTimelockAddress(84532);
    if (!timelock) return;
    const denylist = allProtocolAddresses(84532).map((addr) => addr.toLowerCase());
    assert.equal(denylist.includes(timelock.toLowerCase()), false);
  });
});

describe("isMessageablePeer", () => {
  it("rejects historical v1 marketplace on denylist", () => {
    const legacyMarketplace = SEPOLIA_HISTORICAL_DENYLIST[1];
    assert.equal(isMessageablePeer(legacyMarketplace, 84532), false);
  });

  it("allows normal addresses", () => {
    assert.equal(
      isMessageablePeer("0xcfe194fea9727bD04dA8F78c2362680986e02dF1", 84532),
      true,
    );
  });
});

describe("isMessageablePeerOnCommercialChains", () => {
  it("rejects hub historical marketplace", () => {
    const legacyMarketplace = SEPOLIA_HISTORICAL_DENYLIST[11];
    assert.equal(isMessageablePeerOnCommercialChains(legacyMarketplace), false);
  });

  it("rejects spoke KarPassport", () => {
    assert.equal(isMessageablePeerOnCommercialChains(SPOKE.karPassport), false);
  });

  it("allows ordinary EOAs", () => {
    assert.equal(isMessageablePeerOnCommercialChains(SEPOLIA_DEPLOYER), true);
  });
});

describe("messagingWalletError", () => {
  it("returns null for EOA and EIP-7702", () => {
    assert.equal(messagingWalletError("eoa"), null);
    assert.equal(messagingWalletError("eip7702"), null);
  });

  it("returns message for contract accounts", () => {
    assert.ok(messagingWalletError("contract"));
  });
});

describe("supportsPersonalSignIdentity", () => {
  it("allows EOA and EIP-7702", () => {
    assert.equal(supportsPersonalSignIdentity("eoa"), true);
    assert.equal(supportsPersonalSignIdentity("eip7702"), true);
  });

  it("blocks contract accounts", () => {
    assert.equal(supportsPersonalSignIdentity("contract"), false);
  });
});

describe("explorerAddressUrl", () => {
  it("builds Base Sepolia explorer link", () => {
    const legacyMarketplace = SEPOLIA_HISTORICAL_DENYLIST[1];
    const url = explorerAddressUrl(84532, legacyMarketplace);
    assert.ok(url.includes("sepolia.basescan.org"));
    assert.ok(url.includes(legacyMarketplace));
  });
});
