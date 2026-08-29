import { getAddress } from "viem";

import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";
import {
  requireSepoliaDeployment,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_DEPLOYMENT_PATH,
} from "./lib/load-deployment.js";

type CheckResult = {
  id: string;
  pass: boolean;
  expected: string;
  actual: string;
};

const EXPECTED_TOKEN_ID_OFFSET = BigInt(SEPOLIA_CHAIN_ID) << 128n;

async function main() {
  let manifest;
  try {
    manifest = requireSepoliaDeployment();
  } catch {
    console.error(`Missing ${SEPOLIA_DEPLOYMENT_PATH()} — run pnpm deploy:sepolia first`);
    process.exit(1);
  }

  const hardhat = await import("hardhat");
  const connection = await hardhat.default.network.connect();
  const { viem } = connection;

  try {
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(`Expected chain ${SEPOLIA_CHAIN_ID}, got ${chainId}`);
    }

    const timelock = manifest.timelock;
    const bridgeGatewayAddr = manifest.bridgeGateway;

    if (!timelock || !bridgeGatewayAddr) {
      console.error("Manifest missing timelock or bridgeGateway");
      process.exit(1);
    }

    const passport = await viem.getContractAt("KarPassport", manifest.karPassport);
    const proPass = await viem.getContractAt("KarProPass", manifest.karProPass);
    const staking = await viem.getContractAt("KarProStaking", manifest.karProStaking);
    const timelockContract = await viem.getContractAt("Timelock48h", timelock);
    const bridgeGateway = await viem.getContractAt(
      "KarPassportBridgeGateway",
      bridgeGatewayAddr,
    );
    const fixedPrice = manifest.fixedPriceConsignment
      ? await viem.getContractAt("FixedPriceConsignment", manifest.fixedPriceConsignment)
      : null;
    const ascending = manifest.ascendingConsignment
      ? await viem.getContractAt("AscendingConsignment", manifest.ascendingConsignment)
      : null;

    const results: CheckResult[] = [];
    let idCounter = 0;
    const nextId = () => {
      idCounter += 1;
      return String.fromCharCode(96 + idCounter);
    };

    const check = async (
      label: string,
      pass: boolean,
      expected: string,
      actual: string,
    ) => {
      const id = `${nextId()}. ${label}`;
      results.push({ id, pass, expected, actual });
      console.log(`${pass ? "PASS" : "FAIL"} ${id}`);
      if (!pass) {
        console.log(`  expected: ${expected}`);
        console.log(`  actual:   ${actual}`);
      }
    };

    const versionChecks: Array<{ name: keyof typeof CONTRACT_VERSIONS; read: () => Promise<string> }> =
      [
        { name: "KarPassport", read: () => passport.read.VERSION([]) as Promise<string> },
        { name: "KarProStaking", read: () => staking.read.VERSION([]) as Promise<string> },
        { name: "KarProPass", read: () => proPass.read.VERSION([]) as Promise<string> },
        { name: "Timelock48h", read: () => timelockContract.read.VERSION([]) as Promise<string> },
        {
          name: "KarPassportBridgeGateway",
          read: () => bridgeGateway.read.VERSION([]) as Promise<string>,
        },
        ...(fixedPrice
          ? [
              {
                name: "FixedPriceConsignment" as const,
                read: () => fixedPrice.read.VERSION([]) as Promise<string>,
              },
            ]
          : []),
        ...(ascending
          ? [
              {
                name: "AscendingConsignment" as const,
                read: () => ascending.read.VERSION([]) as Promise<string>,
              },
            ]
          : []),
      ];

    for (const { name, read } of versionChecks) {
      let actual: string;
      try {
        actual = await read();
      } catch {
        if (name === "KarProPass" && manifest.unchanged?.includes("karProPass")) {
          await check(
            `VERSION ${name} (reused — no on-chain VERSION())`,
            true,
            CONTRACT_VERSIONS[name],
            "reused v1 contract",
          );
          continue;
        }
        throw new Error(`${name}.VERSION() reverted`);
      }
      const expected = CONTRACT_VERSIONS[name];
      await check(`VERSION ${name}`, actual === expected, expected, actual);
    }

    const proPassStaking = getAddress((await proPass.read.staking([])) as `0x${string}`);
    await check(
      "KarProPass.staking",
      proPassStaking === getAddress(manifest.karProStaking),
      getAddress(manifest.karProStaking),
      proPassStaking,
    );

    const passportStaking = getAddress(
      (await passport.read.karProStakingAddress([])) as `0x${string}`,
    );
    await check(
      "KarPassport.karProStakingAddress",
      passportStaking === getAddress(manifest.karProStaking),
      getAddress(manifest.karProStaking),
      passportStaking,
    );

    const tokenIdOffset = (await passport.read.tokenIdOffset([])) as bigint;
    await check(
      "KarPassport.tokenIdOffset",
      tokenIdOffset === EXPECTED_TOKEN_ID_OFFSET,
      EXPECTED_TOKEN_ID_OFFSET.toString(),
      tokenIdOffset.toString(),
    );
    console.log(`  tokenIdOffset: ${tokenIdOffset.toString()}`);

    if (fixedPrice) {
      const fixedPriceOwner = getAddress((await fixedPrice.read.owner([])) as `0x${string}`);
      await check(
        "FixedPriceConsignment.owner == timelock",
        fixedPriceOwner === getAddress(timelock),
        getAddress(timelock),
        fixedPriceOwner,
      );

      const fixedPricePassport = getAddress(
        (await fixedPrice.read.karPassport([])) as `0x${string}`,
      );
      await check(
        "FixedPriceConsignment.karPassport",
        fixedPricePassport === getAddress(manifest.karPassport),
        getAddress(manifest.karPassport),
        fixedPricePassport,
      );

      const fixedPricePaused = (await fixedPrice.read.paused([])) as boolean;
      await check(
        "FixedPriceConsignment.paused",
        fixedPricePaused === false,
        "false",
        String(fixedPricePaused),
      );
    }

    if (ascending) {
      const ascendingOwner = getAddress((await ascending.read.owner([])) as `0x${string}`);
      await check(
        "AscendingConsignment.owner == timelock",
        ascendingOwner === getAddress(timelock),
        getAddress(timelock),
        ascendingOwner,
      );

      const ascendingPassport = getAddress(
        (await ascending.read.karPassport([])) as `0x${string}`,
      );
      await check(
        "AscendingConsignment.karPassport",
        ascendingPassport === getAddress(manifest.karPassport),
        getAddress(manifest.karPassport),
        ascendingPassport,
      );

      const ascendingPaused = (await ascending.read.paused([])) as boolean;
      await check(
        "AscendingConsignment.paused",
        ascendingPaused === false,
        "false",
        String(ascendingPaused),
      );
    }

    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    console.log(`\n${passed}/${total} checks passed`);

    if (passed !== total) {
      process.exit(1);
    }
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
