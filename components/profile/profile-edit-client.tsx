"use client";

import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useReadContract, useWalletClient } from "wagmi";

import { IdentityHeader } from "@/components/identity/identity-header";
import { MessagingSettingsSection } from "@/components/profile/messaging-settings-section";
import { LightningWalletSection } from "@/components/profile/lightning-wallet-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { categoryLabel, sansLink } from "@/lib/design/instrument-classes";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  buildProfileEditPatch,
  type ProfileEditFieldKey,
} from "@/lib/nostr/build-profile-edit-patch";
import { publishNostrProfile } from "@/lib/nostr/profile";
import { LightningAddressField, isLightningAddressInvalid } from "@/components/profile/lightning-address-field";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

const ABOUT_MAX = 280;

type SaveStatus = "idle" | "success" | "error";

function SectionEyebrow({ children }: { children: string }) {
  return (
    <p className={categoryLabel}>{children}</p>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="text-sm text-text-primary">{value}</dd>
    </div>
  );
}

export function ProfileEditClient() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const touchedRef = useRef<Set<ProfileEditFieldKey>>(new Set());
  const [dirty, setDirty] = useState(false);

  const [picture, setPicture] = useState("");
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [website, setWebsite] = useState("");
  const [lud16, setLud16] = useState("");
  const [lud16Touched, setLud16Touched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const { profile, loading, refetch } = useNostrProfile(address);

  const staking = karProStakingAddress(DEFAULT_CHAIN_ID);
  const verifierStatusEnabled = Boolean(staking && address);

  const { data: isActiveVerifier, isPending: verifierReadPending } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    query: { enabled: verifierStatusEnabled },
  });

  const { profile: verifierProfile } = useKarProVerifierProfile(address, {
    isActiveVerifier: isActiveVerifier === true,
    syncWhileMissing: true,
  });
  const { stakeLabel } = useMinStakeNative();

  useEffect(() => {
    if (!profile) return;
    if (!touchedRef.current.has("picture")) setPicture(profile.picture ?? "");
    if (!touchedRef.current.has("name")) setName(profile.name ?? "");
    if (!touchedRef.current.has("about")) setAbout(profile.about ?? "");
    if (!touchedRef.current.has("website")) setWebsite(profile.website ?? "");
    if (!touchedRef.current.has("lud16")) setLud16(profile.lud16 ?? "");
  }, [profile]);

  useEffect(() => {
    if (saveStatus === "idle") return;
    const delay = saveStatus === "success" ? 3000 : 4000;
    const timer = window.setTimeout(() => setSaveStatus("idle"), delay);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  const markTouched = useCallback((key: ProfileEditFieldKey) => {
    touchedRef.current.add(key);
    setDirty(true);
  }, []);

  const verifierStatusPending = verifierStatusEnabled && verifierReadPending;
  const verifierActive = isActiveVerifier === true;
  const verifierResolvedNonVerifier = !verifierStatusPending && !verifierActive;
  const lud16Invalid = verifierResolvedNonVerifier && isLightningAddressInvalid(lud16);

  const onSave = useCallback(async () => {
    if (!walletClient || !address || saving) return;
    if (lud16Invalid) {
      setLud16Touched(true);
      return;
    }
    setSaving(true);
    setSaveStatus("idle");
    try {
      const patch = buildProfileEditPatch(
        touchedRef.current,
        { name, about, picture, website, lud16 },
        verifierResolvedNonVerifier,
      );
      const ok = await publishNostrProfile(
        patch,
        address,
        {
          signMessage: (msg) => walletClient.signMessage({ message: msg }),
        },
        { expectExisting: profile != null },
      );
      if (ok) {
        setSaveStatus("success");
        void refetch();
      } else {
        setSaveStatus("error");
      }
    } finally {
      setSaving(false);
    }
  }, [walletClient, address, saving, name, about, picture, website, lud16, lud16Invalid, verifierResolvedNonVerifier, refetch]);

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center md:px-8">
        <p className="font-sans text-sm text-text-secondary">
          Connect your wallet to edit your profile
        </p>
        <div className="mt-4 flex justify-center">
          <WalletLoginButton />
        </div>
      </div>
    );
  }

  if (!address) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 px-6 py-24 text-text-primary md:px-8">
      <IdentityHeader
        wallet={address}
        karProName={verifierProfile?.name}
        karProCategory={verifierProfile?.category}
        isActiveVerifier={isActiveVerifier === true}
        proSlug={verifierProfile?.slug}
        showEditButton={false}
      />

      <div className="flex flex-col gap-8">
        {/* Section 1 — Personal profile */}
        <section className="flex flex-col gap-4">
          <SectionEyebrow>Personal profile</SectionEyebrow>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="avatar-url">Avatar</Label>
            <Input
              id="avatar-url"
              type="text"
              value={picture}
              placeholder="https:// or ar:// image URL"
              className="text-sm"
              onChange={(e) => {
                markTouched("picture");
                setPicture(e.target.value);
              }}
            />
            <p className="text-sm text-text-secondary">
              Paste any public image URL. Shown across Kargain.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              type="text"
              value={name}
              maxLength={64}
              placeholder="Your name"
              className="text-sm"
              onChange={(e) => {
                markTouched("name");
                setName(e.target.value);
              }}
            />
            <p className="text-sm text-text-secondary">Shown when no ENS name is set.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="about">About</Label>
            <Textarea
              id="about"
              rows={3}
              value={about}
              maxLength={ABOUT_MAX}
              placeholder="A short bio"
              className="min-h-[7.5rem] text-sm"
              onChange={(e) => {
                markTouched("about");
                setAbout(e.target.value);
              }}
            />
            <p className="text-right text-xs text-text-secondary">
              {about.length}/{ABOUT_MAX}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              type="url"
              value={website}
              maxLength={200}
              placeholder="https://"
              className="text-sm"
              onChange={(e) => {
                markTouched("website");
                setWebsite(e.target.value);
              }}
            />
          </div>

          {verifierActive ? (
            <div className="flex flex-col gap-1.5">
              <Label>Lightning address</Label>
              <p className="font-mono text-sm text-text-secondary">
                {profile?.lud16?.trim() || "—"}
              </p>
              <p className="font-sans text-sm text-text-secondary">
                <Link href="/kar-pro?section=payments" className={sansLink}>
                  Managed in KarPro settings
                </Link>
              </p>
            </div>
          ) : (
            <LightningAddressField
              id="lightning-address"
              value={lud16}
              touched={lud16Touched}
              disabled={saving || verifierStatusPending}
              helperText="Optional. Lets others pay you over Lightning, e.g. your verification fee. Format: name@domain."
              onChange={(value) => {
                markTouched("lud16");
                setLud16Touched(true);
                setLud16(value);
              }}
              onBlur={() => setLud16Touched(true)}
            />
          )}

          <div className="flex flex-col gap-3">
            <Button
              type="button"
              variant="primary"
              size="md"
              className="w-full md:w-auto"
              disabled={saving || lud16Invalid || loading || verifierStatusPending || !dirty}
              aria-busy={saving}
              onClick={() => void onSave()}
            >
              {saving ? "Saving…" : "Save profile"}
            </Button>

            {saveStatus !== "idle" && (
              <p
                role="status"
                aria-live="polite"
                className={`inline-flex items-center gap-2 text-sm ${
                  saveStatus === "success" ? "text-text-primary" : "text-status-error"
                }`}
              >
                {saveStatus === "success" && (
                  <>
                    <CheckCheck size={16} strokeWidth={1.5} aria-hidden />
                    Profile saved
                  </>
                )}
                {saveStatus === "error" && "Could not save — try again"}
              </p>
            )}
          </div>
        </section>

        <MessagingSettingsSection />

        <LightningWalletSection />

        {/* Section 2 — Professional profile or Become KarPro */}
        {isActiveVerifier === true ? (
          <section className="flex flex-col gap-4">
            <SectionEyebrow>Professional profile</SectionEyebrow>
            <dl className="flex flex-col gap-3">
              <ReadOnlyField label="Name" value={verifierProfile?.name?.trim() || "—"} />
              <ReadOnlyField
                label="Category"
                value={categoryIndexToLabel(verifierProfile?.category ?? 5)}
              />
              <ReadOnlyField
                label="Slug"
                value={verifierProfile?.slug?.trim() || "Not set"}
              />
            </dl>
            <Button variant="secondary" size="sm" className="w-fit" asChild>
              <Link href="/kar-pro">
                Manage on KarPro →
              </Link>
            </Button>
          </section>
        ) : (
          <section className="flex flex-col gap-4">
            <SectionEyebrow>Become a KarPro verifier</SectionEyebrow>
            <p className="text-sm text-text-secondary">
              Stake {stakeLabel} ETH to become a verified professional on Kargain. Earn trust, verify
              passports, and get a professional showroom.
            </p>
            <Button variant="secondary" size="sm" className="w-fit" asChild>
              <Link href="/kar-pro">Learn more</Link>
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
