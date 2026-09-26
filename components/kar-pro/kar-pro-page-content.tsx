"use client";

import {
  commercialNamespaceOf,
  useActiveAccount,
} from "@/hooks/use-active-account";

import { useState } from "react";

import { KarProClient } from "@/components/kar-pro/kar-pro-client";
import { useActiveVerifierFact } from "@/hooks/use-active-verifier-fact";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { formatStakeNative } from "@/lib/kar-pro/stake-format";
import {
  admitSessionSurface,
  admitSurfaceAllowsEvmRead,
  admitSurfaceEvmAddress,
  isSurfaceAdmissionAvailable,
  surfaceAdmissionRefusalCopy,
} from "@/lib/web3/surface-admission";

const VALUE_PROPS = [
  { label: "Refundable stake", stakeStat: true as const },
  { value: "No lock", label: "Leave anytime" },
  { value: "On-chain", label: "Permanent reputation" },
] as const;

export function KarProPageContent() {
  const { account } = useActiveAccount();
  const ns = commercialNamespaceOf(account);
  const chainId = ns.ok ? Number(ns.namespace) : undefined;
  const joinAdmission = admitSessionSurface(account, "kar_pro_join");
  const address = admitSurfaceEvmAddress(joinAdmission);
  const [postTxActive, setPostTxActive] = useState<boolean | null>(null);

  const { fact, isActiveVerifier: onChainActive } = useActiveVerifierFact({
    chainId,
  });

  const minStakeAdmission = admitSessionSurface(account, "kar_pro_min_stake");
  const { minStake, isPending: minStakePending } = useMinStakeNative(
    admitSurfaceAllowsEvmRead(minStakeAdmission) ? chainId : undefined,
  );

  const stack = chainId != null ? commercialActive(chainId) : undefined;
  const unit = stack ? nativeUnitOf(stack) : null;
  const stakeLabel = !isSurfaceAdmissionAvailable(minStakeAdmission)
    ? surfaceAdmissionRefusalCopy(minStakeAdmission).title
    : unit != null
      ? `${formatStakeNative(minStake, unit)} ${unit.symbol}`
      : null;

  const [prevIdentity, setPrevIdentity] = useState(
    `${address}:${account.status}:${chainId}`,
  );
  const identity = `${address}:${account.status}:${chainId}`;
  if (identity !== prevIdentity) {
    setPrevIdentity(identity);
    if (postTxActive !== null) setPostTxActive(null);
  }

  const isActiveVerifier =
    postTxActive === true ||
    (postTxActive == null &&
      (fact.kind === "active" || onChainActive === true));
  const showValueProps = !isActiveVerifier;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-16 md:px-8 xl:max-w-[80rem]">
      <KarProClient onVerifierStatusChange={setPostTxActive} />
      {showValueProps && (
        <div className="mx-auto mt-16 max-w-3xl grid grid-cols-1 sm:grid-cols-3 gap-px bg-border-default">
          {VALUE_PROPS.map((prop) => (
            <div
              key={prop.label}
              className="flex flex-col gap-2 py-6 md:py-10 px-6 bg-bg-surface text-center sm:text-left"
            >
              <p className="font-mono text-2xl md:text-4xl font-normal tabular-nums tracking-tight text-text-primary">
                {"stakeStat" in prop ? (
                  chainId == null ||
                  (isSurfaceAdmissionAvailable(minStakeAdmission) &&
                    (unit == null || minStakePending || stakeLabel == null)) ? (
                    <span
                      className="inline-block h-4 w-16 animate-pulse rounded-sm bg-bg-surface align-baseline"
                      aria-hidden
                    />
                  ) : (
                    stakeLabel
                  )
                ) : (
                  prop.value
                )}
              </p>
              <p className="font-sans text-sm font-normal text-text-secondary">
                {prop.label}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
