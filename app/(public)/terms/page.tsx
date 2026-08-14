export default function TermsPage() {
  return (
    <>
      <section className="border-b border-border-default">
        <div className="mx-auto w-full max-w-7xl px-6 py-16 md:px-8 xl:max-w-[80rem]">
          <header className="max-w-3xl">
            <p className="mb-4 font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm">
              Legal
            </p>
            <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
              Terms of use
            </h1>
            <p className="mt-4 font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary">
              Kargain is a protocol, not a service. Read this carefully before using the
              platform.
            </p>
            <p className="mt-2 font-mono text-xs text-text-tertiary">Last updated: June 2026</p>
          </header>
        </div>
      </section>

      <div className="mx-auto w-full max-w-2xl space-y-12 px-6 py-16 md:px-8">
        <section id="nature-of-the-platform">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            Nature of the platform
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            Kargain is an open-source protocol and web interface. There is no central
            operator. Smart contracts execute autonomously on-chain — no company can
            intervene, reverse, or modify transactions once submitted.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            The MIT License governs the software. Using this interface does not create a
            contract with any legal entity.
          </p>
        </section>

        <section id="no-warranty">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            No warranty
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            The protocol and interface are provided as-is under the MIT License, without
            warranty of any kind. Use at your own risk. Blockchain transactions are
            irreversible. Verify all information independently before any transaction.
          </p>
        </section>

        <section id="your-responsibilities">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            Your responsibilities
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            You are solely responsible for the security of your wallet and private keys.
            Loss of your private key means permanent loss of access — no recovery is
            possible.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            You are responsible for conducting due diligence before purchasing any vehicle.
            KarPassport data is user-provided. Kargain does not verify the accuracy of
            vehicle descriptions, mileage, or condition.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            You must comply with all applicable local laws regarding vehicle purchases,
            import, and ownership transfer in your jurisdiction.
          </p>
        </section>

        <section id="verifier-responsibilities">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            Verifier responsibilities
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            KarPro verifiers stake ETH as a trust signal and attestation fee. Verification
            is a professional attestation — not a warranty, guarantee, or legal
            certification. Staked ETH is not a compensation fund for buyers.
          </p>
          <p className="mt-4 font-sans text-base font-normal leading-[1.6] text-text-primary">
            Verifiers are independent actors. Kargain does not employ, certify, or supervise
            verifiers.
          </p>
        </section>

        <section id="prohibited-conduct">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            Prohibited conduct
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            The following uses are prohibited:
          </p>
          <ul className="mt-2 list-none space-y-1 pl-0">
            <li className="font-sans text-base font-normal leading-[1.6] text-text-primary">
              — Submitting fraudulent or misleading passport data
            </li>
            <li className="font-sans text-base font-normal leading-[1.6] text-text-primary">
              — Manipulating the dispute system in bad faith
            </li>
            <li className="font-sans text-base font-normal leading-[1.6] text-text-primary">
              — Facilitating transactions involving stolen vehicles
            </li>
            <li className="font-sans text-base font-normal leading-[1.6] text-text-primary">
              — Any use that violates applicable law in your jurisdiction
            </li>
          </ul>
        </section>

        <section id="no-liability">
          <h2 className="mb-4 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
            No liability
          </h2>
          <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
            To the maximum extent permitted by applicable law, no contributor to the
            Kargain protocol shall be liable for any direct, indirect, incidental, or
            consequential damages arising from your use of the protocol or interface.
          </p>
        </section>
      </div>
    </>
  );
}
