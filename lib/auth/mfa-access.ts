import type { User } from "@supabase/supabase-js";
import { err, ok, type Result } from "../db/errors";

export const MFA_PATH = "/seguridad/mfa";
export const MFA_MESSAGE = "Completá la verificación en dos pasos para continuar.";
export interface MfaStatus {
  required: boolean;
  allowed: boolean;
  isStaff: boolean;
  hasVerifiedFactor: boolean;
  sessionValid: boolean;
}
export interface MfaPolicyClient {
  rpc(name: "mfa_access_status"): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface MfaSessionClient extends MfaPolicyClient {
  auth: { getUser(): PromiseLike<{ data: { user: User | null }; error: unknown }> };
}

/** The user-scoped RPC evaluates the verified PostgREST JWT and current DB rows. */
export async function readMfaStatus(client: MfaPolicyClient): Promise<Result<MfaStatus>> {
  try {
    const { data, error } = await client.rpc("mfa_access_status");
    if (error || !data || typeof data !== "object") return err("network", "No pudimos verificar la seguridad de tu sesión. Reintentá.");
    const status = data as Record<string, unknown>;
    const keys = ["required", "allowed", "isStaff", "hasVerifiedFactor", "sessionValid"] as const;
    if (keys.some(key => typeof status[key] !== "boolean") ||
        (status.required && status.allowed && (!status.hasVerifiedFactor || !status.sessionValid))) {
      return err("network", "No pudimos verificar la seguridad de tu sesión. Reintentá.");
    }
    return ok(status as unknown as MfaStatus);
  } catch {
    return err("network", "No pudimos verificar la seguridad de tu sesión. Reintentá.");
  }
}

/** Use before human-initiated service-role work, including dual portal accounts. */
export async function verifyMfaSession(client: MfaSessionClient): Promise<Result<{ user: User; mfa: MfaStatus }>> {
  try {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return err("auth_required", "No estás autenticado.");
    const status = await readMfaStatus(client);
    if (!status.ok) return status;
    if (!status.data.allowed) return err("mfa_required", MFA_MESSAGE);
    return ok({ user, mfa: status.data });
  } catch {
    return err("network", "No pudimos verificar la seguridad de tu sesión. Reintentá.");
  }
}

const RECOVERY_PATHS = new Set([
  MFA_PATH, `${MFA_PATH}/recuperar`, "/login", "/portal/login", "/forgot", "/reset-password",
  "/api/auth/callback", "/api/auth/signout", "/api/auth/reset",
]);
export function mfaRouteDecision(pathname: string, allowed: boolean): "pass" | "redirect" | "json" {
  if (allowed || RECOVERY_PATHS.has(pathname)) return "pass";
  return pathname.startsWith("/api/") ? "json" : "redirect";
}
export function safeMfaReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") ||
      /[\\\r\n\u0000-\u001f]/.test(value) || /%2f|%5c|%0[ad]/i.test(value)) return "/hoy";
  const pathname = value.split(/[?#]/, 1)[0];
  if (pathname.startsWith("/api/") || pathname.startsWith(MFA_PATH) || RECOVERY_PATHS.has(pathname)) return "/hoy";
  return value;
}
