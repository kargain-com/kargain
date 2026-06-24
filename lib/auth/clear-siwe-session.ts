/** Clear the httpOnly SIWE session cookie via the logout API. */
export async function clearSiweSession(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // Best-effort; wagmi disconnect still runs client-side.
  }
}
