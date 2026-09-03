"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  LogOutIcon,
  UserIcon,
  WalletIcon,
} from "@/components/ui/icons";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useConfig } from "wagmi";
import type { Connector } from "wagmi";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  commercialNamespaceOf,
  requireEvmSession,
  wrongVmActionCopy,
  useActiveAccount,
} from "@/hooks/use-active-account";
import { useClientMounted } from "@/hooks/use-client-mounted";
import { useEnsProfile } from "@/hooks/use-ens-profile";
import { endWalletSession } from "@/lib/auth/end-wallet-session";
import { shellControlHover } from "@/lib/design/instrument-classes";
import { commercialActive } from "@/lib/web3/commercial-active";
import { explorerAddressUrl } from "@/lib/web3/network-explorer";
import {
  hasInjectedEthereumProvider,
  isMobileBrowser,
  walletConnectProjectId,
} from "@/lib/web3/wallet-connect";
import { ensureWalletConnectConnector } from "@/lib/web3/wagmi-config";
import { ensureSvmWalletDiscovery } from "@/lib/web3/svm-wallet-discovery";
import { identiconBackground, navShortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

function isEvmOptionVisible(connector: Connector): boolean {
  if (connector.id === "injected") return hasInjectedEthereumProvider();
  if (connector.id === "walletConnect") return Boolean(walletConnectProjectId());
  return true;
}

function WalletIdenticon({ address, className }: { address: string; className?: string }) {
  return (
    <span
      className={cn("shrink-0 rounded-full", className)}
      style={{ backgroundColor: identiconBackground(address) }}
      aria-hidden
    />
  );
}

export function WalletLoginButton() {
  const mounted = useClientMounted();
  const [connectOpen, setConnectOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const config = useConfig();
  const {
    account,
    address,
    isConnected,
    disconnect,
    connect,
    connectOptions,
    isConnectPending,
    connectError,
  } = useActiveAccount();

  const openConnect = useCallback(() => {
    setConnectOpen(true);
    void ensureWalletConnectConnector(config);
    ensureSvmWalletDiscovery();
  }, [config]);

  const visibleOptions = useMemo(
    () =>
      connectOptions.filter((opt) => {
        if (opt.family === "evm") return isEvmOptionVisible(opt.connector);
        return true;
      }),
    [connectOptions],
  );
  const showMobileHint = isMobileBrowser() && !hasInjectedEthereumProvider();

  const evm = requireEvmSession(account);
  const ensAddress = evm.ok ? evm.address : undefined;
  const { displayName, isLoading: ensLoading } = useEnsProfile(ensAddress);

  const onCopyAddress = useCallback(async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  if (!mounted) {
    return <div className="h-9 w-28 rounded-sm border border-border-default" aria-hidden />;
  }

  if (isConnected && address) {
    const normalized = address;
    const hasEnsName = Boolean(
      evm.ok && !ensLoading && displayName && !displayName.startsWith("0x"),
    );

    const ns = commercialNamespaceOf(account);
    const stack =
      ns.ok ? commercialActive(Number(ns.namespace)) : undefined;
    const explorerUrl =
      stack != null ? explorerAddressUrl(stack, normalized) : null;

    const profileHref = evm.ok ? `/profile/${evm.address}` : null;

    return (
      <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-sm border border-border-default bg-bg-surface py-1.5 pl-2 pr-3 font-mono text-xs text-text-primary transition-colors duration-200 hover:border-border-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            aria-label="Wallet account menu"
          >
            <WalletIdenticon address={normalized} className="size-5" />
            <span className="truncate">{navShortAddress(normalized)}</span>
            <ChevronDownIcon size={14} className="shrink-0 text-text-secondary" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px] max-w-[calc(100vw-2rem)] p-1">
          <DropdownMenuLabel className="px-3 py-2.5 font-normal">
            <div className="flex items-center gap-2.5">
              <WalletIdenticon address={normalized} className="size-8" />
              <div className="min-w-0">
                <p
                  className="truncate font-sans text-sm font-medium text-text-primary"
                  title={normalized}
                >
                  {ensAddress && !ensLoading ? displayName : navShortAddress(normalized)}
                </p>
                {hasEnsName && (
                  <p className="truncate font-mono text-xs text-text-secondary">
                    {navShortAddress(normalized)}
                  </p>
                )}
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {profileHref != null ? (
            <>
              <DropdownMenuItem asChild className="hidden font-sans text-sm text-text-secondary md:flex">
                <Link href={profileHref}>
                  <UserIcon size={16} aria-hidden />
                  My profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="hidden md:block" />
            </>
          ) : null}
          {explorerUrl != null ? (
            <DropdownMenuItem asChild className="font-sans text-sm text-text-secondary">
              <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon size={14} aria-hidden />
                View on explorer
              </a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="font-sans text-sm text-text-secondary"
            onSelect={() => void onCopyAddress(normalized)}
          >
            <CopyIcon size={14} aria-hidden />
            {copied ? "Copied!" : "Copy address"}
          </DropdownMenuItem>
          {!evm.ok ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="font-sans text-sm text-text-secondary"
                onSelect={() => openConnect()}
              >
                <WalletIcon size={14} aria-hidden />
                {wrongVmActionCopy("evm")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="font-sans text-sm text-red-400 focus:bg-red-400/10 focus:text-red-400"
            onSelect={() => void endWalletSession(() => void disconnect())}
          >
            <LogOutIcon size={14} aria-hidden />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConnectWalletDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        config={config}
        visibleOptions={visibleOptions}
        showMobileHint={showMobileHint}
        isConnectPending={isConnectPending}
        pendingKey={pendingKey}
        setPendingKey={setPendingKey}
        connect={connect}
        connectError={connectError}
        setConnectOpen={setConnectOpen}
      />
    </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={openConnect}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-sm border border-border-hover bg-transparent px-4 font-sans text-sm font-medium text-text-primary transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          shellControlHover,
        )}
      >
        <WalletIcon size={16} aria-hidden />
        Connect wallet
      </button>

      <ConnectWalletDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        config={config}
        visibleOptions={visibleOptions}
        showMobileHint={showMobileHint}
        isConnectPending={isConnectPending}
        pendingKey={pendingKey}
        setPendingKey={setPendingKey}
        connect={connect}
        connectError={connectError}
        setConnectOpen={setConnectOpen}
      />
    </>
  );
}

function ConnectWalletDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ReturnType<typeof useConfig>;
  visibleOptions: ReturnType<typeof useActiveAccount>["connectOptions"];
  showMobileHint: boolean;
  isConnectPending: boolean;
  pendingKey: string | null;
  setPendingKey: (key: string | null) => void;
  connect: ReturnType<typeof useActiveAccount>["connect"];
  connectError: Error | null;
  setConnectOpen: (open: boolean) => void;
}) {
  const {
    open,
    onOpenChange,
    config,
    visibleOptions,
    showMobileHint,
    isConnectPending,
    pendingKey,
    setPendingKey,
    connect,
    connectError,
    setConnectOpen,
  } = props;
  return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (next) {
            void ensureWalletConnectConnector(config);
            ensureSvmWalletDiscovery();
          }
        }}
      >
        <DialogContent showClose className="max-w-sm rounded-lg border-border-default bg-bg-card p-6">
          <DialogHeader className="space-y-1 pr-8">
            <DialogTitle className="font-display text-xl font-medium tracking-[-0.02em] text-text-primary">
              Connect wallet
            </DialogTitle>
            <DialogDescription className="mb-6 font-sans text-sm text-text-secondary">
              Choose an Ethereum or Solana wallet to create passports and use the marketplace.
            </DialogDescription>
          </DialogHeader>

          {showMobileHint && (
            <p className="mb-4 font-sans text-sm text-text-secondary">
              No in-browser wallet detected. Tap{" "}
              <span className="font-medium text-text-primary">WalletConnect</span> to open your
              wallet app, or open kargain.com in MetaMask or Coinbase Wallet.
            </p>
          )}

          {visibleOptions.length === 0 ? (
            <p className="font-sans text-sm text-text-secondary">
              Wallet connection is not available in this browser. Open kargain.com in your wallet
              app&apos;s browser, or ask the site operator to enable WalletConnect.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visibleOptions.map((opt) => (
                <li key={opt.key}>
                  <button
                    type="button"
                    disabled={isConnectPending}
                    onClick={() => {
                      setPendingKey(opt.key);
                      const target =
                        opt.family === "evm"
                          ? ({ family: "evm" as const, connector: opt.connector })
                          : ({ family: "svm" as const, walletName: opt.walletName });
                      void connect(target)
                        .then(() => {
                          setPendingKey(null);
                          setConnectOpen(false);
                        })
                        .catch(() => setPendingKey(null));
                    }}
                    className="flex w-full items-center gap-3 rounded-sm border border-border-default bg-bg-surface px-4 py-3 text-left transition-colors duration-200 hover:border-border-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:opacity-50"
                  >
                    <WalletIcon
                      size={32}
                      className="size-8 shrink-0 text-text-secondary"
                      aria-hidden
                    />
                    <span className="flex-1 font-sans text-sm font-medium text-text-primary">
                      {isConnectPending && pendingKey === opt.key
                        ? `Connecting ${opt.label}…`
                        : opt.label}
                    </span>
                    <ChevronRightIcon
                      size={16}
                      className="shrink-0 text-text-secondary"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {connectError && (
            <p className="mt-3 font-sans text-xs text-status-error" role="alert">
              {connectError.message}
            </p>
          )}
        </DialogContent>
      </Dialog>
  );
}
