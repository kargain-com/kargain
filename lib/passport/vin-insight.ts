import { validateVin, type ModelYearResult, type VinValidation } from "@kargain/vincent";

import { MAX_VIN_LENGTH, MIN_VIN_LENGTH } from "@/lib/passport/metadata-constants";
import { normalizeVin } from "@/lib/passport/metadata-schema";

export type VinInsightStatus = "empty" | "incomplete" | "error" | "warning" | "ok";

export type VinInsightOrigin = {
  wmi: string;
  manufacturer: string;
  country: string;
};

export type VinInsight = {
  status: VinInsightStatus;
  messages: string[];
  yearSuggestion: number | null;
  yearConflict: boolean;
};

const EU_CHECK_DIGIT_ADVISORY =
  "Check digit mismatch — common for European-market VINs, verify for typos";

const LEGACY_LENGTH_NOTE = "Legacy VIN length — check digit not applicable";

function parseYearField(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveYearSuggestion(modelYear: ModelYearResult): number | null {
  if (modelYear.best != null) return modelYear.best;
  if (modelYear.candidates.length === 1) return modelYear.candidates[0] ?? null;
  return null;
}

function buildMessages(validation: VinValidation): string[] {
  const messages: string[] = [];

  for (const error of validation.errors) {
    if (error.code === "check-digit") {
      messages.push(error.message);
      continue;
    }
    messages.push(error.message);
  }

  if (validation.length === "legacy") {
    messages.push(LEGACY_LENGTH_NOTE);
  }

  for (const warning of validation.warnings) {
    if (warning.code === "check-digit" && validation.region !== "north-america") {
      if (!messages.includes(EU_CHECK_DIGIT_ADVISORY)) {
        messages.push(EU_CHECK_DIGIT_ADVISORY);
      }
      continue;
    }
    if (!messages.includes(warning.message)) {
      messages.push(warning.message);
    }
  }

  return messages;
}

function deriveStatus(validation: VinValidation): VinInsightStatus {
  if (validation.errors.length > 0) return "error";
  if (validation.warnings.length > 0) return "warning";
  if (validation.length === "legacy") return "warning";
  return "ok";
}

function emptyInsight(): VinInsight {
  return {
    status: "empty",
    messages: [],
    yearSuggestion: null,
    yearConflict: false,
  };
}

function withYearConflict(
  insight: VinInsight,
  currentYearField: string,
): VinInsight {
  const currentYear = parseYearField(currentYearField);
  const yearConflict =
    insight.yearSuggestion != null &&
    currentYear != null &&
    currentYear !== insight.yearSuggestion;
  return { ...insight, yearConflict };
}

export function buildVinInsight(rawVin: string, currentYearField: string): VinInsight {
  const normalized = normalizeVin(rawVin);

  if (normalized.length === 0 || normalized.length < MIN_VIN_LENGTH) {
    return emptyInsight();
  }

  if (normalized.length < MAX_VIN_LENGTH) {
    const validation = validateVin(normalized);
    const messages =
      validation.length === "legacy" ? [LEGACY_LENGTH_NOTE] : [];
    const yearSuggestion = resolveYearSuggestion(validation.modelYear);

    return withYearConflict(
      {
        status: "incomplete",
        messages,
        yearSuggestion,
        yearConflict: false,
      },
      currentYearField,
    );
  }

  const validation = validateVin(normalized);
  const messages = buildMessages(validation);
  const yearSuggestion = resolveYearSuggestion(validation.modelYear);

  return withYearConflict(
    {
      status: deriveStatus(validation),
      messages,
      yearSuggestion,
      yearConflict: false,
    },
    currentYearField,
  );
}

export async function resolveVinOrigin(
  normalizedVin: string,
): Promise<VinInsightOrigin | null> {
  if (normalizedVin.length < 3) return null;

  const { lookupWmi } = await import("@kargain/vincent/wmi");
  const wmi = await lookupWmi(normalizedVin);
  if (!wmi) return null;

  return {
    wmi: wmi.wmi,
    manufacturer: wmi.manufacturer,
    country: wmi.country ?? "",
  };
}
