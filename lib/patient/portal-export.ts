/**
 * Folio · lib/patient/portal-export.ts · assembler del export SELF-SERVE del
 * PORTAL DEL PACIENTE (Ley 25.326 art. 14 — derecho de acceso · Fase 3 · P7).
 *
 * Capa 2 del export del paciente. Mientras X2 (capa profesional,
 * lib/patient/export-builder.ts) exporta UN paciente de UNA org mediado por el
 * profesional, esta capa arma el export AGREGADO del paciente logueado: TODAS las
 * fichas que cuelgan de su `paciente_cuenta` (una por org linkeada), en un solo
 * paquete que el propio paciente descarga desde el portal, sin intermediación.
 *
 * ── Reúso del assembler de X2 (regla de coordinación #4 del plan) ─────────────
 * NO se re-implementa el ensamblado por-org: se llama `buildPatientExport` (X2)
 * una vez por ficha linkeada. Ese builder ya:
 *   · descifra la PII server-side (tryDecrypt, degrada a null si el ciphertext
 *     está corrupto en vez de tirar el export entero),
 *   · lee turnos + consentimientos scopeados por (org, paciente_id),
 *   · EXCLUYE el SOAP crudo (sesion.tool_data / campos S/O/A/P) — regla dura,
 *   · reafirma la coherencia de org (assertPacienteScope, defensa en profundidad).
 * Acá sólo agregamos el fan-out multi-org y el envelope del canal portal.
 *
 * ── Cross-org gating vía `cuenta_id`, NUNCA por scope de org ──────────────────
 * El conjunto de orgs que entra al export es EXACTAMENTE el fan-out de
 * `session.pacientes`, que `getPacienteSession()` resolvió bajo la RLS de M71
 * (`paciente.cuenta_id = paciente_cuenta_actual()` = auth.uid()). El paciente
 * NUNCA elige la org ni el paciente_id: no hay input de cliente en el scope. Una
 * org donde el paciente NO está linkeado no tiene fila en `session.pacientes` ⇒
 * queda fuera del export por construcción. `assertLinkedOrgScope` (pura,
 * testeable) reafirma esa invariante antes de exportar.
 *
 * ── Qué EXCLUYE (heredado de X2, regla dura) ──────────────────────────────────
 * NUNCA el SOAP crudo de otras ni de la propia org. El "resumen clínico" es el
 * whitelist de X2 (motivo de consulta que el propio paciente declaró + metadata),
 * NO un filtro sobre el SOAP. Bajo el cliente ANON del paciente, además, las
 * lecturas de `paciente_intake_avanzado` y el count de `sesion` que hace X2
 * devuelven vacío/0 (M71 NO otorga policy sobre esas tablas al paciente) ⇒ el
 * resumen del portal es aún más acotado que el de la capa profesional. Es el
 * comportamiento deseado: el portal expone menos, nunca más.
 */

import "server-only";

import { err, ok, type Result } from "@/lib/db/errors";
import type { PacienteSession, PortalPaciente } from "@/lib/db/paciente-session";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { SUPPORT_EMAIL } from "@/lib/support";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { buildPatientExport, type PatientExport } from "./export-builder";

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// ─── Contrato de scope cross-org (puro, anti-IDOR) ───────────────────────────

/** Ficha linkeada tal como sale del fan-out de la sesión del paciente. */
export interface LinkedPaciente {
  pacienteId: string;
  organizationId: string;
  organizacionNombre: string | null;
}

export type LinkedOrgScopeVerdict =
  | { ok: true; orgs: LinkedPaciente[] }
  | { ok: false; code: "no_links"; message: string };

/**
 * Decide el conjunto de fichas que entran al export a partir del fan-out de la
 * sesión. PURA a propósito — sin I/O — para fijar la invariante de gating
 * cross-org en un test sin mockear Supabase:
 *
 *   · El scope es EXACTAMENTE `session.pacientes` (una ficha por org linkeada),
 *     que la RLS de M71 ya restringió a `cuenta_id = auth.uid()`. No se agrega,
 *     no se filtra: el gating es por `cuenta_id`, jamás por un id de org que
 *     mande el cliente (no hay tal input).
 *   · Sin ninguna ficha linkeada (cuenta verificada pero aún sin link) →
 *     `no_links`: no hay nada que exportar todavía (el paciente debe vincular su
 *     ficha primero). No es un error de seguridad, es un estado vacío legítimo.
 *
 * Devuelve las fichas normalizadas (mismo shape de entrada) para que el caller
 * itere sobre el resultado verificado y no vuelva a leer de la sesión.
 */
export function assertLinkedOrgScope(
  pacientes: readonly PortalPaciente[],
): LinkedOrgScopeVerdict {
  if (!pacientes || pacientes.length === 0) {
    return {
      ok: false,
      code: "no_links",
      message:
        "Todavía no hay ninguna ficha vinculada a tu cuenta. Vinculá tu ficha desde el portal antes de exportar tus datos.",
    };
  }
  return {
    ok: true,
    orgs: pacientes.map((p) => ({
      pacienteId: p.pacienteId,
      organizationId: p.organizationId,
      organizacionNombre: p.organizacionNombre,
    })),
  };
}

// ─── Shape del export agregado del portal ────────────────────────────────────

/** El export por-org (X2) más un marcador del origen (para el paquete portal). */
export interface PortalExportOrg extends PatientExport {
  /** Falso reafirma que este bloque salió del canal portal (no del profesional). */
  exported_by: "profesional";
}

export interface PortalExport {
  ok: true;
  exported_at: string;
  /** Canal del export: el propio paciente, sin intermediación del profesional. */
  canal: "portal";
  ley_25326_basis: string;
  privacy_policy_version: string;
  terms_version: string;
  titular: {
    cuenta_id: string;
    email: string;
  };
  /** Un bloque de export por cada org donde el paciente está linkeado. */
  organizaciones: PortalExportOrg[];
  notas: string[];
}

// ─── Assembler agregado ──────────────────────────────────────────────────────

export interface BuildPortalExportInput {
  /** Sesión del paciente ya resuelta (getPacienteSession). Fuente ÚNICA del scope. */
  session: PacienteSession;
  /** Client Supabase ANON del paciente (RLS de M71). Opcional: se crea si falta. */
  supabase?: Supa;
}

/**
 * Arma el export agregado del portal: itera las fichas linkeadas del paciente y,
 * por cada una, delega en `buildPatientExport` (X2) el ensamblado por-org. El
 * scope sale ÍNTEGRAMENTE de `session.pacientes` (RLS por cuenta_id) — nunca de
 * un input de cliente. Devuelve `Result` (contrato lib/db):
 *   · no_links → la cuenta no tiene ninguna ficha vinculada (nada que exportar).
 *   · db_error → falló el ensamblado de una ficha (se propaga el primer error).
 *
 * Nota de seguridad: si `buildPatientExport` de una org devolviera `not_found`
 * (la RLS no ve esa ficha), es una inconsistencia entre la sesión y la RLS —
 * la tratamos como db_error y NO exponemos la ficha, en vez de omitirla en
 * silencio: un fan-out que la sesión resolvió pero la RLS no confirma es una
 * señal a investigar, no un caso normal.
 */
export async function buildPortalExport(
  input: BuildPortalExportInput,
): Promise<Result<PortalExport>> {
  const { session } = input;

  const scope = assertLinkedOrgScope(session.pacientes);
  if (!scope.ok) {
    return err(scope.code === "no_links" ? "not_found" : "forbidden", scope.message);
  }

  const supabase = input.supabase ?? (await createSupabaseServerClient());

  const organizaciones: PortalExportOrg[] = [];
  for (const ficha of scope.orgs) {
    // Reúso literal del assembler de X2, una vez por ficha linkeada. El builder
    // scopea por (org, paciente_id) — ambos salen de la sesión, no del cliente.
    const built = await buildPatientExport({
      supabase,
      organizationId: ficha.organizationId,
      organizationNombre: ficha.organizacionNombre,
      pacienteId: ficha.pacienteId,
    });
    if (!built.ok) {
      // No omitimos en silencio una ficha que la sesión resolvió: propagamos.
      return err(
        "db_error",
        "No se pudo armar el export de una de tus fichas. Intentá de nuevo más tarde.",
        built.error.detail ?? built.error.message,
      );
    }
    organizaciones.push(built.data as PortalExportOrg);
  }

  return ok({
    ok: true,
    exported_at: new Date().toISOString(),
    canal: "portal",
    ley_25326_basis: "art. 14 (derecho de acceso del titular) — art. 16 (portabilidad)",
    privacy_policy_version: PRIVACY_VERSION,
    terms_version: TERMS_VERSION,
    titular: {
      cuenta_id: session.cuentaId,
      email: session.email,
    },
    organizaciones,
    notas: [
      "Este export contiene tus datos personales bajo Ley 25.326 (derecho de acceso, art. 14).",
      "Lo generaste vos mismo desde el portal del paciente; incluye una sección por cada consultorio donde tenés una ficha vinculada a tu cuenta.",
      "La historia clínica narrativa (evolución/SOAP) la conserva cada profesional tratante en su rol de responsable del tratamiento y no se incluye en bruto; el resumen contiene sólo el motivo de consulta que declaraste y metadata de tu atención.",
      "Los archivos de firma de tus consentimientos los conserva cada profesional (Ley 26.529, retención 10 años) y podés verlos/descargarlos desde la sección de consentimientos del portal.",
      `Para ejercer rectificación o supresión, contactá al profesional tratante o, subsidiariamente, a ${SUPPORT_EMAIL}.`,
    ],
  });
}
