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

export interface ConfiguracionData {
  consultorio: ConsultorioData;
  servicios: ServicioRow[];
  googleConectado: boolean;
  /** Opt-out de analytics anonimizadas k-anónimas (organization.opt_out_analytics). */
  optOutAnalytics: boolean;
}

// ─── Fetcher ───────────────────────────────────────────────────────────────

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

  // 3. Address-related fields tampoco están en active-context — los leemos puntualmente.
  //    organization tiene ciudad/provincia/timezone/cuit; profile tiene nombre/matricula.
  //    El "telefono" y "direccion" del consultorio aún no tienen columnas dedicadas en
  //    organization (M02). Para MVP los leemos de columnas auxiliares si existen, sino "—".
  const profesional = [ctx.data.profile.nombre, ctx.data.profile.apellido]
    .filter(Boolean).join(" ").trim() || "—";

  const consultorio: ConsultorioData = {
    nombre: ctx.data.organization.nombre,
    profesional,
    matricula: ctx.data.profile.matricula ?? "",
    email: ctx.data.profile.email,
    tel: "",                        // futuro: organization.telefono cuando exista columna
    direccion: "",                  // futuro: organization.direccion
    ciudad: ctx.data.organization.ciudad ?? "",
    provincia: ctx.data.organization.provincia ?? "",
    instagram: "",                  // futuro: organization.instagram_handle
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
    googleConectado: googleIntegration != null,
    optOutAnalytics: ctx.data.organization.optOutAnalytics,
  });
}

// ─── Mutation: guardar Consultorio ────────────────────────────────────────

const saveConsultorioSchema = z.object({
  nombre: z.string().min(1).max(120),
  profesional: z.string().min(1).max(160),
  matricula: z.string().max(60).optional(),
  ciudad: z.string().max(60).optional(),
  provincia: z.string().max(60).optional(),
});

export type SaveConsultorioInput = z.infer<typeof saveConsultorioSchema>;

/**
 * Guarda los campos de "Consultorio" en `organization` + `profile`. El campo
 * profesional se split en nombre/apellido por la primera espacio y se
 * encripta antes de persistir.
 *
 * Los campos `tel`/`direccion`/`instagram` NO se persisten todavía: no hay
 * columna en el schema actual (M02 no las tiene). Cuando se agreguen en
 * una migration posterior, este action se expande.
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
  };
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
