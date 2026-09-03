/**
 * Injected wallet provider on `window` (MetaMask / WalletConnect bridges).
 * App typecheck root (`types/**`); node tooling uses `test/ambient-ethereum-window.d.ts`.
 */
interface Window {
  ethereum?: {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    on?(event: string, handler: (...args: unknown[]) => void): void;
    removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  };
}
