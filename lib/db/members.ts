/**
 * Folio · equipo: members + invitaciones (M49/M51 · Fase C tiers Solo/Clinic).
 *
 * Capa de datos de la sección "Equipo" de /configuracion:
 *   - listMembers / listInvitations: lectura para la UI de gestión.
 *   - createInvitation: genera token + INSERT en member_invitation.
 *   - revokeInvitation / removeMember: bajas.
 *
 * Seguridad:
 *   - TODAS las escrituras van por el server client RLS-aware. El gate real
 *     son las policies de M49 (solo OWNER/DIRECTOR de la org) + M51 (solo
 *     orgs tipo CLINICA pueden invitar). Los checks app-side de acá replican
 *     esos gates para dar mensajes claros — si divergen, gana la RLS.
 *   - El token crudo se genera con crypto.randomBytes(32) (base64url) y en DB
 *     solo se guarda su sha256 hex (mismo hash que replica
 *     accept_member_invitation con pgcrypto digest()). El token JAMÁS se
 *     persiste ni se loguea: solo viaja en el email y en el Result al
 *     OWNER/DIRECTOR que lo creó (para el botón "copiar link").
 *   - Excepción documentada de service client: profile tiene RLS
 *     `profile_select_self` (M02) — un OWNER NO puede leer los profiles de
 *     sus propios members vía RLS. Para mostrar nombre/email del equipo
 *     usamos una lectura ANGOSTA con service client, acotada a los
 *     profile_ids que la query RLS de `member` ya devolvió (o sea: el scoping
 *     de tenant lo hizo la RLS; el service client solo desreferencia PII de
 *     display) y gateada app-side por capabilities.canManageTeam. Sin PHI.
 */

import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import type { ProfesionalLite } from "@/lib/agenda/profesional";
import { capabilitiesFor, type Role } from "@/lib/auth/capabilities";
import { decryptColumn } from "@/lib/crypto";
import {
  ESPECIALIDAD_SLUGS,
  getEspecialidadMeta,
  isEspecialidadSlug,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

import { getActiveContext, type ActiveContext } from "./active-context";
import { writeAuditEntry } from "./audit";
import { err, isUniqueViolation, mapSupabaseError, ok, type Result } from "./errors";
import { syncSubscriptionAmountInBackground } from "./suscripcion";

// ─── Shapes ────────────────────────────────────────────────────────────────

export type InvitableRole = "PROFESIONAL" | "ASISTENTE" | "COORDINADOR" | "DIRECTOR";

export interface TeamMemberRow {
  memberId: string;
  profileId: string;
  role: Role;
  esColegiado: boolean;
  /**
   * M55 · especialidad propia del profesional, o null = hereda la de la org.
   * Solo significativa para colegiados (decide su herramienta clínica).
   */
  especialidad: EspecialidadSlug | null;
  /** PII de profile desencriptada server-side (tryDecrypt — null si falla). */
  nombre: string | null;
  apellido: string | null;
  email: string | null;
  /** true si es el member de la sesión actual (la UI bloquea auto-baja). */
  esVos: boolean;
  acceptedAt: string | null;
  createdAt: string;
}

export interface TeamInvitationRow {
  id: string;
  email: string;
  role: InvitableRole;
  esColegiado: boolean;
  /**
   * Estado para la UI. `EXPIRADA` se MATERIALIZA acá comparando
   * expires_at < now() — en DB la fila sigue PENDIENTE (el accept con
   * excepción hace rollback y no puede marcarla, ver M49 §6).
   */
  estado: "PENDIENTE" | "EXPIRADA";
  expiresAt: string;
  createdAt: string;
}

export interface CreatedInvitation {
  invitation: TeamInvitationRow;
  /**
   * Link de aceptación con el token crudo. Solo se devuelve UNA vez, al
   * OWNER/DIRECTOR que creó la invitación (para copiar/compartir si el email
   * no sale). No persistirlo ni loguearlo.
   */
  acceptUrl: string;
  /** Para que la action arme el email sin otro round-trip. */
  organizationNombre: string;
  organizationTimezone: string | null;
  invitedByNombre: string | null;
  expiresAtIso: string;
}

/** Límite anti-abuso de invitaciones PENDIENTES simultáneas por org. */
const MAX_PENDING_INVITATIONS = 20;

// ─── Helpers ───────────────────────────────────────────────────────────────

function tryDecrypt(value: string | null, label: string): string | null {
  if (!value) return null;
  try {
    return decryptColumn(value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[members] ${label}: decrypt falló (${msg}).`);
    return null;
  }
}

/** Gate app-side compartido: contexto + canManageTeam. */
async function requireTeamManager(): Promise<Result<ActiveContext>> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  const caps = capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado);
  if (!caps.canManageTeam) {
    return err("forbidden", "Solo dirección puede gestionar el equipo.");
  }
  return ctx;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
}

// ─── listMembers ───────────────────────────────────────────────────────────

export async function listMembers(): Promise<Result<TeamMemberRow[]>> {
  const ctx = await requireTeamManager();
  if (!ctx.ok) return ctx;

  const supabase = await createSupabaseServerClient();

  // 1. Members activos vía RLS (member_select_same_org — scoping real de tenant).
  const { data: members, error } = await supabase
    .from("member")
    .select("id, profile_id, role, es_colegiado, especialidad, accepted_at, created_at")
    .eq("organization_id", ctx.data.organization.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  const rows = (members ?? []) as Array<{
    id: string;
    profile_id: string;
    role: Role;
    es_colegiado: boolean;
    especialidad: EspecialidadSlug | null;
    accepted_at: string | null;
    created_at: string;
  }>;

  // 2. PII de display de esos profiles — service client ANGOSTO (ver header):
  //    profile_select_self impide leer profiles ajenos vía RLS; los ids ya
  //    vienen del query RLS-scoped de arriba.
  const profileIds = rows.map((m) => m.profile_id);
  const profilesById = new Map<
    string,
    { email: string | null; nombre: string | null; apellido: string | null }
  >();
  if (profileIds.length > 0) {
    const service = createSupabaseServiceClient();
    const { data: profiles, error: profErr } = await service
      .from("profile")
      .select("id, email, nombre_cifrado, apellido_cifrado")
      .in("id", profileIds);
    if (profErr) {
      return err("db_error", "Error leyendo los datos del equipo.", profErr.message);
    }
    for (const p of (profiles ?? []) as Array<{
      id: string;
      email: string | null;
      nombre_cifrado: string | null;
      apellido_cifrado: string | null;
    }>) {
      profilesById.set(p.id, {
        email: p.email,
        nombre: tryDecrypt(p.nombre_cifrado, "profile.nombre_cifrado"),
        apellido: tryDecrypt(p.apellido_cifrado, "profile.apellido_cifrado"),
      });
    }
  }

  return ok(
    rows.map((m) => {
      const p = profilesById.get(m.profile_id);
      return {
        memberId: m.id,
        profileId: m.profile_id,
        role: m.role,
        esColegiado: m.es_colegiado,
        especialidad: m.especialidad,
        nombre: p?.nombre ?? null,
        apellido: p?.apellido ?? null,
        email: p?.email ?? null,
        esVos: m.id === ctx.data.session.memberId,
        acceptedAt: m.accepted_at,
        createdAt: m.created_at,
      };
    }),
  );
}

// ─── listProfesionalesLite ─────────────────────────────────────────────────

/**
 * Colegiados activos de la org de la sesión, reducidos a {id, displayName}
 * para el selector de profesional de /hoy y /calendario y la atribución de
 * turnos. Disponible para TODOS los roles autenticados (es solo display name,
 * sin PHI clínica): la agenda compartida ya muestra estos turnos y la RLS
 * `member_select_same_org` (M02) permite a cualquier member leer los members
 * de su propia org — acá NO se gatea con canManageTeam a propósito.
 *
 * Display name: profile.nombre/apellido (decrypt server-side, mismo patrón
 * de lectura ANGOSTA con service client que listMembers — los profile_ids ya
 * vienen del query RLS-scoped de member) con fallback al email.
 */
export async function listProfesionalesLite(
  /**
   * Org activa, si el caller ya la tiene (las pages de /hoy y /calendario la
   * tienen siempre): evita un segundo getActiveContext() en las dos páginas
   * más calientes de la app (review PR #49). Sin argumento, se resuelve acá.
   */
  organizationId?: string,
): Promise<Result<ProfesionalLite[]>> {
  let orgId = organizationId;
  if (!orgId) {
    const ctx = await getActiveContext();
    if (!ctx.ok) return ctx;
    orgId = ctx.data.organization.id;
  }

  const supabase = await createSupabaseServerClient();
  return listProfesionalesLiteCore(supabase, orgId, { emailFallback: true });
}

/**
 * Variante PÚBLICA (CLINICA-4): colegiados activos para el wizard de
 * /book/[slug] — paso "Elegí profesional" y lista bajo la card. NO hay
 * sesión, así que la query de `member` también va por el SERVICE client
 * (con el server client RLS-aware devolvería 0 filas y el booking
 * multi-profesional moriría silenciosamente).
 *
 * Seguridad/privacidad:
 *   - El caller DEBE haber validado la org antes (slug → org viva, no
 *     deslistada) — mismo contrato que fetchSlotsPublico.
 *   - Expone SOLO {id, displayName}: el member.id es un uuid opaco que el
 *     wizard necesita como value del selector; el nombre es la cara del
 *     consultorio ("Dra. López"), igual que en la card pública.
 *   - SIN fallback a email (acá emailFallback=false): el email del
 *     profesional no es público — si el nombre no descifra, "Profesional".
 */
export async function listProfesionalesLitePublico(
  organizationId: string,
): Promise<Result<ProfesionalLite[]>> {
  const service = createSupabaseServiceClient();
  return listProfesionalesLiteCore(service, organizationId, { emailFallback: false });
}

/**
 * Core compartido. `memberClient` es el client que lee `member`: el server
 * client RLS-aware en el flujo autenticado, el service client en el público.
 * El predicado (es_colegiado + deleted_at IS NULL, ORDER BY created_at ASC)
 * es EL MISMO que resolveProfesionalPublico (lib/db/profesional-destino.ts):
 * si divergen, el wizard ofrece profesionales que el server rechaza.
 */
async function listProfesionalesLiteCore(
  memberClient: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  orgId: string,
  opts: { emailFallback: boolean },
): Promise<Result<ProfesionalLite[]>> {
  const { data, error } = await memberClient
    .from("member")
    .select("id, profile_id")
    .eq("organization_id", orgId)
    .eq("es_colegiado", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  const rows = (data ?? []) as Array<{ id: string; profile_id: string }>;
  if (rows.length === 0) return ok([]);

  // PII de display vía service client ANGOSTO (ver header del módulo).
  const profilesById = new Map<string, string>();
  const service = createSupabaseServiceClient();
  const { data: profiles, error: profErr } = await service
    .from("profile")
    .select("id, email, nombre_cifrado, apellido_cifrado")
    .in("id", rows.map((m) => m.profile_id));
  if (profErr) {
    return err("db_error", "Error leyendo los profesionales.", profErr.message);
  }
  for (const p of (profiles ?? []) as Array<{
    id: string;
    email: string | null;
    nombre_cifrado: string | null;
    apellido_cifrado: string | null;
  }>) {
    const nombre = tryDecrypt(p.nombre_cifrado, "profile.nombre_cifrado");
    const apellido = tryDecrypt(p.apellido_cifrado, "profile.apellido_cifrado");
    const display =
      [nombre, apellido].filter(Boolean).join(" ").trim() ||
      (opts.emailFallback ? p.email : null) ||
      "Profesional";
    profilesById.set(p.id, display);
  }

  return ok(
    rows.map((m) => ({
      id: m.id,
      displayName: profilesById.get(m.profile_id) ?? "Profesional",
    })),
  );
}

// ─── listProfesionalesPublico (M62 · perfil público rico) ───────────────────

/**
 * Perfil público RICO de un colegiado para la landing /book/[slug] (M62):
 * además del display name, expone foto, bio y (opt-in) matrícula. Paralelo a
 * listProfesionalesLitePublico (que NO se toca — alimenta el selector del
 * wizard y la agenda, que deben quedar en {id, displayName}).
 *
 * Mismo contrato de seguridad que el lite: el caller validó la org (slug → org
 * viva, no deslistada); service client (sin sesión); mismo predicado
 * (es_colegiado + deleted_at IS NULL, ORDER BY created_at ASC) que
 * resolveProfesionalPublico. Decrypt del nombre SIN fallback a email. La
 * matrícula (profile.matricula) SOLO se emite cuando member.mostrar_matricula
 * === true (opt-in del profesional); jamás email ni columnas cifradas.
 */
export interface ProfesionalPerfilPublico {
  /** member.id — uuid opaco. */
  id: string;
  /** "Nombre Apellido" descifrado server-side, fallback "Profesional". */
  displayName: string;
  /** member.foto_publica_url o null → la landing renderea iniciales. */
  fotoUrl: string | null;
  /** member.bio_publica o null. */
  bioPublica: string | null;
  /** profile.matricula SOLO si member.mostrar_matricula; si no, null. */
  matricula: string | null;
}

export async function listProfesionalesPublico(
  organizationId: string,
): Promise<Result<ProfesionalPerfilPublico[]>> {
  const service = createSupabaseServiceClient();

  const { data, error } = await service
    .from("member")
    .select("id, profile_id, foto_publica_url, bio_publica, mostrar_matricula")
    .eq("organization_id", organizationId)
    .eq("es_colegiado", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    profile_id: string;
    foto_publica_url: string | null;
    bio_publica: string | null;
    mostrar_matricula: boolean;
  }>;
  if (rows.length === 0) return ok([]);

  // PII de display + matrícula vía service client ANGOSTO (ver header del módulo).
  const profilesById = new Map<string, { displayName: string; matricula: string | null }>();
  const { data: profiles, error: profErr } = await service
    .from("profile")
    .select("id, nombre_cifrado, apellido_cifrado, matricula")
    .in(
      "id",
      rows.map((m) => m.profile_id),
    );
  if (profErr) {
    return err("db_error", "Error leyendo los profesionales.", profErr.message);
  }
  for (const p of (profiles ?? []) as Array<{
    id: string;
    nombre_cifrado: string | null;
    apellido_cifrado: string | null;
    matricula: string | null;
  }>) {
    const nombre = tryDecrypt(p.nombre_cifrado, "profile.nombre_cifrado");
    const apellido = tryDecrypt(p.apellido_cifrado, "profile.apellido_cifrado");
    const displayName = [nombre, apellido].filter(Boolean).join(" ").trim() || "Profesional";
    profilesById.set(p.id, { displayName, matricula: p.matricula });
  }

  return ok(
    rows.map((m) => {
      const p = profilesById.get(m.profile_id);
      return {
        id: m.id,
        displayName: p?.displayName ?? "Profesional",
        fotoUrl: m.foto_publica_url,
        bioPublica: m.bio_publica,
        // Opt-in: la matrícula cruza a lo público SOLO si el pro lo activó.
        matricula: m.mostrar_matricula ? (p?.matricula ?? null) : null,
      };
    }),
  );
}

// ─── listInvitations ───────────────────────────────────────────────────────

export async function listInvitations(): Promise<Result<TeamInvitationRow[]>> {
  const ctx = await requireTeamManager();
  if (!ctx.ok) return ctx;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("member_invitation")
    .select("id, email, role, es_colegiado, estado, expires_at, created_at")
    .eq("organization_id", ctx.data.organization.id)
    .eq("estado", "PENDIENTE")
    .order("created_at", { ascending: false });

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  const now = Date.now();
  return ok(
    ((data ?? []) as Array<{
      id: string;
      email: string;
      role: InvitableRole;
      es_colegiado: boolean;
      estado: string;
      expires_at: string;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      esColegiado: row.es_colegiado,
      estado: new Date(row.expires_at).getTime() < now ? "EXPIRADA" : "PENDIENTE",
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
  );
}

// ─── createInvitation ──────────────────────────────────────────────────────

const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email inválido."),
  role: z.enum(["PROFESIONAL", "ASISTENTE", "COORDINADOR", "DIRECTOR"]),
  esColegiado: z.boolean().optional(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<Result<CreatedInvitation>> {
  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const d = parsed.data;

  const ctx = await requireTeamManager();
  if (!ctx.ok) return ctx;

  // Gate de tier app-side (espejo del gate REAL: policy M51 en DB).
  if (ctx.data.organization.tipo !== "CLINICA") {
    return err(
      "forbidden",
      "El equipo es del plan Clínica. Tu organización está en el plan individual.",
    );
  }

  if (d.email === ctx.data.profile.email.toLowerCase()) {
    return err("validation", "Ese email es el tuyo — ya formás parte del equipo.");
  }

  const supabase = await createSupabaseServerClient();

  // ¿Ya es member activo? Check de UX (la aceptación igual sería idempotente).
  // Mismo patrón de lectura angosta que listMembers: ids vía RLS, email vía
  // service client.
  const { data: activeMembers, error: memErr } = await supabase
    .from("member")
    .select("profile_id")
    .eq("organization_id", ctx.data.organization.id)
    .is("deleted_at", null);
  if (memErr) {
    const mapped = mapSupabaseError(memErr);
    return err(mapped.code, mapped.message, memErr.message);
  }
  const memberProfileIds = (activeMembers ?? []).map(
    (m) => (m as { profile_id: string }).profile_id,
  );
  if (memberProfileIds.length > 0) {
    const service = createSupabaseServiceClient();
    const { data: existing } = await service
      .from("profile")
      .select("id, email")
      .in("id", memberProfileIds);
    const yaEsMember = (existing ?? []).some(
      (p) => ((p as { email: string | null }).email ?? "").toLowerCase() === d.email,
    );
    if (yaEsMember) {
      return err("conflict", "Esa persona ya forma parte del equipo.");
    }
  }

  // Límite anti-abuso de pendientes.
  const { count: pendingCount, error: countErr } = await supabase
    .from("member_invitation")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.data.organization.id)
    .eq("estado", "PENDIENTE");
  if (countErr) {
    const mapped = mapSupabaseError(countErr);
    return err(mapped.code, mapped.message, countErr.message);
  }
  if ((pendingCount ?? 0) >= MAX_PENDING_INVITATIONS) {
    return err(
      "validation",
      `Tenés ${MAX_PENDING_INVITATIONS} invitaciones pendientes. Revocá las que no uses antes de crear más.`,
    );
  }

  // Reinvitar = revocar la pendiente previa de ese email (el índice parcial
  // member_invitation_pending_unique solo admite UNA PENDIENTE por org+email).
  // El email se guarda siempre lowercased (este módulo es el único writer),
  // así que el eq() matchea el índice por lower(email).
  const { error: revokeErr } = await supabase
    .from("member_invitation")
    .update({ estado: "REVOCADA" })
    .eq("organization_id", ctx.data.organization.id)
    .eq("estado", "PENDIENTE")
    .eq("email", d.email);
  if (revokeErr) {
    const mapped = mapSupabaseError(revokeErr);
    return err(mapped.code, mapped.message, revokeErr.message);
  }

  // Token crudo (base64url, 32 bytes) + sha256 hex — espejo exacto de
  // accept_member_invitation (M49): encode(digest(token,'sha256'),'hex').
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  // es_colegiado: un PROFESIONAL invitado es ejerciente por definición;
  // para DIRECTOR lo decide el form (dirección médica vs administración).
  const esColegiado =
    d.role === "PROFESIONAL" ? true : d.role === "DIRECTOR" ? Boolean(d.esColegiado) : false;

  const { data: inserted, error: insErr } = await supabase
    .from("member_invitation")
    .insert({
      organization_id: ctx.data.organization.id,
      email: d.email,
      role: d.role,
      es_colegiado: esColegiado,
      token_hash: tokenHash,
      invited_by_member_id: ctx.data.session.memberId,
    })
    .select("id, email, role, es_colegiado, estado, expires_at, created_at")
    .single();

  if (insErr || !inserted) {
    if (isUniqueViolation(insErr)) {
      return err("conflict", "Ya hay una invitación pendiente para ese email.");
    }
    const mapped = mapSupabaseError(insErr ?? { message: "insert vacío" });
    // La policy M51 responde 42501 si la org no es CLINICA (defensa real).
    if (mapped.code === "forbidden" || mapped.code === "auth_required") {
      return err("forbidden", "Tu plan no permite invitar equipo todavía.", insErr?.message);
    }
    return err(mapped.code, mapped.message, insErr?.message);
  }

  const row = inserted as {
    id: string;
    email: string;
    role: InvitableRole;
    es_colegiado: boolean;
    estado: string;
    expires_at: string;
    created_at: string;
  };

  const invitedByNombre =
    [ctx.data.profile.nombre, ctx.data.profile.apellido].filter(Boolean).join(" ").trim() || null;

  // Audit (Ley 26.529 art. 18): registrar la creación de la invitación. El
  // email del invitado es PII y se guarda en el payload — ver writeAuditEntry.
  // NUNCA el token ni token_hash.
  await writeAuditEntry({
    organizationId: ctx.data.organization.id,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "member_invitation.create",
    resourceType: "member_invitation",
    resourceId: row.id,
    payload: { email: row.email, role: row.role, es_colegiado: row.es_colegiado },
  });

  return ok({
    invitation: {
      id: row.id,
      email: row.email,
      role: row.role,
      esColegiado: row.es_colegiado,
      estado: "PENDIENTE",
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    },
    acceptUrl: `${appUrl()}/invitacion/${token}`,
    organizationNombre: ctx.data.organization.nombre,
    organizationTimezone: ctx.data.organization.timezone || null,
    invitedByNombre,
    expiresAtIso: row.expires_at,
  });
}

// ─── revokeInvitation ──────────────────────────────────────────────────────

export async function revokeInvitation(invitationId: string): Promise<Result<void>> {
  const parsed = z.string().uuid().safeParse(invitationId);
  if (!parsed.success) return err("validation", "Identificador de invitación inválido.");

  const ctx = await requireTeamManager();
  if (!ctx.ok) return ctx;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("member_invitation")
    .update({ estado: "REVOCADA" })
    .eq("id", parsed.data)
    .eq("organization_id", ctx.data.organization.id)
    .eq("estado", "PENDIENTE")
    .select("id, email, role");

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }
  if (!data || data.length === 0) {
    return err("not_found", "La invitación ya no está pendiente.");
  }

  // Audit (Ley 26.529 art. 18): registrar la revocación.
  const revoked = data[0] as { id: string; email: string; role: string };
  await writeAuditEntry({
    organizationId: ctx.data.organization.id,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "member_invitation.revoke",
    resourceType: "member_invitation",
    resourceId: revoked.id,
    payload: { email: revoked.email, role: revoked.role },
  });

  return ok(undefined);
}

// ─── removeMember ──────────────────────────────────────────────────────────

/**
 * Soft-delete de un member (deleted_at = now()). Guardas:
 *   - NO al OWNER (la org siempre tiene dueño).
 *   - NO a vos mismo (evita lock-out accidental).
 *   - App-side se exige rol OWNER porque la policy member_update_owner (M02)
 *     solo permite UPDATE de member al OWNER — un DIRECTOR pasaría el gate
 *     de canManageTeam pero su UPDATE afectaría 0 filas. Mensaje honesto acá.
 */
export async function removeMember(memberId: string): Promise<Result<void>> {
  const parsed = z.string().uuid().safeParse(memberId);
  if (!parsed.success) return err("validation", "Identificador de miembro inválido.");

  const ctx = await requireTeamManager();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER") {
    return err("forbidden", "Solo quien es dueño de la cuenta puede dar de baja miembros.");
  }
  if (parsed.data === ctx.data.session.memberId) {
    return err("validation", "No podés darte de baja a vos mismo.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: target, error: tErr } = await supabase
    .from("member")
    .select("id, role, profile_id")
    .eq("id", parsed.data)
    .eq("organization_id", ctx.data.organization.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (tErr) {
    const mapped = mapSupabaseError(tErr);
    return err(mapped.code, mapped.message, tErr.message);
  }
  if (!target) return err("not_found", "Ese miembro no existe o ya fue dado de baja.");
  const targetRow = target as { id: string; role: Role; profile_id: string };
  if (targetRow.role === "OWNER") {
    return err("forbidden", "No se puede dar de baja a la cuenta dueña de la organización.");
  }

  const { data: updated, error } = await supabase
    .from("member")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("organization_id", ctx.data.organization.id)
    .is("deleted_at", null)
    .select("id");

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }
  if (!updated || updated.length === 0) {
    return err("forbidden", "No se pudo dar de baja (permisos insuficientes).");
  }

  // Audit (Ley 26.529 art. 18): registrar la baja del member. resource_id = el
  // member dado de baja; el payload vincula al profile suprimido y su rol.
  await writeAuditEntry({
    organizationId: ctx.data.organization.id,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "member.remove",
    resourceType: "member",
    resourceId: targetRow.id,
    payload: { profile_id: targetRow.profile_id, role: targetRow.role },
  });

  // Fase E (E2): la baja resta un seat → sincronizamos el monto del débito de
  // la org CLINICA. Fire-and-forget: jamás rompe la baja del member; si MP
  // falla, el cron de reconciliación lo reintenta.
  syncSubscriptionAmountInBackground(ctx.data.organization.id, "remove-member");

  return ok(undefined);
}

// ─── updateMemberEspecialidad (M55) ────────────────────────────────────────

/**
 * Gate puro del cambio de especialidad de un member (testeable sin Supabase,
 * patrón checkTurnoOwnership):
 *   - la ORG debe ser CLINICA (la especialidad por profesional es una función
 *     de clínicas — en un consultorio INDEPENDIENTE la especialidad vive a
 *     nivel organización y se edita en /configuracion → Consultorio; sin este
 *     gate, un caller directo de la action podía setear member.especialidad
 *     en una org Solo, donde la UI nunca lo ofrece),
 *   - el TARGET debe ser colegiado (la especialidad decide su herramienta
 *     clínica; para roles administrativos no significa nada),
 *   - el ACTOR debe poder gestionar el equipo (OWNER/DIRECTOR) O ser el
 *     propio member (un profesional define su propia especialidad).
 */
export type EspecialidadUpdateVerdict =
  | { ok: true }
  | { ok: false; code: "forbidden" | "validation"; message: string };

export function checkEspecialidadUpdateAllowed(input: {
  orgTipo: "INDEPENDIENTE" | "CLINICA";
  actorRole: Role;
  actorEsColegiado: boolean;
  actorMemberId: string;
  targetMemberId: string;
  targetEsColegiado: boolean;
}): EspecialidadUpdateVerdict {
  if (input.orgTipo !== "CLINICA") {
    return {
      ok: false,
      code: "validation",
      message:
        "La especialidad por profesional es una función de clínicas. En un consultorio independiente se cambia desde Configuración → Consultorio.",
    };
  }
  if (!input.targetEsColegiado) {
    return {
      ok: false,
      code: "validation",
      message: "Solo el personal colegiado tiene especialidad clínica.",
    };
  }
  const caps = capabilitiesFor(input.actorRole, input.actorEsColegiado);
  if (!caps.canManageTeam && input.actorMemberId !== input.targetMemberId) {
    return {
      ok: false,
      code: "forbidden",
      message: "Solo dirección (o la propia persona) puede cambiar la especialidad.",
    };
  }
  return { ok: true };
}

/** Slugs válidos del registry, o null = heredar organization.especialidad. */
export const memberEspecialidadSchema = z.enum(ESPECIALIDAD_SLUGS).nullable();

/**
 * M55 · setea/borra la especialidad propia de un member colegiado.
 * null = vuelve a heredar organization.especialidad.
 *
 * Gate app-side: canManageTeam O self (checkEspecialidadUpdateAllowed). El
 * UPDATE va con service client ACOTADO a la columna `especialidad` + scoping
 * explícito por org: la policy member_update_owner (M02) solo cubre OWNER y
 * RLS no es column-level — una policy "self/director" permitiría escalar
 * role/alcance. El target se valida primero con una lectura RLS-aware
 * (member_select_same_org hace el scoping real de tenant) y el cambio queda
 * en audit_log (Ley 26.529 art. 18). Sin PHI.
 */
export async function updateMemberEspecialidad(
  memberId: string,
  especialidad: EspecialidadSlug | null,
): Promise<Result<void>> {
  const parsedId = z.string().uuid().safeParse(memberId);
  if (!parsedId.success) return err("validation", "Identificador de miembro inválido.");
  const parsedEsp = memberEspecialidadSchema.safeParse(especialidad);
  if (!parsedEsp.success) return err("validation", "Especialidad inválida.");

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  const supabase = await createSupabaseServerClient();
  const { data: target, error: tErr } = await supabase
    .from("member")
    .select("id, role, es_colegiado, especialidad")
    .eq("id", parsedId.data)
    .eq("organization_id", ctx.data.organization.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (tErr) {
    const mapped = mapSupabaseError(tErr);
    return err(mapped.code, mapped.message, tErr.message);
  }
  if (!target) return err("not_found", "Ese miembro no existe o fue dado de baja.");
  const targetRow = target as {
    id: string;
    role: Role;
    es_colegiado: boolean;
    especialidad: string | null;
  };

  const verdict = checkEspecialidadUpdateAllowed({
    orgTipo: ctx.data.organization.tipo,
    actorRole: ctx.data.session.role,
    actorEsColegiado: ctx.data.session.esColegiado,
    actorMemberId: ctx.data.session.memberId,
    targetMemberId: targetRow.id,
    targetEsColegiado: targetRow.es_colegiado,
  });
  if (!verdict.ok) return err(verdict.code, verdict.message);

  if (targetRow.especialidad === parsedEsp.data) return ok(undefined); // no-op

  const service = createSupabaseServiceClient();
  const { error: upErr } = await service
    .from("member")
    .update({ especialidad: parsedEsp.data })
    .eq("id", targetRow.id)
    .eq("organization_id", ctx.data.organization.id);
  if (upErr) {
    const mapped = mapSupabaseError(upErr);
    return err(mapped.code, mapped.message, upErr.message);
  }

  // Audit (Ley 26.529 art. 18): el cambio de especialidad altera qué
  // herramienta clínica registra las sesiones futuras de este profesional.
  await writeAuditEntry({
    organizationId: ctx.data.organization.id,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "member.especialidad_update",
    resourceType: "member",
    resourceId: targetRow.id,
    payload: {
      especialidad: parsedEsp.data,
      especialidad_anterior: targetRow.especialidad,
    },
  });

  return ok(undefined);
}

/**
 * M55 · especialidad propia del member de la sesión activa (null = hereda la
 * de la org). Lectura RLS-aware de la PROPIA fila, sin gate canManageTeam a
 * propósito: alimenta el panel "Tu especialidad" de /configuracion → Equipo
 * para profesionales colegiados que no gestionan el equipo (el flujo M55:
 * invitar → aceptar → dirección O el propio profesional la setea). Sin PII.
 */
export async function getOwnEspecialidad(): Promise<Result<EspecialidadSlug | null>> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("member")
    .select("especialidad")
    .eq("id", ctx.data.session.memberId)
    .maybeSingle();
  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  const esp = (data as { especialidad: string | null } | null)?.especialidad ?? null;
  // Slug fuera del registry de este deploy (CHECK futuro más amplio) → null:
  // la UI muestra "hereda de la clínica", igual que resolveEspecialidadEfectiva.
  return ok(esp !== null && isEspecialidadSlug(esp) ? esp : null);
}

// ─── getOwnPerfilPublico (M62) ──────────────────────────────────────────────

/** Perfil público del member de la sesión, para la sección Configuración. */
export interface OwnPerfilPublico {
  fotoUrl: string | null;
  bioPublica: string | null;
  mostrarMatricula: boolean;
}

/**
 * M62 · foto/bio/visibilidad-de-matrícula del member de la sesión activa, para
 * la sección "Perfil público" de /configuracion. Lectura RLS-aware de la
 * PROPIA fila (member_select_same_org), sin gate canManageTeam: cada
 * profesional edita su propio perfil. El VALOR de la matrícula no se lee acá
 * (vive en profile.matricula, ya cargado por getConfiguracionData). Sin PII.
 */
export async function getOwnPerfilPublico(): Promise<Result<OwnPerfilPublico>> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("member")
    .select("foto_publica_url, bio_publica, mostrar_matricula")
    .eq("id", ctx.data.session.memberId)
    .eq("organization_id", ctx.data.organization.id)
    .maybeSingle();
  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  const m = (data ?? {}) as {
    foto_publica_url?: string | null;
    bio_publica?: string | null;
    mostrar_matricula?: boolean;
  };
  return ok({
    fotoUrl: m.foto_publica_url ?? null,
    bioPublica: m.bio_publica ?? null,
    mostrarMatricula: m.mostrar_matricula ?? false,
  });
}

/**
 * M55 · espejo per-member de countSesionesOtraEspecialidad (/configuracion):
 * cuántas sesiones de TURNOS de este profesional tienen un tool_id que NO es
 * el de `nuevaEspecialidad` (null = la que heredaría: la de la org). La UI lo
 * usa para advertir ANTES de cambiar la especialidad: esos datos se conservan
 * en DB pero el slot clínico de la ficha deja de mostrarlos.
 *
 * Criterio UNIFICADO con el count org-level (countSesionesOtraEspecialidad,
 * lib/db/configuracion.ts): "otra herramienta" = tool_id que NO empieza con
 * el PREFIJO de la especialidad ("<especialidad>.<tool>.<versión>", M50) —
 * no `neq` contra el toolId exacto, para que una futura tool v2 de la MISMA
 * especialidad no cuente como ajena. Filas legacy con tool_id NULL
 * (quiropraxia implícita) no se cuentan — el reader las maneja con fallback.
 * Service client count-only (sin PHI), gateado igual que el update.
 */
export async function countSesionesOtraEspecialidadMember(
  memberId: string,
  nuevaEspecialidad: EspecialidadSlug | null,
): Promise<Result<number>> {
  const parsedId = z.string().uuid().safeParse(memberId);
  if (!parsedId.success) return err("validation", "Identificador de miembro inválido.");
  const parsedEsp = memberEspecialidadSchema.safeParse(nuevaEspecialidad);
  if (!parsedEsp.success) return err("validation", "Especialidad inválida.");

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  const caps = capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado);
  if (!caps.canManageTeam && ctx.data.session.memberId !== parsedId.data) {
    return err("forbidden", "Solo dirección (o la propia persona) puede ver este dato.");
  }

  // Especialidad que el member pasaría a tener efectiva (null → hereda org).
  const efectiva = parsedEsp.data ?? ctx.data.organization.especialidad;
  const slugNuevo = getEspecialidadMeta(efectiva).slug;

  const service = createSupabaseServiceClient();
  const { count, error } = await service
    .from("sesion")
    .select("id, turno!inner(profesional_id)", { count: "exact", head: true })
    .eq("organization_id", ctx.data.organization.id)
    .eq("turno.profesional_id", parsedId.data)
    .not("tool_id", "is", null)
    .not("tool_id", "like", `${slugNuevo}.%`);

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }
  return ok(count ?? 0);
}
