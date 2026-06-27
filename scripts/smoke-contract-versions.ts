import assert from "node:assert/strict";
import hardhat from "hardhat";

import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";
import { deployEscrowStack } from "./lib/local-stack.js";

async function main() {
  const connection = await hardhat.network.connect();
  try {
    const { viem } = connection;
    const stack = await deployEscrowStack(viem);

    const timelock = await viem.getContractAt("Timelock48h", stack.timelock.address);
    const lzStub = await viem.deployContract("SelfDestructSender", []);
    const adapter = await viem.deployContract("ProxyONFT721Adapter", [
      stack.passport.address,
      stack.marketplace.address,
      lzStub.address,
      stack.admin.account.address,
    ]);

    const checks: Array<{ name: keyof typeof CONTRACT_VERSIONS; read: () => Promise<unknown> }> = [
      { name: "KarPassport", read: () => stack.passport.read.VERSION([]) },
      { name: "KarProPass", read: () => stack.proPass.read.VERSION([]) },
      { name: "KarProStaking", read: () => stack.staking.read.VERSION([]) },
      { name: "MarketplaceEscrow", read: () => stack.marketplace.read.VERSION([]) },
      { name: "Timelock48h", read: () => timelock.read.VERSION([]) },
      { name: "ProxyONFT721Adapter", read: () => adapter.read.VERSION([]) },
    ];

    for (const { name, read } of checks) {
      const version = (await read()) as string;
      assert.equal(version, CONTRACT_VERSIONS[name], `${name} VERSION mismatch`);
      console.log(`${name}: ${version}`);
    }

    const onft = await viem.deployContract("KarPassportONFT721", [
      lzStub.address,
      stack.admin.account.address,
    ]);
    const onftVersion = (await onft.read.VERSION([])) as string;
    assert.equal(onftVersion, CONTRACT_VERSIONS.KarPassportONFT721);
    console.log(`KarPassportONFT721: ${onftVersion}`);
  } finally {
    await connection.close();
  }
}

await main();
