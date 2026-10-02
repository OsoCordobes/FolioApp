import "server-only";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type Client = Pick<ReturnType<typeof createSupabaseServiceClient>, "from">;
const roles = ["OWNER", "DIRECTOR", "PROFESIONAL", "ASISTENTE", "COORDINADOR"] as const;
type Role = typeof roles[number];
export interface BookingRecipientAuthority {
  version: 1;
  organizationId: string;
  pedidoId: string;
  memberId: string;
  profileId: string;
  selection: "assigned_member" | "owner_fallback";
  assignedMemberId: string | null;
  roleAtEnqueue: Role;
}
type Failure = { status: "failed"; detail: string; retryable: boolean };
type Member = {
  id: string; organization_id: string; profile_id: string | null; role: string;
  deleted_at: string | null; accepted_at: string | null; invited_by_id: string | null;
};
type Pedido = { id: string; organization_id: string; profesional_id: string | null; estado: string };
const memberColumns = "id,organization_id,profile_id,role,deleted_at,accepted_at,invited_by_id";
const pedidoColumns = "id,organization_id,profesional_id,estado";
const denied = (): Failure => ({ status: "failed", detail: "email_recipient_authority_lost", retryable: false });
const lookupFailed = (): Failure => ({ status: "failed", detail: "email_recipient_lookup_failed", retryable: true });
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const isRole = (value: unknown): value is Role => roles.some(role => role === value);

function isContext(value: unknown): value is BookingRecipientAuthority {
  if (!value || typeof value !== "object") return false;
  const ctx = value as Partial<BookingRecipientAuthority>;
  return ctx.version === 1 && uuid(ctx.organizationId) && uuid(ctx.pedidoId)
    && uuid(ctx.memberId) && uuid(ctx.profileId) && isRole(ctx.roleAtEnqueue)
    && (ctx.assignedMemberId === null || uuid(ctx.assignedMemberId))
    && (ctx.selection === "owner_fallback" || (ctx.selection === "assigned_member" && ctx.assignedMemberId === ctx.memberId));
}

function canReceive(member: Member, ctx: BookingRecipientAuthority): boolean {
  // M101: founders without inviter are current even before accepted_at is set.
  if (member.id !== ctx.memberId || member.organization_id !== ctx.organizationId
    || member.profile_id !== ctx.profileId || member.deleted_at !== null
    || !(member.accepted_at != null || member.invited_by_id === null)) return false;
  // M128 + M01 self-scope: the assigned recipient is the target member itself.
  // No clinical/es_colegiado gate is added to this administrative notice.
  return ctx.selection === "owner_fallback" ? member.role === "OWNER"
    : ctx.assignedMemberId === member.id && isRole(member.role);
}

/** Capture server-selected identities; a failed lookup never permits OWNER fallback. */
export async function resolveBookingRecipient(client: Client, profileClient: Client, input: {
  organizationId: string; pedidoId: string; profesionalId?: string | null;
}): Promise<{ status: "resolved"; to: string; context: BookingRecipientAuthority } | Failure> {
  try {
    const { data: pedido, error: pedidoError } = await client.from("pedido").select(pedidoColumns)
      .eq("id", input.pedidoId).eq("organization_id", input.organizationId).maybeSingle();
    if (pedidoError) return lookupFailed();
    if (!pedido || pedido.id !== input.pedidoId || pedido.organization_id !== input.organizationId
      || pedido.estado !== "PENDIENTE" || pedido.profesional_id !== (input.profesionalId ?? null)) return denied();

    let member: Member | null = null;
    let selection: BookingRecipientAuthority["selection"] = "assigned_member";
    if (pedido.profesional_id) {
      const { data, error } = await client.from("member").select(memberColumns)
        .eq("id", pedido.profesional_id).eq("organization_id", input.organizationId).is("deleted_at", null).maybeSingle();
      if (error) return lookupFailed();
      member = data as Member | null;
    }
    if (!member?.profile_id) {
      const { data, error } = await client.from("member").select(memberColumns)
        .eq("organization_id", input.organizationId).eq("role", "OWNER").is("deleted_at", null)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (error) return lookupFailed();
      member = data as Member | null;
      selection = "owner_fallback";
    }
    if (!member?.profile_id) return denied();
    const context: BookingRecipientAuthority = {
      version: 1, organizationId: input.organizationId, pedidoId: input.pedidoId,
      memberId: member.id, profileId: member.profile_id, selection,
      assignedMemberId: pedido.profesional_id, roleAtEnqueue: member.role as Role,
    };
    if (!isContext(context) || !canReceive(member, context)) return denied();
    const { data: profile, error } = await profileClient.from("profile").select("id,email")
      .eq("id", context.profileId).maybeSingle();
    if (error) return lookupFailed();
    if (!profile || profile.id !== context.profileId || typeof profile.email !== "string" || !profile.email) return denied();
    return { status: "resolved", to: profile.email, context };
  } catch { return lookupFailed(); }
}

/** Validate only the encrypted original recipient; never resolve a replacement. */
export async function validateBookingRecipient(client: Client, organizationId: string, to: unknown, value: unknown): Promise<{ status: "authorized" } | Failure> {
  if (!isContext(value)) return { status: "failed", detail: "email_recipient_context_missing", retryable: false };
  const ctx = value;
  if (ctx.organizationId !== organizationId || typeof to !== "string" || !to) return denied();
  try {
    const { data, error: pedidoError } = await client.from("pedido").select(pedidoColumns)
      .eq("id", ctx.pedidoId).eq("organization_id", organizationId).maybeSingle();
    if (pedidoError) return lookupFailed();
    const pedido = data as Pedido | null;
    if (!pedido || pedido.id !== ctx.pedidoId || pedido.organization_id !== organizationId
      || pedido.estado !== "PENDIENTE" || pedido.profesional_id !== ctx.assignedMemberId) return denied();
    const { data: member, error: memberError } = await client.from("member").select(memberColumns)
      .eq("id", ctx.memberId).eq("organization_id", organizationId).maybeSingle();
    if (memberError) return lookupFailed();
    if (!member || !canReceive(member as Member, ctx)) return denied();
    const { data: profile, error: profileError } = await client.from("profile").select("id,email")
      .eq("id", ctx.profileId).maybeSingle();
    if (profileError) return lookupFailed();
    if (!profile || profile.id !== ctx.profileId || profile.email !== to) return denied();
    return { status: "authorized" };
  } catch { return lookupFailed(); }
}
