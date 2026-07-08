"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { cn } from "@/lib/utils";

type QrCodeProps = {
  value: string;
  size?: number;
  ariaLabel: string;
  className?: string;
};

function QrCodeImage({
  value,
  size,
  ariaLabel,
  className,
}: {
  value: string;
  size: number;
  ariaLabel: string;
  className?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className={cn("bg-white rounded-lg w-fit", className)}
        style={{ width: size + 24, height: size + 24 }}
        aria-hidden
      />
    );
  }

  return (
    <div className={cn("bg-white p-3 rounded-lg w-fit", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dataUrl} width={size} height={size} alt={ariaLabel} />
    </div>
  );
}

export function QrCode({ value, size = 200, ariaLabel, className }: QrCodeProps) {
  return (
    <QrCodeImage
      key={`${value}:${size}`}
      value={value}
      size={size}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}
