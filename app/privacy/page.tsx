export default function PrivacyPage() {
  return (
    <>
      <section className="border-b border-border-default">
        <div className="mx-auto w-full max-w-7xl px-6 py-16 md:px-8 xl:max-w-[80rem]">
          <header className="max-w-3xl">
            <p className="mb-4 font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm">
              Your data
            </p>
            <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
              Privacy
            </h1>
            <p className="mt-4 font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary">
              Kargain does not collect or store personal data. Here is exactly what goes
              where.
            </p>
            <p className="mt-2 font-mono text-xs text-text-tertiary">Last updated: June 2026</p>
          </header>
        </div>
      </section>

      <div className="mx-auto w-full max-w-2xl space-y-12 px-6 py-16 md:px-8">
        <section id="what-we-do-not-collect">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            What we do not collect
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Kargain collects no email addresses, no names, no phone numbers, no government
            identification, and no payment card data. There is no account registration.
            There is no advertising. There are no third-party analytics trackers on this
            interface.
          </p>
        </section>

        <section id="public-infrastructure">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            What lives on public infrastructure
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            On-chain: wallet addresses, transaction history, passport status, and
            verification records. This data is public by design — it is the foundation of
            the trust model.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            Arweave: vehicle photos and passport metadata uploaded by users. This data is
            permanent and public. It cannot be deleted by Kargain or anyone else.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            Nostr relays: comments, watchlist favorites, and notification read-state.
            Stored on decentralized relays using your wallet-derived Nostr key. Kargain
            does not operate these relays.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            XMTP: encrypted messages between buyers and sellers. End-to-end encrypted.
            Kargain cannot read your messages.
          </p>
        </section>

        <section id="what-the-interface-stores">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            What the interface stores
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            One session cookie is set when you sign in with your wallet (SIWE). It expires
            when you disconnect. No tracking cookies. No persistent login. No cross-site
            data sharing.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            The Ponder indexer reads and indexes public blockchain events only. It stores
            no personal data beyond what is already public on-chain.
          </p>
        </section>

        <section id="your-control">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            Your control
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Disconnect your wallet to end your session immediately. Your Nostr keys are
            derived deterministically from your wallet signature — you control them. You
            can switch wallets at any time. Arweave uploads are permanent by design —
            consider this before uploading.
          </p>
        </section>

        <section id="third-party-infrastructure">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            Third-party infrastructure
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Kargain relies on the following independent open protocols:
          </p>
          <ul className="mt-2 list-none space-y-1 pl-0">
            <li className="font-sans text-base font-normal leading-[1.6] text-text-primary">
              — Base, Ethereum, and other EVM chains — blockchain infrastructure
            </li>
            <li className="font-sans text-base font-normal leading-[1.6] text-text-primary">
              — Arweave / Irys — permanent decentralized storage
            </li>
            <li className="font-sans text-base font-normal leading-[1.6] text-text-primary">
              — Nostr — decentralized social protocol
            </li>
            <li className="font-sans text-base font-normal leading-[1.6] text-text-primary">
              — XMTP — end-to-end encrypted messaging
            </li>
          </ul>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            Kargain does not control these protocols and is not responsible for their
            availability or data practices.
          </p>
        </section>
      </div>
    </>
  );
}
