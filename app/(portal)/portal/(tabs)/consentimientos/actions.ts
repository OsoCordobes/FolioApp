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

import { z } from "zod";

import {
  buildFirmaStoragePath,
  pathSinBucket,
  type PlantillaVigente,
} from "@/lib/consentimientos/helpers";
import {
  createConsentimientoPortal,
  listPlantillasConsentimientoPortal,
} from "@/lib/db/consentimientos";
import { err, ok, type Result } from "@/lib/db/errors";
import { getPacienteSession } from "@/lib/db/paciente-session";
import {
  getFirmaUrlPortal,
  listConsentimientosPortal,
  type PortalConsentimientoItem,
} from "@/lib/db/portal-consentimientos";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

const CONSENT_BUCKET = "consentimientos-firmados";
/** La firma es un PNG de canvas — muy chica; 5 MB es holgadísimo (igual que staff). */
const FIRMA_MAX_BYTES = 5 * 1024 * 1024;

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
export async function uploadFirmaConsentimientoPortalAction(
  formData: FormData,
): Promise<Result<{ consentimientoId: string }>> {
  const file = formData.get("file");
  const pacienteId = String(formData.get("pacienteId") ?? "");
  const plantillaId = String(formData.get("plantillaId") ?? "");

  if (!(file instanceof Blob) || file.size === 0) {
    return err("validation", "La firma llegó vacía. Dibujala de nuevo e intentá otra vez.");
  }
  if (file.size > FIRMA_MAX_BYTES) {
    return err("validation", "La firma supera el límite de 5 MB.");
  }
  if (file.type !== "image/png") {
    return err("validation", "La firma debe ser una imagen PNG.");
  }
  if (
    !z.string().uuid().safeParse(pacienteId).success ||
    !z.string().uuid().safeParse(plantillaId).success
  ) {
    return err("validation", "Datos del consentimiento inválidos.");
  }

  const session = await getPacienteSession();
  if (!session.ok) return session;

  // Gate app (anti-IDOR): la ficha debe estar linkeada a la cuenta. De acá sale el
  // organizationId — NUNCA del cliente. La RLS del upload y del INSERT lo re-validan.
  const ficha = session.data.pacientes.find((p) => p.pacienteId === pacienteId);
  if (!ficha) {
    return err("not_found", "Esa ficha no está vinculada a tu cuenta.");
  }
  const organizationId = ficha.organizationId;

  // Path canónico server-built (CHECK M07). El upload va SIN el prefijo del bucket
  // (storage.objects.name no lo incluye — M27).
  const firmaStoragePath = buildFirmaStoragePath({
    organizationId,
    pacienteId,
    archivoUuid: crypto.randomUUID(),
  });
  const pathEnBucket = pathSinBucket(firmaStoragePath);
  const bytes = new Uint8Array(await file.arrayBuffer());

  const supabase = await createSupabaseServerClient();
  const { error: uploadErr } = await supabase.storage
    .from(CONSENT_BUCKET)
    .upload(pathEnBucket, bytes, { contentType: "image/png" });
  if (uploadErr) {
    return err("db_error", "No pudimos subir la firma.", uploadErr.message);
  }

  const created = await createConsentimientoPortal({
    pacienteId,
    plantillaId,
    firmaStoragePath,
  });
  if (!created.ok) {
    // El PNG quedó huérfano y el paciente no tiene DELETE en este bucket (M27):
    // limpieza best-effort con service client. Si también falla, el archivo huérfano
    // es benigno (uuid sin fila que lo referencie).
    try {
      const service = createSupabaseServiceClient();
      await service.storage.from(CONSENT_BUCKET).remove([pathEnBucket]);
    } catch {
      // best-effort: nunca enmascarar el error real del INSERT
    }
    return created;
  }

  return ok({ consentimientoId: created.data.id });
}
