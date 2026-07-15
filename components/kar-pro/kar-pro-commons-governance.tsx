"use client";

import { useQuery } from "@tanstack/react-query";

import { getVerifierDirectory } from "@/app/actions/verifier-directory";
import {
  monoLinkSm,
  monoTimestampTertiary,
  serialLabel,
} from "@/lib/design/instrument-classes";
import { VINCENT_DATASET } from "@/lib/passport/vincent-dataset";
import {
  buildRegistryPanelModel,
  truncateContentId,
  type RegistryPanelModel,
} from "@/lib/vincent-commons/registry-panel";
import { VINCENT_REGISTRY } from "@/lib/vincent-commons/registry-config";
import { fetchRegistryPublishers } from "@/lib/vincent-commons/registry-reads";
import { explorerAddressUrl } from "@/lib/web3/wallet-account";
import { shortAddress } from "@/lib/web3/wallet-display";

const FLYWHEEL_DOC_PATH = "docs/research/vincent-flywheel.md";

async function loadRegistryPanel(): Promise<RegistryPanelModel> {
  const { verifiers } = await getVerifierDirectory();
  const active = verifiers.filter((verifier) => verifier.active);
  if (active.length === 0) {
    // The Commons section is active-verifier gated, so an empty directory
    // means the indexer fetch failed — surface as unreachable, not empty.
    throw new Error("verifier directory unavailable");
  }
  const inputs = await fetchRegistryPublishers(
    active.map((verifier) => verifier.address),
  );
  return buildRegistryPanelModel(inputs);
}

function PanelShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className={serialLabel}>{title}</h3>
      <div className="rounded-md border border-border-default bg-bg-card p-4 md:p-6">
        {children}
      </div>
    </section>
  );
}

function PublishersPanel() {
  const { data, isPending, isError } = useQuery<RegistryPanelModel>({
    queryKey: ["vincent-registry-publishers"],
    queryFn: loadRegistryPanel,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  return (
    <PanelShell title="Publishers">
      {isPending ? (
        <p className={`${monoTimestampTertiary} text-xs`}>Reading registry…</p>
      ) : isError || !data ? (
        <p className={`${monoTimestampTertiary} text-xs`}>Registry unreachable</p>
      ) : data.publishers.length === 0 ? (
        <div className="space-y-2">
          <p className="font-sans text-sm text-text-secondary">
            No community epochs published yet — any active verifier can be first.
          </p>
          <p className={`${monoTimestampTertiary} text-xs`}>
            {FLYWHEEL_DOC_PATH} §9 F-3 — publisher tooling
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <ul className="divide-y divide-border-default">
            {data.publishers.map((publisher) => (
              <li
                key={publisher.address}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
              >
                <a
                  href={explorerAddressUrl(
                    VINCENT_REGISTRY.chainId,
                    publisher.address,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={monoLinkSm}
                  title={publisher.address}
                >
                  {shortAddress(publisher.address)}
                </a>
                <span className="font-mono text-xs tabular-nums text-text-secondary">
                  {publisher.epochCount}{" "}
                  {publisher.epochCount === 1 ? "epoch" : "epochs"}
                </span>
                <span
                  className="font-mono text-xs tabular-nums text-text-secondary"
                  title={publisher.latestRoot}
                >
                  {truncateContentId(publisher.latestRoot)}
                </span>
                <span
                  className={
                    publisher.lineageOk
                      ? "font-mono text-xs text-text-tertiary"
                      : "font-mono text-xs text-status-error"
                  }
                >
                  {publisher.lineageOk ? "lineage ok" : "lineage broken"}
                </span>
              </li>
            ))}
          </ul>
          {data.zeroEpochCount > 0 && (
            <p className={`${monoTimestampTertiary} pt-2 text-xs`}>
              {data.zeroEpochCount} active{" "}
              {data.zeroEpochCount === 1 ? "verifier has" : "verifiers have"} not
              published yet
            </p>
          )}
        </div>
      )}
    </PanelShell>
  );
}

function PinnedDatasetCard() {
  return (
    <PanelShell title="Pinned dataset">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <p className={serialLabel}>Root</p>
            <p
              className="font-mono text-sm tabular-nums text-text-primary"
              title={VINCENT_DATASET.merkleRoot}
            >
              {truncateContentId(VINCENT_DATASET.merkleRoot)}
            </p>
          </div>
          <div>
            <p className={serialLabel}>Publisher</p>
            <p
              className="font-mono text-sm tabular-nums text-text-primary"
              title={VINCENT_DATASET.publisher}
            >
              {truncateContentId(VINCENT_DATASET.publisher)}
            </p>
          </div>
          <div>
            <p className={serialLabel}>Epoch tag</p>
            <p className="font-mono text-sm tabular-nums text-text-primary">
              {VINCENT_DATASET.arweaveEpochTag}
            </p>
          </div>
        </div>
        <p className="font-sans text-xs text-text-secondary">
          The app follows the community acceptance bar (§4.4) starting with the
          client-policy phase; until then it reads this pinned dataset.
        </p>
      </div>
    </PanelShell>
  );
}

function RoleExplainer() {
  return (
    <PanelShell title="How the commons grows">
      <div className="space-y-2 font-sans text-sm text-text-secondary">
        <p>Contributor — verified passports feed the shared claim derivation.</p>
        <p>
          Reviewer (you are here) — accept or reject derived claims and
          document-based proposals in this queue.
        </p>
        <p>
          Publisher — assembles accepted claims into an epoch and anchors it on
          their own registry chain; tooling and rebuilt confirmations arrive with
          the publisher tooling phase.
        </p>
        <p className="text-text-primary">
          Every step is open to any active verifier individually.
        </p>
        <p className={`${monoTimestampTertiary} text-xs`}>{FLYWHEEL_DOC_PATH}</p>
      </div>
    </PanelShell>
  );
}

/** F-2.2 read-only governance readouts below the Commons review queue. */
export function KarProCommonsGovernance() {
  return (
    <div className="space-y-6">
      <PublishersPanel />
      <PinnedDatasetCard />
      <RoleExplainer />
    </div>
  );
}
