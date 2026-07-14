"use client";

import { useEffect, useState } from "react";

/** Tab visibility for poll gating (blueprint §5). */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  useEffect(() => {
    const onChange = () => {
      setVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}
