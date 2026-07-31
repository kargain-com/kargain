/**
 * Available, or blocked with a named cause mirroring an entry-point guard.
 * Same shape as settlement action gates — one vocabulary for offered vs refused.
 */
export type ActionGate<C extends string> =
  | { readonly status: "available" }
  | { readonly status: "blocked"; readonly cause: C };

export const AVAILABLE = { status: "available" } as const;

export function blocked<C extends string>(cause: C): ActionGate<C> {
  return { status: "blocked", cause };
}

export function isAvailable<C extends string>(gate: ActionGate<C>): boolean {
  return gate.status === "available";
}
