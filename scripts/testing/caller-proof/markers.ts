export const STAGE_PREFIX = "@@FOLIO_CALLER_STAGE@@";
export const DIAGNOSTIC_PREFIX = "@@FOLIO_CALLER_DIAGNOSTIC@@";

export type CallerStage = { stage: string; elapsedMs: number; visible11s?: number; hidden6s?: number };
export type CallerPairDiagnostic = {
  kind: "pair";
  action: "none" | "pending" | "complete" | "failed";
  status: "none" | "2xx" | "3xx" | "4xx" | "5xx";
  button: "enabled" | "disabled" | "missing";
  message: "none" | "issued" | "already_issued" | "permission" | "membership" | "mfa_session" | "uncertain_write" | "network" | "validation" | "rate_limit" | "unmapped";
  code: "present" | "absent";
};

export function parseCallerProofOutput(output: string): { stages: CallerStage[]; diagnostics: CallerPairDiagnostic[] } {
  const stages: CallerStage[] = [];
  const diagnostics: CallerPairDiagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const value = line.trim();
    if (value.startsWith(STAGE_PREFIX)) {
      try {
        const item = JSON.parse(value.slice(STAGE_PREFIX.length)) as CallerStage;
        if (/^[a-z0-9_]+$/.test(item.stage) && Number.isSafeInteger(item.elapsedMs) && item.elapsedMs >= 0 &&
            (item.visible11s === undefined || Number.isSafeInteger(item.visible11s)) &&
            (item.hidden6s === undefined || item.hidden6s === 0)) stages.push(item);
      } catch { /* Reporter source snippets are never evidence. */ }
    } else if (value.startsWith(DIAGNOSTIC_PREFIX)) {
      try {
        const item = JSON.parse(value.slice(DIAGNOSTIC_PREFIX.length)) as CallerPairDiagnostic;
        if (item.kind === "pair" && ["none", "pending", "complete", "failed"].includes(item.action) &&
            ["none", "2xx", "3xx", "4xx", "5xx"].includes(item.status) &&
            ["enabled", "disabled", "missing"].includes(item.button) &&
            ["none", "issued", "already_issued", "permission", "membership", "mfa_session", "uncertain_write", "network", "validation", "rate_limit", "unmapped"].includes(item.message) &&
            ["present", "absent"].includes(item.code)) diagnostics.push(item);
      } catch { /* Invalid output is not a proof marker. */ }
    }
  }
  return { stages, diagnostics };
}
