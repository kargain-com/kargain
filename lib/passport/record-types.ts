import {
  arUriToHttp,
  DISPUTE_WITHDRAWN_PREFIX,
  isDisputeWithdrawnRecord,
} from "@/lib/passport/index-passport-metadata";
import type { PonderPassportRecord } from "@/lib/types/ponder";

export type RecordSeverity = "neutral" | "info" | "warn" | "success";

export type RecordDisplayLabels = {
  service: string;
  attestation: string;
  disputeClarification: string;
  discrepancyReport: string;
  disputeOpened: string;
  disputeWithdrawn: string;
  ownerInitiated: string;
  unknownType: string;
};

export const DEFAULT_RECORD_LABELS: RecordDisplayLabels = {
  service: "Service history",
  attestation: "Verifier attestation",
  disputeClarification: "Owner clarification",
  discrepancyReport: "Discrepancy report",
  disputeOpened: "Dispute opened",
  disputeWithdrawn: "Dispute withdrawn (signal)",
  ownerInitiated: "Owner-initiated",
  unknownType: "On-chain record",
};

export type RecordDisplayContext = {
  passportOwner: string;
  lastDisputer: string;
  disputeReason: string;
};

export type RecordDisplay = {
  label: string;
  severity: RecordSeverity;
  badges: string[];
  description: string;
  evidenceHref: string | null;
};

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

export function isOpeningDisputeRecord(
  record: Pick<PonderPassportRecord, "recordType" | "author" | "description">,
  ctx: Pick<RecordDisplayContext, "lastDisputer" | "disputeReason">,
): boolean {
  if (record.recordType !== "discrepancy") return false;
  if (!ctx.lastDisputer.trim()) return false;
  if (normalizeAddress(record.author) !== normalizeAddress(ctx.lastDisputer)) {
    return false;
  }
  if (record.description.trim().startsWith(DISPUTE_WITHDRAWN_PREFIX)) {
    return false;
  }
  const reason = ctx.disputeReason.trim();
  if (!reason) return true;
  return record.description.trim() === reason;
}

export function getRecordDisplay(
  record: PonderPassportRecord,
  ctx: RecordDisplayContext,
  labels: RecordDisplayLabels = DEFAULT_RECORD_LABELS,
): RecordDisplay {
  const badges: string[] = [];
  let label = labels.unknownType;
  let severity: RecordSeverity = "neutral";
  let description = record.description.trim();

  if (
    isDisputeWithdrawnRecord(
      record.recordType,
      record.description,
      record.author,
      ctx.lastDisputer,
    )
  ) {
    label = labels.disputeWithdrawn;
    severity = "info";
  } else if (record.recordType === "dispute-clarification") {
    label = labels.disputeClarification;
    severity = "info";
  } else if (record.recordType === "service") {
    label = labels.service;
    severity = "neutral";
  } else if (record.recordType === "attestation") {
    label = labels.attestation;
    severity = "success";
  } else if (record.recordType === "discrepancy") {
    if (isOpeningDisputeRecord(record, ctx)) {
      label = labels.disputeOpened;
      severity = "warn";
      if (
        ctx.passportOwner.trim() &&
        normalizeAddress(record.author) === normalizeAddress(ctx.passportOwner)
      ) {
        badges.push(labels.ownerInitiated);
      }
    } else {
      label = labels.discrepancyReport;
      severity = "warn";
    }
  } else if (record.recordType.trim()) {
    label = record.recordType.replace(/-/g, " ");
  }

  const evidenceHref = record.evidenceCID.trim()
    ? arUriToHttp(record.evidenceCID) ??
      (record.evidenceCID.startsWith("http") ? record.evidenceCID : null)
    : null;

  return { label, severity, badges, description, evidenceHref };
}

export function getDisputeBannerText(ctx: {
  disputeReason: string;
  fallback: string;
}): string {
  return ctx.disputeReason.trim() || ctx.fallback;
}
