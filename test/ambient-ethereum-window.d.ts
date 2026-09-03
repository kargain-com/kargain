/**
 * Injected wallet provider on `window` (MetaMask / WalletConnect bridges).
 * Node typecheck root only — product ambient stays via app tsconfig `types/`.
 */
interface Window {
  ethereum?: {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    on?(event: string, handler: (...args: unknown[]) => void): void;
    removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  };
}
