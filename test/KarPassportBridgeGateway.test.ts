/**
 * KarPassportBridgeGateway suite — symmetric OApp on dual Hardhat networks
 * (84532 hub + 11155111 spoke) with EndpointV2Mock + manual lzReceive relay.
 *
 * Mock: @layerzerolabs/test-devtools-evm-hardhat EndpointV2Mock artifact.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import hardhat from "hardhat";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import {
  encodeAbiParameters,
  encodePacked,
  getAddress,
  getContract,
  keccak256,
  padHex,
  parseEther,
  toBytes,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import {
  DISPUTE_DEPOSIT,
  deployAscendingConsignment,
  deployCommerceBaseStack,
  deployFixedPriceConsignment,
  increaseTime,
  joinVerifier,
  mintPassport,
  type DeployedContract,
  type ViemSuite,
  ZERO,
} from "../scripts/lib/local-stack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EID_HUB = 1;
const EID_SPOKE = 2;
const LZ_RECEIVE_GAS = 1_000_000n;
const STATUS_UNVERIFIED = 0;
const STATUS_VERIFIED = 1;
const STATUS_DISPUTED = 2;
const HUB_CHAIN_ID = 84532n;
const SPOKE_CHAIN_ID = 11155111n;
const THIRD_ORIGIN = 999n;

const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const DENOM_ASSET = { kind: 0, currencyCode: BYTES32_ZERO } as const;
const ASC_MIN_DURATION = 10n;
const ASC_MAX_DURATION = 10_000n;
const ASC_DURATION = 20n;
const ASC_EXTENSION = 5n;
const ASC_MIN_INCREMENT_BPS = 300n;
const ASC_PROTECTION = 10n;
const ASC_ABANDONMENT = 20n;
const ASC_CHALLENGE_WINDOW = 30n;
const ASC_BOND = DISPUTE_DEPOSIT;
const ASC_RESERVE = parseEther("1");
const PLATFORM_FEE_BPS = 250n;
const MAX_STALENESS = 3600n;

const require = createRequire(import.meta.url);
const endpointArtifactPath = require
  .resolve("@layerzerolabs/test-devtools-evm-hardhat/package.json")
  .replace(/package.json$/, "artifacts/contracts/mocks/EndpointV2Mock.sol/EndpointV2Mock.json");
const endpointArtifact = JSON.parse(readFileSync(endpointArtifactPath, "utf8")) as {
  abi: Abi;
  bytecode: Hex;
};

/** Custom-error selectors when mock/endpoint ABI cannot decode passport/gateway errors. */
const ERROR_SELECTORS: Record<string, string> = {
  LeaveChainRefused: keccak256(toBytes("LeaveChainRefused()")).slice(0, 10),
  NotRepresentationOwner: keccak256(toBytes("NotRepresentationOwner()")).slice(0, 10),
  ZeroAddress: keccak256(toBytes("ZeroAddress()")).slice(0, 10),
};

function revertsWith(errorName: string) {
  return (err: unknown) => {
    if (!(err instanceof Error)) return false;
    if (err.message.includes(errorName)) return true;
    const selector = ERROR_SELECTORS[errorName];
    if (selector == null) return false;
    // Creation-revert payloads embed the selector without a `0x` prefix.
    return err.message.includes(selector) || err.message.includes(selector.slice(2));
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
  sender?: Address;
  composeBody?: Hex;
}): Hex {
  if (params.composeBody != null && params.sender != null) {
    return encodePacked(
      ["bytes32", "uint256", "bytes32", "bytes"],
      [
        addressToBytes32(params.to),
        params.tokenId,
        addressToBytes32(params.sender),
        params.composeBody,
      ],
    );
  }
  return encodePacked(["bytes32", "uint256"], [addressToBytes32(params.to), params.tokenId]);
}

function encodeUriCompose(uri: string): Hex {
  return encodeAbiParameters([{ type: "string" }], [uri]);
}

function tokenIdOn(chainId: bigint, localSeq: bigint): bigint {
  return (chainId << 128n) | localSeq;
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

type ChainSide = {
  stack: Awaited<ReturnType<typeof deployCommerceBaseStack>>;
  gateway: DeployedContract;
  endpoint: EndpointMock;
  publicClient: PublicClient;
  viem: ViemSuite;
  eid: number;
  chainId: bigint;
};

type GatewayPair = {
  hub: ChainSide;
  spoke: ChainSide;
};

async function deploySide(
  networkName: "gatewayHub" | "gatewaySpoke",
  eid: number,
  chainId: bigint,
): Promise<ChainSide> {
  const connection = await hardhat.network.connect(networkName);
  const viem = connection.viem as ViemSuite;
  const stack = await deployCommerceBaseStack(viem);
  const [wallet] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const chainIdOnNet = await publicClient.getChainId();
  assert.equal(BigInt(chainIdOnNet), chainId, `${networkName} chainId`);

  const endpoint = await deployEndpointMock(viem, eid, wallet, publicClient);

  const gateway = await viem.deployContract("KarPassportBridgeGateway", [
    stack.passport.address,
    endpoint.address,
    stack.admin.account.address,
  ]);
  await stack.passport.write.setBridgeGateway([gateway.address], {
    account: stack.admin.account,
  });

  return {
    stack,
    gateway,
    endpoint,
    publicClient,
    viem,
    eid,
    chainId,
  };
}

async function deployGatewayPair(): Promise<{
  pair: GatewayPair;
  close: () => Promise<void>;
}> {
  const hub = await deploySide("gatewayHub", EID_HUB, HUB_CHAIN_ID);
  const spoke = await deploySide("gatewaySpoke", EID_SPOKE, SPOKE_CHAIN_ID);

  await hub.gateway.write.setPeer([EID_SPOKE, addressToBytes32(spoke.gateway.address)], {
    account: hub.stack.admin.account,
  });
  await spoke.gateway.write.setPeer([EID_HUB, addressToBytes32(hub.gateway.address)], {
    account: spoke.stack.admin.account,
  });

  return {
    pair: { hub, spoke },
    close: async () => {
      // Connections are closed by afterEach via stored refs when needed.
    },
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
  return (await oapp.write.send([param, fee, account!.address], {
    account,
    value: fee.nativeFee,
  })) as Hex;
}

async function callLzReceive(params: {
  oapp: DeployedContract;
  endpoint: Address;
  origin: { srcEid: number; sender: Hex; nonce: bigint };
  guid: Hex;
  message: Hex;
  publicClient: PublicClient;
  viem: ViemSuite;
}): Promise<Hex> {
  const wallet = await impersonateAs(
    params.publicClient,
    params.viem as ViemSuite & { getWalletClient: (address: Address) => Promise<WalletClient> },
    params.endpoint,
  );
  try {
    return (await params.oapp.write.lzReceive(
      [params.origin, params.guid, params.message, zeroAddress, "0x"],
      { account: wallet.account },
    )) as Hex;
  } finally {
    await stopImpersonating(params.publicClient, params.endpoint);
  }
}

let nonceCounter = 1n;

async function relaySend(params: {
  src: ChainSide;
  dst: ChainSide;
  to: Address;
  tokenId: bigint;
  uri: string;
  senderAccount: WalletClient["account"];
  recipient?: Address;
}) {
  const recipient = params.recipient ?? params.to;
  await params.src.stack.passport.write.setApprovalForAll([params.src.gateway.address, true], {
    account: params.senderAccount,
  });
  await bridgeSend(
    params.src.gateway,
    sendParam(params.dst.eid, recipient, params.tokenId),
    params.senderAccount,
  );
  const message = encodeOnftMessage({
    to: recipient,
    tokenId: params.tokenId,
    sender: params.src.gateway.address,
    composeBody: encodeUriCompose(params.uri),
  });
  const nonce = nonceCounter++;
  const guid = padHex(toHex(nonce), { size: 32 });
  await callLzReceive({
    oapp: params.dst.gateway,
    endpoint: params.dst.endpoint.address,
    origin: {
      srcEid: params.src.eid,
      sender: addressToBytes32(params.src.gateway.address),
      nonce,
    },
    guid,
    message,
    publicClient: params.dst.publicClient,
    viem: params.dst.viem,
  });
}

describe("KarPassportBridgeGateway — dual-chain EndpointV2Mock", () => {
  let hubConn: Awaited<ReturnType<typeof hardhat.network.connect>>;
  let spokeConn: Awaited<ReturnType<typeof hardhat.network.connect>>;
  let pair: GatewayPair;

  beforeEach(async () => {
    hubConn = await hardhat.network.connect("gatewayHub");
    spokeConn = await hardhat.network.connect("gatewaySpoke");
    // Redeploy via deploySide using the open connections' network names —
    // deployGatewayPair opens its own connections; instead build on these.
    const hubViem = hubConn.viem as ViemSuite;
    const spokeViem = spokeConn.viem as ViemSuite;

    async function buildSide(
      viem: ViemSuite,
      eid: number,
      chainId: bigint,
    ): Promise<ChainSide> {
      const stack = await deployCommerceBaseStack(viem);
      const [wallet] = await viem.getWalletClients();
      const publicClient = await viem.getPublicClient();
      assert.equal(BigInt(await publicClient.getChainId()), chainId);
      const endpoint = await deployEndpointMock(viem, eid, wallet, publicClient);
      const gateway = await viem.deployContract("KarPassportBridgeGateway", [
        stack.passport.address,
        endpoint.address,
        stack.admin.account.address,
      ]);
      await stack.passport.write.setBridgeGateway([gateway.address], {
        account: stack.admin.account,
      });
      return {
        stack,
        gateway,
        endpoint,
        publicClient,
        viem,
        eid,
        chainId,
      };
    }

    const hub = await buildSide(hubViem, EID_HUB, HUB_CHAIN_ID);
    const spoke = await buildSide(spokeViem, EID_SPOKE, SPOKE_CHAIN_ID);
    await hub.gateway.write.setPeer([EID_SPOKE, addressToBytes32(spoke.gateway.address)], {
      account: hub.stack.admin.account,
    });
    await spoke.gateway.write.setPeer([EID_HUB, addressToBytes32(hub.gateway.address)], {
      account: spoke.stack.admin.account,
    });
    // Dual-network: dest OApp is not on this chain. Point lookup at the local
    // endpoint so send() debit succeeds; receivePayload try/catch swallows the
    // failed local lzReceive. Real credit is applied via callLzReceive on dest.
    await hub.endpoint.write.setDestLzEndpoint(
      [spoke.gateway.address, hub.endpoint.address],
      { account: hub.stack.admin.account },
    );
    await spoke.endpoint.write.setDestLzEndpoint(
      [hub.gateway.address, spoke.endpoint.address],
      { account: spoke.stack.admin.account },
    );
    pair = { hub, spoke };
  });

  afterEach(async () => {
    await hubConn.close();
    await spokeConn.close();
  });

  it("#1 master invariant: home lock + spoke mint UNVERIFIED; return unlocks", async () => {
    const { hub, spoke } = pair;
    const seller = hub.stack.seller;
    const tokenId = await mintPassport(
      hub.stack.passport,
      seller,
      seller.account.address,
      "ar://home-1",
    );
    assert.equal(await hub.stack.passport.read.chainIdOf([tokenId]), HUB_CHAIN_ID);

    await relaySend({
      src: hub,
      dst: spoke,
      to: seller.account.address,
      tokenId,
      uri: "ar://home-1",
      senderAccount: seller.account,
    });

    assert.equal(
      getAddress(await hub.stack.passport.read.ownerOf([tokenId])),
      getAddress(hub.gateway.address),
    );
    assert.equal(await hub.stack.passport.read.custodyLocked([tokenId]), true);
    assert.equal(
      getAddress(await spoke.stack.passport.read.ownerOf([tokenId])),
      getAddress(seller.account.address),
    );
    const [spokeStatus] = await spoke.stack.passport.read.getPassportStatus([tokenId]);
    assert.equal(spokeStatus, STATUS_UNVERIFIED);

    // Return spoke → hub
    const spokeSeller = spoke.stack.seller;
    // Same address index as hub seller — fund/use spoke wallet at same index
    const spokeWallets = await spoke.viem.getWalletClients();
    const hubWallets = await hub.viem.getWalletClients();
    const sellerIdx = hubWallets.findIndex(
      (w) => getAddress(w.account.address) === getAddress(seller.account.address),
    );
    const spokeSender = spokeWallets[sellerIdx]!;

    // Rep lives on spoke under hub seller address; transfer to matching spoke account if needed
    const repOwner = getAddress(await spoke.stack.passport.read.ownerOf([tokenId]));
    assert.equal(repOwner, getAddress(seller.account.address));

    await relaySend({
      src: spoke,
      dst: hub,
      to: seller.account.address,
      tokenId,
      uri: "ar://home-1",
      senderAccount: spokeSender.account,
    });

    assert.equal(
      getAddress(await hub.stack.passport.read.ownerOf([tokenId])),
      getAddress(seller.account.address),
    );
    assert.equal(await hub.stack.passport.read.custodyLocked([tokenId]), false);
    await assert.rejects(
      spoke.stack.passport.read.ownerOf([tokenId]),
      (err: unknown) => err instanceof Error && err.message.includes("ERC721NonexistentToken"),
    );
    void spokeSeller;
  });

  it("#4 URI sync (G5): returned URI adopted; home status UNVERIFIED", async () => {
    const { hub, spoke } = pair;
    const seller = hub.stack.seller;
    const tokenId = await mintPassport(
      hub.stack.passport,
      seller,
      seller.account.address,
      "ar://original",
    );
    await joinVerifier(hub.stack.staking, hub.stack.verifier);
    await hub.stack.passport.write.verifyPassport([tokenId], {
      account: hub.stack.verifier.account,
    });
    let [status] = await hub.stack.passport.read.getPassportStatus([tokenId]);
    assert.equal(status, STATUS_VERIFIED);

    await relaySend({
      src: hub,
      dst: spoke,
      to: seller.account.address,
      tokenId,
      uri: "ar://original",
      senderAccount: seller.account,
    });

    const hubWallets = await hub.viem.getWalletClients();
    const spokeWallets = await spoke.viem.getWalletClients();
    const sellerIdx = hubWallets.findIndex(
      (w) => getAddress(w.account.address) === getAddress(seller.account.address),
    );
    const spokeSender = spokeWallets[sellerIdx]!;

    await spoke.stack.passport.write.setPassportURI([tokenId, "ar://edited-on-spoke"], {
      account: spokeSender.account,
    });
    assert.equal(await spoke.stack.passport.read.tokenURI([tokenId]), "ar://edited-on-spoke");

    await relaySend({
      src: spoke,
      dst: hub,
      to: seller.account.address,
      tokenId,
      uri: "ar://edited-on-spoke",
      senderAccount: spokeSender.account,
    });

    assert.equal(await hub.stack.passport.read.tokenURI([tokenId]), "ar://edited-on-spoke");
    [status] = await hub.stack.passport.read.getPassportStatus([tokenId]);
    assert.equal(status, STATUS_UNVERIFIED);
  });

  it("#5 outbound guards (G1): listed/challenged/settlement via may → LeaveChainRefused; NotRepresentationOwner", async () => {
    const { hub, spoke } = pair;
    const seller = hub.stack.seller;
    const admin = hub.stack.admin;
    await joinVerifier(hub.stack.staking, hub.stack.verifier);
    await joinVerifier(hub.stack.staking, seller);

    // Listed — FixedPrice registered + live consignment → may false
    {
      const tokenId = await mintPassport(
        hub.stack.passport,
        seller,
        seller.account.address,
        "ar://listed",
      );
      await hub.stack.passport.write.verifyPassport([tokenId], {
        account: hub.stack.verifier.account,
      });
      const { mode: fixedPrice } = await deployFixedPriceConsignment(hub.viem, {
        passport: hub.stack.passport.address,
        platformRecipient: admin.account.address,
        feeBps: PLATFORM_FEE_BPS,
        nativeUsdFeed: hub.stack.nativeFeed.address,
        maxFeedStaleness: MAX_STALENESS,
        owner: admin.account.address,
        guardian: admin.account.address,
      });
      await hub.stack.passport.write.addEncumbranceSource([fixedPrice.address], {
        account: admin.account,
      });
      await hub.stack.passport.write.setApprovalForAll([fixedPrice.address, true], {
        account: seller.account,
      });
      await fixedPrice.write.openDirect([tokenId, DENOM_ASSET, ZERO, parseEther("1")], {
        account: seller.account,
      });
      await hub.stack.passport.write.setApprovalForAll([hub.gateway.address, true], {
        account: seller.account,
      });
      await assert.rejects(
        bridgeSend(
          hub.gateway,
          sendParam(EID_SPOKE, seller.account.address, tokenId),
          seller.account,
        ),
        revertsWith("LeaveChainRefused"),
      );
      await hub.stack.passport.write.removeEncumbranceSource([fixedPrice.address], {
        account: admin.account,
      });
    }

    // Challenged — intrinsic BondedChallenge → may false
    {
      const tokenId = await mintPassport(
        hub.stack.passport,
        seller,
        seller.account.address,
        "ar://challenged",
      );
      await hub.stack.passport.write.verifyPassport([tokenId], {
        account: hub.stack.verifier.account,
      });
      await hub.stack.passport.write.open([tokenId], {
        account: seller.account,
        value: DISPUTE_DEPOSIT,
      });
      await hub.stack.passport.write.setApprovalForAll([hub.gateway.address, true], {
        account: seller.account,
      });
      await assert.rejects(
        bridgeSend(
          hub.gateway,
          sendParam(EID_SPOKE, seller.account.address, tokenId),
          seller.account,
        ),
        revertsWith("LeaveChainRefused"),
      );
    }

    // Settlement — Ascending registered + unresolved hold → may false
    {
      const tokenId = await mintPassport(
        hub.stack.passport,
        seller,
        seller.account.address,
        "ar://hold",
      );
      await hub.stack.passport.write.verifyPassport([tokenId], {
        account: hub.stack.verifier.account,
      });
      const { mode: ascending } = await deployAscendingConsignment(hub.viem, {
        passport: hub.stack.passport.address,
        karProStaking: hub.stack.staking.address,
        platformRecipient: admin.account.address,
        feeBps: PLATFORM_FEE_BPS,
        forfeitRecipient: admin.account.address,
        challengeBond: ASC_BOND,
        challengeWindow: ASC_CHALLENGE_WINDOW,
        minDuration: ASC_MIN_DURATION,
        maxDuration: ASC_MAX_DURATION,
        extensionWindow: ASC_EXTENSION,
        minIncrementBps: ASC_MIN_INCREMENT_BPS,
        minProtectionWindow: ASC_PROTECTION,
        maxProtectionWindow: ASC_PROTECTION * 10n,
        abandonmentWindow: ASC_ABANDONMENT,
        owner: admin.account.address,
        guardian: admin.account.address,
      });
      await hub.stack.passport.write.addEncumbranceSource([ascending.address], {
        account: admin.account,
      });
      await hub.stack.passport.write.setApprovalForAll([ascending.address, true], {
        account: seller.account,
      });
      await ascending.write.openAscendingDirect(
        [tokenId, ZERO, ASC_RESERVE, ASC_DURATION, ASC_PROTECTION],
        { account: seller.account },
      );
      await ascending.write.bid([tokenId, ASC_RESERVE], {
        account: hub.stack.buyer.account,
        value: ASC_RESERVE,
      });
      await increaseTime(hub.publicClient, ASC_DURATION + 2n);
      await ascending.write.settle([tokenId], { account: hub.stack.stranger.account });
      await hub.stack.passport.write.setApprovalForAll([hub.gateway.address, true], {
        account: hub.stack.buyer.account,
      });
      await assert.rejects(
        bridgeSend(
          hub.gateway,
          sendParam(EID_SPOKE, hub.stack.buyer.account.address, tokenId),
          hub.stack.buyer.account,
        ),
        revertsWith("LeaveChainRefused"),
      );
      await hub.stack.passport.write.removeEncumbranceSource([ascending.address], {
        account: admin.account,
      });
    }

    // NotRepresentationOwner — mint foreign on hub via lzReceive, non-owner send
    {
      const foreignId = tokenIdOn(THIRD_ORIGIN, 1n);
      const message = encodeOnftMessage({
        to: seller.account.address,
        tokenId: foreignId,
        sender: spoke.gateway.address,
        composeBody: encodeUriCompose("ar://foreign"),
      });
      await callLzReceive({
        oapp: hub.gateway,
        endpoint: hub.endpoint.address,
        origin: {
          srcEid: EID_SPOKE,
          sender: addressToBytes32(spoke.gateway.address),
          nonce: nonceCounter++,
        },
        guid: padHex(toHex(nonceCounter), { size: 32 }),
        message,
        publicClient: hub.publicClient,
        viem: hub.viem,
      });
      await hub.stack.passport.write.setApprovalForAll([hub.gateway.address, true], {
        account: hub.stack.stranger.account,
      });
      await assert.rejects(
        bridgeSend(
          hub.gateway,
          sendParam(EID_SPOKE, hub.stack.stranger.account.address, foreignId),
          hub.stack.stranger.account,
        ),
        revertsWith("NotRepresentationOwner"),
      );
    }
  });

  it("#7 unlock only-locked (G7): non-held unlock reverts; happy unlock succeeds", async () => {
    const { hub, spoke } = pair;
    const seller = hub.stack.seller;
    const tokenId = await mintPassport(
      hub.stack.passport,
      seller,
      seller.account.address,
      "ar://g7",
    );

    // Crafted unlock while gateway does not hold
    const badMessage = encodeOnftMessage({
      to: seller.account.address,
      tokenId,
      sender: spoke.gateway.address,
      composeBody: encodeUriCompose("ar://g7"),
    });
    await assert.rejects(
      callLzReceive({
        oapp: hub.gateway,
        endpoint: hub.endpoint.address,
        origin: {
          srcEid: EID_SPOKE,
          sender: addressToBytes32(spoke.gateway.address),
          nonce: nonceCounter++,
        },
        guid: padHex(toHex(9n), { size: 32 }),
        message: badMessage,
        publicClient: hub.publicClient,
        viem: hub.viem,
      }),
      (err: unknown) => err instanceof Error,
    );

    // Happy path: lock then unlock
    await relaySend({
      src: hub,
      dst: spoke,
      to: seller.account.address,
      tokenId,
      uri: "ar://g7",
      senderAccount: seller.account,
    });
    const hubWallets = await hub.viem.getWalletClients();
    const spokeWallets = await spoke.viem.getWalletClients();
    const sellerIdx = hubWallets.findIndex(
      (w) => getAddress(w.account.address) === getAddress(seller.account.address),
    );
    await relaySend({
      src: spoke,
      dst: hub,
      to: seller.account.address,
      tokenId,
      uri: "ar://g7",
      senderAccount: spokeWallets[sellerIdx]!.account,
    });
    assert.equal(
      getAddress(await hub.stack.passport.read.ownerOf([tokenId])),
      getAddress(seller.account.address),
    );
  });

  it("#9 S11: spoke-origin mint bridges to hub as UNVERIFIED foreign rep; return resets spoke", async () => {
    const { hub, spoke } = pair;
    const spokeSeller = spoke.stack.seller;
    const tokenId = await mintPassport(
      spoke.stack.passport,
      spokeSeller,
      spokeSeller.account.address,
      "ar://spoke-native",
    );
    assert.equal(await spoke.stack.passport.read.chainIdOf([tokenId]), SPOKE_CHAIN_ID);

    await joinVerifier(spoke.stack.staking, spoke.stack.verifier);
    await spoke.stack.passport.write.verifyPassport([tokenId], {
      account: spoke.stack.verifier.account,
    });

    await relaySend({
      src: spoke,
      dst: hub,
      to: spokeSeller.account.address,
      tokenId,
      uri: "ar://spoke-native",
      senderAccount: spokeSeller.account,
    });

    assert.equal(await spoke.stack.passport.read.custodyLocked([tokenId]), true);
    const [hubStatus] = await hub.stack.passport.read.getPassportStatus([tokenId]);
    assert.equal(hubStatus, STATUS_UNVERIFIED);

    const hubWallets = await hub.viem.getWalletClients();
    const spokeWallets = await spoke.viem.getWalletClients();
    const idx = spokeWallets.findIndex(
      (w) => getAddress(w.account.address) === getAddress(spokeSeller.account.address),
    );
    await relaySend({
      src: hub,
      dst: spoke,
      to: spokeSeller.account.address,
      tokenId,
      uri: "ar://spoke-native",
      senderAccount: hubWallets[idx]!.account,
    });

    assert.equal(await spoke.stack.passport.read.custodyLocked([tokenId]), false);
    const [spokeStatus] = await spoke.stack.passport.read.getPassportStatus([tokenId]);
    assert.equal(spokeStatus, STATUS_UNVERIFIED);
  });

  it("#11 settlement×bridge: LeaveChainRefused while HELD then succeeds after release", async () => {
    const { hub, spoke } = pair;
    const seller = hub.stack.seller;
    const buyer = hub.stack.buyer;
    const admin = hub.stack.admin;
    const tokenId = await mintPassport(
      hub.stack.passport,
      seller,
      seller.account.address,
      "ar://a16",
    );
    await joinVerifier(hub.stack.staking, seller);
    await joinVerifier(hub.stack.staking, hub.stack.verifier);
    await hub.stack.passport.write.verifyPassport([tokenId], {
      account: hub.stack.verifier.account,
    });
    const { mode: ascending } = await deployAscendingConsignment(hub.viem, {
      passport: hub.stack.passport.address,
      karProStaking: hub.stack.staking.address,
      platformRecipient: admin.account.address,
      feeBps: PLATFORM_FEE_BPS,
      forfeitRecipient: admin.account.address,
      challengeBond: ASC_BOND,
      challengeWindow: ASC_CHALLENGE_WINDOW,
      minDuration: ASC_MIN_DURATION,
      maxDuration: ASC_MAX_DURATION,
      extensionWindow: ASC_EXTENSION,
      minIncrementBps: ASC_MIN_INCREMENT_BPS,
      minProtectionWindow: ASC_PROTECTION,
      maxProtectionWindow: ASC_PROTECTION * 10n,
      abandonmentWindow: ASC_ABANDONMENT,
      owner: admin.account.address,
      guardian: admin.account.address,
    });
    await hub.stack.passport.write.addEncumbranceSource([ascending.address], {
      account: admin.account,
    });
    await hub.stack.passport.write.setApprovalForAll([ascending.address, true], {
      account: seller.account,
    });
    await ascending.write.openAscendingDirect([tokenId, ZERO, ASC_RESERVE, ASC_DURATION, ASC_PROTECTION], {
      account: seller.account,
    });
    await ascending.write.bid([tokenId, ASC_RESERVE], {
      account: buyer.account,
      value: ASC_RESERVE,
    });
    await increaseTime(hub.publicClient, ASC_DURATION + 2n);
    await ascending.write.settle([tokenId], { account: hub.stack.stranger.account });

    await hub.stack.passport.write.setApprovalForAll([hub.gateway.address, true], {
      account: buyer.account,
    });
    await assert.rejects(
      bridgeSend(
        hub.gateway,
        sendParam(EID_SPOKE, buyer.account.address, tokenId),
        buyer.account,
      ),
      revertsWith("LeaveChainRefused"),
    );

    await increaseTime(hub.publicClient, ASC_PROTECTION + 2n);
    await ascending.write.releaseFunds([tokenId], { account: hub.stack.stranger.account });

    await relaySend({
      src: hub,
      dst: spoke,
      to: buyer.account.address,
      tokenId,
      uri: "ar://a16",
      senderAccount: buyer.account,
    });
    assert.equal(await hub.stack.passport.read.custodyLocked([tokenId]), true);
  });

  it("#S14: third-origin hub rep → spoke burns hub rep and mints spoke; no home custody", async () => {
    const { hub, spoke } = pair;
    const seller = hub.stack.seller;
    const foreignId = tokenIdOn(THIRD_ORIGIN, 7n);

    const mintMsg = encodeOnftMessage({
      to: seller.account.address,
      tokenId: foreignId,
      sender: spoke.gateway.address,
      composeBody: encodeUriCompose("ar://s14"),
    });
    await callLzReceive({
      oapp: hub.gateway,
      endpoint: hub.endpoint.address,
      origin: {
        srcEid: EID_SPOKE,
        sender: addressToBytes32(spoke.gateway.address),
        nonce: nonceCounter++,
      },
      guid: padHex(toHex(77n), { size: 32 }),
      message: mintMsg,
      publicClient: hub.publicClient,
      viem: hub.viem,
    });
    assert.equal(
      getAddress(await hub.stack.passport.read.ownerOf([foreignId])),
      getAddress(seller.account.address),
    );

    await relaySend({
      src: hub,
      dst: spoke,
      to: seller.account.address,
      tokenId: foreignId,
      uri: "ar://s14",
      senderAccount: seller.account,
    });

    await assert.rejects(
      hub.stack.passport.read.ownerOf([foreignId]),
      (err: unknown) => err instanceof Error && err.message.includes("ERC721NonexistentToken"),
    );
    assert.equal(
      getAddress(await spoke.stack.passport.read.ownerOf([foreignId])),
      getAddress(seller.account.address),
    );
    // Third-origin: never home on hub or spoke
    assert.equal(await hub.stack.passport.read.custodyLocked([foreignId]), false);
    assert.equal(await spoke.stack.passport.read.custodyLocked([foreignId]), false);
  });

  it("#10 recoverLockedHome: stranded outbound restore + revert matrix", async () => {
    const { hub, spoke } = pair;
    const seller = hub.stack.seller;
    const admin = hub.stack.admin;

    // Stranded outbound: hub→spoke send without spoke lzReceive
    const tokenId = await mintPassport(
      hub.stack.passport,
      seller,
      seller.account.address,
      "ar://stranded",
    );
    await joinVerifier(hub.stack.staking, hub.stack.verifier);
    await hub.stack.passport.write.verifyPassport([tokenId], {
      account: hub.stack.verifier.account,
    });
    await hub.stack.passport.write.setApprovalForAll([hub.gateway.address, true], {
      account: seller.account,
    });
    await bridgeSend(
      hub.gateway,
      sendParam(EID_SPOKE, seller.account.address, tokenId),
      seller.account,
    );

    assert.equal(
      getAddress(await hub.stack.passport.read.ownerOf([tokenId])),
      getAddress(hub.gateway.address),
    );
    assert.equal(await hub.stack.passport.read.custodyLocked([tokenId]), true);
    await assert.rejects(
      spoke.stack.passport.read.ownerOf([tokenId]),
      (err: unknown) => err instanceof Error && err.message.includes("ERC721NonexistentToken"),
    );

    // Non-owner
    await assert.rejects(
      hub.gateway.write.recoverLockedHome([tokenId, seller.account.address], {
        account: seller.account,
      }),
      revertsWith("OwnableUnauthorizedAccount"),
    );

    // Zero recipient
    await assert.rejects(
      hub.gateway.write.recoverLockedHome([tokenId, zeroAddress], {
        account: admin.account,
      }),
      revertsWith("ZeroAddress"),
    );

    // Happy path
    const recoverHash = (await hub.gateway.write.recoverLockedHome(
      [tokenId, seller.account.address],
      { account: admin.account },
    )) as Hex;
    const recoverReceipt = await hub.publicClient.waitForTransactionReceipt({
      hash: recoverHash,
    });
    const recoveredTopic = keccak256(toBytes("RecoveredLockedHome(uint256,address)"));
    assert.ok(
      recoverReceipt.logs.some((log) => log.topics[0] === recoveredTopic),
      "RecoveredLockedHome emitted",
    );

    assert.equal(
      getAddress(await hub.stack.passport.read.ownerOf([tokenId])),
      getAddress(seller.account.address),
    );
    assert.equal(await hub.stack.passport.read.custodyLocked([tokenId]), false);
    const [status] = await hub.stack.passport.read.getPassportStatus([tokenId]);
    assert.equal(status, STATUS_UNVERIFIED);
    await assert.rejects(
      spoke.stack.passport.read.ownerOf([tokenId]),
      (err: unknown) => err instanceof Error && err.message.includes("ERC721NonexistentToken"),
    );

    // Free home (never locked) → NotLocked
    const freeId = await mintPassport(
      hub.stack.passport,
      seller,
      seller.account.address,
      "ar://free",
    );
    await assert.rejects(
      hub.gateway.write.recoverLockedHome([freeId, seller.account.address], {
        account: admin.account,
      }),
      revertsWith("NotLocked"),
    );

    // Foreign-origin id → NotHomeToken (gateway does not hold it; home check first)
    const foreignId = tokenIdOn(999n, 7n);
    await assert.rejects(
      hub.gateway.write.recoverLockedHome([foreignId, seller.account.address], {
        account: admin.account,
      }),
      revertsWith("NotHomeToken"),
    );

    // After normal round-trip, recover cannot double-release
    const roundId = await mintPassport(
      hub.stack.passport,
      seller,
      seller.account.address,
      "ar://roundtrip",
    );
    await relaySend({
      src: hub,
      dst: spoke,
      to: seller.account.address,
      tokenId: roundId,
      uri: "ar://roundtrip",
      senderAccount: seller.account,
    });
    const hubWallets = await hub.viem.getWalletClients();
    const spokeWallets = await spoke.viem.getWalletClients();
    const sellerIdx = hubWallets.findIndex(
      (w) => getAddress(w.account.address) === getAddress(seller.account.address),
    );
    await relaySend({
      src: spoke,
      dst: hub,
      to: seller.account.address,
      tokenId: roundId,
      uri: "ar://roundtrip",
      senderAccount: spokeWallets[sellerIdx]!.account,
    });
    assert.equal(
      getAddress(await hub.stack.passport.read.ownerOf([roundId])),
      getAddress(seller.account.address),
    );
    await assert.rejects(
      hub.gateway.write.recoverLockedHome([roundId, seller.account.address], {
        account: admin.account,
      }),
      revertsWith("NotLocked"),
    );
  });

  it("locked dispute bond is not stranded by bridge refuse-while-DISPUTED", async () => {
    const { hub } = pair;
    const seller = hub.stack.seller;
    const tokenId = await mintPassport(
      hub.stack.passport,
      seller,
      seller.account.address,
      "ar://bond-lock",
    );
    await joinVerifier(hub.stack.staking, hub.stack.verifier);
    await hub.stack.passport.write.verifyPassport([tokenId], {
      account: hub.stack.verifier.account,
    });
    await hub.stack.passport.write.open([tokenId], {
      account: seller.account,
      value: DISPUTE_DEPOSIT,
    });
    const lockedBefore = (await hub.stack.passport.read.totalLockedBonds()) as bigint;
    const depositBefore = (await hub.stack.passport.read.challengeBondAmount([tokenId])) as bigint;
    assert.equal(lockedBefore, DISPUTE_DEPOSIT);
    assert.equal(depositBefore, DISPUTE_DEPOSIT);

    await hub.stack.passport.write.setApprovalForAll([hub.gateway.address, true], {
      account: seller.account,
    });
    await assert.rejects(
      bridgeSend(
        hub.gateway,
        sendParam(EID_SPOKE, seller.account.address, tokenId),
        seller.account,
      ),
      revertsWith("LeaveChainRefused"),
    );

    assert.equal(await hub.stack.passport.read.totalLockedBonds(), lockedBefore);
    assert.equal(await hub.stack.passport.read.challengeBondAmount([tokenId]), depositBefore);
    assert.equal(Number(await hub.stack.passport.read.passportStatus([tokenId])), STATUS_DISPUTED);
    assert.equal(
      getAddress(await hub.stack.passport.read.ownerOf([tokenId])),
      getAddress(seller.account.address),
    );
  });

  it("VERSION is 1.3.0-rc.1", async () => {
    assert.equal(await pair.hub.gateway.read.VERSION(), "1.3.0-rc.1");
  });

  it("gateway leave path is may-only (no status / listing leave probes)", () => {
    const src = readFileSync(
      path.join(repoRoot, "contracts/KarPassportBridgeGateway.sol"),
      "utf8",
    );
    assert.ok(src.includes("LeaveChain"), "gateway source must reference LeaveChain");
    assert.ok(/\bmay\s*\(/.test(src), "gateway source must call may(");
    for (const banned of [
      "passportStatus",
      "isListed",
      "holds(",
      "IAuctionHold",
      "IKarPassportStatus",
      "ListedInMarketplace",
      "InSettlementHold",
      "PassportDisputed",
    ]) {
      assert.ok(!src.includes(banned), `gateway source must not contain ${banned}`);
    }
    const abi = pair.hub.gateway.abi as readonly { type?: string; name?: string }[];
    const names = new Set(
      abi.filter((e) => e.type === "error" || e.type === "function").map((e) => e.name),
    );
    for (const banned of [
      "ListedInMarketplace",
      "InSettlementHold",
      "PassportDisputed",
    ]) {
      assert.ok(!names.has(banned), `gateway ABI must not declare ${banned}`);
    }
    assert.ok(names.has("LeaveChainRefused"));
  });

  it("UNVERIFIED idle passport may leave (no forbidding source)", async () => {
    const { hub, spoke } = pair;
    const seller = hub.stack.seller;
    const tokenId = await mintPassport(
      hub.stack.passport,
      seller,
      seller.account.address,
      "ar://idle-unverified",
    );
    const [status] = await hub.stack.passport.read.getPassportStatus([tokenId]);
    assert.equal(status, STATUS_UNVERIFIED);
    await relaySend({
      src: hub,
      dst: spoke,
      to: seller.account.address,
      tokenId,
      uri: "ar://idle-unverified",
      senderAccount: seller.account,
    });
    assert.equal(await hub.stack.passport.read.custodyLocked([tokenId]), true);
  });

  it("ctor reverts ZeroAddress on required immutable deps", async () => {
    const hub = pair.hub;
    const { stack, endpoint } = hub;
    await assert.rejects(
      hub.viem.deployContract("KarPassportBridgeGateway", [
        ZERO,
        endpoint.address,
        stack.admin.account.address,
      ]),
      revertsWith("ZeroAddress"),
    );
    await assert.rejects(
      hub.viem.deployContract("KarPassportBridgeGateway", [
        stack.passport.address,
        ZERO,
        stack.admin.account.address,
      ]),
      revertsWith("ZeroAddress"),
    );
    await assert.rejects(
      hub.viem.deployContract("KarPassportBridgeGateway", [
        stack.passport.address,
        endpoint.address,
        ZERO,
      ]),
      revertsWith("ZeroAddress"),
    );
  });
});
