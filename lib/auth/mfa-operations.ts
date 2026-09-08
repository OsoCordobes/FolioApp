import type { SupabaseClient } from "@supabase/supabase-js";
import { err, ok, type Result } from "../db/errors";
import { MFA_MESSAGE, readMfaStatus, type MfaPolicyClient } from "./mfa-access";

export interface MfaOperationsClient extends MfaPolicyClient { auth: SupabaseClient["auth"] }
export interface MfaEnrollment { factorId: string; qrCode: string; secret: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function enrollTotp(client: MfaOperationsClient, friendlyName: string): Promise<Result<MfaEnrollment>> {
  if (typeof friendlyName !== "string" || !friendlyName.trim() || friendlyName.length > 60) return err("validation", "Indicá un nombre de hasta 60 caracteres para el dispositivo.");
  try {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return err("auth_required", "Volvé a iniciar sesión.");
    const access = await readMfaStatus(client);
    if (!access.ok) return access;
    if (access.data.hasVerifiedFactor && (!access.data.allowed || !access.data.sessionValid)) return err("mfa_required", MFA_MESSAGE);
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) return err("network", "No pudimos consultar tus dispositivos. Reintentá.");
    // Abandoned setup secrets cannot be recovered. Retire only the user's
    // UNVERIFIED TOTP attempts; never remove a verified recovery device.
    for (const factor of factors.data.all) {
      if (factor.factor_type === "totp" && factor.status === "unverified") {
        const removed = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) return err("network", "No pudimos reiniciar la configuración. Reintentá.");
      }
    }
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: friendlyName.trim(), issuer: "Folio" });
    if (enrolled.error) return err("validation", "No pudimos agregar el dispositivo. Usá otro nombre o reintentá más tarde.");
    return ok({ factorId: enrolled.data.id, qrCode: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
  } catch {
    return err("network", "No pudimos configurar el autenticador. Reintentá.");
  }
}

export async function confirmTotp(client: MfaOperationsClient, factorId: string, code: string): Promise<Result<void>> {
  if (typeof factorId !== "string" || typeof code !== "string" || !UUID.test(factorId) || !/^\d{6}$/.test(code)) return err("validation", "Ingresá los 6 números de tu autenticador.");
  try {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return err("auth_required", "Volvé a iniciar sesión.");
    const factors = await client.auth.mfa.listFactors();
    if (factors.error || !factors.data.all.some(f => f.id === factorId && f.factor_type === "totp")) {
      return err("forbidden", "No encontramos ese dispositivo en tu cuenta.");
    }
    const challenge = await client.auth.mfa.challenge({ factorId });
    if (challenge.error) return err("validation", "No pudimos iniciar la verificación. Reintentá en unos instantes.");
    const verification = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
    if (verification.error) return err("validation", "El código no es válido o venció. Ingresá el código actual de tu autenticador.");
    // verify refreshes the SSR session cookies. Recheck database authorization
    // instead of treating an OTP success as permission after revocation.
    const access = await readMfaStatus(client);
    if (!access.ok) return access;
    if (!access.data.allowed || !access.data.hasVerifiedFactor || !access.data.sessionValid) return err("mfa_required", MFA_MESSAGE);
    return ok(undefined);
  } catch {
    return err("network", "No pudimos verificar el código. Reintentá.");
  }
}
