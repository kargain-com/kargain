import { getAddress, zeroAddress } from "viem";

import { CONTRACT_VERSIONS } from "./lib/contract-versions.js";
import { currencyCodeBytes32 } from "./lib/chainlink-feeds.js";
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
    console.error(`Missing ${SEPOLIA_DEPLOYMENT_PATH} — run pnpm deploy:sepolia first`);
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
    const adapter = manifest.proxyOnftAdapter;
    const usdc = getAddress(manifest.usdc ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e");

    if (!timelock || !adapter) {
      console.error("Manifest missing timelock or proxyOnftAdapter");
      process.exit(1);
    }

    const passport = await viem.getContractAt("KarPassport", manifest.karPassport);
    const proPass = await viem.getContractAt("KarProPass", manifest.karProPass);
    const staking = await viem.getContractAt("KarProStaking", manifest.karProStaking);
    const marketplace = await viem.getContractAt("MarketplaceEscrow", manifest.marketplace);
    const timelockContract = await viem.getContractAt("Timelock48h", timelock);
    const onftAdapter = await viem.getContractAt("ProxyONFT721Adapter", adapter);
    const auctionEscrow = manifest.auctionEscrow
      ? await viem.getContractAt("AuctionEscrow", manifest.auctionEscrow)
      : null;

    const results: CheckResult[] = [];

    const check = async (
      id: string,
      pass: boolean,
      expected: string,
      actual: string,
    ) => {
      results.push({ id, pass, expected, actual });
      console.log(`${pass ? "PASS" : "FAIL"} ${id}`);
      if (!pass) {
        console.log(`  expected: ${expected}`);
        console.log(`  actual:   ${actual}`);
      }
    };

    const versionChecks: Array<{ id: string; name: keyof typeof CONTRACT_VERSIONS; read: () => Promise<string> }> =
      [
        { id: "a", name: "KarPassport", read: () => passport.read.VERSION([]) as Promise<string> },
        { id: "b", name: "KarProStaking", read: () => staking.read.VERSION([]) as Promise<string> },
        { id: "c", name: "KarProPass", read: () => proPass.read.VERSION([]) as Promise<string> },
        { id: "d", name: "MarketplaceEscrow", read: () => marketplace.read.VERSION([]) as Promise<string> },
        { id: "e", name: "Timelock48h", read: () => timelockContract.read.VERSION([]) as Promise<string> },
        { id: "f", name: "ProxyONFT721Adapter", read: () => onftAdapter.read.VERSION([]) as Promise<string> },
        ...(auctionEscrow
          ? [
              {
                id: "g",
                name: "AuctionEscrow" as const,
                read: () => auctionEscrow.read.VERSION([]) as Promise<string>,
              },
            ]
          : []),
      ];

    for (const { id, name, read } of versionChecks) {
      let actual: string;
      try {
        actual = await read();
      } catch {
        if (name === "KarProPass" && manifest.unchanged?.includes("karProPass")) {
          await check(
            `${id}. VERSION ${name} (reused — no on-chain VERSION())`,
            true,
            CONTRACT_VERSIONS[name],
            "reused v1 contract",
          );
          continue;
        }
        throw new Error(`${name}.VERSION() reverted`);
      }
      const expected = CONTRACT_VERSIONS[name];
      await check(`${id}. VERSION ${name}`, actual === expected, expected, actual);
    }

    const marketplaceUpgradeId = auctionEscrow ? "h" : "g";
    const upgradeAuthority = getAddress((await marketplace.read.upgradeAuthority([])) as `0x${string}`);
    await check(
      `${marketplaceUpgradeId}. upgradeAuthority == timelock`,
      upgradeAuthority === getAddress(timelock),
      getAddress(timelock),
      upgradeAuthority,
    );

    const proPassStaking = getAddress((await proPass.read.staking([])) as `0x${string}`);
    await check(
      `${auctionEscrow ? "i" : "h"}. KarProPass.staking`,
      proPassStaking === getAddress(manifest.karProStaking),
      getAddress(manifest.karProStaking),
      proPassStaking,
    );

    const passportStaking = getAddress(
      (await passport.read.karProStakingAddress([])) as `0x${string}`,
    );
    await check(
      `${auctionEscrow ? "j" : "i"}. KarPassport.karProStakingAddress`,
      passportStaking === getAddress(manifest.karProStaking),
      getAddress(manifest.karProStaking),
      passportStaking,
    );

    const tokenIdOffset = (await passport.read.tokenIdOffset([])) as bigint;
    await check(
      `${auctionEscrow ? "k" : "j"}. KarPassport.tokenIdOffset`,
      tokenIdOffset === EXPECTED_TOKEN_ID_OFFSET,
      EXPECTED_TOKEN_ID_OFFSET.toString(),
      tokenIdOffset.toString(),
    );
    console.log(`  tokenIdOffset: ${tokenIdOffset.toString()}`);

    const marketplacePassport = getAddress((await marketplace.read.karPassport([])) as `0x${string}`);
    await check(
      `${auctionEscrow ? "l" : "k"}. MarketplaceEscrow.karPassport`,
      marketplacePassport === getAddress(manifest.karPassport),
      getAddress(manifest.karPassport),
      marketplacePassport,
    );

    const platformFeeBps = (await marketplace.read.platformFeeBps([])) as number;
    await check(
      `${auctionEscrow ? "m" : "l"}. platformFeeBps`,
      platformFeeBps === 10,
      "10",
      String(platformFeeBps),
    );

    const paused = (await marketplace.read.paused([])) as boolean;
    await check(`${auctionEscrow ? "n" : "m"}. paused`, paused === false, "false", String(paused));

    const usdFeed = (await marketplace.read.currencyFeeds([currencyCodeBytes32("USD")])) as `0x${string}`;
    await check(
      `${auctionEscrow ? "o" : "n"}. currencyFeeds(USD)`,
      usdFeed === zeroAddress,
      zeroAddress,
      usdFeed,
    );

    const paymentCfg = (await marketplace.read.paymentTokens([usdc])) as readonly [
      `0x${string}`,
      boolean,
    ];
    await check(
      `${auctionEscrow ? "p" : "o"}. paymentTokens(USDC).enabled`,
      paymentCfg[1] === true,
      "true",
      String(paymentCfg[1]),
    );

    if (auctionEscrow) {
      const auctionUpgradeAuthority = getAddress(
        (await auctionEscrow.read.upgradeAuthority([])) as `0x${string}`,
      );
      await check(
        "q. AuctionEscrow.upgradeAuthority == timelock",
        auctionUpgradeAuthority === getAddress(timelock),
        getAddress(timelock),
        auctionUpgradeAuthority,
      );

      const auctionActive = (await auctionEscrow.read.isAuctionActive([0n])) as boolean;
      await check("r. AuctionEscrow.isAuctionActive(0)", auctionActive === false, "false", String(auctionActive));
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
