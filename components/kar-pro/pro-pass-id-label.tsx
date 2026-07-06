import {
  formatKarProPassTitle,
  formatProPassShortLabel,
  formatProPassTitle,
  parseProPassTokenId,
  proPassTokenIdFromAddress,
} from "@/lib/kar-pro/pro-pass-token-id";
import { serialLabel } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

type Props = {
  tokenId?: string | bigint;
  address?: `0x${string}`;
  chainId?: number;
  prefix?: "pass" | "karProPass" | "none";
  variant?: "default" | "eyebrow" | "mono";
  showChain?: boolean;
  title?: boolean;
  className?: string;
};

function resolveTokenId(tokenId: string | bigint | undefined, address: `0x${string}` | undefined): string {
  if (tokenId != null) {
    return typeof tokenId === "bigint" ? tokenId.toString() : tokenId;
  }
  if (address) {
    return proPassTokenIdFromAddress(address).toString();
  }
  throw new Error("ProPassIdLabel requires tokenId or address");
}

function labelText(
  resolvedTokenId: string,
  chainId: number | undefined,
  prefix: NonNullable<Props["prefix"]>,
  showChain: boolean,
): string {
  const options = { showChain };
  if (prefix === "none") {
    return formatProPassShortLabel(resolvedTokenId, chainId, options);
  }
  if (prefix === "karProPass") {
    return formatKarProPassTitle(resolvedTokenId, chainId, options);
  }
  return formatProPassTitle(resolvedTokenId, chainId, options);
}

const variantClass: Record<NonNullable<Props["variant"]>, string> = {
  default: "font-sans text-sm text-text-secondary",
  eyebrow: serialLabel,
  mono: "font-mono text-[10px] text-text-secondary",
};

export function ProPassIdLabel({
  tokenId,
  address,
  chainId,
  prefix = "pass",
  variant = "default",
  showChain = true,
  title: showTitle = true,
  className,
}: Props) {
  const resolvedTokenId = resolveTokenId(tokenId, address);
  const text = labelText(resolvedTokenId, chainId, prefix, showChain);
  const fullId = parseProPassTokenId(resolvedTokenId).full;

  return (
    <span className={cn(variantClass[variant], className)} title={showTitle ? fullId : undefined}>
      {text}
    </span>
  );
}
