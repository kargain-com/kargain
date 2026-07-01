"use client";

import { useEffect, useState } from "react";

import {
  formatReturnCountdown,
  returnRemainingSeconds,
} from "@/lib/marketplace/return-cooldown";

export function useReturnRemainingSeconds(returnRequestedAt: bigint): bigint {
  const [nowSec, setNowSec] = useState(() =>
    BigInt(Math.floor(Date.now() / 1000)),
  );

  useEffect(() => {
    if (returnRequestedAt <= 0n) return;
    const tick = () => setNowSec(BigInt(Math.floor(Date.now() / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [returnRequestedAt]);

  if (returnRequestedAt <= 0n) return 0n;
  return returnRemainingSeconds(returnRequestedAt, nowSec);
}

type Props = {
  returnRequestedAt: bigint;
};

export function ReturnCooldownDisplay({ returnRequestedAt }: Props) {
  const remaining = useReturnRemainingSeconds(returnRequestedAt);
  const elapsed = remaining <= 0n;

  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        elapsed
          ? "border-accent-warm/50 bg-bg-primary/80"
          : "border-border-default bg-bg-primary/80"
      }`}
    >
      {elapsed ? (
        <p className="text-accent-warm">Force return is now available</p>
      ) : (
        <p className="text-text-primary">
          Force return available in{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {formatReturnCountdown(remaining)}
          </span>
        </p>
      )}
    </div>
  );
}
