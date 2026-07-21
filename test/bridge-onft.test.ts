/**
 * Bridge ONFT suite — hub ProxyONFT721Adapter ↔ spoke KarPassportONFT721
 * through a LayerZero EndpointV2Mock pair on one Hardhat network.
 *
 * Mock: @layerzerolabs/test-devtools-evm-hardhat@0.5.3 precompiled artifact
 * (Hardhat 3 / viem — no hardhat-deploy). hardhat.config `default` network
 * sets allowUnlimitedContractSize (mock exceeds EIP-170).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import hardhat from "hardhat";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import {
  concat,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  getContract,
  padHex,
  parseEther,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import {
  CURRENCY_USD,
  DISPUTE_DEPOSIT,
  THREE_DAYS,
  deployAuctionEscrow,
  deployEscrowStack,
  deployTimelock,
  joinVerifier,
  mintPassport,
  type DeployedContract,
  type ViemSuite,
  ZERO,
} from "../scripts/lib/local-stack.js";
import {
  buildSendParam,
  encodeLzReceiveExtraOptions,
} from "../lib/web3/bridge/bridge-send.js";
import {
  ENFORCED_GAS_SEND_AND_COMPOSE,
  LZ_RECEIVE_GAS_MARGIN_BPS,
  LZ_RECEIVE_MEASURED_500_CHAR_GAS,
  requiredLzReceiveGasForUri,
} from "../lib/web3/bridge/lz-receive-gas.js";

const EID_A = 1;
const EID_B = 2;
const LZ_RECEIVE_GAS = 1_000_000n;
const STATUS_VERIFIED = 1;
const STATUS_DISPUTED = 2;

const require = createRequire(import.meta.url);
const endpointArtifactPath = require
  .resolve("@layerzerolabs/test-devtools-evm-hardhat/package.json")
  .replace(/package\.json$/, "artifacts/contracts/mocks/EndpointV2Mock.sol/EndpointV2Mock.json");
const endpointArtifact = JSON.parse(readFileSync(endpointArtifactPath, "utf8")) as {
  abi: Abi;
  bytecode: Hex;
};

type GasRow = { label: string; gasUsed: bigint };
const gasTable: GasRow[] = [];

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return err.message.includes(errorName);
  };
}

function revertsWithEitherBridgeGuard() {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return (
      err.message.includes("ListedInMarketplace") || err.message.includes("PassportDisputed")
    );
  };
}

function addressToBytes32(addr: Address): Hex {
  return padHex(addr, { size: 32 });
}

function lzReceiveOptions(): Hex {
  return Options.newOptions().addExecutorLzReceiveOption(Number(LZ_RECEIVE_GAS), 0).toHex() as Hex;
}

function encodeOnftMessage(params: {
  to: Address;
  tokenId: bigint;
  /** When set, message is composed: sender(32) + composeBody */
  sender?: Address;
  composeBody?: Hex;
}): Hex {
  if (params.composeBody != null && params.sender != null) {
    return encodePacked(
      ["bytes32", "uint256", "bytes32", "bytes"],
      [addressToBytes32(params.to), params.tokenId, addressToBytes32(params.sender), params.composeBody],
    );
  }
  return encodePacked(["bytes32", "uint256"], [addressToBytes32(params.to), params.tokenId]);
}

function encodeUriCompose(uri: string): Hex {
  return encodeAbiParameters([{ type: "string" }], [uri]);
}

async function deployEndpointMock(
  viem: ViemSuite,
  eid: number,
  wallet: WalletClient,
  publicClient: PublicClient,
) {
  const hash = await wallet.deployContract({
    abi: endpointArtifact.abi,
    bytecode: endpointArtifact.bytecode,
    args: [eid],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.ok(receipt.contractAddress, "EndpointV2Mock deploy missing address");
  return getContract({
    address: receipt.contractAddress,
    abi: endpointArtifact.abi,
    client: { public: publicClient, wallet },
  });
}

type EndpointMock = Awaited<ReturnType<typeof deployEndpointMock>>;

async function impersonateAs(
  publicClient: PublicClient,
  viem: ViemSuite & { getWalletClient: (address: Address) => Promise<WalletClient> },
  address: Address,
): Promise<WalletClient> {
  await publicClient.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });
  await publicClient.request({
    method: "hardhat_setBalance",
    params: [address, toHex(parseEther("10"))],
  });
  return viem.getWalletClient(address);
}

async function stopImpersonating(publicClient: PublicClient, address: Address) {
  await publicClient.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [address],
  });
}

type BridgePair = {
  admin: Awaited<ReturnType<typeof deployEscrowStack>>["admin"];
  seller: Awaited<ReturnType<typeof deployEscrowStack>>["seller"];
  verifier: Awaited<ReturnType<typeof deployEscrowStack>>["verifier"];
  stranger: Awaited<ReturnType<typeof deployEscrowStack>>["stranger"];
  passport: DeployedContract;
  marketplace: DeployedContract;
  staking: DeployedContract;
  adapter: DeployedContract;
  spoke: DeployedContract;
  epA: EndpointMock;
  epB: EndpointMock;
  publicClient: PublicClient;
  viem: ViemSuite;
};

async function deployBridgePair(viem: ViemSuite): Promise<BridgePair> {
  const stack = await deployEscrowStack(viem);
  const [wallet] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const epA = await deployEndpointMock(viem, EID_A, wallet, publicClient);
  const epB = await deployEndpointMock(viem, EID_B, wallet, publicClient);

  const adapter = await viem.deployContract("ProxyONFT721Adapter", [
    stack.passport.address,
    stack.marketplace.address,
    epA.address,
    stack.admin.account.address,
  ]);
  const spoke = await viem.deployContract("KarPassportONFT721", [
    epB.address,
    stack.admin.account.address,
  ]);

  await epA.write.setDestLzEndpoint([spoke.address, epB.address]);
  await epB.write.setDestLzEndpoint([adapter.address, epA.address]);
  await adapter.write.setPeer([EID_B, addressToBytes32(spoke.address)], {
    account: stack.admin.account,
  });
  await spoke.write.setPeer([EID_A, addressToBytes32(adapter.address)], {
    account: stack.admin.account,
  });

  return {
    admin: stack.admin,
    seller: stack.seller,
    verifier: stack.verifier,
    stranger: stack.stranger,
    passport: stack.passport,
    marketplace: stack.marketplace,
    staking: stack.staking,
    adapter,
    spoke,
    epA,
    epB,
    publicClient,
    viem,
  };
}

function sendParam(dstEid: number, to: Address, tokenId: bigint, extraOptions: Hex = lzReceiveOptions()) {
  return {
    dstEid,
    to: addressToBytes32(to),
    tokenId,
    extraOptions,
    composeMsg: "0x" as Hex,
    onftCmd: "0x" as Hex,
  };
}

async function bridgeSend(
  oapp: DeployedContract,
  param: ReturnType<typeof sendParam>,
  account: WalletClient["account"],
) {
  const fee = (await oapp.read.quoteSend([param, false])) as {
    nativeFee: bigint;
    lzTokenFee: bigint;
  };
  const hash = await oapp.write.send([param, fee, account!.address], {
    account,
    value: fee.nativeFee,
  });
  return hash as Hex;
}

async function callLzReceive(params: {
  oapp: DeployedContract;
  endpoint: Address;
  origin: { srcEid: number; sender: Hex; nonce: bigint };
  guid: Hex;
  message: Hex;
  publicClient: PublicClient;
  viem: ViemSuite;
}): Promise<{ gasUsed: bigint; hash: Hex }> {
  const wallet = await impersonateAs(
    params.publicClient,
    params.viem as ViemSuite & { getWalletClient: (address: Address) => Promise<WalletClient> },
    params.endpoint,
  );
  try {
    const hash = await params.oapp.write.lzReceive(
      [params.origin, params.guid, params.message, zeroAddress, "0x"],
      { account: wallet.account },
    );
    const receipt = await params.publicClient.waitForTransactionReceipt({ hash });
    return { gasUsed: receipt.gasUsed, hash };
  } finally {
    await stopImpersonating(params.publicClient, params.endpoint);
  }
}

describe("Bridge ONFT — EndpointV2Mock delivery", () => {
  let connection: Awaited<ReturnType<typeof hardhat.network.connect>>;

  beforeEach(async () => {
    connection = await hardhat.network.connect();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("full roundtrip: hub lock → spoke mint+URI → spoke burn → hub unlock", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const uri = "ar://bridge-roundtrip-abcdefghijklmnopqrstuvwxyz012345";
    const tokenId = await mintPassport(pair.passport, pair.seller, pair.seller.account.address, uri);
    await pair.passport.write.setApprovalForAll([pair.adapter.address, true], {
      account: pair.seller.account,
    });

    await bridgeSend(
      pair.adapter,
      sendParam(EID_B, pair.seller.account.address, tokenId),
      pair.seller.account,
    );

    assert.equal(getAddress(await pair.passport.read.ownerOf([tokenId])), getAddress(pair.adapter.address));
    assert.equal(getAddress(await pair.spoke.read.ownerOf([tokenId])), getAddress(pair.seller.account.address));
    assert.equal(await pair.spoke.read.tokenURI([tokenId]), uri);

    await bridgeSend(
      pair.spoke,
      sendParam(EID_A, pair.seller.account.address, tokenId),
      pair.seller.account,
    );

    assert.equal(
      getAddress(await pair.passport.read.ownerOf([tokenId])),
      getAddress(pair.seller.account.address),
    );
    await assert.rejects(pair.spoke.read.ownerOf([tokenId]), revertsWith("ERC721NonexistentToken"));
  });

  it("VERIFIED passport stays VERIFIED after roundtrip; locked in adapter while bridged", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const uri = "ar://verified-bridge";
    const tokenId = await mintPassport(pair.passport, pair.seller, pair.seller.account.address, uri);
    await joinVerifier(pair.staking, pair.verifier);
    await pair.passport.write.verifyPassport([tokenId], { account: pair.verifier.account });
    assert.equal(Number(await pair.passport.read.passportStatus([tokenId])), STATUS_VERIFIED);

    await pair.passport.write.setApprovalForAll([pair.adapter.address, true], {
      account: pair.seller.account,
    });
    await bridgeSend(
      pair.adapter,
      sendParam(EID_B, pair.seller.account.address, tokenId),
      pair.seller.account,
    );
    assert.equal(getAddress(await pair.passport.read.ownerOf([tokenId])), getAddress(pair.adapter.address));
    assert.equal(Number(await pair.passport.read.passportStatus([tokenId])), STATUS_VERIFIED);

    await bridgeSend(
      pair.spoke,
      sendParam(EID_A, pair.seller.account.address, tokenId),
      pair.seller.account,
    );
    assert.equal(Number(await pair.passport.read.passportStatus([tokenId])), STATUS_VERIFIED);
    assert.equal(
      getAddress(await pair.passport.read.ownerOf([tokenId])),
      getAddress(pair.seller.account.address),
    );
  });

  it("bridge while listed reverts ListedInMarketplace", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const tokenId = await mintPassport(
      pair.passport,
      pair.seller,
      pair.seller.account.address,
      "ar://bridge-listed",
    );
    await pair.passport.write.setApprovalForAll([pair.marketplace.address, true], {
      account: pair.seller.account,
    });
    await pair.marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: pair.seller.account,
    });
    await pair.passport.write.setApprovalForAll([pair.adapter.address, true], {
      account: pair.seller.account,
    });
    await assert.rejects(
      bridgeSend(
        pair.adapter,
        sendParam(EID_B, pair.seller.account.address, tokenId),
        pair.seller.account,
      ),
      revertsWith("ListedInMarketplace"),
    );
  });

  it("bridge while DISPUTED reverts PassportDisputed", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const tokenId = await mintPassport(
      pair.passport,
      pair.seller,
      pair.seller.account.address,
      "ar://bridge-disputed",
    );
    await joinVerifier(pair.staking, pair.verifier);
    await pair.passport.write.verifyPassport([tokenId], { account: pair.verifier.account });
    await pair.passport.write.disputePassport([tokenId, "bridge"], {
      account: pair.seller.account,
      value: DISPUTE_DEPOSIT,
    });
    await pair.passport.write.setApprovalForAll([pair.adapter.address, true], {
      account: pair.seller.account,
    });
    await assert.rejects(
      bridgeSend(
        pair.adapter,
        sendParam(EID_B, pair.seller.account.address, tokenId),
        pair.seller.account,
      ),
      revertsWith("PassportDisputed"),
    );
  });

  it("bridge UNVERIFIED / VERIFIED succeeds through real delivery", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const unverifiedId = await mintPassport(
      pair.passport,
      pair.seller,
      pair.seller.account.address,
      "ar://bridge-unverified",
    );
    const verifiedId = await mintPassport(
      pair.passport,
      pair.seller,
      pair.seller.account.address,
      "ar://bridge-verified-ok",
    );
    await joinVerifier(pair.staking, pair.verifier);
    await pair.passport.write.verifyPassport([verifiedId], { account: pair.verifier.account });
    await pair.passport.write.setApprovalForAll([pair.adapter.address, true], {
      account: pair.seller.account,
    });

    for (const tokenId of [unverifiedId, verifiedId]) {
      await bridgeSend(
        pair.adapter,
        sendParam(EID_B, pair.seller.account.address, tokenId),
        pair.seller.account,
      );
      assert.equal(
        getAddress(await pair.spoke.read.ownerOf([tokenId])),
        getAddress(pair.seller.account.address),
      );
    }
  });

  it("bridge listed and DISPUTED reverts before endpoint", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const tokenId = await mintPassport(
      pair.passport,
      pair.seller,
      pair.seller.account.address,
      "ar://bridge-listed-disputed",
    );
    await joinVerifier(pair.staking, pair.verifier);
    await pair.passport.write.verifyPassport([tokenId], { account: pair.verifier.account });
    await pair.passport.write.disputePassport([tokenId, "bridge listed"], {
      account: pair.seller.account,
      value: DISPUTE_DEPOSIT,
    });
    await pair.passport.write.setApprovalForAll([pair.marketplace.address, true], {
      account: pair.seller.account,
    });
    await pair.marketplace.write.list([tokenId, 100n * 10n ** 8n, CURRENCY_USD], {
      account: pair.seller.account,
    });
    await pair.passport.write.setApprovalForAll([pair.adapter.address, true], {
      account: pair.seller.account,
    });
    await assert.rejects(
      bridgeSend(
        pair.adapter,
        sendParam(EID_B, pair.seller.account.address, tokenId),
        pair.seller.account,
      ),
      revertsWithEitherBridgeGuard(),
    );
  });

  it("auction custody: send fails with ownership error, not ListedInMarketplace", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const timelock = await deployTimelock(viem, pair.admin.account.address);
    const usdc = await viem.deployContract("MockUSDC", []);
    const { auction } = await deployAuctionEscrow(
      viem,
      {
        passport: pair.passport,
        staking: pair.staking,
        usdc,
        timelock,
        admin: pair.admin,
      },
      { feeBps: 250n, upgradeAuthority: pair.admin.account.address },
    );

    const tokenId = await mintPassport(
      pair.passport,
      pair.seller,
      pair.seller.account.address,
      "ar://auction-custody",
    );
    await joinVerifier(pair.staking, pair.seller);
    await joinVerifier(pair.staking, pair.verifier);
    await pair.passport.write.verifyPassport([tokenId], { account: pair.verifier.account });
    await pair.passport.write.setApprovalForAll([auction.address, true], {
      account: pair.seller.account,
    });
    await auction.write.createAuction([tokenId, ZERO, 1n * 10n ** 18n, THREE_DAYS], {
      account: pair.seller.account,
    });
    assert.equal(getAddress(await pair.passport.read.ownerOf([tokenId])), getAddress(auction.address));

    await pair.passport.write.setApprovalForAll([pair.adapter.address, true], {
      account: pair.seller.account,
    });
    await assert.rejects(
      bridgeSend(
        pair.adapter,
        sendParam(EID_B, pair.seller.account.address, tokenId),
        pair.seller.account,
      ),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        assert.equal(err.message.includes("ListedInMarketplace"), false);
        return (
          err.message.includes("ERC721InsufficientApproval") ||
          err.message.includes("ERC721IncorrectOwner") ||
          err.message.includes("ERC721InsufficientAllowance") ||
          err.message.includes("0x177e802f") ||
          err.message.includes("OnlyNFTOwner")
        );
      },
    );
  });

  it("duplicate lzReceive reverts on second mint", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const uri = "ar://dup";
    const tokenId = 42n;
    const message = encodeOnftMessage({
      to: pair.seller.account.address,
      tokenId,
      sender: pair.adapter.address,
      composeBody: encodeUriCompose(uri),
    });
    const origin = {
      srcEid: EID_A,
      sender: addressToBytes32(pair.adapter.address),
      nonce: 1n,
    };
    const guid = padHex("0x1", { size: 32 });

    await callLzReceive({
      oapp: pair.spoke,
      endpoint: pair.epB.address,
      origin,
      guid,
      message,
      publicClient: pair.publicClient,
      viem: pair.viem,
    });
    assert.equal(
      getAddress(await pair.spoke.read.ownerOf([tokenId])),
      getAddress(pair.seller.account.address),
    );

    await assert.rejects(
      callLzReceive({
        oapp: pair.spoke,
        endpoint: pair.epB.address,
        origin: { ...origin, nonce: 2n },
        guid: padHex("0x2", { size: 32 }),
        message,
        publicClient: pair.publicClient,
        viem: pair.viem,
      }),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        return (
          err.message.includes("ERC721InvalidSender") ||
          err.message.includes("ERC721") ||
          err.message.includes("mint")
        );
      },
    );
  });

  it("message from unwired peer reverts OnlyPeer", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const message = encodeOnftMessage({
      to: pair.seller.account.address,
      tokenId: 7n,
      sender: pair.stranger.account.address,
      composeBody: encodeUriCompose("ar://x"),
    });
    await assert.rejects(
      callLzReceive({
        oapp: pair.spoke,
        endpoint: pair.epB.address,
        origin: {
          srcEid: EID_A,
          sender: addressToBytes32(pair.stranger.account.address),
          nonce: 1n,
        },
        guid: padHex("0x3", { size: 32 }),
        message,
        publicClient: pair.publicClient,
        viem: pair.viem,
      }),
      revertsWith("OnlyPeer"),
    );
  });

  it("malformed compose (<32B extension) mints without URI — ComposeMsgTooShort unreachable", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const tokenId = 99n;
    // composeMsg() returns sender(32)+body; body 16 bytes → extension length 48 > 32,
    // but abi.decode of non-string tail would fail. Use extension length 16 total
    // (no sender prefix in crafted pack) so length <= 32 and URI set is skipped.
    const shortTail = padHex("0xabcd", { size: 16 });
    const message = concat([
      addressToBytes32(pair.seller.account.address),
      padHex(toHex(tokenId), { size: 32 }),
      shortTail,
    ]);
    assert.ok(shortTail.length === 34); // 0x + 32 hex chars = 16 bytes

    await callLzReceive({
      oapp: pair.spoke,
      endpoint: pair.epB.address,
      origin: {
        srcEid: EID_A,
        sender: addressToBytes32(pair.adapter.address),
        nonce: 1n,
      },
      guid: padHex("0x4", { size: 32 }),
      message,
      publicClient: pair.publicClient,
      viem: pair.viem,
    });
    assert.equal(
      getAddress(await pair.spoke.read.ownerOf([tokenId])),
      getAddress(pair.seller.account.address),
    );
    assert.equal(await pair.spoke.read.tokenURI([tokenId]), "");
  });

  it("empty compose: spoke mint succeeds without URI (advisory)", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const tokenId = 100n;
    const message = encodeOnftMessage({ to: pair.seller.account.address, tokenId });
    await callLzReceive({
      oapp: pair.spoke,
      endpoint: pair.epB.address,
      origin: {
        srcEid: EID_A,
        sender: addressToBytes32(pair.adapter.address),
        nonce: 1n,
      },
      guid: padHex("0x5", { size: 32 }),
      message,
      publicClient: pair.publicClient,
      viem: pair.viem,
    });
    assert.equal(
      getAddress(await pair.spoke.read.ownerOf([tokenId])),
      getAddress(pair.seller.account.address),
    );
    assert.equal(await pair.spoke.read.tokenURI([tokenId]), "");
  });

  it("long URI: typical Arweave and 500-char both deliver; record dest gas", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const typical = "ar://AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    assert.ok(typical.length >= 45 && typical.length <= 55);
    const long500 = `ar://${"b".repeat(500 - 5)}`;
    assert.equal(long500.length, 500);

    for (const [uri, tokenId, label] of [
      [typical, 201n, "hub→spoke SEND_AND_COMPOSE (typical URI)"] as const,
      [long500, 202n, "hub→spoke SEND_AND_COMPOSE (500-char URI)"] as const,
    ]) {
      const message = encodeOnftMessage({
        to: pair.seller.account.address,
        tokenId,
        sender: pair.adapter.address,
        composeBody: encodeUriCompose(uri),
      });
      const { gasUsed } = await callLzReceive({
        oapp: pair.spoke,
        endpoint: pair.epB.address,
        origin: {
          srcEid: EID_A,
          sender: addressToBytes32(pair.adapter.address),
          nonce: tokenId,
        },
        guid: padHex(toHex(tokenId), { size: 32 }),
        message,
        publicClient: pair.publicClient,
        viem: pair.viem,
      });
      assert.equal(await pair.spoke.read.tokenURI([tokenId]), uri);
      gasTable.push({ label, gasUsed });
    }
  });

  /**
   * EndpointV2Mock applies Executor lzReceive gas from send-path `extraOptions`
   * and swallows destination OOG in an empty try/catch — so this suite cannot
   * assert fail-below-budget. Separately, long compose payloads do not deliver
   * on the mock send path even at the 1M measurement stipend (upstream mock
   * “composed calls with correct gas” TODO). This case therefore:
   * (1) binds production `encodeLzReceiveExtraOptions(requiredGas)` bytes and
   *     500-char policy invariants;
   * (2) proves compose delivery via endpoint-impersonated `lzReceive` (same
   *     wire path as the gas table);
   * (3) proves send-path delivery under policy-sized options for a typical URI
   *     (fits mock compose).
   */
  it("policy-sized extraOptions deliver typical and 500-char URIs", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const typical = "ar://AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    assert.ok(typical.length >= 45 && typical.length <= 55);
    const long500 = `ar://${"b".repeat(500 - 5)}`;
    assert.equal(long500.length, 500);

    for (const [uri, tokenId] of [
      [typical, 301n] as const,
      [long500, 302n] as const,
    ]) {
      const gasResult = requiredLzReceiveGasForUri(uri);
      assert.equal(gasResult.ok, true);
      if (!gasResult.ok) return;

      const options = encodeLzReceiveExtraOptions(gasResult.gas);
      assert.equal(
        options,
        buildSendParam({
          dstEid: EID_B,
          recipient: pair.seller.account.address,
          tokenId,
          tokenUri: uri,
        }).extraOptions,
      );

      const message = encodeOnftMessage({
        to: pair.seller.account.address,
        tokenId,
        sender: pair.adapter.address,
        composeBody: encodeUriCompose(uri),
      });
      await callLzReceive({
        oapp: pair.spoke,
        endpoint: pair.epB.address,
        origin: {
          srcEid: EID_A,
          sender: addressToBytes32(pair.adapter.address),
          nonce: tokenId,
        },
        guid: padHex(toHex(tokenId), { size: 32 }),
        message,
        publicClient: pair.publicClient,
        viem: pair.viem,
      });
      assert.equal(
        getAddress(await pair.spoke.read.ownerOf([tokenId])),
        getAddress(pair.seller.account.address),
      );
      assert.equal(await pair.spoke.read.tokenURI([tokenId]), uri);

      if (uri === long500) {
        assert.ok(gasResult.gas > ENFORCED_GAS_SEND_AND_COMPOSE);
        const min = Math.ceil(
          (LZ_RECEIVE_MEASURED_500_CHAR_GAS * (10_000 + LZ_RECEIVE_GAS_MARGIN_BPS)) /
            10_000,
        );
        assert.ok(gasResult.gas >= min);
      }
    }

    // Send-path: typical URI under production policy-sized extraOptions.
    const sendUri = typical;
    const sendGas = requiredLzReceiveGasForUri(sendUri);
    assert.equal(sendGas.ok, true);
    if (!sendGas.ok) return;
    const sendTokenId = await mintPassport(
      pair.passport,
      pair.seller,
      pair.seller.account.address,
      sendUri,
    );
    await pair.passport.write.setApprovalForAll([pair.adapter.address, true], {
      account: pair.seller.account,
    });
    const sendParamBuilt = buildSendParam({
      dstEid: EID_B,
      recipient: pair.seller.account.address,
      tokenId: sendTokenId,
      tokenUri: sendUri,
    });
    assert.equal(
      sendParamBuilt.extraOptions,
      encodeLzReceiveExtraOptions(sendGas.gas),
    );
    await bridgeSend(pair.adapter, sendParamBuilt, pair.seller.account);
    assert.equal(
      getAddress(await pair.spoke.read.ownerOf([sendTokenId])),
      getAddress(pair.seller.account.address),
    );
    assert.equal(await pair.spoke.read.tokenURI([sendTokenId]), sendUri);
  });

  it("spoke→hub SEND unlock gas (destination-side)", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const uri = "ar://return-gas";
    const tokenId = await mintPassport(pair.passport, pair.seller, pair.seller.account.address, uri);
    await pair.passport.write.transferFrom(
      [pair.seller.account.address, pair.adapter.address, tokenId],
      { account: pair.seller.account },
    );
    assert.equal(getAddress(await pair.passport.read.ownerOf([tokenId])), getAddress(pair.adapter.address));

    const message = encodeOnftMessage({ to: pair.seller.account.address, tokenId });
    const { gasUsed } = await callLzReceive({
      oapp: pair.adapter,
      endpoint: pair.epA.address,
      origin: {
        srcEid: EID_B,
        sender: addressToBytes32(pair.spoke.address),
        nonce: 1n,
      },
      guid: padHex("0x20", { size: 32 }),
      message,
      publicClient: pair.publicClient,
      viem: pair.viem,
    });
    assert.equal(
      getAddress(await pair.passport.read.ownerOf([tokenId])),
      getAddress(pair.seller.account.address),
    );
    gasTable.push({ label: "spoke→hub SEND (return path)", gasUsed });

    process.stdout.write("\n--- Bridge destination-side gas (lzReceive, endpoint-impersonated) ---\n");
    process.stdout.write("| Path | gasUsed |\n| --- | --- |\n");
    for (const row of gasTable) {
      process.stdout.write(`| ${row.label} | ${row.gasUsed.toString()} |\n`);
    }
    process.stdout.write(
      "Methodology: hardhat_impersonateAccount(dest endpoint) → OApp.lzReceive; receipt.gasUsed.\n\n",
    );
  });

  it("active dispute deposit cannot bridge (PassportDisputed)", async () => {
    const { viem } = connection;
    const pair = await deployBridgePair(viem);
    const tokenId = await mintPassport(
      pair.passport,
      pair.seller,
      pair.seller.account.address,
      "ar://dispute-deposit",
    );
    await joinVerifier(pair.staking, pair.verifier);
    await pair.passport.write.verifyPassport([tokenId], { account: pair.verifier.account });
    await pair.passport.write.disputePassport([tokenId, "deposit"], {
      account: pair.seller.account,
      value: DISPUTE_DEPOSIT,
    });
    assert.equal(Number(await pair.passport.read.passportStatus([tokenId])), STATUS_DISPUTED);
    const locked = (await pair.passport.read.disputeDeposits([tokenId])) as bigint;
    assert.ok(locked > 0n);

    await pair.passport.write.setApprovalForAll([pair.adapter.address, true], {
      account: pair.seller.account,
    });
    await assert.rejects(
      bridgeSend(
        pair.adapter,
        sendParam(EID_B, pair.seller.account.address, tokenId),
        pair.seller.account,
      ),
      revertsWith("PassportDisputed"),
    );
  });
});
