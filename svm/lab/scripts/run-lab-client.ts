/**
 * S3 laboratory client proofs against local validator + cloned mpl-core.
 */

import {
  create,
  fetchAsset,
  transferV1,
  updateV1,
  addPlugin,
  removePlugin,
  updatePlugin,
  burnV1,
  mplCore,
  DataState,
} from "@metaplex-foundation/mpl-core";
import {
  createSignerFromKeypair,
  generateSigner,
  publicKey,
  signerIdentity,
  type Umi,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { base58 } from "@metaplex-foundation/umi/serializers";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RPC = process.env.SVM_LAB_RPC ?? "http://127.0.0.1:8899";
const CORE_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const URI_CEILING = 731;
/** Core Transfer/Burn require an explicit system program account (umi default placeholder fails). */
const SYSTEM = publicKey(SystemProgram.programId.toBase58());

type Result = {
  id: string;
  ok: boolean;
  detail: string;
  metrics?: Record<string, number | string | boolean>;
};

function loadPayer(): Keypair {
  const p =
    process.env.SOLANA_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`;
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function umiFromKeypair(kp: Keypair): Umi {
  const umi = createUmi(RPC).use(mplCore());
  const secret = umi.eddsa.createKeypairFromSecretKey(kp.secretKey);
  const signer = createSignerFromKeypair(umi, secret);
  return umi.use(signerIdentity(signer));
}

function withIdentity(umi: Umi, secretKey: Uint8Array): Umi {
  const secret = umi.eddsa.createKeypairFromSecretKey(secretKey);
  return umi.use(signerIdentity(createSignerFromKeypair(umi, secret)));
}

function uriOfLength(n: number): string {
  const prefix = "ar://";
  return prefix + "x".repeat(Math.max(0, n - prefix.length));
}

async function measureCu(
  connection: Connection,
  sig: string,
): Promise<number | null> {
  // Allow indexing
  for (let i = 0; i < 10; i++) {
    const tx = await connection.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (tx?.meta?.computeUnitsConsumed != null) {
      return tx.meta.computeUnitsConsumed;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function airdrop(connection: Connection, pubkey: PublicKey, solAmt = 5) {
  const sig = await connection.requestAirdrop(
    pubkey,
    solAmt * LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(sig, "confirmed");
}

function hasTransferDelegate(asset: {
  transferDelegate?: unknown;
}): boolean {
  return asset.transferDelegate != null;
}

function permanentFrozen(asset: {
  permanentFreezeDelegate?: { frozen?: boolean };
}): boolean | undefined {
  return asset.permanentFreezeDelegate?.frozen;
}

export async function runClientLab(): Promise<Result[]> {
  const results: Result[] = [];
  const connection = new Connection(RPC, "confirmed");
  const payer = loadPayer();
  try {
    await airdrop(connection, payer.publicKey, 50);
  } catch {
    /* already funded */
  }
  const umi = umiFromKeypair(payer);

  const coreInfo = await connection.getAccountInfo(new PublicKey(CORE_ID));
  if (!coreInfo?.executable) {
    results.push({
      id: "fixture-core",
      ok: false,
      detail: `Core ${CORE_ID} not executable on ${RPC}`,
    });
    return results;
  }
  results.push({
    id: "fixture-core",
    ok: true,
    detail: `Core executable dataLen=${coreInfo.data.length}`,
  });

  // Permanent freeze attached with frozen=false
  {
    const asset = generateSigner(umi);
    try {
      await create(umi, {
        asset,
        name: "lab-thawed-permanent",
        uri: "ar://lab-thawed",
        dataState: DataState.AccountState,
        plugins: [
          {
            type: "PermanentFreezeDelegate",
            frozen: false,
            authority: { type: "Address", address: umi.identity.publicKey },
          },
        ],
      }).sendAndConfirm(umi);
      const fetched = await fetchAsset(umi, asset.publicKey);
      const frozen = permanentFrozen(fetched);
      results.push({
        id: "obs-permanent-thawed",
        ok: frozen === false,
        detail: `PermanentFreeze attached, frozen=${frozen}`,
      });
    } catch (e) {
      results.push({ id: "obs-permanent-thawed", ok: false, detail: String(e) });
    }
  }

  // П-3: Address authority (program-address-shaped — PDA proven in harness)
  const freezeAuthority = generateSigner(umi);
  await airdrop(
    connection,
    new PublicKey(freezeAuthority.publicKey),
    2,
  ).catch(() => undefined);
  {
    const asset = generateSigner(umi);
    try {
      await create(umi, {
        asset,
        name: "lab-p3",
        uri: "ar://lab-p3",
        dataState: DataState.AccountState,
        plugins: [
          {
            type: "PermanentFreezeDelegate",
            frozen: false,
            authority: { type: "Address", address: freezeAuthority.publicKey },
          },
        ],
      }).sendAndConfirm(umi);
      results.push({
        id: "P-3",
        ok: true,
        detail: `PermanentFreeze authority Address=${freezeAuthority.publicKey}`,
      });
    } catch (e) {
      results.push({ id: "P-3", ok: false, detail: String(e) });
    }
  }

  // П-2: TransferDelegate
  {
    const asset = generateSigner(umi);
    const delegate = generateSigner(umi);
    const newOwner = generateSigner(umi);
    try {
      await create(umi, {
        asset,
        name: "lab-p2",
        uri: "ar://lab-p2",
        dataState: DataState.AccountState,
        plugins: [
          {
            type: "TransferDelegate",
            authority: { type: "Address", address: delegate.publicKey },
          },
        ],
      }).sendAndConfirm(umi);

      let a = await fetchAsset(umi, asset.publicKey);
      const hasDelegateBefore = hasTransferDelegate(a);

      await removePlugin(umi, {
        asset: asset.publicKey,
        plugin: { type: "TransferDelegate" },
      }).sendAndConfirm(umi);
      a = await fetchAsset(umi, asset.publicKey);
      const hasDelegateAfterRemove = hasTransferDelegate(a);

      await addPlugin(umi, {
        asset: asset.publicKey,
        plugin: {
          type: "TransferDelegate",
          authority: { type: "Address", address: delegate.publicKey },
        },
      }).sendAndConfirm(umi);

      await airdrop(connection, new PublicKey(newOwner.publicKey), 1).catch(
        () => undefined,
      );

      await transferV1(umi, {
        asset: asset.publicKey,
        newOwner: newOwner.publicKey,
        systemProgram: SYSTEM,
      }).sendAndConfirm(umi);

      a = await fetchAsset(umi, asset.publicKey);
      // Core keeps the TransferDelegate plugin slot but resets authority to Owner
      // after transfer — the prior Address authority is revoked (П-2).
      const afterXferAuth = (
        a as {
          transferDelegate?: { authority?: { type?: string; address?: string } };
        }
      ).transferDelegate?.authority;
      const priorAuthorityRevoked =
        !hasTransferDelegate(a) ||
        afterXferAuth?.type === "Owner" ||
        afterXferAuth?.address !== String(delegate.publicKey);

      const ok =
        hasDelegateBefore &&
        !hasDelegateAfterRemove &&
        priorAuthorityRevoked;
      results.push({
        id: "P-2",
        ok,
        detail: `before=${hasDelegateBefore} afterRemove=${hasDelegateAfterRemove} afterXferAuth=${afterXferAuth?.type ?? "absent"} priorRevoked=${priorAuthorityRevoked}`,
        metrics: {
          hasDelegateBefore,
          hasDelegateAfterRemove,
          priorAuthorityRevoked,
          afterTransferAuthorityType: afterXferAuth?.type ?? "absent",
        },
      });
    } catch (e) {
      results.push({ id: "P-2", ok: false, detail: String(e) });
    }
  }

  // Freeze rejects transfer with TransferDelegate present
  {
    const asset = generateSigner(umi);
    const delegate = generateSigner(umi);
    const stranger = generateSigner(umi);
    try {
      await create(umi, {
        asset,
        name: "lab-freeze-xfer",
        uri: "ar://lab-freeze-xfer",
        dataState: DataState.AccountState,
        plugins: [
          {
            type: "PermanentFreezeDelegate",
            frozen: true,
            authority: { type: "Address", address: freezeAuthority.publicKey },
          },
          {
            type: "TransferDelegate",
            authority: { type: "Address", address: delegate.publicKey },
          },
        ],
      }).sendAndConfirm(umi);

      let transferRejected = false;
      try {
        await transferV1(umi, {
          asset: asset.publicKey,
          newOwner: stranger.publicKey,
          systemProgram: SYSTEM,
        }).sendAndConfirm(umi);
      } catch {
        transferRejected = true;
      }

      // Thaw with freeze authority, then owner burns (two ixs; same-tx = harness П-1)
      const umiFa = withIdentity(umiFromKeypair(payer), freezeAuthority.secretKey);
      await updatePlugin(umiFa, {
        asset: asset.publicKey,
        plugin: { type: "PermanentFreezeDelegate", frozen: false },
      }).sendAndConfirm(umiFa);

      const umiOwner = umiFromKeypair(payer);
      await burnV1(umiOwner, {
        asset: asset.publicKey,
        systemProgram: SYSTEM,
      }).sendAndConfirm(umiOwner);

      results.push({
        id: "freeze-blocks-transfer",
        ok: transferRejected,
        detail: transferRejected
          ? "transfer rejected while frozen; thaw+burn succeeded (separate ixs)"
          : "transfer unexpectedly succeeded while frozen",
      });
    } catch (e) {
      results.push({
        id: "freeze-blocks-transfer",
        ok: false,
        detail: String(e),
      });
    }
  }

  // Freeze does not block URI update
  {
    const asset = generateSigner(umi);
    try {
      await create(umi, {
        asset,
        name: "lab-freeze-uri",
        uri: "ar://before",
        dataState: DataState.AccountState,
        plugins: [
          {
            type: "PermanentFreezeDelegate",
            frozen: true,
            authority: { type: "Address", address: umi.identity.publicKey },
          },
        ],
      }).sendAndConfirm(umi);

      await updateV1(umi, {
        asset: asset.publicKey,
        newUri: "ar://after-frozen",
        systemProgram: SYSTEM,
      }).sendAndConfirm(umi);
      const a = await fetchAsset(umi, asset.publicKey);
      results.push({
        id: "freeze-allows-uri-update",
        ok: a.uri === "ar://after-frozen",
        detail: `uri=${a.uri}`,
      });
    } catch (e) {
      results.push({
        id: "freeze-allows-uri-update",
        ok: false,
        detail: String(e),
      });
    }
  }

  // П-7: URI=731 create — measure CU + accounts
  {
    const asset = generateSigner(umi);
    const uri = uriOfLength(URI_CEILING);
    try {
      const result = await create(umi, {
        asset,
        name: "lab-p7",
        uri,
        dataState: DataState.AccountState,
        plugins: [
          {
            type: "PermanentFreezeDelegate",
            frozen: false,
            authority: { type: "Address", address: umi.identity.publicKey },
          },
        ],
      }).sendAndConfirm(umi);

      const sig = base58.deserialize(result.signature)[0];
      const cu = await measureCu(connection, sig);
      const tx = await connection.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      const accountKeys =
        tx?.transaction.message.getAccountKeys().staticAccountKeys.length ??
        0;
      const needsAlt = accountKeys > 64; // v0 without ALT still has higher limits; flag if >32 for legacy
      const legacyNeedsAlt = accountKeys > 32;
      const a = await fetchAsset(umi, asset.publicKey);
      results.push({
        id: "P-7",
        ok: a.uri.length === URI_CEILING && cu != null,
        detail: `uriLen=${a.uri.length} cu=${cu} staticAccounts=${accountKeys} legacyNeedsAlt=${legacyNeedsAlt}`,
        metrics: {
          uriLen: a.uri.length,
          computeUnits: cu ?? -1,
          staticAccountKeys: accountKeys,
          needsAddressLookupTable: needsAlt,
          legacyTxNeedsAlt: legacyNeedsAlt,
        },
      });
    } catch (e) {
      results.push({ id: "P-7", ok: false, detail: String(e) });
    }
  }

  return results;
}

const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runClientLab()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.some((x) => !x.ok) ? 1 : 0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
