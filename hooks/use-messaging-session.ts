"use client";

import { useContext } from "react";

import {
  MessagingSessionContext,
  type MessagingSessionContextValue,
} from "@/components/providers/messaging-session-provider";

/** Thin context reader — session ownership lives in MessagingSessionProvider. */
export function useMessagingSession(): MessagingSessionContextValue {
  return useContext(MessagingSessionContext);
}
