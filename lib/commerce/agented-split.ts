import {
  COMPENSATION_FORM,
  type CompensationForm,
} from "@/lib/commerce/denomination";

const BPS_DENOM = 10_000n;

/**
 * Mirrors `ConsignmentBase._computeAgentedSplitAmounts`. `ok === false` is the
 * client-side view of the contract's `BelowFloor` revert.
 */
export type AgentedSplit = {
  platform: bigint;
  ownerAmount: bigint;
  agentAmount: bigint;
  ok: boolean;
};

export function computeAgentedSplit(input: {
  settled: bigint;
  floor: bigint;
  compensationForm: CompensationForm;
  commissionBps: number;
  platformFeeBps: bigint;
}): AgentedSplit {
  const { settled, floor, compensationForm, commissionBps, platformFeeBps } =
    input;
  const platform = (settled * platformFeeBps) / BPS_DENOM;

  if (compensationForm === COMPENSATION_FORM.Margin) {
    const ok = settled >= platform + floor;
    return {
      platform,
      ownerAmount: ok ? floor : 0n,
      agentAmount: ok ? settled - platform - floor : 0n,
      ok,
    };
  }

  const agentAmount = (settled * BigInt(commissionBps)) / BPS_DENOM;
  if (settled < platform + agentAmount) {
    return { platform, ownerAmount: 0n, agentAmount: 0n, ok: false };
  }
  const ownerAmount = settled - platform - agentAmount;
  return { platform, ownerAmount, agentAmount, ok: ownerAmount >= floor };
}

/** Client mirror of the `openFromMandate` / `setPrice` floor guard. */
export function agentedPriceMeetsFloor(input: {
  price: bigint | null;
  floor: bigint;
  compensationForm: CompensationForm;
  commissionBps: number;
  platformFeeBps: bigint | null | undefined;
}): boolean {
  const { price, platformFeeBps } = input;
  if (price == null || price <= 0n) return false;
  if (platformFeeBps == null) return false;
  return computeAgentedSplit({
    settled: price,
    floor: input.floor,
    compensationForm: input.compensationForm,
    commissionBps: input.commissionBps,
    platformFeeBps,
  }).ok;
}
