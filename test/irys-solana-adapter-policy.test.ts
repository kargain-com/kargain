import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildIrysUploaderFromPlan,
  type IrysUploader,
} from "../lib/storage/irys-client.ts";
import {
  IRYS_DEVNET_BUNDLER_URL,
  planIrysUpload,
} from "../lib/storage/irys-upload-plan.ts";
import { requireCommercialActive } from "../lib/web3/commercial-active.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IRYS_CLIENT = path.join(ROOT, "lib/storage/irys-client.ts");

function fakeEip1193Provider() {
  return {
    async request(args: { method: string; params?: readonly unknown[] }) {
      switch (args.method) {
        case "eth_chainId":
          return "0x14a34";
        case "eth_accounts":
        case "eth_requestAccounts":
          return ["0x0000000000000000000000000000000000000001"];
        default:
          throw new Error(`unexpected EIP-1193 method in test: ${args.method}`);
      }
    },
  };
}

function fakeSolanaProvider() {
  return {
    publicKey: {
      toBuffer() {
        return Buffer.alloc(32, 1);
      },
    },
    async sendTransaction() {
      return "4x9zFakeSignature";
    },
    async signMessage(data: Uint8Array) {
      return data;
    },
  };
}

function staticAdapterImportViolation(source: string): string | false {
  const re =
    /\bimport\s+(?:type\s+)?(?:[\w*\s{},]+\s+from\s+)?["']@\/adapters\/irys-solana\/build-uploader["']|\bexport\s+(?:type\s+)?(?:[\w*\s{},]+\s+from\s+)?["']@\/adapters\/irys-solana\/build-uploader["']|\brequire\s*\(\s*["']@\/adapters\/irys-solana\/build-uploader["']\s*\)/;
  return re.test(source)
    ? "static Solana adapter import from product code"
    : false;
}

describe("irys solana adapter boundary", () => {
  it("irys-client reaches the Solana adapter only via dynamic import", () => {
    const source = fs.readFileSync(IRYS_CLIENT, "utf8");
    assert.equal(staticAdapterImportViolation(source), false);
    assert.match(source, /import\(\s*["']@\/adapters\/irys-solana\/build-uploader["']\s*\)/);
  });

  it("constructed dirty static import is red", () => {
    const dirty =
      'import { buildIrysSolanaUploader } from "@/adapters/irys-solana/build-uploader";\n';
    assert.equal(
      staticAdapterImportViolation(dirty),
      "static Solana adapter import from product code",
    );
  });

  it("uploadFilesWithUploader under solana plan calls uploadFolder once for ≥2 files", async () => {
    const { uploadFilesWithUploader } = await import("../lib/storage/irys-client.ts");
    let folderCalls = 0;
    const uploader = {
      async uploadFile() {
        throw new Error("uploadFile must not run for multi-file batch");
      },
      async uploadFolder(files: File[]) {
        folderCalls += 1;
        const paths: Record<string, { id: string }> = {};
        for (const file of files) {
          paths[file.name] = { id: `id-${file.name}` };
        }
        return { manifest: { paths } };
      },
    };
    const files = [
      new File([Uint8Array.of(1)], "a.jpg", { type: "image/jpeg" }),
      new File([Uint8Array.of(2)], "b.jpg", { type: "image/jpeg" }),
    ];
    const uris = await uploadFilesWithUploader(uploader as never, files);
    assert.equal(folderCalls, 1);
    assert.equal(uris.length, 2);
    assert.ok(uris.every((u) => u.startsWith("ar://")));
  });

  it("toIrysSolanaProvider passes MessageSigner-shaped wallets through", async () => {
    const { toIrysSolanaProvider, encodeIrysSolanaSignatureBase58 } = await import(
      "../adapters/irys-solana/to-irys-provider.ts"
    );
    const shaped = fakeSolanaProvider();
    const out = toIrysSolanaProvider(shaped, {
      paymentToken: "solana",
      bundlerUrl: IRYS_DEVNET_BUNDLER_URL,
      rpcUrl: "https://api.devnet.solana.com",
      devnet: true,
    });
    assert.equal(out, shaped);
    assert.equal(encodeIrysSolanaSignatureBase58(Uint8Array.of(0)), "1");
    assert.equal(encodeIrysSolanaSignatureBase58(Uint8Array.of()), "");
  });

  it("toIrysSolanaProvider refuses unknown provider shapes by name", async () => {
    const { toIrysSolanaProvider } = await import(
      "../adapters/irys-solana/to-irys-provider.ts"
    );
    assert.throws(
      () =>
        toIrysSolanaProvider(
          { notAWallet: true },
          {
            paymentToken: "solana",
            bundlerUrl: IRYS_DEVNET_BUNDLER_URL,
            rpcUrl: "https://api.devnet.solana.com",
            devnet: true,
          },
        ),
      /Wallet Standard wallet or MessageSigner provider/,
    );
  });

  it("product never imports deleted EIP-1193 dual upload wrappers", () => {
    const client = fs.readFileSync(IRYS_CLIENT, "utf8");
    assert.equal(/\bexport async function uploadFile\b/.test(client), false);
    assert.equal(/\bexport async function uploadFiles\b/.test(client), false);
    assert.equal(/\bexport async function uploadJson\b/.test(client), false);
    assert.equal(/\bexport async function prepareUserPaidUpload\b/.test(client), false);
    assert.match(client, /\bexport async function prepareUserPaidUploadForStack\b/);
    assert.match(client, /\bexport async function getIrysUploader\b/);
  });

  it("loads the real adapter and builds an uploader with batch upload support", async () => {
    const mod = await import("../adapters/irys-solana/build-uploader.ts");
    const uploader = await mod.buildIrysSolanaUploader(
      {
        paymentToken: "solana",
        bundlerUrl: IRYS_DEVNET_BUNDLER_URL,
        rpcUrl: "https://api.devnet.solana.com",
        devnet: true,
      },
      fakeSolanaProvider(),
      1_000,
    );
    assert.equal(typeof uploader.uploadFolder, "function");
    assert.equal(typeof uploader.uploadFile, "function");
    assert.equal(typeof uploader.fund, "function");
  });

  it("broken Solana adapter loader fails by name", async () => {
    await assert.rejects(
      () =>
        buildIrysUploaderFromPlan(
          {
            paymentToken: "solana",
            bundlerUrl: IRYS_DEVNET_BUNDLER_URL,
            rpcUrl: "https://api.devnet.solana.com",
            devnet: true,
          },
          fakeSolanaProvider(),
          {
            loadSolanaAdapter: async () => {
              throw new Error("broken chunk");
            },
          },
        ),
      /Failed to load Solana Irys adapter: broken chunk/,
    );
  });

  it("broken adapter shape fails by name", async () => {
    await assert.rejects(
      () =>
        buildIrysUploaderFromPlan(
          {
            paymentToken: "solana",
            bundlerUrl: IRYS_DEVNET_BUNDLER_URL,
            rpcUrl: "https://api.devnet.solana.com",
            devnet: true,
          },
          fakeSolanaProvider(),
          {
            loadSolanaAdapter: async () => ({}) as never,
          },
        ),
      /module does not export buildIrysSolanaUploader/,
    );
  });

  it("EVM plan keeps the current uploader path and does not fetch the Solana adapter", async () => {
    const planned = planIrysUpload(requireCommercialActive(84532));
    assert.equal(planned.ok, true);
    if (!planned.ok) return;

    let loaded = false;
    const prevWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { ethereum: fakeEip1193Provider() },
    });
    try {
      const uploader = (await buildIrysUploaderFromPlan(
        planned.plan,
        fakeEip1193Provider(),
        {
          loadSolanaAdapter: async () => {
            loaded = true;
            throw new Error("should not load");
          },
        },
      )) as IrysUploader;

      assert.equal(loaded, false);
      assert.equal(typeof uploader.uploadFile, "function");
      assert.equal(typeof uploader.uploadFolder, "function");
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: prevWindow,
      });
    }
  });
});
