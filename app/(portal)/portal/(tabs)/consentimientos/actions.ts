"use server";

/**
 * Folio · Server Actions de consentimientos del PORTAL DEL PACIENTE (Fase 3 · P6).
 *
 * Espejo, del lado paciente, de las acciones de consentimiento del staff
 * (app/(app)/pacientes/actions.ts). El paciente autenticado puede:
 *   · listar sus consentimientos firmados (listConsentimientosPortalAction),
 *   · abrir la imagen de su firma (getFirmaUrlPortalAction),
 *   · cargar las plantillas GLOBALES firmables (listPlantillasPortalAction),
 *   · FIRMAR un consentimiento nuevo (uploadFirmaConsentimientoPortalAction).
 *
 * Toda la lógica de seguridad (sesión del paciente + RLS M71/M85) vive en el data
 * layer (lib/db/consentimientos.ts, lib/db/portal-consentimientos.ts). Acá:
 *   · re-validamos el shape con Zod,
 *   · construimos el firma_storage_path SERVER-SIDE (nunca del cliente),
 *   · subimos el PNG con el cliente anon del paciente (RLS "consentimientos-firmados
 *     portal write", M85 — scopeada por paciente_owns del path),
 *   · creamos la fila vía createConsentimientoPortal (RLS consentimiento_insert_portal).
 *
 * ANTI-IDOR: el pacienteId llega por argumento pero se valida contra la sesión y la
 * RLS lo re-valida (paciente_owns). El org y el path se DERIVAN de la sesión.
 */

import { uploadReviewedConsent } from "@/lib/consentimientos/signature-upload";
import { z } from "zod";

import {
  type PlantillaVigente,
} from "@/lib/consentimientos/helpers";
import {
  listPlantillasConsentimientoPortal,
} from "@/lib/db/consentimientos";
import { err, type Result } from "@/lib/db/errors";
import {
  getFirmaUrlPortal,
  listConsentimientosPortal,
  type PortalConsentimientoItem,
} from "@/lib/db/portal-consentimientos";

/** La firma es un PNG de canvas — muy chica; 5 MB es holgadísimo (igual que staff). */

/** Lista los consentimientos del paciente (vigentes + revocados). */
export async function listConsentimientosPortalAction(): Promise<
  Result<PortalConsentimientoItem[]>
> {
  return listConsentimientosPortal();
}

/** Plantillas GLOBALES firmables desde el portal (incluye TELEMEDICINA · M68). */
export async function listPlantillasPortalAction(): Promise<Result<PlantillaVigente[]>> {
  return listPlantillasConsentimientoPortal();
}

/** Signed URL de 5 min para ver la firma de un consentimiento propio (por id). */
export async function getFirmaUrlPortalAction(
  consentimientoId: string,
): Promise<Result<{ signedUrl: string }>> {
  if (!z.string().uuid().safeParse(consentimientoId).success) {
    return err("validation", "ID inválido.");
  }
  return getFirmaUrlPortal(consentimientoId);
}

/**
 * Registra un consentimiento firmado desde el portal: sube el PNG del canvas al
 * bucket privado (cliente anon del paciente · RLS portal write M85) y crea la fila
 * vía createConsentimientoPortal (RLS consentimiento_insert_portal M85).
 *
 * Upload + create van JUNTOS acá (no separados) para que el firma_storage_path NUNCA
 * viaje del cliente: el path se arma server-side con el org+paciente de la SESIÓN.
 *
 * FormData: file (PNG), pacienteId, plantillaId. Guards:
 *   · sesión de portal (paciente_cuenta viva),
 *   · pacienteId ∈ fichas linkeadas de la sesión (anti-IDOR; la RLS lo re-valida),
 *   · PNG ≤ 5 MB, image/png.
 * Si el INSERT falla tras el upload, se borra el PNG huérfano best-effort con el
 * service client (el bucket no tiene DELETE policy — inmutabilidad M27).
 */
export async function uploadFirmaConsentimientoPortalAction(formData: FormData): Promise<Result<{ consentimientoId: string }>> {
  return uploadReviewedConsent(formData, "portal");
}
