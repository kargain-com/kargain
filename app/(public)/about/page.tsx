import { sansLinkUnderline } from "@/lib/design/instrument-classes";

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-border-default">
        <div className="mx-auto w-full max-w-7xl px-6 py-16 md:px-8 xl:max-w-[80rem]">
          <header className="max-w-3xl">
            <p className="mb-4 font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm">
              Open source protocol
            </p>
            <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
              About Kargain
            </h1>
            <p className="mt-4 font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary">
              A decentralized marketplace where vehicle history lives on-chain, trust is
              cryptographic, and ownership is yours.
            </p>
          </header>
        </div>
      </section>

      <div className="mx-auto w-full max-w-2xl space-y-12 px-6 py-16 md:px-8">
        <section id="what-is-kargain">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            What is Kargain
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Kargain is a peer-to-peer marketplace for used vehicles. There is no central
            operator — buyers and sellers transact directly through smart contract escrow.
            Vehicle history is stored permanently as KarPassport NFTs with metadata on
            Arweave. No company holds your funds, your data, or your vehicle records.
          </p>
        </section>

        <section id="how-it-works">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            How it works
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Anyone can mint a KarPassport for a vehicle — permissionless, no approval
            required. The passport travels with the vehicle across ownership transfers,
            accumulating verified history.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            Verified professionals (KarPro) stake ETH to earn the right to inspect and
            verify passports. Disputes are resolved on-chain by active verifiers. Every
            action — verification, dispute, record — is public and permanent.
          </p>
        </section>

        <section id="the-trust-model">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            The trust model
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Trust on Kargain is earned, not assigned. KarPro verifiers post a fully refundable ETH
            stake as a signal of accountability — no institution grants them authority, the community
            does. Verification is an attestation, not a guarantee. Disputes are
            permissionless — anyone can open one. Resolution requires an active verifier.
            The full history of every passport is immutable and publicly auditable.
          </p>
        </section>

        <section id="multi-chain">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            Multi-chain protocol
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Kargain is designed to run across multiple networks. Users choose which chain
            holds their passport. Listings and trust state are chain-scoped, but the
            protocol is not tied to any single network.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            Passport photos and metadata live on Arweave — permanent and chain-agnostic.
            Social features (comments, watchlist, notifications) use Nostr. Messaging uses
            XMTP. These layers work across any supported chain.
          </p>
        </section>

        <section id="open-source">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            Open source
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Kargain is MIT licensed. Smart contracts are publicly verified. Protocol
            standards are governed through KIPs (Kargain Improvement Proposals) in a
            public repository. Anyone can fork, audit, or extend the protocol.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            <a
              href="https://github.com/kargain-com/kargain"
              target="_blank"
              rel="noopener noreferrer"
              className={sansLinkUnderline}
            >
              github.com/kargain-com/kargain
            </a>
            <br />
            <a
              href="https://github.com/kargain-com/kips"
              target="_blank"
              rel="noopener noreferrer"
              className={sansLinkUnderline}
            >
              github.com/kargain-com/kips
            </a>
          </p>
        </section>

        <section id="built-by">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            Built by
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Kargain was started in 2018 by automotive brokers and enthusiasts. The original
            concept used a centralized backend and was rejected. It took years to find the
            right combination of decentralized infrastructure to make the vision work. In
            2026, that combination became possible: on-chain passports, permanent storage,
            decentralized identity, and permissionless trust. The builders became the first
            verified professionals on the network.
          </p>
        </section>
      </div>
    </>
  );
}
