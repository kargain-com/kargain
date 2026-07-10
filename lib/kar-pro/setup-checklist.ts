export type SetupChecklistInput = {
  name: string;
  slug: string;
  feeWei: bigint | undefined;
  hasExplicitPaymentMethods: boolean;
  messagingReady: boolean;
};

export type SetupChecklistRowState = "complete" | "pending";
export type SetupChecklistFeeState = "set" | "quote";

export type SetupChecklistResult = {
  profile: SetupChecklistRowState;
  payments: SetupChecklistRowState;
  messages: SetupChecklistRowState;
  fee: SetupChecklistFeeState;
  allRequiredComplete: boolean;
};

export function deriveSetupChecklist(input: SetupChecklistInput): SetupChecklistResult {
  const profileComplete =
    input.name.trim().length > 0 && input.slug.trim().length > 0;
  const paymentsComplete = input.hasExplicitPaymentMethods;
  const messagesComplete = input.messagingReady;
  const feeSet = (input.feeWei ?? 0n) > 0n;

  const profile: SetupChecklistRowState = profileComplete ? "complete" : "pending";
  const payments: SetupChecklistRowState = paymentsComplete ? "complete" : "pending";
  const messages: SetupChecklistRowState = messagesComplete ? "complete" : "pending";
  const fee: SetupChecklistFeeState = feeSet ? "set" : "quote";

  return {
    profile,
    payments,
    messages,
    fee,
    allRequiredComplete: profileComplete && paymentsComplete && messagesComplete,
  };
}
