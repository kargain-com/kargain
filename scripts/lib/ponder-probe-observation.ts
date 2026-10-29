/**
 * Sole owner of typed Ponder deploy probe-observation parsing (ADR 0015).
 * Executor observation JSON must pass through parseProbeObservationJson —
 * bare status digits or any other shape are refused.
 */
export type ProbeObservation =
  | { kind: "status"; code: number }
  | { kind: "no_answer" }
  | { kind: "probe_failed"; detail: string };

export type ParseProbeObservationResult =
  | { ok: true; value: ProbeObservation }
  | { ok: false; reason: "not_json" | "not_object" | "invalid_shape" };

/**
 * Parse one probe observation. Accepts only the exact typed shapes.
 * A bare number (legacy probe printing `200`) is invalid_shape.
 */
export function parseProbeObservationJson(
  raw: string,
): ParseProbeObservationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not_object" };
  }
  const obj = parsed as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === "status") {
    if (typeof obj.code !== "number" || !Number.isFinite(obj.code)) {
      return { ok: false, reason: "invalid_shape" };
    }
    if (Object.keys(obj).some((k) => k !== "kind" && k !== "code")) {
      return { ok: false, reason: "invalid_shape" };
    }
    return { ok: true, value: { kind: "status", code: obj.code } };
  }
  if (kind === "no_answer") {
    if (Object.keys(obj).some((k) => k !== "kind")) {
      return { ok: false, reason: "invalid_shape" };
    }
    return { ok: true, value: { kind: "no_answer" } };
  }
  if (kind === "probe_failed") {
    if (typeof obj.detail !== "string") {
      return { ok: false, reason: "invalid_shape" };
    }
    if (Object.keys(obj).some((k) => k !== "kind" && k !== "detail")) {
      return { ok: false, reason: "invalid_shape" };
    }
    return { ok: true, value: { kind: "probe_failed", detail: obj.detail } };
  }
  return { ok: false, reason: "invalid_shape" };
}
