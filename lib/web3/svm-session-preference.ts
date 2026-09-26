/**
 * Sole SVM session preference owner — last wallet name for silent restore.
 * Never stores addresses; accounts come only from Wallet Standard connect.
 * Injectable store for tests; production uses window.localStorage when present.
 */

export const SVM_LAST_WALLET_STORAGE_KEY = "kargain:svm-last-wallet";

export type SvmSessionPreferenceStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function browserStore(): SvmSessionPreferenceStore | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = window.localStorage;
    if (
      ls == null ||
      typeof ls.getItem !== "function" ||
      typeof ls.setItem !== "function" ||
      typeof ls.removeItem !== "function"
    ) {
      return null;
    }
    return ls;
  } catch {
    return null;
  }
}

/** Last Wallet Standard wallet name the user connected, or null. */
export function readSvmLastWalletName(
  store: SvmSessionPreferenceStore | null = browserStore(),
): string | null {
  if (store == null) return null;
  try {
    const raw = store.getItem(SVM_LAST_WALLET_STORAGE_KEY);
    if (raw == null) return null;
    const name = raw.trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** Persist wallet name after a successful interactive or silent connect. */
export function writeSvmLastWalletName(
  walletName: string,
  store: SvmSessionPreferenceStore | null = browserStore(),
): void {
  const name = walletName.trim();
  if (!name || store == null) return;
  try {
    store.setItem(SVM_LAST_WALLET_STORAGE_KEY, name);
  } catch {
    /* private mode / quota — preference is best-effort */
  }
}

/** Clear preference on user disconnect or EVM mutual-exclusion clear. */
export function clearSvmLastWalletName(
  store: SvmSessionPreferenceStore | null = browserStore(),
): void {
  if (store == null) return;
  try {
    store.removeItem(SVM_LAST_WALLET_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
