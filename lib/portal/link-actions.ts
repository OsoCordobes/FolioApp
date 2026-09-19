
import { safeLog } from "@/lib/observability/safe-log";
import { verifyMfaSession } from "@/lib/auth/mfa-access";
import "server-only";

/**
 * Portal linkage runs only on the server. Email is taken from verified Auth;
 * callers may provide a DNI/phone and CAPTCHA, never an alternative email.
 * The matcher identifies candidates across organizations with service_role.
 * M98 atomically rechecks identity, account, live organization and adult patient,
 * writes the link, and records its audit. Ambiguous records remain claims.
 */
import { headers } from "next/headers";

import { blindIndex, blindIndexPhone } from "@/lib/crypto";
import { err, ok, type Result } from "@/lib/db/errors";
import { writeAuditEntry } from "@/lib/db/audit";
import { formatResetMessage, limitByKey } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

import { matchAccount, type MatchCandidate, type MatchOutcome } from "./matcher";

/** Optional self-declared identifiers; verified email always comes from Auth. */
export interface LinkageIdentifiers {
  dni?: string | null;
  telefono?: string | null;

  /** Token de Turnstile del widget del portal. OBLIGATORIO (fail-closed en prod)
   * cuando se aportan DNI/teléfono (el path que puede AUTO-LINKEAR y el vector de
   * fuerza bruta de DNIs). El auto-run email-only no lo necesita (no auto-linkea)
   * y no puede cambiar la identidad verificada. */
  captchaToken?: string | null;
}

/** Límite de corridas del matcher por cuenta y por hora. Frena la fuerza bruta
 * de DNIs (keyspace denso, no-secreto, enumerable) desde una cuenta de portal
 * autenticada: cada corrida recomputa blind indexes contra todas las orgs vivas.
 * Generoso para el uso legítimo (una persona vincula sus 2-3 fichas), letal para
 * el scripting. */
const LINKAGE_MAX_PER_HOUR = 8;

export interface LinkageResult {
  autoLinked: number;
  claimsQueued: number;
}

interface IdentidadCandidateRow {
  id: string;
  organization_id: string;
  dni_hash: string | null;
  telefono_hash: string | null;
  email_hash: string | null;
}

/** IP del cliente (primer hop de x-forwarded-for) para pasarle a Turnstile.
 * Best-effort: si no hay headers de request, null (Turnstile igual valida el
 * token sin remoteip). */
async function clientIpForLinkage(): Promise<string | null> {
  try {
    const h = await headers();
    const raw = h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null;
    return raw ? raw.split(",")[0]?.trim() ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Corre el matcher para la cuenta del usuario logueado y aplica las decisiones.
 * AUDITADO. Idempotente en la práctica: un paciente ya linkeado a ESTA cuenta se
 * excluye (cuenta_id IS NULL en el filtro de candidatos), y un claim duplicado
 * lo bloquea el UNIQUE (paciente_cuenta_id, paciente_id) de M70 (lo tragamos).
 *
 * @param identifiers DNI/teléfono aportados y token CAPTCHA.
 */
export async function runLinkageForCurrentAccount(
  identifiers: LinkageIdentifiers = {},
): Promise<Result<LinkageResult>> {
  // 1. La cuenta del usuario logueado, tomada de SU sesión (no de un arg).
  const anon = await createSupabaseServerClient();
  const verified = await verifyMfaSession(anon);
  if (!verified.ok) return verified;
  const { user } = verified.data;

  const { data: cuentaId, error: cuentaErr } = await anon.rpc("paciente_cuenta_actual");
  if (cuentaErr) {
    return err("db_error", "Error resolviendo tu cuenta.", cuentaErr.message);
  }
  if (!cuentaId) {
    return err("forbidden", "Tu usuario no tiene un perfil de paciente en el portal.");
  }
  const pacienteCuentaId = cuentaId as string;

  // 2. Derive identity exclusively from the verified Auth response.
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email || !user.email_confirmed_at) {
    return err("forbidden", "Verificá tu email antes de vincular una ficha.");
  }
  const dni = identifiers.dni?.trim() || null;
  const telefono = identifiers.telefono?.trim() || null;

  // El path PELIGROSO es el que aporta DNI/teléfono: es el único que puede
  // AUTO-LINKEAR y el vector de fuerza bruta de DNIs (keyspace denso, no-secreto,
  // enumerable). El auto-run email-only NO puede variar nada (el email está atado
  // a la cuenta) → correrlo N veces da el MISMO resultado, no cosecha nada; por
  // eso NO se le aplica ni rate-limit ni captcha (evita falsos lockouts al
  // recargar el portal). Rate-limit + Turnstile SÓLO cuando hay identificadores.
  const hasIdentifiers = Boolean(dni || telefono);

  if (hasIdentifiers) {
    // 1b. Rate-limit por CUENTA (no por IP: la cuenta es la identidad estable, no
    // se puede spoofear — sale de auth.uid()). Cada corrida recomputa blind
    // indexes contra TODAS las orgs vivas y auto-linkea si dos identificadores
    // matchean una ficha sin cuenta. Fail-closed en prod cuando Upstash está
    // provisionado (UPSTASH_FAIL_CLOSED).
    const rl = await limitByKey("portal-linkage", pacienteCuentaId, LINKAGE_MAX_PER_HOUR);
    if (!rl.ok) {
      return err(
        "forbidden",
        `Demasiados intentos de vinculación. ${formatResetMessage(rl.resetIn)}`,
      );
    }

    // 2b. Turnstile OBLIGATORIO. Fail-closed en prod (sin secret o token inválido
    // → deniega); permisivo en dev (verifyTurnstile devuelve true sin secret).
    const ip = await clientIpForLinkage();
    const captchaOk = await verifyTurnstile(identifiers.captchaToken, ip);
    if (!captchaOk) {
      return err(
        "forbidden",
        "Verificación anti-robot fallida. Recargá la página e intentá de nuevo.",
      );
    }
  }

  // 3. Buscar candidatos: filas paciente VIVAS y SIN cuenta linkeada. Recorremos
  // por org para poder recomputar el salt correcto. En lugar de escanear todo el
  // universo, buscamos por hash contra TODAS las orgs, org por org — pero como el
  // salt es por org, no podemos pre-filtrar en SQL con un solo hash. Estrategia:
  // traer las orgs candidatas por CUALQUIER match posible es caro; en cambio
  // recomputamos, POR ORG existente, los tres hashes y hacemos un OR. Para acotar,
  // sólo consideramos orgs que tengan al menos una identidad vinculable.
  const service = createSupabaseServiceClient();

  // Orgs vivas (acotamos el fan-out del matcher a orgs reales). El universo de
  // orgs en Folio es chico (una SaaS de consultorios); si crece, se indexa por un
  // hash global cross-org, pero eso es optimización futura (decisión: correcto y
  // auditado ahora, rápido después).
  const { data: orgsRaw, error: orgsErr } = await service
    .from("organization")
    .select("id")
    .is("deleted_at", null);
  if (orgsErr) {
    return err("db_error", "Error buscando organizaciones.", orgsErr.message);
  }
  const orgIds = ((orgsRaw ?? []) as Array<{ id: string }>).map((o) => o.id);

  const candidates: MatchCandidate[] = [];

  for (const organizationId of orgIds) {
    // Recomputar los blind indexes del titular con el salt de ESTA org.
    const dniHash = dni ? blindIndex(dni, organizationId) : null;
    const telHash = telefono ? blindIndexPhone(telefono, organizationId) : null;
    const emailHash = email ? blindIndex(email, organizationId) : null;

    // Si no hay ningún hash computable (no hay identificadores), no hay match.
    if (!dniHash && !telHash && !emailHash) continue;

    // Un OR sobre los hashes disponibles. Sólo filas SIN cuenta (cuenta_id NULL)
    // y vivas (deleted_at NULL en identidad; paciente no pseudonimizado). El join
    // a paciente lo hace PostgREST vía la FK identidad_id — pero acá consultamos
    // paciente_identidad y traemos su paciente asociado.
    const orClauses: string[] = [];
    if (dniHash) orClauses.push(`dni_hash.eq.${dniHash}`);
    if (telHash) orClauses.push(`telefono_hash.eq.${telHash}`);
    if (emailHash) orClauses.push(`email_hash.eq.${emailHash}`);

    const { data: idRows, error: idErr } = await service
      .from("paciente_identidad")
      .select("id, organization_id, dni_hash, telefono_hash, email_hash, paciente:paciente!identidad_id(id, cuenta_id, pseudonimizado_en, deleted_at)")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .or(orClauses.join(","));

    if (idErr) {
      // No abortamos todo el matcher por una org: logueamos y seguimos (fail-safe
      // — mejor linkear las orgs que sí resolvieron que denegar todo).
      safeLog("warn", "lib.portal.link.actions.L187", { error: idErr });
      continue;
    }

    for (const row of (idRows ?? []) as unknown as Array<
      IdentidadCandidateRow & {
        paciente: { id: string; cuenta_id: string | null; pseudonimizado_en: string | null; deleted_at: string | null } | { id: string; cuenta_id: string | null; pseudonimizado_en: string | null; deleted_at: string | null }[] | null;
      }
    >) {
      // El embed puede venir como objeto (1:1 por FK) — normalizamos.
      const pac = Array.isArray(row.paciente) ? row.paciente[0] : row.paciente;
      if (!pac) continue;
      // Linked household members still count toward ambiguity.
      if (pac.deleted_at !== null) continue;
      if (pac.pseudonimizado_en !== null) continue;

      candidates.push({
        pacienteId: pac.id,
        alreadyLinked: pac.cuenta_id !== null,
        organizationId,
        dniMatch: Boolean(dniHash && row.dni_hash === dniHash),
        telefonoMatch: Boolean(telHash && row.telefono_hash === telHash),
        emailMatch: Boolean(emailHash && row.email_hash === emailHash),
      });
    }
  }

  // 4. Decisión pura.
  const outcome: MatchOutcome = matchAccount(candidates);

  // 5. Aplicar. Auto-links: setear cuenta_id (con guard cuenta_id IS NULL para no
  // pisar un link de carrera). Claims: insertar 'pendiente' (UNIQUE tolera dup).
  let autoLinked = 0;
  for (const link of outcome.autoLinks) {
    // Revalidate and lock Auth, account, organization, patient and identity in
    // ONE transaction. The RPC is executable only by the service role.
    const { data: updated, error: upErr } = await service.rpc("portal_link_verified_patient", {
      p_auth_user_id: user.id,
      p_cuenta_id: pacienteCuentaId,
      p_paciente_id: link.pacienteId,
      p_organization_id: link.organizationId,
      p_verified_email: email,
      p_email_hash: blindIndex(email, link.organizationId),
      p_dni_hash: dni ? blindIndex(dni, link.organizationId) : null,
      p_telefono_hash: telefono ? blindIndexPhone(telefono, link.organizationId) : null,
    });    if (upErr) {
      safeLog("warn", "lib.portal.link.actions.L233", { error: upErr });
      continue;
    }
    if (updated === true) autoLinked += 1;
  }
  let claimsQueued = 0;
  for (const claim of outcome.claims) {
    const { error: insErr } = await service.from("paciente_claim").insert({
      organization_id: claim.organizationId,
      paciente_cuenta_id: pacienteCuentaId,
      paciente_id: claim.pacienteId,
      estado: "pendiente",
    });
    if (insErr) {
      // 23505 = ya existe el claim (UNIQUE paciente_cuenta_id, paciente_id): no es
      // error, es idempotencia. Cualquier otro error se loguea y sigue.
      if (insErr.code !== "23505") {
        safeLog("warn", "lib.portal.link.actions.L250", { error: insErr });
      }
      continue;
    }
    claimsQueued += 1;
    await writeAuditEntry({
      organizationId: claim.organizationId,
      actorId: user.id,
      actorRole: "PACIENTE",
      action: "paciente.portal_claim_queued",
      resourceType: "paciente_claim",
      resourceId: claim.pacienteId,
      payload: {
        paciente_cuenta_id: pacienteCuentaId,
        matched: claim.matched,
      },
    });
  }

  return ok({ autoLinked, claimsQueued });
}
