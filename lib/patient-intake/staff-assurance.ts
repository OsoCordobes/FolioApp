/** Client assurance is a UX precheck; the intake RPC remains the authority. */
import type { Result } from "../db/errors";
import type { MfaStatus } from "../auth/mfa-access";

export function intakeAssuranceDecision(
  level: string | null | undefined,
  factors?: { hasVerifiedFactor: boolean; sessionValid: boolean },
): "verified" | "needs_mfa" | "unknown" {
  if (!level) return "unknown";
  if (level !== "aal2") return "needs_mfa";
  if (!factors) return "unknown";
  return factors.hasVerifiedFactor && factors.sessionValid ? "verified" : "needs_mfa";
}

/** The callback is the real RPC seam: it runs only after AAL2 and current factors. */
export async function runAssuredIntakeRpc<T>(
  readAssurance: () => Promise<{ data: { currentLevel: string | null } | null; error: unknown }>,
  readFactors: () => Promise<Result<MfaStatus>>,
  rpc: () => PromiseLike<T>,
): Promise<{ kind: "unknown" } | { kind: "needs_mfa" } | { kind: "verified"; result: T }> {
  const assurance = await readAssurance();
  const level = assurance.error ? null : assurance.data?.currentLevel;
  if (!level) return { kind: "unknown" };
  if (level !== "aal2") return { kind: "needs_mfa" };
  const factors = await readFactors();
  if (!factors.ok) return { kind: "unknown" };
  if (intakeAssuranceDecision(level, factors.data) !== "verified") return { kind: "needs_mfa" };
  return { kind: "verified", result: await rpc() };
}
