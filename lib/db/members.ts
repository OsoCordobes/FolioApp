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
    .select("id, profile_id, role, es_colegiado, accepted_at, created_at")
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

  const { data, error } = await supabase
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
      [nombre, apellido].filter(Boolean).join(" ").trim() || p.email || "Profesional";
    profilesById.set(p.id, display);
  }

  return ok(
    rows.map((m) => ({
      id: m.id,
      displayName: profilesById.get(m.profile_id) ?? "Profesional",
    })),
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
