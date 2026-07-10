"use client";

import { usePathname } from "next/navigation";

import { CheckIcon } from "@/components/ui/icons";
import { categoryLabel, monoLinkSm } from "@/lib/design/instrument-classes";
import { replaceKarProSectionUrl, type KarProSection } from "@/lib/kar-pro/kar-pro-section-url";
import type { SetupChecklistResult } from "@/lib/kar-pro/setup-checklist";

type KarProSetupChecklistProps = {
  checklist: SetupChecklistResult;
};

type RowConfig = {
  label: string;
  pendingDescription: string;
  pendingAction?: { text: string; section: KarProSection };
  pendingStatusText?: string;
  complete: boolean;
};

function ChecklistRow({ label, pendingDescription, pendingAction, pendingStatusText, complete }: RowConfig) {
  const pathname = usePathname();

  const goToSection = (section: KarProSection) => {
    replaceKarProSectionUrl(pathname, window.location.search, section);
  };

  return (
    <li className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <p className="font-sans text-sm text-text-primary">{label}</p>
        {!complete && (
          <p className="font-sans text-xs text-text-secondary">{pendingDescription}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        {complete ? (
          <CheckIcon size={16} className="text-text-secondary" aria-hidden />
        ) : pendingAction ? (
          <button type="button" onClick={() => goToSection(pendingAction.section)} className={monoLinkSm}>
            {pendingAction.text}
          </button>
        ) : (
          <p className="font-sans text-xs text-text-secondary">{pendingStatusText}</p>
        )}
      </div>
    </li>
  );
}

export function KarProSetupChecklist({ checklist }: KarProSetupChecklistProps) {
  const rows: RowConfig[] = [
    {
      label: "Business profile",
      pendingDescription: "Add your business name and showroom slug.",
      pendingAction: { text: "Edit →", section: "profile" },
      complete: checklist.profile === "complete",
    },
    {
      label: "Payment methods",
      pendingDescription: "Choose how owners can pay you.",
      pendingAction: { text: "Configure →", section: "payments" },
      complete: checklist.payments === "complete",
    },
    {
      label: "Private messages",
      pendingDescription: "Required to receive verification requests",
      pendingStatusText: "Enable messages above",
      complete: checklist.messages === "complete",
    },
    {
      label: "Verification fee (optional)",
      pendingDescription: "Not set — owners see contact for quote",
      pendingAction: { text: "Set fee →", section: "fee" },
      complete: checklist.fee === "set",
    },
  ];

  return (
    <div className="rounded-md border border-border-default bg-bg-card p-6">
      <div className="space-y-1">
        <p className={categoryLabel}>Setup</p>
        <p className="font-sans text-fluid-sm text-text-secondary">
          Complete these steps so owners can find and pay you.
        </p>
      </div>
      <ul className="mt-4 divide-y divide-border-default">
        {rows.map((row) => (
          <ChecklistRow key={row.label} {...row} />
        ))}
      </ul>
    </div>
  );
}
