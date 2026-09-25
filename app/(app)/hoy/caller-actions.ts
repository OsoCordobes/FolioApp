"use server";

import { callWaitingCode, issueCallerCode } from "@/lib/db/caller";

export async function issueCallerCodeAction(turnoId: string) {
  return issueCallerCode(turnoId);
}

export async function callWaitingCodeAction(input: {
  turnoId: string;
  operationId: string;
  destination: "RECEPCION" | "CONSULTORIO";
  room: number | null;
}) {
  return callWaitingCode(input);
}
