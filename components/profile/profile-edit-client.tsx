"use client";

import { useState } from "react";
import { useAccount, useConnect, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KarProClient } from "@/components/kar-pro/kar-pro-client";
import { KarProPassAbi } from "@/lib/contracts/abis.generated";
import { karProPassAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export function ProfileEditClient() {
  const { address } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { writeContractAsync, isPending: isSaving } = useWriteContract();
  const [message, setMessage] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [twitter, setTwitter] = useState("");
  const [website, setWebsite] = useState("");
  const [discord, setDiscord] = useState("");

  if (!address) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-text-secondary">Connect a wallet to edit your profile.</p>
        <div className="mt-4 flex flex-col gap-2">
          {connectors.map((connector: (typeof connectors)[number]) => (
            <Button
              key={connector.uid}
              type="button"
              variant="default"
              disabled={isPending}
              onClick={() => connect({ connector })}
            >
              {isPending ? "Connecting..." : `Connect ${connector.name}`}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8 text-text-primary">
      <h1 className="text-2xl font-medium">Edit profile</h1>
      <p className="text-xs text-text-secondary">
        Avatar uploads use authenticated storage. Username should be 3-32 chars using letters, numbers, and underscores.
      </p>

      <div className="space-y-2">
        <Label>Avatar</Label>
        <Input
          type="file"
          accept="image/*"
          className="cursor-pointer border-border-hover"
          onChange={() => {
            // TODO Phase 1.1: removed — pending @irys/web-upload
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="border-border-hover"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dn">Display name</Label>
        <Input
          id="dn"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="border-border-hover"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className="border-border-hover"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="loc">Location</Label>
        <Input
          id="loc"
          value={locationLabel}
          onChange={(e) => setLocationLabel(e.target.value)}
          className="border-border-hover"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tw">Twitter / X</Label>
        <Input
          id="tw"
          value={twitter}
          onChange={(e) => setTwitter(e.target.value)}
          className="border-border-hover"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="web">Website</Label>
        <Input
          id="web"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="border-border-hover"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dc">Discord</Label>
        <Input
          id="dc"
          value={discord}
          onChange={(e) => setDiscord(e.target.value)}
          className="border-border-hover"
        />
      </div>

      <section className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-primary">Kar pro membership</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Manage your Kar Pro status from profile settings.
          </p>
        </div>
        <KarProClient embedded />
      </section>

      <Button
        type="button"
        disabled={isSaving || !displayName.trim()}
        onClick={() => {
          void (async () => {
            const karPro = karProPassAddress(DEFAULT_CHAIN_ID);
            if (!karPro || !address) {
              setMessage("Kar Pro pass required to persist profile on-chain.");
              return;
            }
            try {
              await writeContractAsync({
                address: karPro,
                abi: KarProPassAbi,
                functionName: "updateProfile",
                args: [5, displayName.trim(), ""],
              });
              setMessage("Profile updated on-chain.");
            } catch (err) {
              setMessage(err instanceof Error ? err.message : "Save failed.");
            }
          })();
        }}
      >
        Save profile
      </Button>
      <p className="text-sm text-text-secondary">
        {message ??
          "On-chain profile save requires a Kar Pro pass. Local fields are not persisted otherwise."}
      </p>
    </div>
  );
}
