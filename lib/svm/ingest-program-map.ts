/**
 * Map program id → contract slug for ingest attribution.
 */

import type { FollowedProgram } from "./ingest-config.js";
import { contractNameForProgramSlug } from "./event-discriminators.js";

export function programIdToSlug(
  programs: readonly FollowedProgram[],
): Map<string, string> {
  return new Map(programs.map((p) => [p.programId, p.slug]));
}

export function contractNameForProgramId(
  programId: string,
  programs: readonly FollowedProgram[],
): string | null {
  const slug = programIdToSlug(programs).get(programId);
  if (!slug) return null;
  return contractNameForProgramSlug(slug);
}
