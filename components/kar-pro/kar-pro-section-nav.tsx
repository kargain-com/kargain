"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  KAR_PRO_SECTION_CHANGE_EVENT,
  parseKarProSection,
  readKarProSectionFromLocation,
  replaceKarProSectionUrl,
  type KarProSection,
} from "@/lib/kar-pro/kar-pro-section-url";
import { cn } from "@/lib/utils";

type Props = {
  overview: ReactNode;
  profile: ReactNode;
  fee: ReactNode;
  payments: ReactNode;
  commons: ReactNode;
  membership: ReactNode;
};

const SECTIONS: { id: KarProSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "profile", label: "Profile" },
  { id: "fee", label: "Fee" },
  { id: "payments", label: "Payments" },
  { id: "commons", label: "Commons" },
  { id: "membership", label: "Membership" },
];

export function KarProSectionNav({
  overview,
  profile,
  fee,
  payments,
  commons,
  membership,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [section, setSection] = useState<KarProSection>(() =>
    parseKarProSection(searchParams.get("section")),
  );
  const [visitedProfile, setVisitedProfile] = useState(() => section === "profile");
  const [visitedFee, setVisitedFee] = useState(() => section === "fee");
  const [visitedPayments, setVisitedPayments] = useState(() => section === "payments");
  const [visitedCommons, setVisitedCommons] = useState(() => section === "commons");
  const [visitedMembership, setVisitedMembership] = useState(() => section === "membership");

  const syncSectionFromLocation = useCallback(() => {
    const next = readKarProSectionFromLocation();
    setSection(next);
    if (next === "profile") setVisitedProfile(true);
    if (next === "fee") setVisitedFee(true);
    if (next === "payments") setVisitedPayments(true);
    if (next === "commons") setVisitedCommons(true);
    if (next === "membership") setVisitedMembership(true);
  }, []);

  useEffect(() => {
    window.addEventListener(KAR_PRO_SECTION_CHANGE_EVENT, syncSectionFromLocation);
    window.addEventListener("popstate", syncSectionFromLocation);
    return () => {
      window.removeEventListener(KAR_PRO_SECTION_CHANGE_EVENT, syncSectionFromLocation);
      window.removeEventListener("popstate", syncSectionFromLocation);
    };
  }, [syncSectionFromLocation]);

  const selectSection = useCallback(
    (nextSection: KarProSection) => {
      if (nextSection === "profile") setVisitedProfile(true);
      if (nextSection === "fee") setVisitedFee(true);
      if (nextSection === "payments") setVisitedPayments(true);
      if (nextSection === "commons") setVisitedCommons(true);
      if (nextSection === "membership") setVisitedMembership(true);
      setSection(nextSection);
      replaceKarProSectionUrl(pathname, window.location.search, nextSection);
    },
    [pathname],
  );

  const panels: Record<KarProSection, ReactNode> = {
    overview,
    profile,
    fee,
    payments,
    commons,
    membership,
  };

  const visited: Record<KarProSection, boolean> = {
    overview: true,
    profile: visitedProfile,
    fee: visitedFee,
    payments: visitedPayments,
    commons: visitedCommons,
    membership: visitedMembership,
  };

  return (
    <div>
      <nav
        aria-label="KarPro sections"
        className="sticky top-14 z-30 -mx-6 mt-6 border-b border-border-default bg-bg-primary px-6 md:-mx-8 md:px-8"
      >
        <div className="flex gap-1 overflow-x-auto">
          {SECTIONS.map(({ id, label }) => {
            const active = section === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectSection(id)}
                className={cn(
                  "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-4 py-3 font-sans text-sm transition-colors",
                  active
                    ? "font-medium text-text-primary"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                {label}
                {active && (
                  <span className="absolute inset-x-4 bottom-0 h-0.5 bg-accent-warm" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-6">
        {SECTIONS.map(({ id }) => {
          if (!visited[id]) return null;
          return (
            <div
              key={id}
              className={section === id ? "block" : "hidden"}
              inert={section === id ? undefined : true}
            >
              {panels[id]}
            </div>
          );
        })}
      </div>
    </div>
  );
}
