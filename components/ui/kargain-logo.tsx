import { cn } from "@/lib/utils";

export function KargainLogo({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label="Kargain"
      className={cn("inline-block shrink-0 bg-current text-text-primary", className)}
      style={{
        width: size,
        height: size,
        maskImage: "url(/kargain-logo.svg)",
        WebkitMaskImage: "url(/kargain-logo.svg)",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
