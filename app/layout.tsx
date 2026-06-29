import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Inter } from "next/font/google";

import { AppProviders } from "@/components/providers/app-providers";
import { SiteChrome } from "@/components/shell/site-chrome";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Kargain",
    template: "%s — Kargain",
  },
  description:
    "Decentralized peer-to-peer marketplace for used vehicles. "
    + "Vehicle history as an NFT passport. Community-driven verification.",
  icons: {
    icon: [{ url: "/kargain-logo.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Kargain",
    description: "Decentralized used-car marketplace on Base Sepolia.",
    siteName: "Kargain",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kargain",
    description: "Decentralized used-car marketplace on Base Sepolia.",
    images: ["/opengraph-image"],
  },
  other: {
    "base:app_id": "6a429f434c9267afe64e904c",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh font-sans">
        <AppProviders>
          <SiteChrome>{children}</SiteChrome>
        </AppProviders>
      </body>
    </html>
  );
}
