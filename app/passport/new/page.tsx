import type { Metadata } from "next";

import { CreatePassportWizard } from "@/components/passport/create-passport-wizard";

export const metadata: Metadata = {
  title: "Create passport · Kargain",
  description: "Mint a KarPassport NFT with vehicle details and photos on Base Sepolia.",
};

export default function NewPassportPage() {
  return (
    <div className="min-h-dvh bg-bg-primary">
      <CreatePassportWizard />
    </div>
  );
}
