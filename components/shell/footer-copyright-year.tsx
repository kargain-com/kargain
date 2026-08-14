"use client";

/** Client island — `new Date()` is invalid in prerendered Server Components. */
export function FooterCopyrightYear() {
  return <>{new Date().getFullYear()}</>;
}
