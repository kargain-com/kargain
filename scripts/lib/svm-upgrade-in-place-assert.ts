/**
 * Pure checks for upgrade-in-place eligibility (no chain I/O).
 */

export function assertProgramShowAllowsUpgrade(args: {
  showText: string;
  programId: string;
  deployerPubkey: string;
  evidenceKey: string;
  caller?: string;
}): void {
  const caller = args.caller ?? "svm-upgrade-in-place";
  const { showText, programId, deployerPubkey, evidenceKey } = args;
  if (!/Owner:\s*BPFLoaderUpgradeab/i.test(showText)) {
    throw new Error(
      `${caller}: ${evidenceKey} (${programId}) is not owned by the upgradeable loader`,
    );
  }
  const authMatch = showText.match(/Authority:\s*(\S+)/);
  if (!authMatch) {
    throw new Error(
      `${caller}: ${evidenceKey} (${programId}) program show missing Authority line`,
    );
  }
  if (authMatch[1] !== deployerPubkey) {
    throw new Error(
      `${caller}: ${evidenceKey} (${programId}) upgrade authority ≠ deployer`,
    );
  }
}
