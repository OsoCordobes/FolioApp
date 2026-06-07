/**
 * Folio · /configuracion data fetcher y mutations (Sprint S1 T-1.9).
 *
 * Para mantener la API del Client Component (heredada del prototipo) usamos
 * un shape `ConsultorioData` que es una mezcla de campos de `organization`
 * y `profile` — al persistir splitteamos las escrituras a las dos tablas.
 *
 * MVP scope:
 *   - Read: org + profile + servicios activos + disponibilidad por día.
 *   - Write: solo Consultorio (org + profile en una sola action). Horarios,
 *     Servicios e Integraciones quedan read-only en MVP (UI mantiene
 *     toggles deshabilitados; un sprint posterior cablea sus actions).
 *
 * Encriptación: el profile.nombre/apellido sigue siendo PII cifrada AES-GCM.
 * El save action re-encripta antes de UPDATE.
 */

import { z } from "zod";

import { encryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { getActiveContext } from "./active-context";
import { err, mapSupabaseError, ok, type Result } from "./errors";

// ─── Shapes ────────────────────────────────────────────────────────────────

export interface ConsultorioData {
  nombre: string;
  profesional: string;
  matricula: string;
  email: string;
  tel: string;
  direccion: string;
  ciudad: string;
  provincia: string;
  instagram: string;
  /** IANA timezone de la org (M02 organization.timezone). */
  timezone: string;
}

export interface ServicioRow {
  id: string;
  nombre: string;
  dur: number;          // duracion_min
  precio: number;       // pesos (precio_cents / 100)
  paraNuevos: boolean;
  activo: boolean;
  paquete?: number;     // sesiones incluidas si es paquete
}

export interface IntegrationStatus {
  conectado: boolean;
  /** ISO timestamp when the OAuth token expires (refresh is automatic). */
  expiraTs: string | null;
  /** ISO timestamp of last sync activity, null when never used. */
  ultimoUsoTs: string | null;
  /** ISO timestamp of last error (token refresh failure, webhook reject, etc.). */
  ultimoErrorTs: string | null;
}

export type DiaSemanaId = "lun" | "mar" | "mie" | "jue" | "vie" | "sab" | "dom";
export interface DiaHorarios {
  on: boolean;
  franjas: [string, string][];
}

export interface ConfiguracionData {
  consultorio: ConsultorioData;
  servicios: ServicioRow[];
  googleCalendar: IntegrationStatus;
  /** Disponibilidad semanal del profesional actual (M04 disponibilidad_profesional). */
  dias: Record<DiaSemanaId, DiaHorarios>;
  /** Duración por defecto de slots en el booking público. */
  slotMin: number;
  /** M43 · si true, las reservas del link público se confirman automáticamente. */
  autoConfirmarReservas: boolean;
  /** M43 · minutos de margen entre slots ofrecidos en el booking público. */
  slotMargenMin: number;
}

// ─── Fetcher ───────────────────────────────────────────────────────────────

const DEFAULT_DIAS: Record<DiaSemanaId, DiaHorarios> = {
  lun: { on: false, franjas: [] },
  mar: { on: false, franjas: [] },
  mie: { on: false, franjas: [] },
  jue: { on: false, franjas: [] },
  vie: { on: false, franjas: [] },
  sab: { on: false, franjas: [] },
  dom: { on: false, franjas: [] },
};

const DOW_TO_DIA: Record<number, DiaSemanaId> = {
  0: "dom", 1: "lun", 2: "mar", 3: "mie", 4: "jue", 5: "vie", 6: "sab",
};

export async function getConfiguracionData(): Promise<Result<ConfiguracionData>> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  const supabase = await createSupabaseServerClient();

  // 1. Servicios activos de la org.
  const { data: serviciosRaw, error: servErr } = await supabase
    .from("servicio")
    .select("id, nombre, duracion_min, precio_cents, activo, tipo_canonico")
    .eq("organization_id", ctx.data.organization.id)
    .order("created_at", { ascending: true });

  if (servErr) return err("db_error", "Error leyendo servicios.", servErr.message);

  // 2. Google integration status.
  const { data: googleIntegration } = await supabase
    .from("integration")
    .select("id, expira_ts, ultimo_error_ts, ultimo_uso_ts")
    .eq("organization_id", ctx.data.organization.id)
    .eq("proveedor", "GOOGLE_CALENDAR")
    .maybeSingle();

  // 3. Organization fields nuevos (M20 agregó telefono_publico / direccion_completa / instagram_handle).
  const { data: orgExtra } = await supabase
    .from("organization")
    .select("telefono_publico, direccion_completa, instagram_handle, auto_confirmar_reservas, slot_margen_min")
    .eq("id", ctx.data.organization.id)
    .maybeSingle();

  // 4. Disponibilidad del profesional activo (member actual).
  const { data: disponibilidad } = await supabase
    .from("disponibilidad_profesional")
    .select("dia_semana, hora_inicio, hora_fin")
    .eq("organization_id", ctx.data.organization.id)
    .eq("member_id", ctx.data.session.memberId)
    .order("dia_semana");

  const dias: Record<DiaSemanaId, DiaHorarios> = JSON.parse(JSON.stringify(DEFAULT_DIAS));
  for (const row of disponibilidad ?? []) {
    const dia = DOW_TO_DIA[row.dia_semana as number];
    if (!dia) continue;
    dias[dia].on = true;
    const hi = String(row.hora_inicio).slice(0, 5);
    const hf = String(row.hora_fin).slice(0, 5);
    dias[dia].franjas.push([hi, hf]);
  }

  const profesional = [ctx.data.profile.nombre, ctx.data.profile.apellido]
    .filter(Boolean).join(" ").trim() || "—";

  const consultorio: ConsultorioData = {
    nombre: ctx.data.organization.nombre,
    profesional,
    matricula: ctx.data.profile.matricula ?? "",
    email: ctx.data.profile.email,
    tel: (orgExtra?.telefono_publico as string | null) ?? "",
    direccion: (orgExtra?.direccion_completa as string | null) ?? "",
    ciudad: ctx.data.organization.ciudad ?? "",
    provincia: ctx.data.organization.provincia ?? "",
    instagram: (orgExtra?.instagram_handle as string | null) ?? "",
    timezone: ctx.data.organization.timezone || "America/Argentina/Cordoba",
  };

  const servicios: ServicioRow[] = (serviciosRaw ?? []).map(
    (row: { id: string; nombre: string; duracion_min: number; precio_cents: number; activo: boolean; tipo_canonico: string }) => ({
      id: row.id,
      nombre: row.nombre,
      dur: row.duracion_min,
      precio: Math.round((row.precio_cents ?? 0) / 100),
      paraNuevos: row.tipo_canonico === "CONSULTA_INICIAL" || row.tipo_canonico === "consulta_inicial",
      activo: row.activo,
    }),
  );

  return ok({
    consultorio,
    servicios,
    googleCalendar: {
      conectado: googleIntegration != null,
      expiraTs: googleIntegration?.expira_ts ?? null,
      ultimoUsoTs: googleIntegration?.ultimo_uso_ts ?? null,
      ultimoErrorTs: googleIntegration?.ultimo_error_ts ?? null,
    },
    dias,
    slotMin: 45,
    // M43 · default true (igual que el DEFAULT de la columna) si la org es
    // anterior a la migración o el campo viene null.
    autoConfirmarReservas: (orgExtra?.auto_confirmar_reservas as boolean | null) ?? true,
    // M43 · default 0 (sin margen) si la org es anterior a la migración o null.
    slotMargenMin: (orgExtra?.slot_margen_min as number | null) ?? 0,
  });
}

// ─── Mutation: guardar Consultorio ────────────────────────────────────────

const saveConsultorioSchema = z.object({
  nombre: z.string().min(1).max(120),
  profesional: z.string().min(1).max(160),
  matricula: z.string().max(60).optional(),
  ciudad: z.string().max(60).optional(),
  provincia: z.string().max(60).optional(),
  tel: z.string().max(30).optional(),
  direccion: z.string().max(200).optional(),
  instagram: z.string().max(60).optional(),
  timezone: z.string().min(1).max(60).optional(),
});

export type SaveConsultorioInput = z.infer<typeof saveConsultorioSchema>;

/**
 * Guarda los campos de "Consultorio" en `organization` + `profile`. El campo
 * profesional se split en nombre/apellido por la primera espacio y se
 * encripta antes de persistir. Tel/dirección/Instagram persisten en las
 * columnas M20 (telefono_publico, direccion_completa, instagram_handle).
 */
export async function saveConsultorio(input: SaveConsultorioInput): Promise<Result<void>> {
  const parsed = saveConsultorioSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER" && ctx.data.session.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER/DIRECTOR puede editar el consultorio.");
  }

  const supabase = await createSupabaseServerClient();

  // 1. UPDATE organization.
  const orgPatch: Record<string, unknown> = {
    nombre: d.nombre,
    ciudad: d.ciudad ?? null,
    provincia: d.provincia ?? null,
    telefono_publico: d.tel && d.tel.length > 0 ? d.tel : null,
    direccion_completa: d.direccion && d.direccion.length > 0 ? d.direccion : null,
    instagram_handle: d.instagram && d.instagram.length > 0 ? d.instagram : null,
  };
  if (d.timezone) {
    orgPatch.timezone = d.timezone;
  }
  const { error: orgErr } = await supabase
    .from("organization")
    .update(orgPatch)
    .eq("id", ctx.data.organization.id);
  if (orgErr) {
    const mapped = mapSupabaseError(orgErr);
    return err(mapped.code, mapped.message, orgErr.message);
  }

  // 2. UPDATE profile.nombre + apellido + matricula.
  const [primerNombre, ...resto] = d.profesional.trim().split(/\s+/);
  const apellido = resto.join(" ");
  const profilePatch: Record<string, unknown> = {
    nombre_cifrado: encryptColumn(primerNombre)!,
    apellido_cifrado: encryptColumn(apellido || primerNombre)!,
    matricula: d.matricula ?? null,
  };
  const { error: profErr } = await supabase
    .from("profile")
    .update(profilePatch)
    .eq("id", ctx.data.profile.id);
  if (profErr) {
    const mapped = mapSupabaseError(profErr);
    return err(mapped.code, mapped.message, profErr.message);
  }

  return ok(undefined);
}

// ─── Mutation: guardar Horarios ───────────────────────────────────────────

const DIA_TO_DOW: Record<DiaSemanaId, number> = {
  dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const saveHorariosSchema = z.object({
  dias: z.record(
    z.enum(["lun", "mar", "mie", "jue", "vie", "sab", "dom"]),
    z.object({
      on: z.boolean(),
      franjas: z.array(z.tuple([z.string().regex(HHMM), z.string().regex(HHMM)])),
    }),
  ),
  slotMin: z.number().int().min(5).max(240),
});

export type SaveHorariosInput = z.infer<typeof saveHorariosSchema>;

/**
 * Reemplaza la disponibilidad semanal del profesional activo en
 * disponibilidad_profesional. Es delete-all + insert-all dentro del
 * member_id corriente. Idempotente en el sentido de que llamarla con la
 * misma data dos veces produce el mismo resultado final.
 */
export async function saveHorarios(input: SaveHorariosInput): Promise<Result<void>> {
  const parsed = saveHorariosSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de horarios inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER" && ctx.data.session.role !== "DIRECTOR" && ctx.data.session.role !== "PROFESIONAL") {
    return err("forbidden", "No tenés permisos para editar horarios.");
  }

  const supabase = await createSupabaseServerClient();

  await supabase
    .from("disponibilidad_profesional")
    .delete()
    .eq("organization_id", ctx.data.organization.id)
    .eq("member_id", ctx.data.session.memberId);

  const rows: Array<{
    organization_id: string;
    member_id: string;
    dia_semana: number;
    hora_inicio: string;
    hora_fin: string;
  }> = [];

  for (const [diaKey, dia] of Object.entries(d.dias)) {
    if (!dia || !dia.on) continue;
    const dow = DIA_TO_DOW[diaKey as DiaSemanaId];
    if (dow == null) continue;
    for (const [hi, hf] of dia.franjas) {
      if (!hi || !hf) continue;
      if (hi >= hf) continue;
      rows.push({
        organization_id: ctx.data.organization.id,
        member_id: ctx.data.session.memberId,
        dia_semana: dow,
        hora_inicio: hi,
        hora_fin: hf,
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("disponibilidad_profesional").insert(rows);
    if (error) {
      const mapped = mapSupabaseError(error);
      return err(mapped.code, mapped.message, error.message);
    }
  }

  // slotMin no tiene columna dedicada en el schema actual — se persiste como
  // metadata local del cliente. Si en el futuro queremos persistirlo (para que
  // el booking público use el slot configurado), agregamos organization.slot_min.

  return ok(undefined);
}

// ─── Mutation: guardar Servicios ──────────────────────────────────────────

const saveServiciosSchema = z.object({
  servicios: z.array(
    z.object({
      id: z.string(),                      // "tmp-..." si es nuevo
      nombre: z.string().min(1).max(120),
      dur: z.number().int().min(5).max(480),
      precio: z.number().min(0).max(10_000_000),
      paraNuevos: z.boolean(),
      activo: z.boolean(),
    }),
  ),
});

export type SaveServiciosInput = z.infer<typeof saveServiciosSchema>;

/**
 * Sync de servicios: actualiza los existentes (id es UUID real), inserta los
 * nuevos (id empieza con "tmp-"), y soft-deletea los que ya no aparecen en
 * la lista entrante (set deleted_at).
 */
export async function saveServicios(input: SaveServiciosInput): Promise<Result<void>> {
  const parsed = saveServiciosSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de servicios inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER" && ctx.data.session.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER/DIRECTOR puede editar servicios.");
  }

  const supabase = await createSupabaseServerClient();

  // Lookup existentes para diff (encontrar los borrados) y para preservar
  // tipo_canonico cuando el usuario solo cambia nombre/precio/duración. Sin esto,
  // un servicio originalmente PACK_SESIONES o SERVICIO_ESPECIALIZADO se resetea
  // a CONSULTA_INICIAL o SEGUIMIENTO_ESTANDAR en cada save — pérdida de info.
  const { data: existentes } = await supabase
    .from("servicio")
    .select("id, tipo_canonico")
    .eq("organization_id", ctx.data.organization.id)
    .is("deleted_at", null);

  const existingIds = new Set((existentes ?? []).map((r) => r.id as string));
  const existingTipoCanonico = new Map(
    (existentes ?? []).map((r) => [r.id as string, r.tipo_canonico as string]),
  );
  const incomingIds = new Set(d.servicios.filter((s) => !s.id.startsWith("tmp-")).map((s) => s.id));

  // Soft-delete los que ya no están.
  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
  if (toDelete.length > 0) {
    await supabase
      .from("servicio")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", toDelete)
      .eq("organization_id", ctx.data.organization.id);
  }

  // Updates / inserts. Para nuevos servicios el tipo se deriva del flag
  // paraNuevos (UI simplificada — solo dos opciones). Para servicios existentes
  // preservamos el tipo_canonico previo a menos que el flag paraNuevos haya
  // cambiado de manera que requiera moverse entre CONSULTA_INICIAL y otro tipo.
  for (const s of d.servicios) {
    if (s.id.startsWith("tmp-")) {
      const tipoCanonico = s.paraNuevos ? "CONSULTA_INICIAL" : "SEGUIMIENTO_ESTANDAR";
      const { error } = await supabase.from("servicio").insert({
        organization_id: ctx.data.organization.id,
        nombre: s.nombre,
        duracion_min: s.dur,
        precio_cents: Math.round(s.precio * 100),
        activo: s.activo,
        tipo_canonico: tipoCanonico,
      });
      if (error) {
        const mapped = mapSupabaseError(error);
        return err(mapped.code, mapped.message, error.message);
      }
    } else {
      // Preservar tipo_canonico existente, salvo que el toggle paraNuevos
      // contradiga el tipo actual (ej. paraNuevos=true en algo que no era
      // CONSULTA_INICIAL → hay que reasignarlo).
      const prev = existingTipoCanonico.get(s.id);
      const isCurrentlyConsultaInicial = prev === "CONSULTA_INICIAL" || prev === "consulta_inicial";
      let tipoCanonico = prev ?? (s.paraNuevos ? "CONSULTA_INICIAL" : "SEGUIMIENTO_ESTANDAR");
      if (s.paraNuevos && !isCurrentlyConsultaInicial) {
        tipoCanonico = "CONSULTA_INICIAL";
      } else if (!s.paraNuevos && isCurrentlyConsultaInicial) {
        tipoCanonico = "SEGUIMIENTO_ESTANDAR";
      }

      const { error } = await supabase
        .from("servicio")
        .update({
          nombre: s.nombre,
          duracion_min: s.dur,
          precio_cents: Math.round(s.precio * 100),
          activo: s.activo,
          tipo_canonico: tipoCanonico,
        })
        .eq("id", s.id)
        .eq("organization_id", ctx.data.organization.id);
      if (error) {
        const mapped = mapSupabaseError(error);
        return err(mapped.code, mapped.message, error.message);
      }
    }
  }

  return ok(undefined);
}

// ─── Mutation: guardar preferencias de booking (M43) ──────────────────────

const saveBookingPrefsSchema = z.object({
  autoConfirmarReservas: z.boolean().optional(),
  slotMargenMin: z.number().int().min(0).max(120).optional(),
});

export type SaveBookingPrefsInput = z.infer<typeof saveBookingPrefsSchema>;

/**
 * Guarda las preferencias del booking público en `organization`:
 * `auto_confirmar_reservas` y `slot_margen_min` (M43). Ambos campos son
 * opcionales — solo se persisten los provistos (patch parcial). Requiere
 * OWNER/DIRECTOR (igual que
 * saveConsultorio). Nota B2: la policy org_update_owner (M02) solo permite
 * UPDATE de organization al OWNER en DB; DIRECTOR pasa el gate de la app pero
 * el UPDATE devuelve 0 filas. Para la demo el profesional es OWNER.
 */
export async function saveBookingPrefs(input: SaveBookingPrefsInput): Promise<Result<void>> {
  const parsed = saveBookingPrefsSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos inválidos.", parsed.error.message);
  }

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER" && ctx.data.session.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER/DIRECTOR puede editar las preferencias de reservas.");
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.autoConfirmarReservas !== undefined) {
    patch.auto_confirmar_reservas = parsed.data.autoConfirmarReservas;
  }
  if (parsed.data.slotMargenMin !== undefined) {
    patch.slot_margen_min = parsed.data.slotMargenMin;
  }
  if (Object.keys(patch).length === 0) {
    return ok(undefined);
  }

  const supabase = await createSupabaseServerClient();
  const { error: orgErr } = await supabase
    .from("organization")
    .update(patch)
    .eq("id", ctx.data.organization.id);
  if (orgErr) {
    const mapped = mapSupabaseError(orgErr);
    return err(mapped.code, mapped.message, orgErr.message);
  }

  return ok(undefined);
}
