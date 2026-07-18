/**
 * Folio · /configuracion (Server Component).
 *
 * Lee organization + profile + servicios y los pasa al Client Component.
 * MVP scope:
 *   - Save real para sección Consultorio (organization + profile).
 *   - Servicios, Horarios, Integraciones, Plan: read-only o stub.
 *
 * Role gating del save: el server action `saveConsultorioAction` ya rechaza
 * si el rol no es OWNER/DIRECTOR. El UI usa `canEdit` para deshabilitar el
 * botón Guardar y mostrar tooltip explicativo.
 */

import { Configuracion } from "@/components/configuracion/configuracion";
import { capabilitiesFor } from "@/lib/auth/capabilities";
import { computeMonthlyPriceCents } from "@/lib/billing/pricing";
import { getActiveContext } from "@/lib/db/active-context";
import { getConfiguracionData } from "@/lib/db/configuracion";
import { isOrgListedInDirectory } from "@/lib/db/directorio";
import { puedeResolverClaims } from "@/lib/db/paciente-claims";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getOwnEspecialidad,
  getOwnPerfilPublico,
  listInvitations,
  listMembers,
  type OwnPerfilPublico,
  type TeamInvitationRow,
  type TeamMemberRow,
} from "@/lib/db/members";
import type { EquipoSelf } from "@/components/configuracion/configuracion";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar /configuracion: ${ctx.error.message}`);
  }

  const data = await getConfiguracionData();
  if (!data.ok) {
    throw new Error(`Error cargando configuración: ${data.error.message}`);
  }

  const canEdit = ctx.data.session.role === "OWNER" || ctx.data.session.role === "DIRECTOR";

  // Equipo (M49/M51 · Fase C): la sección solo existe para quien puede
  // gestionarlo. Los datos solo se cargan en orgs CLINICA — en INDEPENDIENTE
  // la sección muestra el upsell del plan Clínica sin tocar la DB.
  const caps = capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado);
  let equipoMembers: TeamMemberRow[] = [];
  let equipoInvitations: TeamInvitationRow[] = [];
  if (caps.canManageTeam && data.data.tipo === "CLINICA") {
    const [membersRes, invitationsRes] = await Promise.all([listMembers(), listInvitations()]);
    if (membersRes.ok) equipoMembers = membersRes.data;
    if (invitationsRes.ok) equipoInvitations = invitationsRes.data;
  }

  // M55 · camino "self": un profesional colegiado SIN gestión de equipo
  // igual ve la sección Equipo, reducida a su propia especialidad (la que
  // decide su herramienta clínica). listMembers queda gateado a dirección —
  // acá solo se lee la PROPIA fila (getOwnEspecialidad, RLS-aware, sin PII).
  let equipoSelf: EquipoSelf | null = null;
  if (!caps.canManageTeam && ctx.data.session.esColegiado && data.data.tipo === "CLINICA") {
    const own = await getOwnEspecialidad();
    if (own.ok) {
      equipoSelf = { memberId: ctx.data.session.memberId, especialidad: own.data };
    }
  }

  // M62 · Perfil público (foto/bio/matrícula visible) — solo para colegiados
  // (son los únicos que aparecen en la landing /book/[slug]). Cada profesional
  // edita el suyo.
  let perfilPublico: OwnPerfilPublico | null = null;
  if (ctx.data.session.esColegiado) {
    const res = await getOwnPerfilPublico();
    if (res.ok) perfilPublico = res.data;
  }

  // M64 · opt-in al directorio público (toggle "Presencia online"). GUARDED →
  // false si M64 no está aplicada todavía (no rompe la página de config).
  const listarEnDirectorio = await isOrgListedInDirectory(ctx.data.organization.slug);

  // Card WhatsApp de Integraciones: solo se muestra si el envío por WhatsApp
  // Cloud está operativo en este deploy (mismas envs que chequea /api/health).
  // Server-side: presencia booleana, nunca los valores.
  const whatsappConfigured = Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
  );

  // PR 1.4 · datos para el upgrade self-serve a Clínica (card "Tipo de
  // organización"). membersActivos = head-count de members activos (incluye al
  // titular) → define los seats que cobraría Clínica. RLS-aware (server client);
  // best-effort: si el count falla, asumimos 1 (solo el titular) para no romper
  // la página — el monto real lo re-computa el action al confirmar.
  const supabase = await createSupabaseServerClient();
  const { count: membersCount } = await supabase
    .from("member")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.data.organization.id)
    .is("deleted_at", null);
  const membersActivos = membersCount ?? 1;
  const montoActualCents = computeMonthlyPriceCents(data.data.tipo, membersActivos);
  const montoClinicaCents = computeMonthlyPriceCents("CLINICA", membersActivos);

  return (
    <Configuracion
      orgSlug={ctx.data.organization.slug}
      initialConsultorio={data.data.consultorio}
      initialServicios={data.data.servicios}
      initialDias={data.data.dias}
      initialSlotMin={data.data.slotMin}
      initialAutoConfirmar={data.data.autoConfirmarReservas}
      initialSlotMargenMin={data.data.slotMargenMin}
      googleCalendar={data.data.googleCalendar}
      orgTipo={data.data.tipo}
      canEdit={canEdit}
      membersActivos={membersActivos}
      montoActualCents={montoActualCents}
      montoClinicaCents={montoClinicaCents}
      canManageTeam={caps.canManageTeam}
      isOwner={ctx.data.session.role === "OWNER"}
      equipoMembers={equipoMembers}
      equipoInvitations={equipoInvitations}
      equipoSelf={equipoSelf}
      esColegiado={ctx.data.session.esColegiado}
      initialPerfilPublico={perfilPublico}
      initialListarEnDirectorio={listarEnDirectorio}
      suscripcionEstado={ctx.data.subscription.estado}
      whatsappConfigured={whatsappConfigured}
      showVinculaciones={puedeResolverClaims(
        ctx.data.session.role,
        ctx.data.session.esColegiado,
      )}
    />
  );
}
