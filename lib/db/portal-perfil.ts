/**
 * Folio · auto-gestión de CONTACTO del PORTAL DEL PACIENTE (Fase 3 · P8).
 *
 * El paciente logueado (getPacienteSession → paciente_cuenta_actual() → auth.uid())
 * puede LEER y EDITAR sus datos de CONTACTO y DOMICILIO sobre cada ficha
 * `paciente_identidad` que cuelga de una ficha `paciente` SUYA. Al guardar se
 * recomputan los blind indexes de teléfono/email con el salt POR ORG (los hashes de
 * paciente_identidad están salteados por org — M30/M36/M70).
 *
 * ALLOW-LIST DURA (server-side · integridad de identidad):
 *   EDITABLE   → email, teléfono, domicilio (calle/número/ciudad/provincia/CP).
 *   INMUTABLE  → nombre, apellido, tipo/número de documento (y sus hashes de
 *                identidad). Cambiarlos sería un PEDIDO que el clínico revisa, NO un
 *                auto-servicio del paciente. Este módulo construye el UPDATE con SÓLO
 *                las columnas editables; jamás toca nombre/apellido/doc. El
 *                trigger-guard M86 (paciente_identidad_portal_update_guard) es el
 *                cinturón a nivel DB (rechaza cualquier cambio de identidad aunque un
 *                path futuro arme un UPDATE crudo).
 *
 * PRINCIPIO ANTI-IDOR (crítico · plan Fase 3): TODA query scopea desde la sesión del
 * paciente (cuenta_id = auth.uid() vía las policies M71/M86), NUNCA desde un id que
 * mande el cliente. El identidadId que llega por argumento se valida contra las
 * fichas de la sesión Y la RLS del UPDATE (paciente_identidad_update_portal) lo
 * re-valida — doble gate. El paciente NO tiene acceso a `sesion` (SOAP) — eso es
 * estructural (M71): este módulo sólo toca contacto/domicilio de la PII.
 */

import { z } from "zod";

import {
  blindIndex,
  blindIndexPhone,
  encryptColumn,
  tryDecrypt,
} from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getPacienteSession } from "./paciente-session";

// ═══════════════════════════════════════════════════════════════════════════════
// Allow-list de columnas editables (pura · testeable sin DB)
// ═══════════════════════════════════════════════════════════════════════════════

/** Los campos de CONTACTO/DOMICILIO que el paciente puede auto-gestionar. Es la
 * fuente de verdad de la allow-list del data layer; el schema Zod de abajo la
 * refleja, y el test unitario la contrasta contra las claves de identidad
 * prohibidas. */
export const CAMPOS_CONTACTO_EDITABLES = [
  "email",
  "telefono",
  "domicilioCalle",
  "domicilioNumero",
  "domicilioCiudad",
  "domicilioProvincia",
  "domicilioCp",
] as const;

export type CampoContactoEditable = (typeof CAMPOS_CONTACTO_EDITABLES)[number];

/** Los campos de IDENTIDAD que el paciente NUNCA puede editar desde el portal
 * (integridad de identidad). Un cambio de estos es un pedido revisado por el clínico,
 * no un auto-servicio. La lista es el backstop del test unitario del allow-list. */
export const CAMPOS_IDENTIDAD_PROHIBIDOS = [
  "nombre",
  "apellido",
  "tipoDoc",
  "tipo_doc",
  "numeroDoc",
  "numero_doc",
  "documento",
  "dni",
  "nombreHash",
  "nombre_hash",
  "dniHash",
  "dni_hash",
  "fechaNacimiento",
  "fecha_nacimiento",
  "sexoBiologico",
  "sexo_biologico",
  "organizationId",
  "organization_id",
  "identidadId",
  "identidad_id",
  "pacienteId",
  "deletedAt",
  "deleted_at",
] as const;

/**
 * Filtra un objeto arbitrario del cliente dejando SÓLO las claves de la allow-list de
 * contacto. PURA a propósito (sin I/O) para fijar la invariante "el paciente no edita
 * identidad" en un test sin mockear Supabase. Cualquier clave fuera de la allow-list
 * (incluidas TODAS las de identidad) se descarta silenciosamente — nunca llega al
 * UPDATE. Devuelve el subconjunto sólo-contacto.
 */
export function pickContactoEditable(
  input: Record<string, unknown>,
): Partial<Record<CampoContactoEditable, unknown>> {
  const editable = new Set<string>(CAMPOS_CONTACTO_EDITABLES);
  const out: Partial<Record<CampoContactoEditable, unknown>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (editable.has(key)) {
      out[key as CampoContactoEditable] = value;
    }
  }
  return out;
}

/**
 * ¿El objeto del cliente INTENTA modificar algún campo de identidad? PURA. Devuelve
 * la primera clave de identidad prohibida presente, o `null` si el objeto es
 * sólo-contacto. NO se usa para rechazar (el UPDATE ignora las claves de más de todos
 * modos vía pickContactoEditable), sino como aserción del test y para telemetría
 * futura: un cliente honesto nunca las manda.
 */
export function detectaCampoIdentidad(
  input: Record<string, unknown>,
): string | null {
  const prohibidas = new Set<string>(
    CAMPOS_IDENTIDAD_PROHIBIDOS.map((k) => k.toLowerCase()),
  );
  for (const key of Object.keys(input)) {
    if (prohibidas.has(key.toLowerCase())) return key;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lectura del perfil de contacto (RLS-enforced · una ficha por org linkeada)
// ═══════════════════════════════════════════════════════════════════════════════

/** El perfil de contacto de UNA ficha `paciente` linkeada, tal como lo edita el
 * paciente en el portal. Incluye el nombre/documento en SÓLO LECTURA (para que sepa
 * cuál ficha está editando) y los campos editables. NUNCA expone SOAP ni tool_data
 * (el paciente no tiene grant a `sesion` · M71). */
export interface PortalPerfilView {
  /** id de la fila paciente_identidad (target del UPDATE, self-scoped por la sesión). */
  identidadId: string;
  pacienteId: string;
  organizationId: string;
  organizacionNombre: string | null;
  /** Sólo lectura (identidad · el paciente no los edita desde el portal). */
  nombre: string | null;
  apellido: string | null;
  documento: string | null;
  /** Editables (contacto + domicilio). */
  email: string | null;
  telefono: string | null;
  domicilioCalle: string | null;
  domicilioNumero: string | null;
  domicilioCiudad: string | null;
  domicilioProvincia: string | null;
  domicilioCp: string | null;
}

interface IdentidadEmbed {
  id: string;
  nombre_cifrado: Buffer | null;
  apellido_cifrado: Buffer | null;
  numero_doc_cifrado: Buffer | null;
  email_cifrado: Buffer | null;
  telefono_cifrado: Buffer | null;
  domicilio_calle_cifrado: Buffer | null;
  domicilio_numero_cifrado: Buffer | null;
  domicilio_ciudad: string | null;
  domicilio_provincia: string | null;
  domicilio_cp: string | null;
}

/**
 * Lee el perfil de contacto de TODAS las fichas del paciente logueado (una por org
 * linkeada), bajo la RLS de auto-lectura (M71) por el cliente ANON — sólo devuelve
 * las fichas que cuelgan de su cuenta. Descifra la PII server-side (tryDecrypt:
 * degrada a null si el ciphertext está corrupto, no rompe la pantalla). NUNCA toca
 * `sesion`.
 */
export async function getPortalPerfiles(): Promise<Result<PortalPerfilView[]>> {
  const session = await getPacienteSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // Nombre de la org por id, desde el fan-out de la sesión (P3). El paciente NO es
  // member ⇒ no puede leer `organization` (org_select_own, M02): el nombre sale de la
  // sesión, no de un embed que la RLS devolvería NULL.
  const nombrePorOrg = new Map<string, string | null>();
  for (const p of session.data.pacientes) {
    nombrePorOrg.set(p.organizationId, p.organizacionNombre);
  }

  // Las fichas del paciente + su identidad embebida (RLS M71: paciente_select_portal
  // + paciente_identidad_select_portal). El paciente_id/identidad NO salen del
  // cliente: la RLS restringe a lo que cuelga de su cuenta.
  const { data, error } = await supabase
    .from("paciente")
    .select(
      "id, organization_id, identidad_id, " +
        "paciente_identidad(" +
        "id, nombre_cifrado, apellido_cifrado, numero_doc_cifrado, email_cifrado, " +
        "telefono_cifrado, domicilio_calle_cifrado, domicilio_numero_cifrado, " +
        "domicilio_ciudad, domicilio_provincia, domicilio_cp" +
        ")",
    )
    .eq("cuenta_id", session.data.cuentaId)
    .is("pseudonimizado_en", null);

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, "No se pudo cargar tu perfil.", error.message);
  }

  const perfiles: PortalPerfilView[] = [];
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const identidadRaw = row.paciente_identidad;
    const id = Array.isArray(identidadRaw) ? identidadRaw[0] : identidadRaw;
    if (!id) continue; // ficha pseudonimizada / sin identidad → nada que mostrar.
    const identidad = id as unknown as IdentidadEmbed;
    const orgId = String(row.organization_id);

    perfiles.push({
      identidadId: String(identidad.id),
      pacienteId: String(row.id),
      organizationId: orgId,
      organizacionNombre: nombrePorOrg.get(orgId) ?? null,
      nombre: tryDecrypt(identidad.nombre_cifrado, "paciente_identidad.nombre"),
      apellido: tryDecrypt(identidad.apellido_cifrado, "paciente_identidad.apellido"),
      documento: tryDecrypt(identidad.numero_doc_cifrado, "paciente_identidad.numero_doc"),
      email: tryDecrypt(identidad.email_cifrado, "paciente_identidad.email"),
      telefono: tryDecrypt(identidad.telefono_cifrado, "paciente_identidad.telefono"),
      domicilioCalle: tryDecrypt(
        identidad.domicilio_calle_cifrado,
        "paciente_identidad.domicilio_calle",
      ),
      domicilioNumero: tryDecrypt(
        identidad.domicilio_numero_cifrado,
        "paciente_identidad.domicilio_numero",
      ),
      domicilioCiudad: identidad.domicilio_ciudad ?? null,
      domicilioProvincia: identidad.domicilio_provincia ?? null,
      domicilioCp: identidad.domicilio_cp ?? null,
    });
  }

  return ok(perfiles);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edición del contacto (allow-list server-side + recompute de hashes por org)
// ═══════════════════════════════════════════════════════════════════════════════

/** Schema del input de edición. `.strict()`: cualquier clave FUERA de la allow-list
 * (incluidas TODAS las de identidad — nombre/apellido/documento) hace fallar la
 * validación. Es la primera línea del allow-list; el UPDATE construido más abajo sólo
 * setea columnas de contacto, y el trigger-guard M86 es el cinturón a nivel DB. */
const updateContactoSchema = z
  .object({
    identidadId: z.string().uuid(),
    email: z.string().email().max(320).nullable().optional(),
    telefono: z.string().min(6).max(30).nullable().optional(),
    domicilioCalle: z.string().max(120).nullable().optional(),
    domicilioNumero: z.string().max(20).nullable().optional(),
    domicilioCiudad: z.string().max(60).nullable().optional(),
    domicilioProvincia: z.string().max(60).nullable().optional(),
    domicilioCp: z.string().max(15).nullable().optional(),
  })
  .strict();

export type UpdatePortalContactoInput = z.infer<typeof updateContactoSchema>;

/** ¿El valor es "presente" en el input? (la clave existe, incluso si es `null` para
 * BORRAR el dato). undefined = "no se toca". Normaliza strings vacíos a null (borrar).
 */
function normalizarOpcional(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Actualiza el contacto/domicilio de UNA ficha del paciente logueado. RLS-enforced
 * end-to-end + allow-list server-side:
 *
 *   1. Sesión de portal (paciente_cuenta viva).
 *   2. Gate app anti-IDOR: la identidadId debe pertenecer a una ficha `paciente` de
 *      la SESIÓN. La resolvemos leyendo bajo RLS (paciente_select_portal, M71); si no
 *      es suya → not_found. La RLS del UPDATE (paciente_identidad_update_portal, M86)
 *      lo re-valida (Gate 2).
 *   3. Construye el UPDATE con SÓLO columnas de contacto (allow-list dura). Recomputa
 *      telefono_hash / email_hash con el salt de la org de la ficha (blindIndex por
 *      org). NUNCA toca nombre/apellido/documento/hashes de identidad → el
 *      trigger-guard M86 es el backstop.
 *   4. UPDATE por el cliente ANON. La RLS + el guard son la verdad; si la fila no es
 *      del paciente, 0 filas (o el guard RAISE 42501 → forbidden).
 *
 * Sin campos presentes (todos undefined) → validation (nada para actualizar).
 */
export async function updatePortalContacto(
  input: UpdatePortalContactoInput,
): Promise<Result<{ identidadId: string }>> {
  const parsed = updateContactoSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de contacto inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  const session = await getPacienteSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // Gate 1 (app · anti-IDOR): la identidad debe colgar de una ficha `paciente` de la
  // sesión. Leemos la ficha por identidad_id bajo RLS (M71 sólo devuelve las del
  // paciente) para obtener su organization_id (necesario para el salt de los hashes).
  // Si la RLS no la devuelve → not_found (no revelamos existencia de fichas ajenas).
  const { data: ficha, error: fichaErr } = await supabase
    .from("paciente")
    .select("id, organization_id, identidad_id")
    .eq("identidad_id", d.identidadId)
    .eq("cuenta_id", session.data.cuentaId)
    .is("pseudonimizado_en", null)
    .maybeSingle();

  if (fichaErr) {
    const mapped = mapSupabaseError(fichaErr);
    return err(mapped.code, mapped.message, fichaErr.message);
  }
  if (!ficha) {
    return err("not_found", "Esa ficha no está vinculada a tu cuenta.");
  }
  const orgId = String(ficha.organization_id);

  // 3. Construir el UPDATE con SÓLO columnas de contacto. Cada campo se incluye SÓLO
  //    si está presente en el input (undefined = "no tocar"; null/"" = "borrar").
  //    El teléfono/email además recomputan su blind index por org.
  const patch: Record<string, unknown> = {};

  const emailNorm = normalizarOpcional(d.email);
  if (emailNorm !== undefined) {
    patch.email_cifrado = encryptColumn(emailNorm);
    // email_hash: blind index salteado por org (M70). null si se borró el email.
    patch.email_hash = emailNorm ? blindIndex(emailNorm.toLowerCase(), orgId) : null;
  }

  const telNorm = normalizarOpcional(d.telefono);
  if (telNorm !== undefined) {
    // telefono_cifrado es NOT NULL en el esquema (M03): si el paciente intenta
    // borrarlo, lo rechazamos (el teléfono es el contacto operativo mínimo).
    if (telNorm === null) {
      return err("validation", "El teléfono no puede quedar vacío.");
    }
    patch.telefono_cifrado = encryptColumn(telNorm);
    patch.telefono_hash = blindIndexPhone(telNorm, orgId);
  }

  const calleNorm = normalizarOpcional(d.domicilioCalle);
  if (calleNorm !== undefined) patch.domicilio_calle_cifrado = encryptColumn(calleNorm);

  const numeroNorm = normalizarOpcional(d.domicilioNumero);
  if (numeroNorm !== undefined) patch.domicilio_numero_cifrado = encryptColumn(numeroNorm);

  const ciudadNorm = normalizarOpcional(d.domicilioCiudad);
  if (ciudadNorm !== undefined) patch.domicilio_ciudad = ciudadNorm;

  const provinciaNorm = normalizarOpcional(d.domicilioProvincia);
  if (provinciaNorm !== undefined) patch.domicilio_provincia = provinciaNorm;

  const cpNorm = normalizarOpcional(d.domicilioCp);
  if (cpNorm !== undefined) patch.domicilio_cp = cpNorm;

  if (Object.keys(patch).length === 0) {
    return err("validation", "No hay ningún cambio para guardar.");
  }

  // 4. UPDATE self-scoped bajo RLS (paciente_identidad_update_portal, M86) + el
  //    trigger-guard. El .eq('id', ...) apunta a la identidad; la RLS ya restringe a
  //    las del paciente. Si no es suya → 0 filas → conflict.
  const { data: updated, error: updErr } = await supabase
    .from("paciente_identidad")
    .update(patch)
    .eq("id", d.identidadId)
    .is("deleted_at", null)
    .select("id");

  if (updErr) {
    const mapped = mapSupabaseError(updErr);
    // El trigger-guard RAISE con ERRCODE 42501 → mapSupabaseError lo mapea a
    // 'forbidden'; lo enriquecemos para el portal.
    if (mapped.code === "forbidden") {
      return err(
        "forbidden",
        "No se pudo actualizar tu contacto. Sólo podés editar contacto y domicilio.",
        updErr.message,
      );
    }
    return err(mapped.code, mapped.message, updErr.message);
  }
  if (!updated || updated.length === 0) {
    return err(
      "conflict",
      "No se pudo actualizar tu contacto. Actualizá la página e intentá de nuevo.",
    );
  }

  return ok({ identidadId: d.identidadId });
}
