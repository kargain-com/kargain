/**
 * Irys Solana payment uploader — outside the app product graph.
 *
 * `@irys/web-upload-solana` transitively brings `@solana/web3.js` and
 * `@solana/spl-token`; product code reaches this owner only through one
 * dynamic import in `lib/storage/irys-client.ts`.
 */
import { WebUploader } from "@irys/web-upload";
import type BaseWebIrys from "@irys/web-upload/base";
import { WebSolana } from "@irys/web-upload-solana";

import type { IrysUploadPlan } from "@/lib/storage/irys-upload-plan";

export type IrysSolanaUploader = BaseWebIrys;

export async function buildIrysSolanaUploader(
  plan: IrysUploadPlan,
  provider: unknown,
  timeoutMs: number,
): Promise<IrysSolanaUploader> {
  if (plan.paymentToken !== "solana") {
    throw new Error("buildIrysSolanaUploader: plan.paymentToken must be solana");
  }
  let builder = WebUploader(WebSolana)
    .withProvider(provider)
    .bundlerUrl(plan.bundlerUrl)
    .withRpc(plan.rpcUrl)
    .timeout(timeoutMs);
  if (plan.devnet) {
    builder = builder.devnet();
  }
  return builder;
}
