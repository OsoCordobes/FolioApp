/**
 * Folio · queries y mutations de `paciente_claim` — lado CLÍNICO (Fase 3 · P9) 🔒
 *
 * El matcher del portal (P3, lib/portal/link-actions.ts) encola en `paciente_claim`
 * los intentos de vinculación AMBIGUOS (los que no llegan al umbral de auto-link de
 * alta confianza — p. ej. un solo identificador matcheó, o hay varias fichas
 * candidatas en la org). P9 le da al CLÍNICO de la org la decisión explícita:
 *   · APROBAR  → materializa el link (setea paciente.cuenta_id) — el paciente pasa a
 *                ver esa ficha desde su portal.
 *   · RECHAZAR → cierra el claim sin vincular.
 *
 * ─── GATE ANTI-IMPERSONACIÓN (el punto de P9) ────────────────────────────────
 * Ningún link ambiguo se vuelve real sin la decisión de alguien con acceso clínico
 * a esa org. La verdad dura la fija la función SECURITY DEFINER
 * `resolver_paciente_claim` (M87): valida `can_read_clinical(org-del-claim)` por
 * auth.uid() (NO por input del cliente → no impersona), hace el CAS atómico
 * ('pendiente'→'aprobado'/'rechazado' con FOR UPDATE) y — al aprobar — setea
 * `paciente.cuenta_id` SÓLO SI está NULL (NO re-asigna una ficha ya vinculada a otra
 * cuenta). Este data layer es el gate APP (rol clínico + org de la sesión); la RLS y
 * el RPC son la frontera real.
 *
 * ─── Anti-IDOR ────────────────────────────────────────────────────────────────
 * El org se DERIVA de la sesión (getActiveSession), NUNCA del cliente. El claim se
 * resuelve por su id, pero el RPC re-valida que ese claim sea de una org donde el
 * caller tiene acceso clínico (por auth.uid()): un claim_id de otra org no se puede
 * resolver aunque se conozca. El listado sólo trae claims de la org activa.
 */

import { z } from "zod";

import { tryDecrypt } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

// ─── Roles con acceso clínico (espejo APP de public.can_read_clinical, M01) ───
// can_read_clinical = OWNER + PROFESIONAL + DIRECTOR colegiado. El gate app rechaza
// temprano con un mensaje claro; el RPC lo re-valida como frontera real (por
// auth.uid()). Mantener sincronizado con M01 si cambian los roles clínicos.
export type ClinicalRole = "OWNER" | "DIRECTOR" | "PROFESIONAL" | "COORDINADOR" | "ASISTENTE";

/** ¿Este rol (con su flag colegiado) puede leer/resolver claims de identidad?
 * PURA: espeja can_read_clinical (M01). Testeable sin DB. */
export function puedeResolverClaims(role: ClinicalRole, esColegiado: boolean): boolean {
  if (role === "OWNER" || role === "PROFESIONAL") return true;
  if (role === "DIRECTOR") return esColegiado;
  return false;
}

/** Enmascara un documento para mostrarlo al clínico sin volcar el DNI completo en
 * el listado de claims (defensa de superficie: alcanza con los últimos dígitos para
 * contrastar identidad). PURA. `12345678` → `••••5678`. null/corto → placeholder. */
export function maskDocumento(numeroDoc: string | null): string {
  if (!numeroDoc) return "—";
  const clean = numeroDoc.trim();
  if (clean.length <= 4) return "•".repeat(clean.length);
  const visible = clean.slice(-4);
  return "•".repeat(Math.max(0, clean.length - 4)) + visible;
}

/** Fila del RPC listar_paciente_claims_pendientes (datos de la cuenta que reclama). */
interface ClaimCuentaRow {
  claim_id: string;
  paciente_id: string;
  paciente_cuenta_id: string;
  cuenta_email: string;
  cuenta_email_verificado: boolean;
  cuenta_telefono_verificado: boolean;
  creado_en: string;
}

/** Un claim pendiente listo para mostrarle al clínico: identidad de la ficha
 * (nombre/doc enmascarado, RLS-enforced) + datos de la cuenta que reclama. */
export interface PacienteClaimView {
  claimId: string;
  pacienteId: string;
  /** Nombre completo de la ficha (desencriptado server-side). null si caja_fuerte
   * oculta la identidad al rol actual → se muestra "Ficha protegida". */
  pacienteNombre: string | null;
  /** Documento enmascarado (últimos 4). "—" si no hay o está protegido. */
  pacienteDocMasked: string;
  /** Email de la cuenta que reclama el link. */
  cuentaEmail: string;
  cuentaEmailVerificado: boolean;
  cuentaTelefonoVerificado: boolean;
  creadoEn: string;
}

/**
 * Lista los claims PENDIENTES de la org activa para la UI de aprobación.
 *
 * Dos fuentes, ambas gateadas:
 *   1. RPC `listar_paciente_claims_pendientes` (SECURITY DEFINER, M87): trae los
 *      datos NO-SENSIBLES de la `paciente_cuenta` que reclama (email + flags), que
 *      la RLS del clínico no le deja leer (paciente_cuenta cerrada, M70). El RPC
 *      gatea por can_read_clinical(org) via auth.uid().
 *   2. `paciente_identidad` (RLS-enforced, M03/M31): el nombre/doc de cada ficha,
 *      respetando caja_fuerte. Si el rol no puede ver la identidad (VIP protegido),
 *      la fila se muestra sin nombre ("Ficha protegida") — el clínico igual puede
 *      decidir por el email de la cuenta y el contexto.
 *
 * El org sale de la sesión (nunca del cliente). Devuelve [] si no hay claims.
 */
export async function listPacienteClaimsPendientes(): Promise<Result<PacienteClaimView[]>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  // Gate app: sólo rol clínico. El RPC lo re-valida (frontera real).
  if (!puedeResolverClaims(session.data.role, session.data.esColegiado)) {
    return err("forbidden", "Solo el personal clínico puede gestionar vinculaciones de pacientes.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: claimRows, error: rpcErr } = await supabase.rpc(
    "listar_paciente_claims_pendientes",
    { p_org: session.data.organizationId },
  );
  if (rpcErr) {
    const m = mapSupabaseError(rpcErr);
    return err(m.code, "No pudimos cargar las solicitudes de vinculación.", rpcErr.message);
  }

  const claims = (claimRows ?? []) as ClaimCuentaRow[];
  if (claims.length === 0) return ok([]);

  // Resolver nombre/doc de cada ficha vía paciente_identidad (RLS-enforced). Traemos
  // en batch por los ids de paciente. El JOIN paciente→identidad se hace por
  // identidad_id. Respeta caja_fuerte: si el rol no ve la identidad, no viene la fila.
  const pacienteIds = [...new Set(claims.map((c) => c.paciente_id))];

  const { data: pacRows, error: pacErr } = await supabase
    .from("paciente")
    .select("id, identidad_id, identidad:paciente_identidad!identidad_id(nombre_cifrado, apellido_cifrado, numero_doc_cifrado)")
    .in("id", pacienteIds);
  if (pacErr) {
    const m = mapSupabaseError(pacErr);
    return err(m.code, "No pudimos cargar las fichas de las solicitudes.", pacErr.message);
  }

  // Mapa paciente_id → identidad desencriptada.
  const identidadByPaciente = new Map<
    string,
    { nombre: string | null; docMasked: string }
  >();
  for (const row of (pacRows ?? []) as unknown as Array<{
    id: string;
    identidad:
      | { nombre_cifrado: Buffer | null; apellido_cifrado: Buffer | null; numero_doc_cifrado: Buffer | null }
      | { nombre_cifrado: Buffer | null; apellido_cifrado: Buffer | null; numero_doc_cifrado: Buffer | null }[]
      | null;
  }>) {
    const id = Array.isArray(row.identidad) ? row.identidad[0] : row.identidad;
    if (!id) continue;
    const nombre = tryDecrypt(id.nombre_cifrado, "paciente.nombre");
    const apellido = tryDecrypt(id.apellido_cifrado, "paciente.apellido");
    const doc = tryDecrypt(id.numero_doc_cifrado, "paciente.numero_doc");
    const full = [nombre, apellido].filter(Boolean).join(" ").trim() || null;
    identidadByPaciente.set(row.id, { nombre: full, docMasked: maskDocumento(doc) });
  }

  const views: PacienteClaimView[] = claims.map((c) => {
    const id = identidadByPaciente.get(c.paciente_id);
    return {
      claimId: c.claim_id,
      pacienteId: c.paciente_id,
      pacienteNombre: id?.nombre ?? null,
      pacienteDocMasked: id?.docMasked ?? "—",
      cuentaEmail: c.cuenta_email,
      cuentaEmailVerificado: c.cuenta_email_verificado,
      cuentaTelefonoVerificado: c.cuenta_telefono_verificado,
      creadoEn: c.creado_en,
    };
  });

  return ok(views);
}

const resolveSchema = z.object({
  claimId: z.string().uuid(),
  aprobar: z.boolean(),
});

export type ResolvePacienteClaimInput = z.infer<typeof resolveSchema>;

export interface ResolvePacienteClaimResult {
  claimId: string;
  estado: "aprobado" | "rechazado";
  /** true si aprobar materializó el link (seteó cuenta_id). false si rechazó, o si
   * la ficha ya estaba linkeada a esta misma cuenta (idempotente). */
  linkSeteado: boolean;
}

/**
 * Resuelve un claim: aprobar (materializa el link) o rechazar (lo cierra).
 *
 * Toda la lógica de seguridad vive en el RPC `resolver_paciente_claim` (M87):
 *   · Autorización por auth.uid() (can_read_clinical de la org DEL CLAIM).
 *   · CAS atómico de estado (sólo 'pendiente') con FOR UPDATE.
 *   · Al aprobar, setea paciente.cuenta_id SÓLO SI NULL (anti-impersonación): si la
 *     ficha ya está linkeada a OTRA cuenta, raise 23505 → aquí `conflict`.
 * El gate app (rol clínico + sesión) es defensa temprana; el org NO se pasa al RPC
 * (el RPC lo deriva del claim y lo autoriza por auth.uid()).
 */
export async function resolvePacienteClaim(
  input: ResolvePacienteClaimInput,
): Promise<Result<ResolvePacienteClaimResult>> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de la resolución inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  // Gate app: sólo rol clínico. El RPC lo re-valida por auth.uid() (frontera real).
  if (!puedeResolverClaims(session.data.role, session.data.esColegiado)) {
    return err("forbidden", "Solo el personal clínico puede resolver vinculaciones de pacientes.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("resolver_paciente_claim", {
    p_claim_id: parsed.data.claimId,
    p_aprobar: parsed.data.aprobar,
  });

  if (error) {
    const m = mapSupabaseError(error);
    return err(m.code, m.message, error.message);
  }

  const result = data as {
    estado: "aprobado" | "rechazado";
    link_seteado: boolean;
  } | null;
  if (!result) {
    return err("db_error", "No se pudo resolver la solicitud.");
  }

  return ok({
    claimId: parsed.data.claimId,
    estado: result.estado,
    linkSeteado: result.link_seteado,
  });
}
