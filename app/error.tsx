"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg-primary px-4 text-center text-text-primary">
      <h1 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15]">Something went wrong</h1>
      <p className="max-w-md text-sm text-text-secondary">
        {error.message || "An unexpected error occurred. You can retry or return home."}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}
