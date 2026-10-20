import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  supportsPersonalSignIdentity,
  classifyBytecode,
  isMessageablePeer,
  isMessageablePeerOnCommercialChains,
  isProtocolAddress,
  isProtocolAddressOnCommercialChains,
  messagingWalletError,
} from "../lib/web3/wallet-account.ts";
import { kargainTimelockAddress } from "../lib/web3/deployment-addresses.ts";
import {
  evmProtocolAddresses,
  requireEvmCommercialActive,
} from "../lib/web3/commercial-active.ts";
import {
  ETHEREUM_SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from "../lib/web3/sepolia-addresses.ts";
import {
  BASE_SEPOLIA_AT_6C5CEBC,
  ETHEREUM_SEPOLIA_AT_6C5CEBC,
} from "./fixtures/n2-addresses-at-6c5cebc.ts";
import { SEPOLIA_FALLBACK } from "../scripts/lib/load-deployment.ts";

const SEPOLIA_DEPLOYER = SEPOLIA_FALLBACK.deployer;
const HUB = requireEvmCommercialActive(84532);
const SPOKE = requireEvmCommercialActive(11155111);

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
      isProtocolAddress("0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19", SEPOLIA_CHAIN_ID),
      true,
    );
  });

  it("flags spoke KarPassport on Ethereum Sepolia", () => {
    assert.equal(isProtocolAddress(SPOKE.karPassport, ETHEREUM_SEPOLIA_CHAIN_ID), true);
  });

  // Retired dual-list hex: Base historical adapter + Eth Nuclear #2 KarPassport.
  // Pin the literal — never SPOKE.karPassport (active bundle changes every Nuclear).
  const DUAL_CHAIN_RETIRED =
    "0xC219bf834B8965339b95C0B6Afe3c4d0F1266Fb0" as const;

  it("protocol match is chain-scoped (SPEC §I.12.12 dual-list hex)", () => {
    assert.equal(isProtocolAddress(DUAL_CHAIN_RETIRED, SEPOLIA_CHAIN_ID), true);
    assert.equal(isProtocolAddress(DUAL_CHAIN_RETIRED, ETHEREUM_SEPOLIA_CHAIN_ID), true);
  });

  it("does not flag arbitrary EOA", () => {
    assert.equal(
      isProtocolAddress("0xcfe194fea9727bD04dA8F78c2362680986e02dF1", SEPOLIA_CHAIN_ID),
      false,
    );
  });

  it("does not flag Sepolia deployer EOA", () => {
    assert.equal(isProtocolAddress(SEPOLIA_DEPLOYER, SEPOLIA_CHAIN_ID), false);
    assert.equal(isMessageablePeer(SEPOLIA_DEPLOYER, SEPOLIA_CHAIN_ID), true);
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
    const legacyMarketplace = HUB.historicalDenylist[11];
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

describe("protocol set is a superset of the pre-registry wallet set (per network)", () => {
  it("84532", () => {
    for (const addr of BASE_SEPOLIA_AT_6C5CEBC.walletSet) {
      assert.equal(isProtocolAddress(addr, SEPOLIA_CHAIN_ID), true, addr);
    }
  });

  it("11155111", () => {
    for (const addr of ETHEREUM_SEPOLIA_AT_6C5CEBC.walletSet) {
      assert.equal(isProtocolAddress(addr, ETHEREUM_SEPOLIA_CHAIN_ID), true, addr);
    }
  });

  it("owner excludes deployer, upgrade authority and sinks", () => {
    const set = evmProtocolAddresses(HUB).map((a) => a.toLowerCase());
    assert.equal(set.includes(SEPOLIA_DEPLOYER.toLowerCase()), false);
  });
});

describe("kargainTimelockAddress", () => {
  it("returns Timelock48h fallback on Base Sepolia", () => {
    assert.equal(
      kargainTimelockAddress(SEPOLIA_CHAIN_ID)?.toLowerCase(),
      SEPOLIA_FALLBACK.timelock!.toLowerCase(),
    );
  });

  it("TimelockController is in the protocol denylist; deployer EOA is not (SPEC II.4.1)", () => {
    const timelock = kargainTimelockAddress(SEPOLIA_CHAIN_ID);
    assert.ok(timelock);
    const denylist = evmProtocolAddresses(HUB).map((addr) => addr.toLowerCase());
    assert.equal(denylist.includes(timelock.toLowerCase()), true);
    assert.equal(isProtocolAddress(timelock, SEPOLIA_CHAIN_ID), true);
    assert.equal(isMessageablePeer(timelock, SEPOLIA_CHAIN_ID), false);

    assert.equal(isProtocolAddress(SEPOLIA_DEPLOYER, SEPOLIA_CHAIN_ID), false);
    assert.equal(
      denylist.includes(SEPOLIA_DEPLOYER.toLowerCase()),
      false,
    );
  });
});

describe("isMessageablePeer", () => {
  it("rejects historical v1 marketplace on denylist", () => {
    const legacyMarketplace = HUB.historicalDenylist[1];
    assert.equal(isMessageablePeer(legacyMarketplace, SEPOLIA_CHAIN_ID), false);
  });

  it("allows normal addresses", () => {
    assert.equal(
      isMessageablePeer("0xcfe194fea9727bD04dA8F78c2362680986e02dF1", SEPOLIA_CHAIN_ID),
      true,
    );
  });
});

describe("isMessageablePeerOnCommercialChains", () => {
  it("rejects hub historical marketplace", () => {
    const legacyMarketplace = HUB.historicalDenylist[11];
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
