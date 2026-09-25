"use server";

import { createCallerPair, listCallerScreens, revokeCallerScreen } from "@/lib/db/caller";

export async function createCallerPairAction(operationId: string) {
  return createCallerPair(operationId);
}

export async function revokeCallerScreenAction(screenId: string) {
  return revokeCallerScreen(screenId);
}

export async function listCallerScreensAction(cursor: { createdAt: string; screenId: string } | null) {
  return listCallerScreens(cursor);
}
