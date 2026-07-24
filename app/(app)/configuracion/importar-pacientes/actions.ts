"use server";

/**
 * Folio · /configuracion/importar-pacientes · server action del importador CSV.
 *
 * Flujo (espejo de createPaciente en lib/db/pacientes.ts, pero en batch):
 *   1. Sesión + capability gate (canCreatePacienteClinical — la RLS de
 *      `paciente` es el gate real; acá cortamos ANTES de crear identidades
 *      que quedarían huérfanas).
 *   2. Re-parseo server-side del CSV con el MISMO parser puro que usó el
 *      preview del cliente (lib/import/pacientes-csv.ts) — el cliente solo
 *      manda texto crudo + mapeo, nunca filas "ya validadas".
 *   3. Dedupe contra la org por blind index (dni_hash / telefono_hash con
 *      salt per-org, más el hash legacy sin salt de la transición A2 — mismo
 *      doble lookup que buscarPaciente) y dedupe interno del archivo.
 *   4. INSERT batch (identidades → pacientes) vía el server client RLS-aware,
 *      en chunks. Transaccionalidad best-effort: si el insert de `paciente`
 *      falla después del de identidades, las identidades de ESE chunk se
 *      borran con el service client (la policy paciente_identidad_no_delete
 *      bloquea el DELETE RLS-aware; el service client es el único camino y se
 *      acota por id + organization_id).
 *
 * PII: este módulo NUNCA loguea valores de fila. Los motivos de error por
 * fila son categóricos ("teléfono inválido"), sin datos del paciente.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { capabilitiesFor } from "@/lib/auth/capabilities";
import { blindIndex, blindIndexPhone, encryptColumn } from "@/lib/crypto";
import { err, isUniqueViolation, mapSupabaseError, ok, type Result } from "@/lib/db/errors";
import { getActiveSession } from "@/lib/db/session";
import {
  claveDni,
  decidirDedupe,
  MAX_CSV_CHARS,
  MAX_FILAS_IMPORT,
  normalizarFilas,
  parseCsv,
  type DedupeSets,
  type FilaNormalizada,
  type ImportResumen,
} from "@/lib/import/pacientes-csv";
import { trackEvent } from "@/lib/observability/events";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

// ─── Input ──────────────────────────────────────────────────────────────────

const indiceColumna = z.number().int().min(0).max(500);

const importInputSchema = z.object({
  csvText: z.string().min(1).max(MAX_CSV_CHARS),
  mapeo: z.object({
    nombre: indiceColumna,
    apellido: indiceColumna,
    telefono: indiceColumna,
    dni: indiceColumna.optional(),
    email: indiceColumna.optional(),
    fechaNacimiento: indiceColumna.optional(),
  }),
});

export type ImportPacientesInput = z.infer<typeof importInputSchema>;

/** Chunk de INSERT batch: 50 filas ≈ payload chico y blast radius acotado. */
const INSERT_CHUNK = 50;
/** Chunk del lookup `.in()` de hashes: 100 × 64 chars entra cómodo en la URL. */
const LOOKUP_CHUNK = 100;

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface FilaLista {
  fila: number;
  data: FilaNormalizada;
  dniHash: string | null;
  telHash: string | null;
}

export async function importarPacientesAction(
  input: ImportPacientesInput,
): Promise<Result<ImportResumen>> {
  const parsedInput = importInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return err("validation", "El archivo o el mapeo de columnas no son válidos.");
  }
  const { csvText, mapeo } = parsedInput.data;

  const indices = Object.values(mapeo).filter((v): v is number => v !== undefined);
  if (new Set(indices).size !== indices.length) {
    return err("validation", "Cada campo tiene que mapear a una columna distinta.");
  }

  const session = await getActiveSession();
  if (!session.ok) return session;
  const orgId = session.data.organizationId;

  // Mismo gate y mensaje que createPaciente: el par identidad+paciente nace acá.
  const caps = capabilitiesFor(session.data.role, session.data.esColegiado);
  if (!caps.canCreatePacienteClinical) {
    return err(
      "forbidden",
      "Tu rol no permite crear la ficha clínica de un paciente. Pedile a un profesional o a dirección que haga la importación.",
    );
  }

  // ── Parseo + validación por fila ─────────────────────────────────────────
  const csv = parseCsv(csvText);
  if (csv.filas.length === 0) {
    return err("validation", "El archivo no tiene filas de datos (solo encabezado o vacío).");
  }
  if (csv.filas.length > MAX_FILAS_IMPORT) {
    return err(
      "validation",
      `El archivo tiene ${csv.filas.length} filas y el máximo por importación es ${MAX_FILAS_IMPORT}. Dividilo en partes y repetí.`,
    );
  }
  const fueraDeRango = indices.some((i) => i >= csv.headers.length);
  if (fueraDeRango) {
    return err("validation", "El mapeo de columnas no coincide con el archivo. Volvé a subirlo.");
  }

  const resumen: ImportResumen = {
    total: csv.filas.length,
    importados: 0,
    duplicadosDni: 0,
    duplicadosTelefono: 0,
    duplicadosEnArchivo: 0,
    errores: [],
  };

  const validas: FilaLista[] = [];
  for (const r of normalizarFilas(csv.filas, mapeo)) {
    if (!r.ok) {
      resumen.errores.push({ fila: r.fila, motivo: r.motivo });
      continue;
    }
    validas.push({
      fila: r.fila,
      data: r.data,
      // Los hashes se computan sobre la clave normalizada (dni sin puntos,
      // teléfono últimos-10) — el MISMO valor que se cifra en el INSERT.
      dniHash: blindIndex(claveDni(r.data.dni), orgId),
      telHash: blindIndexPhone(r.data.telefono, orgId),
    });
  }

  const supabase = await createSupabaseServerClient();

  // ── Dedupe contra pacientes existentes de la org ─────────────────────────
  // Doble lookup salted + legacy (transición per-tenant salt, audit A2 —
  // mismo criterio que buscarPaciente): un paciente pre-salt tiene el hash
  // sin salt guardado y el lookup solo-salted lo dejaría duplicarse.
  const dniLegacy = new Map<number, string | null>();
  const telLegacy = new Map<number, string | null>();
  // Variante CRUDA del DNI: createPaciente/buscarPaciente hashean el valor tal
  // como se tipeó ("28.456.789" con puntos) — el lookup solo-normalizado no
  // matchearía un paciente cargado a mano y el import lo duplicaría. Se buscan
  // las 4 variantes (normalizada/cruda × salted/legacy) cuando difieren.
  const dniRawSalted = new Map<number, string | null>();
  const dniRawLegacy = new Map<number, string | null>();
  for (const v of validas) {
    dniLegacy.set(v.fila, blindIndex(claveDni(v.data.dni)));
    telLegacy.set(v.fila, blindIndexPhone(v.data.telefono));
    const raw = v.data.dni.trim();
    if (raw && raw !== claveDni(v.data.dni)) {
      dniRawSalted.set(v.fila, blindIndex(raw, orgId));
      dniRawLegacy.set(v.fila, blindIndex(raw));
    }
  }

  const setNoNulos = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => x !== null))];
  const dniBuscar = setNoNulos([
    ...validas.map((v) => v.dniHash),
    ...dniLegacy.values(),
    ...dniRawSalted.values(),
    ...dniRawLegacy.values(),
  ]);
  const telBuscar = setNoNulos([...validas.map((v) => v.telHash), ...telLegacy.values()]);

  const dniDb = await fetchHashesExistentes(supabase, orgId, "dni_hash", dniBuscar);
  if (!dniDb.ok) return dniDb;
  const telDb = await fetchHashesExistentes(supabase, orgId, "telefono_hash", telBuscar);
  if (!telDb.ok) return telDb;

  const existentes: DedupeSets = { dni: dniDb.data, telefono: telDb.data };
  // Traducción legacy → salted: si el hash SIN salt de una fila existe en la
  // DB, marcamos también su hash salted como existente, así decidirDedupe
  // (que compara por clave salted) lo ve.
  for (const v of validas) {
    const dl = dniLegacy.get(v.fila);
    if (v.dniHash && dl && existentes.dni.has(dl)) existentes.dni.add(v.dniHash);
    const drs = dniRawSalted.get(v.fila);
    if (v.dniHash && drs && existentes.dni.has(drs)) existentes.dni.add(v.dniHash);
    const drl = dniRawLegacy.get(v.fila);
    if (v.dniHash && drl && existentes.dni.has(drl)) existentes.dni.add(v.dniHash);
    const tl = telLegacy.get(v.fila);
    if (v.telHash && tl && existentes.telefono.has(tl)) existentes.telefono.add(v.telHash);
  }

  const vistos: DedupeSets = { dni: new Set(), telefono: new Set() };
  const aImportar: FilaLista[] = [];
  for (const v of validas) {
    const decision = decidirDedupe({ dni: v.dniHash, telefono: v.telHash }, existentes, vistos);
    if (decision === "duplicado_dni") resumen.duplicadosDni++;
    else if (decision === "duplicado_telefono") resumen.duplicadosTelefono++;
    else if (decision === "duplicado_en_archivo") resumen.duplicadosEnArchivo++;
    else aImportar.push(v);
  }

  // ── INSERT batch identidades → pacientes ─────────────────────────────────
  // Solo un member colegiado queda como profesional principal; para dirección
  // no colegiada el campo queda NULL (nullable en M03) y se asigna después.
  const profesionalPrincipalId = session.data.esColegiado ? session.data.memberId : null;

  for (let i = 0; i < aImportar.length; i += INSERT_CHUNK) {
    const chunk = aImportar.slice(i, i + INSERT_CHUNK);
    await importarChunk(supabase, chunk, {
      orgId,
      profesionalPrincipalId,
      resumen,
    });
  }

  if (resumen.importados > 0) {
    revalidatePath("/pacientes");
  }
  void trackEvent.pacientesImported({
    orgId,
    total: resumen.total,
    importados: resumen.importados,
    duplicados:
      resumen.duplicadosDni + resumen.duplicadosTelefono + resumen.duplicadosEnArchivo,
    errores: resumen.errores.length,
  });

  // Los errores de formato se acumulan antes que los de INSERT — ordenados
  // por fila se leen como en la planilla.
  resumen.errores.sort((a, b) => a.fila - b.fila);
  return ok(resumen);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Lookup chunked de hashes existentes en `paciente_identidad` (org + vivos).
 * Devuelve el set de hashes ENCONTRADOS en DB. RLS-aware (la policy de select
 * de identidad cubre todos los roles activos de la org).
 */
async function fetchHashesExistentes(
  supabase: Supa,
  orgId: string,
  columna: "dni_hash" | "telefono_hash",
  hashes: string[],
): Promise<Result<Set<string>>> {
  const encontrados = new Set<string>();
  for (let i = 0; i < hashes.length; i += LOOKUP_CHUNK) {
    const chunk = hashes.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from("paciente_identidad")
      .select(columna)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .in(columna, chunk);
    if (error) {
      const mapped = mapSupabaseError(error);
      return err(mapped.code, "Error verificando duplicados.", error.message);
    }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const h = row[columna];
      if (typeof h === "string") encontrados.add(h);
    }
  }
  return ok(encontrados);
}

function buildIdentidadRow(v: FilaLista, orgId: string): Record<string, unknown> {
  const d = v.data;
  return {
    organization_id: orgId,
    nombre_cifrado: encryptColumn(d.nombre),
    apellido_cifrado: encryptColumn(d.apellido),
    tipo_doc: "DNI",
    // d.dni ya viene normalizado (sin puntos) por normalizarFila; el case
    // original se conserva para display — blindIndex lowercasea internamente,
    // así que el hash es idéntico al de claveDni.
    numero_doc_cifrado: encryptColumn(d.dni),
    email_cifrado: encryptColumn(d.email),
    telefono_cifrado: encryptColumn(d.telefono),
    fecha_nacimiento: d.fechaNacimiento,
    nombre_hash: blindIndex(`${d.nombre} ${d.apellido}`, orgId),
    dni_hash: v.dniHash,
    telefono_hash: v.telHash,
  };
}

/**
 * Inserta un chunk (identidades batch → pacientes batch). Muta `resumen`.
 *
 *   - 23505 en el batch de identidades (carrera con un alta concurrente o con
 *     otro import): reintenta FILA POR FILA para reportar el duplicado exacto
 *     sin perder el resto del chunk.
 *   - Falla el batch de pacientes: borra las identidades de ESTE chunk con el
 *     service client (huérfanas de este import, acotadas por id + org).
 */
async function importarChunk(
  supabase: Supa,
  chunk: FilaLista[],
  ctx: {
    orgId: string;
    profesionalPrincipalId: string | null;
    resumen: ImportResumen;
  },
): Promise<void> {
  const { orgId, profesionalPrincipalId, resumen } = ctx;

  const { data: idents, error: idErr } = await supabase
    .from("paciente_identidad")
    .insert(chunk.map((v) => buildIdentidadRow(v, orgId)))
    .select("id");

  if (idErr || !idents || idents.length !== chunk.length) {
    if (isUniqueViolation(idErr)) {
      await importarFilaPorFila(supabase, chunk, ctx);
      return;
    }
    const mapped = idErr
      ? mapSupabaseError(idErr)
      : { message: "No se pudieron crear los pacientes." };
    for (const v of chunk) resumen.errores.push({ fila: v.fila, motivo: mapped.message });
    return;
  }

  // SIN .select(): con RETURNING, Postgres aplica las policies de SELECT de
  // `paciente` (can_read_clinical, M46), que excluyen a DIRECTOR no colegiado
  // — el INSERT pasaba el WITH CHECK pero el RETURNING volvía vacío y el
  // import entero se reportaba como error. El insert sin select va con
  // Prefer: return=minimal (no dispara SELECT) y es atómico: pacErr alcanza.
  const { error: pacErr } = await supabase.from("paciente").insert(
    chunk.map((v, i) => ({
      organization_id: orgId,
      identidad_id: idents[i].id,
      profesional_principal_id: profesionalPrincipalId,
    })),
  );

  if (pacErr) {
    await limpiarIdentidadesHuerfanas(orgId, idents.map((x) => x.id as string));
    const mapped = mapSupabaseError(pacErr);
    for (const v of chunk) resumen.errores.push({ fila: v.fila, motivo: mapped.message });
    return;
  }

  resumen.importados += chunk.length;
}

/**
 * Fallback fila por fila para un chunk cuya inserción batch chocó un UNIQUE
 * (M30): identifica exactamente qué fila es el duplicado (lo cuenta como
 * salteado, no como error) y deja pasar el resto.
 */
async function importarFilaPorFila(
  supabase: Supa,
  chunk: FilaLista[],
  ctx: {
    orgId: string;
    profesionalPrincipalId: string | null;
    resumen: ImportResumen;
  },
): Promise<void> {
  const { orgId, profesionalPrincipalId, resumen } = ctx;

  for (const v of chunk) {
    const { data: ident, error: idErr } = await supabase
      .from("paciente_identidad")
      .insert(buildIdentidadRow(v, orgId))
      .select("id")
      .single();

    if (idErr || !ident) {
      if (idErr && isUniqueViolation(idErr)) {
        const detalle = `${idErr.details ?? ""} ${idErr.message}`;
        if (detalle.includes("telefono_unique_active")) resumen.duplicadosTelefono++;
        else resumen.duplicadosDni++;
        continue;
      }
      const mapped = idErr ? mapSupabaseError(idErr) : { message: "No se pudo crear el paciente." };
      resumen.errores.push({ fila: v.fila, motivo: mapped.message });
      continue;
    }

    // SIN .select() — mismo motivo que el batch: el RETURNING dispararía las
    // policies de SELECT de `paciente` y rompería para DIRECTOR no colegiado.
    const { error: pacErr } = await supabase.from("paciente").insert({
      organization_id: orgId,
      identidad_id: ident.id,
      profesional_principal_id: profesionalPrincipalId,
    });

    if (pacErr) {
      await limpiarIdentidadesHuerfanas(orgId, [ident.id as string]);
      resumen.errores.push({ fila: v.fila, motivo: mapSupabaseError(pacErr).message });
      continue;
    }

    resumen.importados++;
  }
}

/**
 * Borra identidades huérfanas creadas por ESTE import. Va por el service
 * client porque `paciente_identidad_no_delete` (M03) bloquea el DELETE
 * RLS-aware para todos los roles — el filtro por ids exactos que acabamos de
 * insertar + organization_id acota el blast radius. Best-effort: si el borrado
 * falla, la identidad queda huérfana (sin fila `paciente` que la referencie,
 * invisible en la app) y no se corta el resto del import.
 */
async function limpiarIdentidadesHuerfanas(orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const service = createSupabaseServiceClient();
    await service
      .from("paciente_identidad")
      .delete()
      .in("id", ids)
      .eq("organization_id", orgId);
  } catch {
    // Sin log de PII (los ids son opacos, pero el fallo tampoco debe romper).
  }
}
