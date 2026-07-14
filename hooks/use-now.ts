"use client";

import { useEffect, useState } from "react";

/** Single page-level wall-clock ticker (unix seconds). One interval per mount. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
