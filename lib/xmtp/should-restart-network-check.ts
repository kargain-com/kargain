export type NetworkCheckStoreSnapshot = {
  address: string | null;
  networkChecking: boolean;
  networkChecked: boolean;
};

export function shouldRestartNetworkCheck(
  snapshot: NetworkCheckStoreSnapshot,
  key: string,
): boolean {
  if (snapshot.address !== key) return true;
  return !snapshot.networkChecking && !snapshot.networkChecked;
}
