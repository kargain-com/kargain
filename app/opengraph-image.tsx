import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Kargain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logoPath = path.join(process.cwd(), "public", "kargain-logo-white.png");
  const logoBuffer = await readFile(logoPath);
  const logoSrc = `data:image/png;base64,${logoBuffer.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: "#0a0a0b",
          paddingTop: 192,
        }}
      >
        <img src={logoSrc} width={120} height={120} alt="" />
        <div
          style={{
            marginTop: 32,
            fontSize: 48,
            fontWeight: 500,
            color: "#f4f4f5",
            letterSpacing: "-0.02em",
          }}
        >
          Kargain
        </div>
        <div style={{ marginTop: 12, fontSize: 18, color: "#a1a1aa" }}>
          Decentralized vehicle marketplace
        </div>
      </div>
    ),
    { ...size },
  );
}
