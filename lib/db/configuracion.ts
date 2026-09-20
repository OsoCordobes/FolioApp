
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
import type { PublicLandingViewData } from "@/components/book-landing/book-landing-view";
import { listProfesionalesPublico } from "@/lib/db/members";
import { decodeAvailabilitySnapshot } from "@/lib/agenda/availability-snapshot";
import { createHash } from "node:crypto";

import { decryptColumn, encryptColumn } from "@/lib/crypto";
import { ESPECIALIDAD_SLUGS, type EspecialidadSlug } from "@/lib/especialidades/meta";
import { esIntegracionMuerta } from "@/lib/google/health";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

import { getActiveContext } from "./active-context";
import { err, mapSupabaseError, ok, type Result } from "./errors";

// ─── Shapes ────────────────────────────────────────────────────────────────

export interface ConsultorioData {
  nombre: string;
  /** Texto público de organization.bio; vacío en el editor equivale a NULL. */
  bio: string;
  organizationUpdatedAt: string;
  profileUpdatedAt: string;
  acento: string;
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
  /** M50 · especialidad arquitectural de la org (editable por OWNER/DIRECTOR). */
  especialidad: EspecialidadSlug;
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
  /**
   * true si la integración está MUERTA (refresh token revocado →
   * invalid_grant persistido, o fila sin token): el único arreglo es
   * re-correr el OAuth ("Reconectar"). Computado server-side con
   * esIntegracionMuerta (lib/google/health.ts) — el ciphertext no viaja
   * al cliente.
   */
  muerta: boolean;
}

export type DiaSemanaId = "lun" | "mar" | "mie" | "jue" | "vie" | "sab" | "dom";
export interface DiaHorarios {
  on: boolean;
  franjas: [string, string][];
}

export interface ConfiguracionData {
  consultorio: ConsultorioData;
  publicPreview: PublicLandingViewData | null;
  servicios: ServicioRow[];
  googleCalendar: IntegrationStatus;
  /** Disponibilidad semanal del profesional actual (M04 disponibilidad_profesional). */
  dias: Record<DiaSemanaId, DiaHorarios>;
  /**
   * true si el profesional no tiene NINGUNA franja cargada. No es un detalle
   * cosmético: sin franjas el link público no ofrece un solo turno. La UI lo
   * muestra como anomalía en Horarios en vez de dejar la sección en blanco.
   */
  sinDisponibilidad: boolean;
  horariosContext: HorariosContext;
  /** M43 · si true, las reservas del link público se confirman automáticamente. */
  autoConfirmarReservas: boolean;
  /** M43 · minutos de margen entre slots ofrecidos en el booking público. */
  slotMargenMin: number;
  /**
   * Foto del consultorio ya subida (organization.logo_url), o null. La sube
   * LogoUpload, cuya action persiste sola: acá solo se lee para pintarla.
   */
  logoUrl: string | null;
  /** M49 · tipo de organización. Solo lectura en /configuracion (el upgrade llega con billing por seats — Fase E). */
  tipo: "INDEPENDIENTE" | "CLINICA";
}

// ─── Fetcher ───────────────────────────────────────────────────────────────

export async function getConfiguracionData(expected?: { organizationId: string; memberId: string }): Promise<Result<ConfiguracionData>> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  if (expected && (expected.organizationId !== ctx.data.organization.id || expected.memberId !== ctx.data.session.memberId)) return err("conflict", "Cambió el consultorio activo. Volvé a cargar la página.");

  const supabase = await createSupabaseServerClient();

  // 1. Servicios activos de la org.
  const { data: serviciosRaw, error: servErr } = await supabase
    .from("servicio")
    .select("id, nombre, duracion_min, precio_cents, activo, tipo_canonico, deleted_at")
    .eq("organization_id", ctx.data.organization.id)
    .order("created_at", { ascending: true });

  if (servErr) return err("db_error", "Error leyendo servicios.", servErr.message);

  // 2. Google integration status. refresh_token_cifrado y ultimo_error se
  // leen SOLO para computar `muerta` server-side — no se serializan al cliente.
  // La integración es per-member (unique org+profesional+proveedor): sin el
  // filtro por profesional_id, en una CLINICA con 2+ profesionales conectados
  // .maybeSingle() falla (multiple rows) o muestra el estado de OTRO member.
  const { data: googleIntegration } = await supabase
    .from("integration")
    .select("id, expira_ts, ultimo_error, ultimo_error_ts, ultimo_uso_ts, refresh_token_cifrado")
    .eq("organization_id", ctx.data.organization.id)
    .eq("profesional_id", ctx.data.session.memberId)
    .eq("proveedor", "GOOGLE_CALENDAR")
    .maybeSingle();

  // 3. Organization fields nuevos (M20 agregó telefono_publico / direccion_completa / instagram_handle).
  const { data: orgExtra, error: orgExtraError } = await supabase
    .from("organization")
    .select(
      "telefono_publico, direccion_completa, instagram_handle, auto_confirmar_reservas, slot_margen_min, logo_url, card_mood, bio, updated_at",
    )
    .eq("id", ctx.data.organization.id)
    .maybeSingle();
  if (orgExtraError || !orgExtra) return err("db_error", "No pudimos cargar los datos del consultorio.");
  const { data: profileRevision, error: profileRevisionError } = await supabase
    .from("profile").select("updated_at").eq("id", ctx.data.session.userId).maybeSingle();
  if (profileRevisionError || !profileRevision) return err("db_error", "No pudimos cargar la revisión del perfil.");

  // 4. Una lectura fallida nunca se convierte en una semana vacía editable.
  const snapshot = await readHorarios(expected ?? { organizationId: ctx.data.organization.id, memberId: ctx.data.session.memberId });
  if (!snapshot.ok) return snapshot;
  const { dias, context: horariosContext } = snapshot.data;

  const profesional = [ctx.data.profile.nombre, ctx.data.profile.apellido]
    .filter(Boolean).join(" ").trim() || "—";

  const consultorio: ConsultorioData = {
    nombre: ctx.data.organization.nombre,
    bio: (orgExtra.bio as string | null) ?? "",
    organizationUpdatedAt: orgExtra.updated_at as string,
    profileUpdatedAt: profileRevision.updated_at as string,
    acento: ctx.data.organization.acentoHex || "#8A6722",
    profesional,
    matricula: ctx.data.profile.matricula ?? "",
    email: ctx.data.profile.email,
    tel: (orgExtra?.telefono_publico as string | null) ?? "",
    direccion: (orgExtra?.direccion_completa as string | null) ?? "",
    ciudad: ctx.data.organization.ciudad ?? "",
    provincia: ctx.data.organization.provincia ?? "",
    instagram: (orgExtra?.instagram_handle as string | null) ?? "",
    timezone: ctx.data.organization.timezone || "America/Argentina/Cordoba",
    especialidad: ctx.data.organization.especialidad,
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

  // La vista previa usa la misma composición y los mismos profesionales públicos
  // que /book. Un error de lectura no inventa perfiles clínicos.
  const publicProfiles = await listProfesionalesPublico(ctx.data.organization.id);
  const profesionales = publicProfiles.ok ? publicProfiles.data : [];
  const publicPreview: PublicLandingViewData | null = publicProfiles.ok && orgExtra ? {
    org: {
      slug: ctx.data.organization.slug,
      tipo: ctx.data.organization.tipo,
      nombre: consultorio.nombre,
      ciudad: consultorio.ciudad,
      provincia: consultorio.provincia,
      rubro: ctx.data.organization.rubro,
      especialidad: consultorio.especialidad,
      acentoHex: consultorio.acento,
      logoUrl: (orgExtra?.logo_url as string | null) ?? null,
      cardMood: (orgExtra?.card_mood ?? "editorial") as PublicLandingViewData["org"]["cardMood"],
      bio: (orgExtra?.bio as string | null) ?? null,
      telefonoPublico: consultorio.tel,
      direccionCompleta: consultorio.direccion,
      instagramHandle: consultorio.instagram,
      autoConfirmar: (orgExtra?.auto_confirmar_reservas as boolean | null) ?? true,
    },
    profesional: ctx.data.organization.tipo === "INDEPENDIENTE" && profesionales.length === 1 ? profesionales[0] : null,
    profesionales: ctx.data.organization.tipo === "CLINICA" ? profesionales : [],
    servicios: (serviciosRaw ?? []).filter((service) => service.activo && !service.deleted_at).map((service) => ({
      id: service.id,
      nombre: service.nombre,
      duracion_min: service.duracion_min,
      precio_cents: service.precio_cents,
      tipo_canonico: service.tipo_canonico,
    })),
  } : null;

  return ok({
    consultorio,
    publicPreview,
    servicios,
    googleCalendar: {
      conectado: googleIntegration != null,
      expiraTs: googleIntegration?.expira_ts ?? null,
      ultimoUsoTs: googleIntegration?.ultimo_uso_ts ?? null,
      ultimoErrorTs: googleIntegration?.ultimo_error_ts ?? null,
      muerta:
        googleIntegration != null &&
        esIntegracionMuerta({
          sinToken: !googleIntegration.refresh_token_cifrado,
          ultimoError: googleIntegration.ultimo_error ?? null,
          ultimoErrorTs: googleIntegration.ultimo_error_ts ?? null,
        }),
    },
    dias,
    // Cero franjas = agenda pública en cero. Se calcula sobre las filas leídas,
    // no sobre los toggles: un día "encendido" sin franjas tampoco ofrece nada.
    // Con `dispErr` no afirmamos nada (no sabemos si hay franjas): avisar "no
    // tenés horarios" por un fallo transitorio sería una alarma falsa.
    sinDisponibilidad: Object.values(dias).every((dia) => !dia.on),
    horariosContext,
    // M43 · default true (igual que el DEFAULT de la columna) si la org es
    // anterior a la migración o el campo viene null.
    autoConfirmarReservas: (orgExtra?.auto_confirmar_reservas as boolean | null) ?? true,
    // M43 · default 0 (sin margen) si la org es anterior a la migración o null.
    slotMargenMin: (orgExtra?.slot_margen_min as number | null) ?? 0,
    // La foto del consultorio se sube con LogoUpload, que persiste sola (la
    // action resuelve la org desde la sesión). No pasa por la save-bar: acá
    // solo se lee para pintar la que ya está.
    logoUrl: (orgExtra?.logo_url as string | null) ?? null,
    tipo: ctx.data.organization.tipo,
  });
}

// ─── Mutation: guardar Consultorio ────────────────────────────────────────

const saveConsultorioSchema = z.object({
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
  expectedOrganizationUpdatedAt: z.string().datetime({ offset: true }),
  expectedProfileUpdatedAt: z.string().datetime({ offset: true }),
  organization: z.object({
    nombre: z.string().trim().min(1).max(120).optional(),
    bio: z.string().trim().max(280).optional(),
    ciudad: z.string().max(60).optional(),
    provincia: z.string().max(60).optional(),
    tel: z.string().max(30).optional(),
    direccion: z.string().max(200).optional(),
    instagram: z.string().max(40).optional(),
    timezone: z.string().min(1).max(60).optional(),
    especialidad: z.enum(ESPECIALIDAD_SLUGS).optional(),
  }).strict().optional(),
  profile: z.object({
    profesional: z.string().trim().min(1).max(160).optional(),
    matricula: z.string().max(60).optional(),
  }).strict().optional(),
}).refine((d) => Object.keys(d.organization ?? {}).length + Object.keys(d.profile ?? {}).length > 0);

export type SaveConsultorioInput = z.infer<typeof saveConsultorioSchema>;
export interface SaveConsultorioReceipt { organizationUpdatedAt: string; profileUpdatedAt: string }
const receiptSchema = z.object({
  organizationUpdatedAt: z.string().datetime({ offset: true }),
  profileUpdatedAt: z.string().datetime({ offset: true }),
});

function nullablePublicValue(value: string): string | null { return value.trim() || null; }

/** A lost response can only be confirmed by reading the exact requested fields. */
async function readConsultorioReceipt(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  userId: string,
  orgPatch: Record<string, string | null>,
  requestedProfile: SaveConsultorioInput["profile"],
): Promise<SaveConsultorioReceipt | null> {
  try {
    const [orgResult, profileResult] = await Promise.all([
      client.from("organization")
        .select("id, updated_at, nombre, bio, ciudad, provincia, telefono_publico, direccion_completa, instagram_handle, timezone, especialidad")
        .eq("id", organizationId).is("deleted_at", null).maybeSingle(),
      client.from("profile")
        .select("id, updated_at, nombre_cifrado, apellido_cifrado, matricula")
        .eq("id", userId).maybeSingle(),
    ]);
    if (orgResult.error || !orgResult.data || profileResult.error || !profileResult.data) return null;
    const org = orgResult.data as Record<string, string | null>;
    if (Object.entries(orgPatch).some(([key, value]) => org[key] !== value)) return null;
    const profile = profileResult.data;
    if (requestedProfile?.profesional !== undefined) {
      const [first, ...rest] = requestedProfile.profesional.trim().split(/\s+/);
      if (decryptColumn(profile.nombre_cifrado) !== first ||
          decryptColumn(profile.apellido_cifrado) !== (rest.join(" ") || first)) return null;
    }
    if (requestedProfile?.matricula !== undefined &&
        profile.matricula !== nullablePublicValue(requestedProfile.matricula)) return null;
    const receipt = receiptSchema.safeParse({
      organizationUpdatedAt: orgResult.data.updated_at,
      profileUpdatedAt: profile.updated_at,
    });
    return receipt.success ? receipt.data : null;
  } catch { return null; }
}

/** M127 confirms both writes in one transaction, with current membership and revisions locked. */
export async function saveConsultorio(input: SaveConsultorioInput): Promise<Result<SaveConsultorioReceipt>> {
  const parsed = saveConsultorioSchema.safeParse(input);
  if (!parsed.success) return err("validation", "Datos inválidos.", parsed.error.message);
  const d = parsed.data;
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.organization.id !== d.organizationId || ctx.data.session.memberId !== d.memberId) {
    return err("conflict", "Cambió el consultorio activo. Volvé a cargar la página.");
  }
  if (ctx.data.session.role !== "OWNER" && ctx.data.session.role !== "DIRECTOR") {
    return err("forbidden", "Solo el titular o la dirección pueden editar el consultorio.");
  }

  const orgPatch: Record<string, string | null> = {};
  const o = d.organization;
  if (o?.nombre !== undefined) orgPatch.nombre = o.nombre;
  if (o?.bio !== undefined) orgPatch.bio = nullablePublicValue(o.bio);
  if (o?.ciudad !== undefined) orgPatch.ciudad = nullablePublicValue(o.ciudad);
  if (o?.provincia !== undefined) orgPatch.provincia = nullablePublicValue(o.provincia);
  if (o?.tel !== undefined) orgPatch.telefono_publico = nullablePublicValue(o.tel);
  if (o?.direccion !== undefined) orgPatch.direccion_completa = nullablePublicValue(o.direccion);
  if (o?.instagram !== undefined) orgPatch.instagram_handle = nullablePublicValue(o.instagram);
  if (o?.timezone !== undefined) orgPatch.timezone = o.timezone;
  if (o?.especialidad !== undefined) orgPatch.especialidad = o.especialidad;
  const profilePatch: Record<string, string | null> = {};
  if (d.profile?.profesional !== undefined) {
    const [first, ...rest] = d.profile.profesional.trim().split(/\s+/);
    profilePatch.nombre_cifrado = encryptColumn(first)!;
    profilePatch.apellido_cifrado = encryptColumn(rest.join(" ") || first)!;
  }
  if (d.profile?.matricula !== undefined) profilePatch.matricula = nullablePublicValue(d.profile.matricula);

  const supabase = await createSupabaseServerClient();
  try {
    const { data, error, status } = await supabase.rpc("save_consultorio_atomic", {
      p_org: d.organizationId,
      p_member: d.memberId,
      p_expected_org_updated_at: d.expectedOrganizationUpdatedAt,
      p_expected_profile_updated_at: d.expectedProfileUpdatedAt,
      p_org_patch: orgPatch,
      p_profile_patch: profilePatch,
    });
    if (!error) {
      const receipt = receiptSchema.safeParse(data);
      if (receipt.success) return ok(receipt.data);
    }
    const definitiveCode = error && ["42501", "22023", "23514", "23502", "23505", "PGRST301", "PGRST302"].includes(error.code);
    const uncertainTransport = Boolean(error && !definitiveCode && (status === 0 || !error.code ||
      /fetch failed|failed to fetch|network/i.test(error.message)));
    if (error?.code === "40001" || !error || uncertainTransport) {
      const recovered = await readConsultorioReceipt(supabase, d.organizationId,
        ctx.data.session.userId, orgPatch, d.profile);
      if (recovered) return ok(recovered);
      if (error?.code === "40001") return err("conflict", "El consultorio cambió en otra pestaña. Recargá antes de guardar.");
      return err("network", "No pudimos confirmar el guardado. Conservamos tus cambios; reintentá.");
    }
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  } catch {
    const recovered = await readConsultorioReceipt(supabase, d.organizationId,
      ctx.data.session.userId, orgPatch, d.profile);
    if (recovered) return ok(recovered);
    return err("network", "No pudimos confirmar el guardado. Conservamos tus cambios; reintentá.");
  }
}

/** Guardado aislado del color. La comparación evita reemplazar un cambio
 * reciente hecho en otra pestaña o por otro director. */
export async function savePublicAccent(input: { accent: string; expectedAccent: string; organizationId: string; memberId: string }): Promise<Result<void>> {
  const accentSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
  if (!accentSchema.safeParse(input.accent).success || !accentSchema.safeParse(input.expectedAccent).success ||
      !z.string().uuid().safeParse(input.organizationId).success || !z.string().uuid().safeParse(input.memberId).success) {
    return err("validation", "Elegí un color válido.");
  }
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.organization.id !== input.organizationId || ctx.data.session.memberId !== input.memberId) {
    return err("conflict", "Cambió el consultorio activo. Volvé a cargar la página.");
  }
  if (ctx.data.session.role !== "OWNER" && ctx.data.session.role !== "DIRECTOR") {
    return err("forbidden", "Solo el titular o la dirección pueden editar la página.");
  }
  // M02 permite UPDATE de organization sólo al OWNER bajo RLS. La dirección
  // también puede editar esta identidad pública: revalidar su membresía
  // activa antes de usar el servicio, sin ampliar la policy de toda la tabla.
  const service = createSupabaseServiceClient();
  const { data: member, error: memberError } = await service.from("member")
    .select("id, profile_id, organization_id, role, deleted_at, accepted_at, invited_by_id")
    .eq("id", input.memberId)
    .eq("profile_id", ctx.data.session.userId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (memberError) {
    const mapped = mapSupabaseError(memberError);
    return err(mapped.code, mapped.message, memberError.message);
  }
  if (!member || member.id !== input.memberId || member.profile_id !== ctx.data.session.userId ||
      member.organization_id !== input.organizationId || member.deleted_at !== null ||
      (member.accepted_at === null && member.invited_by_id !== null) ||
      (member.role !== "OWNER" && member.role !== "DIRECTOR")) {
    return err("forbidden", "Ya no tenés permiso para editar esta página. Volvé a cargarla.");
  }
  const { data, error } = await service.from("organization")
    .update({ acento_hex: input.accent })
    .eq("id", input.organizationId)
    .is("deleted_at", null)
    .eq("acento_hex", input.expectedAccent)
    .select("id").maybeSingle();
  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }
  if (!data) {
    // Respuesta perdida tras un COMMIT: leer antes de reintentar evita el falso
    // conflicto sin pisar un tercer color escrito por otra pestaña.
    const { data: current, error: readError } = await service.from("organization")
      .select("acento_hex").eq("id", input.organizationId).is("deleted_at", null).maybeSingle();
    if (readError || !current) return err("db_error", "No pudimos confirmar el color guardado. Recargá la página.");
    if (current.acento_hex !== input.accent) return err("conflict", "El color cambió en otra pestaña. Recargá la página antes de guardar.");
  }
  return ok(undefined);
}

// ─── Mutation: guardar Horarios ───────────────────────────────────────────

const DIA_TO_DOW: Record<DiaSemanaId, number> = {
  dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface HorariosContext { organizationId: string; memberId: string; revision: number; protectedDates: boolean }
export interface HorariosSnapshot { context: HorariosContext; dias: Record<DiaSemanaId, DiaHorarios> }
const expectedHorariosSchema = z.object({ organizationId: z.string().uuid(), memberId: z.string().uuid() });
export async function readHorarios(expected: { organizationId: string; memberId: string }): Promise<Result<HorariosSnapshot>> {
  if (!expectedHorariosSchema.safeParse(expected).success) return err("validation", "Falta identificar la agenda.");
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.organization.id !== expected.organizationId || ctx.data.session.memberId !== expected.memberId) return err("conflict", "Cambió el consultorio activo. Volvé a cargar la página.");
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("read_availability_snapshot", { p_org: expected.organizationId, p_member: expected.memberId });
    if (error) { const mapped = mapSupabaseError(error); return err(mapped.code, mapped.message); }
    const parsed = decodeAvailabilitySnapshot(data, expected);
    return parsed ? ok(parsed) : err("db_error", "No se pudieron leer los horarios. Volvé a intentar.");
  } catch { return err("db_error", "No se pudieron leer los horarios. Volvé a intentar."); }
}
const saveHorariosSchema = expectedHorariosSchema.extend({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), operacionId: z.string().uuid(),
  dias: z.record(z.enum(["lun", "mar", "mie", "jue", "vie", "sab", "dom"]), z.object({
    on: z.boolean(), franjas: z.array(z.tuple([z.string().max(5), z.string().max(5)])).max(12),
  })).superRefine((dias, check) => {
    for (const key of Object.keys(DIA_TO_DOW) as DiaSemanaId[]) {
      const dia = dias[key];
      if (!dia || (dia.on && !dia.franjas.length)) { check.addIssue({ code: z.ZodIssueCode.custom, message: "Semana incompleta" }); continue; }
      if (!dia.on) continue;
      const ordered = [...dia.franjas].sort((a, b) => a[0].localeCompare(b[0]));
      if (ordered.some(([start, end], i) => !HHMM.test(start) || !HHMM.test(end) || start >= end || (i > 0 && start < ordered[i - 1][1]))) check.addIssue({ code: z.ZodIssueCode.custom, message: "Franjas inválidas" });
    }
  }),
});
export type SaveHorariosInput = z.infer<typeof saveHorariosSchema>;
export interface SaveHorariosResult { revision: number; count: number }
/** Revisión y recibo atómicos: reintentar el mismo intento recupera su resultado. */
export async function saveHorarios(input: SaveHorariosInput): Promise<Result<SaveHorariosResult>> {
  const parsed = saveHorariosSchema.safeParse(input);
  if (!parsed.success) return err("validation", "Revisá los días y las franjas: deben estar completas, ordenadas y sin superponerse.");
  const d = parsed.data;
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (!["OWNER", "DIRECTOR", "PROFESIONAL"].includes(ctx.data.session.role)) return err("forbidden", "No tenés permisos para editar horarios.");
  if (ctx.data.organization.id !== d.organizationId || ctx.data.session.memberId !== d.memberId) return err("conflict", "Cambió el consultorio activo. Volvé a cargar la página.");
  const franjas = Object.entries(d.dias).flatMap(([key, dia]) => dia?.on ? dia.franjas.map(([hora_inicio, hora_fin]) => ({ dia_semana: DIA_TO_DOW[key as DiaSemanaId], hora_inicio, hora_fin })) : [])
    .sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio) || a.hora_fin.localeCompare(b.hora_fin));
  const hash = createHash("sha256").update(JSON.stringify([d.revision, franjas])).digest("hex");
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_availability_revision", { p_org: d.organizationId, p_member: d.memberId, p_expected_revision: d.revision, p_operation: d.operacionId, p_hash: hash, p_franjas: franjas });
    if (error) { if (error.code === "40001") return err("conflict", "Los horarios cambiaron desde que abriste la página. Cargá los guardados antes de volver a editar."); const mapped = mapSupabaseError(error); return err(mapped.code, mapped.message); }
    const receipt = z.object({ revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), count: z.number().int().min(0).max(84) }).safeParse(data);
    if (!receipt.success || receipt.data.revision <= d.revision) return err("db_error", "No pudimos confirmar el guardado. Reintentá para recuperar el resultado.");
    return ok(receipt.data);
  } catch { return err("db_error", "No pudimos confirmar el guardado. Reintentá para recuperar el resultado."); }
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

// ─── Query: sesiones con tool_id de otra especialidad (M50 · Fase C) ────────

/**
 * Cuenta las sesiones de la org cuyo `tool_id` pertenece a una especialidad
 * DISTINTA de `nuevaEspecialidad`. /configuracion lo usa para advertir antes
 * de cambiar la especialidad: esos datos clínicos se conservan en DB pero la
 * ficha deja de mostrarlos (el registry solo monta la herramienta activa).
 *
 * Convención de tool_id (M50): "<especialidad>.<tool>.<versión>"
 * ("quiropraxia.spine.v1", "cardiologia.cv.v1", ...). Filtramos por
 * prefijo — criterio CANÓNICO: una futura tool v2 de la misma especialidad no
 * cuenta como ajena; el espejo per-member (countSesionesOtraEspecialidadMember,
 * lib/db/members.ts) usa exactamente el mismo filtro. Filas legacy con tool_id
 * NULL (pre-M50, quiropraxia implícita por vertebras_json) no se cuentan — el
 * reader las maneja con su propio fallback.
 *
 * Usa service client (count-only, sin PHI) con gate de rol app-side, igual
 * criterio que saveConsultorio: solo OWNER/DIRECTOR puede cambiar la
 * especialidad, así que solo ellos necesitan este count.
 */
export async function countSesionesOtraEspecialidad(
  nuevaEspecialidad: string,
): Promise<Result<number>> {
  const parsed = z.enum(ESPECIALIDAD_SLUGS).safeParse(nuevaEspecialidad);
  if (!parsed.success) {
    return err("validation", "Especialidad inválida.");
  }

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER" && ctx.data.session.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER/DIRECTOR puede cambiar la especialidad.");
  }

  const service = createSupabaseServiceClient();
  const { count, error } = await service
    .from("sesion")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.data.organization.id)
    .not("tool_id", "is", null)
    .not("tool_id", "like", `${parsed.data}.%`);

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }
  return ok(count ?? 0);
}
