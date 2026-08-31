/**
 * S6 #3a — lab-only price-source measurement (revised after Devnet discovery).
 *
 * Finding: Pyth price-feed PDA seeds under pythWSnsw… returned empty accounts on
 * Devnet. Live PriceUpdateV2 accounts (134 B) are owned by the receiver
 * rec5EKM… . Sponsored SOL/USD account 7UVimff… is continuously updated; tens of
 * thousands of other SOL/USDC update accounts exist with stale publish_times
 * (pull residue).
 *
 * Usage:
 *   pnpm exec tsx scripts/measure-price-sources.ts discover
 *   pnpm exec tsx scripts/measure-price-sources.ts sample [--seconds 900] [--interval 15]
 *   pnpm exec tsx scripts/measure-price-sources.ts local-five
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "../fixtures/price-measure");

const DEVNET_RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const LOCAL_RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8899";

const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const PYTH_PRICE_FEED_PROGRAM = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

/** Docs-sourced feed id constants (not price values). */
const FEEDS = {
  SOL_USD: {
    pair: "Crypto.SOL/USD",
    feedIdHex: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    /** Community / Pyth directory cited sponsored account — verified on Devnet by read. */
    sponsoredCited: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
  },
  USDC_USD: {
    pair: "Crypto.USDC/USD",
    feedIdHex: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  },
  EUR_USD: {
    pair: "FX.EUR/USD",
    feedIdHex: "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af095b906dc",
  },
} as const;

const SEARCH_PROGRAMS: { label: string; id: string; note: string }[] = [
  { label: "pyth_receiver", id: PYTH_RECEIVER.toBase58(), note: "owns PriceUpdateV2 accounts (measured)" },
  { label: "pyth_price_feed_program", id: PYTH_PRICE_FEED_PROGRAM.toBase58(), note: "docs PDA program; GPA size134 count 0 on Devnet" },
  { label: "legacy_pyth_oracle", id: "FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH", note: "non-executable on Devnet" },
  { label: "switchboard_v2", id: "SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f", note: "executable on Devnet" },
  { label: "switchboard_ondemand_devnet", id: "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2", note: "executable on Devnet" },
  { label: "switchboard_ondemand_mainnet_pid", id: "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv", note: "executable account present on Devnet" },
  { label: "chainlink_store_suspect", id: "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny", note: "executable; no price account found in this lab" },
];

type Decoded = {
  layout: string;
  discriminatorHex: string;
  fields: { name: string; offset: number; size: number; value: string }[];
  price: string;
  conf: string;
  exponent: number;
  publishTime: number;
  prevPublishTime: number;
  emaPrice: string;
  emaConf: string;
  postedSlot: string;
  feedIdHex: string;
  verificationLevel: number;
  writeAuthority: string;
};

/** PriceUpdateV2 — measured layout: message starts at offset 41. */
export function decodePriceUpdateV2(data: Buffer): Decoded {
  if (data.length < 134) throw new Error(`expected >=134 bytes, got ${data.length}`);
  const msg = 41;
  return {
    layout: "PriceUpdateV2_msg@41",
    discriminatorHex: data.subarray(0, 8).toString("hex"),
    verificationLevel: data[40]!,
    writeAuthority: new PublicKey(data.subarray(8, 40)).toBase58(),
    feedIdHex: data.subarray(msg, msg + 32).toString("hex"),
    price: data.readBigInt64LE(msg + 32).toString(),
    conf: data.readBigUInt64LE(msg + 40).toString(),
    exponent: data.readInt32LE(msg + 48),
    publishTime: Number(data.readBigInt64LE(msg + 52)),
    prevPublishTime: Number(data.readBigInt64LE(msg + 60)),
    emaPrice: data.readBigInt64LE(msg + 68).toString(),
    emaConf: data.readBigUInt64LE(msg + 76).toString(),
    postedSlot: data.readBigUInt64LE(msg + 84).toString(),
    fields: [
      { name: "discriminator", offset: 0, size: 8, value: data.subarray(0, 8).toString("hex") },
      { name: "write_authority", offset: 8, size: 32, value: new PublicKey(data.subarray(8, 40)).toBase58() },
      { name: "verification_level_u8", offset: 40, size: 1, value: String(data[40]) },
      { name: "feed_id", offset: 41, size: 32, value: data.subarray(41, 73).toString("hex") },
      { name: "price_i64", offset: 73, size: 8, value: data.readBigInt64LE(73).toString() },
      { name: "conf_u64", offset: 81, size: 8, value: data.readBigUInt64LE(81).toString() },
      { name: "exponent_i32", offset: 89, size: 4, value: String(data.readInt32LE(89)) },
      { name: "publish_time_i64_unix", offset: 93, size: 8, value: data.readBigInt64LE(93).toString() },
      { name: "prev_publish_time_i64", offset: 101, size: 8, value: data.readBigInt64LE(101).toString() },
      { name: "ema_price_i64", offset: 109, size: 8, value: data.readBigInt64LE(109).toString() },
      { name: "ema_conf_u64", offset: 117, size: 8, value: data.readBigUInt64LE(117).toString() },
      { name: "posted_slot_u64", offset: 125, size: 8, value: data.readBigUInt64LE(125).toString() },
    ],
  };
}

function pythPdaUnderFeedProgram(shardId: number, feedId: Buffer): PublicKey {
  const shard = Buffer.alloc(2);
  shard.writeUInt16LE(shardId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("price_feed"), shard, feedId],
    PYTH_PRICE_FEED_PROGRAM,
  )[0];
}

async function readDecoded(connection: Connection, address: PublicKey) {
  const { context, value } = await connection.getAccountInfoAndContext(address, "confirmed");
  if (!value) return { slot: context.slot, missing: true as const };
  const data = Buffer.from(value.data);
  const decoded = data.length >= 134 ? decodePriceUpdateV2(data) : null;
  return {
    slot: context.slot,
    missing: false as const,
    address: address.toBase58(),
    owner: value.owner.toBase58(),
    lamports: value.lamports,
    dataLen: data.length,
    executable: value.executable,
    rentEpoch: value.rentEpoch,
    dataBase64: data.toString("base64"),
    decoded,
  };
}

async function findByFeedId(connection: Connection, feedId: Buffer, limit = 8) {
  const accts = await connection.getProgramAccounts(PYTH_RECEIVER, {
    commitment: "confirmed",
    filters: [{ dataSize: 134 }, { memcmp: { offset: 41, bytes: bs58.encode(feedId) } }],
  });
  // Rank by publish_time descending (need decode)
  const ranked = accts
    .map((a) => {
      const d = Buffer.from(a.account.data);
      const publishTime = Number(d.readBigInt64LE(93));
      return { pubkey: a.pubkey, lamports: a.account.lamports, publishTime, data: d };
    })
    .sort((a, b) => b.publishTime - a.publishTime);
  return { total: accts.length, top: ranked.slice(0, limit) };
}

async function probeProgram(connection: Connection, id: string) {
  const pk = new PublicKey(id);
  const { context, value } = await connection.getAccountInfoAndContext(pk, "confirmed");
  if (!value) {
    return { id, exists: false, slot: context.slot, executable: false, owner: null, lamports: 0, dataLen: 0 };
  }
  return {
    id,
    exists: true,
    slot: context.slot,
    executable: value.executable,
    owner: value.owner.toBase58(),
    lamports: value.lamports,
    dataLen: value.data.length,
  };
}

async function cmdDiscover() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const version = await connection.getVersion();
  const slot0 = await connection.getSlot("confirmed");
  const blockTime = await connection.getBlockTime(slot0);

  const programs = [];
  for (const sp of SEARCH_PROGRAMS) {
    const row = await probeProgram(connection, sp.id);
    programs.push({ ...sp, ...row });
    console.log(JSON.stringify({ probe: sp.label, ...row }));
  }

  // Docs PDA under price-feed program — expect empty (prior finding)
  const pdaProbes = [];
  for (const key of ["SOL_USD", "USDC_USD"] as const) {
    const feedId = Buffer.from(FEEDS[key].feedIdHex, "hex");
    for (const shard of [0, 1]) {
      const pda = pythPdaUnderFeedProgram(shard, feedId);
      const snap = await readDecoded(connection, pda);
      pdaProbes.push({
        pair: FEEDS[key].pair,
        shard,
        address: pda.toBase58(),
        found: !snap.missing,
        note: "PDA seeds [price_feed, shard_u16_le, feed_id] under pythWSnsw…",
      });
    }
  }

  // Sponsored SOL
  const solSponsored = await readDecoded(
    connection,
    new PublicKey(FEEDS.SOL_USD.sponsoredCited),
  );
  if (!solSponsored.missing) {
    writeFileSync(join(FIXTURE_DIR, "pyth-SOL-USD-sponsored.bin"), Buffer.from(solSponsored.dataBase64, "base64"));
    writeFileSync(
      join(FIXTURE_DIR, "pyth-SOL-USD-sponsored.meta.json"),
      JSON.stringify({ ...solSponsored, feedIdHex_docs: FEEDS.SOL_USD.feedIdHex }, null, 2),
    );
  }

  // Receiver GPA by feed id
  const solFind = await findByFeedId(connection, Buffer.from(FEEDS.SOL_USD.feedIdHex, "hex"), 5);
  const usdcFind = await findByFeedId(connection, Buffer.from(FEEDS.USDC_USD.feedIdHex, "hex"), 5);
  const eurFind = await findByFeedId(connection, Buffer.from(FEEDS.EUR_USD.feedIdHex, "hex"), 3);

  const freshestUsdc = usdcFind.top[0];
  let usdcSnap = null;
  if (freshestUsdc) {
    usdcSnap = await readDecoded(connection, freshestUsdc.pubkey);
    if (!usdcSnap.missing) {
      writeFileSync(join(FIXTURE_DIR, "pyth-USDC-USD-freshest.bin"), Buffer.from(usdcSnap.dataBase64, "base64"));
      writeFileSync(
        join(FIXTURE_DIR, "pyth-USDC-USD-freshest.meta.json"),
        JSON.stringify({ ...usdcSnap, feedIdHex_docs: FEEDS.USDC_USD.feedIdHex, rankNote: "max publish_time among receiver GPA memcmp" }, null, 2),
      );
    }
  }

  // Receiver account counts
  let receiverCount134: number | string = "error";
  try {
    const all = await connection.getProgramAccounts(PYTH_RECEIVER, {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 0 },
      filters: [{ dataSize: 134 }],
    });
    receiverCount134 = all.length;
  } catch (e) {
    receiverCount134 = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  let feedProgCount134: number | string = "error";
  try {
    const all = await connection.getProgramAccounts(PYTH_PRICE_FEED_PROGRAM, {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 0 },
      filters: [{ dataSize: 134 }],
    });
    feedProgCount134 = all.length;
  } catch (e) {
    feedProgCount134 = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  const rent134 = await connection.getMinimumBalanceForRentExemption(134);

  // Switchboard: sample one GPA with dataSize common for aggregators (~3840+) — may fail on public RPC
  let switchboardNote = "";
  try {
    const sb = new PublicKey("SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f");
    const sample = await connection.getProgramAccounts(sb, {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 8 },
      filters: [{ dataSize: 3240 }],
    });
    switchboardNote = `Switchboard V2 GPA dataSize=3240 count=${sample.length} sample=${sample[0]?.pubkey.toBase58() ?? "none"}`;
  } catch (e) {
    switchboardNote = `Switchboard GPA: ${e instanceof Error ? e.message : String(e)}`;
  }

  const out = {
    measuredAt: new Date().toISOString(),
    rpc: DEVNET_RPC,
    clusterVersion: version,
    slot0,
    blockTime,
    programs,
    gpa: {
      pythReceiverDataSize134: receiverCount134,
      pythPriceFeedProgramDataSize134: feedProgCount134,
      switchboardNote,
    },
    docsPdaProbesEmpty: pdaProbes,
    solSponsored,
    feedIdSearch: {
      SOL: { total: solFind.total, topPublishTimes: solFind.top.map((t) => ({ pk: t.pubkey.toBase58(), publishTime: t.publishTime, lamports: t.lamports })) },
      USDC: { total: usdcFind.total, topPublishTimes: usdcFind.top.map((t) => ({ pk: t.pubkey.toBase58(), publishTime: t.publishTime, lamports: t.lamports })) },
      EUR: { total: eurFind.total, topPublishTimes: eurFind.top.map((t) => ({ pk: t.pubkey.toBase58(), publishTime: t.publishTime, lamports: t.lamports })) },
    },
    usdcFreshest: usdcSnap,
    rentExemptMin134: rent134,
    searchedAbsent: [
      eurFind.total === 0 ? "FX.EUR/USD feed id: zero receiver accounts dataSize=134 with memcmp@41" : null,
      feedProgCount134 === 0 ? "pythWSnsw… owns zero dataSize=134 accounts; docs PDA derivation yields AccountNotFound" : null,
      "Chainlink AggregatorV3-shaped account (answer+updatedAt, no conf): not located on Devnet in this lab",
    ].filter(Boolean),
  };

  writeFileSync(join(FIXTURE_DIR, "measure-run.json"), JSON.stringify(out, null, 2));
  console.log("Wrote measure-run.json");
  console.log(JSON.stringify({
    slot0,
    blockTime,
    solSponsoredAgeSec: solSponsored.missing || !solSponsored.decoded || blockTime == null
      ? null
      : blockTime - solSponsored.decoded.publishTime,
    solPrice: solSponsored.missing ? null : solSponsored.decoded?.price,
    solConf: solSponsored.missing ? null : solSponsored.decoded?.conf,
    usdcFreshest: usdcSnap && !usdcSnap.missing ? { address: usdcSnap.address, price: usdcSnap.decoded?.price, conf: usdcSnap.decoded?.conf, publishTime: usdcSnap.decoded?.publishTime, ageSec: blockTime != null && usdcSnap.decoded ? blockTime - usdcSnap.decoded.publishTime : null } : null,
    counts: { receiver134: receiverCount134, solAccounts: solFind.total, usdcAccounts: usdcFind.total, eurAccounts: eurFind.total },
  }, null, 2));
}

async function cmdSample(seconds: number, intervalSec: number) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const targets = [
    { label: "SOL_sponsored", address: new PublicKey(FEEDS.SOL_USD.sponsoredCited) },
  ];
  // Add freshest USDC from prior discover if present
  const usdcMeta = join(FIXTURE_DIR, "pyth-USDC-USD-freshest.meta.json");
  if (existsSync(usdcMeta)) {
    const m = JSON.parse(readFileSync(usdcMeta, "utf8")) as { address: string };
    targets.push({ label: "USDC_freshest_at_discover", address: new PublicKey(m.address) });
  }

  type Pt = { t: number; label: string; slot: number; publishTime: number | null; price: string | null; conf: string | null; postedSlot: string | null; blockTime: number | null };
  const points: Pt[] = [];
  const end = Date.now() + seconds * 1000;
  let n = 0;
  while (Date.now() < end) {
    const slot = await connection.getSlot("confirmed");
    const blockTime = await connection.getBlockTime(slot);
    for (const t of targets) {
      const snap = await readDecoded(connection, t.address);
      const pt: Pt = {
        t: Date.now(),
        label: t.label,
        slot: snap.slot,
        publishTime: snap.missing ? null : snap.decoded?.publishTime ?? null,
        price: snap.missing ? null : snap.decoded?.price ?? null,
        conf: snap.missing ? null : snap.decoded?.conf ?? null,
        postedSlot: snap.missing ? null : snap.decoded?.postedSlot ?? null,
        blockTime,
      };
      points.push(pt);
      console.log(JSON.stringify({ n, ...pt }));
    }
    n += 1;
    if (Date.now() >= end) break;
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }

  const cadence: Record<string, object> = {};
  for (const label of [...new Set(points.map((p) => p.label))]) {
    const arr = points.filter((p) => p.label === label);
    const pubs = [...new Set(arr.map((a) => a.publishTime).filter((x): x is number => x != null))].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < pubs.length; i++) gaps.push(pubs[i]! - pubs[i - 1]!);
    const sorted = [...gaps].sort((a, b) => a - b);
    cadence[label] = {
      samples: arr.length,
      distinctPublishTimes: pubs.length,
      gapsSec: gaps,
      minGap: sorted[0] ?? null,
      medianGap: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null,
      maxGap: sorted.length ? sorted[sorted.length - 1]! : null,
      windowSec: seconds,
      intervalSec,
      firstPublish: pubs[0] ?? null,
      lastPublish: pubs[pubs.length - 1] ?? null,
    };
  }

  writeFileSync(
    join(FIXTURE_DIR, "cadence-sample.json"),
    JSON.stringify({ measuredAt: new Date().toISOString(), rpc: DEVNET_RPC, seconds, intervalSec, points, cadence }, null, 2),
  );
  console.log("Wrote cadence-sample.json", JSON.stringify(cadence, null, 2));
}

function buildLabPriceAccount(opts: {
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: bigint;
  feedId?: Buffer;
}): Buffer {
  const feedId = opts.feedId ?? Buffer.from(FEEDS.SOL_USD.feedIdHex, "hex");
  const buf = Buffer.alloc(134);
  Buffer.from("22f123639d7ef4cd", "hex").copy(buf, 0);
  SystemProgram.programId.toBuffer().copy(buf, 8);
  buf[40] = 1;
  feedId.copy(buf, 41);
  buf.writeBigInt64LE(opts.price, 73);
  buf.writeBigUInt64LE(opts.conf, 81);
  buf.writeInt32LE(opts.exponent, 89);
  buf.writeBigInt64LE(opts.publishTime, 93);
  buf.writeBigInt64LE(opts.publishTime - 1n, 101);
  buf.writeBigInt64LE(opts.price, 109);
  buf.writeBigUInt64LE(opts.conf, 117);
  buf.writeBigUInt64LE(1n, 125);
  return buf;
}

async function cmdLocalFive() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const cases = [
    { name: "fresh_narrow", buf: buildLabPriceAccount({ price: 150_00000000n, conf: 50_000n, exponent: -8, publishTime: now }) },
    { name: "stale", buf: buildLabPriceAccount({ price: 150_00000000n, conf: 50_000n, exponent: -8, publishTime: now - 1_000_000n }) },
    { name: "wide_conf", buf: buildLabPriceAccount({ price: 150_00000000n, conf: 150_00000000n, exponent: -8, publishTime: now }) },
    { name: "non_positive", buf: buildLabPriceAccount({ price: 0n, conf: 1n, exponent: -8, publishTime: now }) },
    { name: "negative_price", buf: buildLabPriceAccount({ price: -1n, conf: 1n, exponent: -8, publishTime: now }) },
  ];
  const decodedCases = cases.map((c) => {
    writeFileSync(join(FIXTURE_DIR, `lab-${c.name}.bin`), c.buf);
    return { name: c.name, decoded: decodePriceUpdateV2(c.buf) };
  });

  let localReachable = false;
  let wrongOwnerAddress: string | null = null;
  try {
    const connection = new Connection(LOCAL_RPC, "confirmed");
    await connection.getSlot();
    localReachable = true;
    const payer = Keypair.generate();
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    const acc = Keypair.generate();
    // create empty system account = wrong owner relative to PYTH_RECEIVER
    const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
    const rent = await connection.getMinimumBalanceForRentExemption(0);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: acc.publicKey,
        lamports: rent,
        space: 0,
        programId: SystemProgram.programId,
      }),
    );
    await sendAndConfirmTransaction(connection, tx, [payer, acc]);
    wrongOwnerAddress = acc.publicKey.toBase58();
  } catch (e) {
    localReachable = false;
    console.log("local validator note:", e instanceof Error ? e.message : e);
  }

  const report = {
    measuredAt: new Date().toISOString(),
    localRpc: LOCAL_RPC,
    localReachable,
    wrongOwnerAddress,
    decodedCases,
    conditions: {
      freshNarrow: {
        producible: true,
        method: "lab-fresh_narrow.bin — PriceUpdateV2_msg@41 with fresh publish_time and conf << |price|; decode in-process (same offsets as chain).",
      },
      stale: {
        producible: true,
        method: "lab-stale.bin — publish_time = now-1e6. Cloned Devnet Pyth account cannot be field-rewritten (owner=receiver program).",
      },
      wideConf: {
        producible: true,
        method: "lab-wide_conf.bin — conf == |price|.",
      },
      nonPositiveOrMalformed: {
        producible: true,
        method: "lab-non_positive.bin (price=0) and lab-negative_price.bin.",
      },
      wrongOwner: {
        producible: true,
        method: localReachable
          ? `SystemProgram-owned account ${wrongOwnerAddress} on local validator; consumer requires owner==rec5EKM…`
          : "Create SystemProgram-owned account on local validator when up; always producible.",
      },
      vendorAccountMutation: {
        producible: false,
        reason:
          "Accounts owned by rec5EKM… require that program’s instructions to mutate price fields. Lab cannot drive stale/wide on the live sponsored account without posting a forged update (not attempted; would be a Devnet write / pull post). Finding: fiat-branch unit tests must use a lab-owned mirror of the 134-byte layout, not mutation of cloned vendor accounts.",
      },
    },
  };
  writeFileSync(join(FIXTURE_DIR, "local-five.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const cmd = process.argv[2] ?? "discover";
  if (cmd === "discover") await cmdDiscover();
  else if (cmd === "sample") {
    const secIdx = process.argv.indexOf("--seconds");
    const intIdx = process.argv.indexOf("--interval");
    await cmdSample(secIdx >= 0 ? Number(process.argv[secIdx + 1]) : 900, intIdx >= 0 ? Number(process.argv[intIdx + 1]) : 15);
  } else if (cmd === "local-five") await cmdLocalFive();
  else {
    console.error("unknown", cmd);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
