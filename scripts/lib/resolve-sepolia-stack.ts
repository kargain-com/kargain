/**
 * Sole commercial stack resolver for the Ponder indexing config and
 * `pnpm ponder:config` (ADR 0016 §a): COMMERCIAL_ACTIVE only. No env override
 * and no deployments/<chainId>.json — a start block or an address changes only
 * through a reviewed registry change. Deploy-machine manifest asserts live in
 * scripts/lib/assert-commercial-active-manifest.ts.
 */
import { requireEvmCommercialActive } from "../../lib/web3/commercial-active.js";
import type {
  DeploymentBlocks,
  PonderAddressBundle,
} from "./load-deployment.js";

export type ResolvedCommercialStack = {
  chainId: number;
  karPassport: `0x${string}`;
  karProPass: `0x${string}`;
  karProStaking: `0x${string}`;
  bridgeGateway: `0x${string}`;
  fixedPriceConsignment?: `0x${string}`;
  ascendingConsignment?: `0x${string}`;
  indexFromBlock: number;
  blocks: DeploymentBlocks;
};

export function resolveCommercialStack(chainId: number): ResolvedCommercialStack {
  const active = requireEvmCommercialActive(chainId);
  return {
    chainId,
    karPassport: active.karPassport,
    karProPass: active.karProPass,
    karProStaking: active.karProStaking,
    bridgeGateway: active.bridgeGateway,
    ...(active.fixedPriceConsignment
      ? { fixedPriceConsignment: active.fixedPriceConsignment }
      : {}),
    ...(active.ascendingConsignment
      ? { ascendingConsignment: active.ascendingConsignment }
      : {}),
    indexFromBlock: active.indexFromBlock,
    blocks: { ...active.blocks },
  };
}

export function ponderAddressesFromStack(
  stack: ResolvedCommercialStack,
): PonderAddressBundle {
  return {
    karPassport: stack.karPassport,
    karProPass: stack.karProPass,
    karProStaking: stack.karProStaking,
    ...(stack.fixedPriceConsignment
      ? { fixedPriceConsignment: stack.fixedPriceConsignment }
      : {}),
    ...(stack.ascendingConsignment
      ? { ascendingConsignment: stack.ascendingConsignment }
      : {}),
    bridgeGateway: stack.bridgeGateway,
  };
}
