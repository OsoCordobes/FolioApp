/**
 * Shell autenticada con gating real (S1 T-1.2).
 *
 * Flujo:
 *   1. `getActiveContext()` resuelve user + organization + profile.
 *   2. Si no hay sesión → redirect /login.
 *   3. Si hay sesión pero no membership → redirect /onboarding.
 *   4. Pasa `organization`, `profile` y `role` a `Sidebar` (T-1.3 los usa).
 *
 * Render: sidebar fija + main scrollable, dentro de `.fi-app` (grid-2
 * 248px + 1fr) del prototipo. Las rutas hijas son responsables del
 * contenido del main (header de página, KPIs, listas, etc.).
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { EmailVerifyBanner } from "@/components/auth/email-verify-banner";
import { MobileNav } from "@/components/mobile-nav";
import { Sidebar, type GoogleSyncStatus } from "@/components/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { getActiveContext } from "@/lib/db/active-context";
import { listUserMemberships } from "@/lib/db/session";
import { BILLING_RECOVERY_PATH, shouldGateToBilling } from "@/lib/db/suscripcion";
import {
  ESPECIALIDAD_OVERRIDE_COOKIE,
  isEspecialidadSlug,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    if (ctx.error.code === "auth_required") {
      redirect("/login");
    }
    if (ctx.error.code === "no_org" || ctx.error.code === "not_found") {
      // El otro extremo del ping-pong: si /onboarding decide que el wizard está
      // completo y nos devuelve acá, y acá volvemos a mandarlo allá, el usuario
      // rebota para siempre. /onboarding ahora corta ese loop mandando a
      // /cuenta-error; este log es lo que permite reconstruir por qué el
      // contexto no resolvía (RLS, org sin member, member soft-deleted…).
      console.warn(
        `[app layout] getActiveContext ${ctx.error.code} → /onboarding: ${ctx.error.message}`,
      );
      redirect("/onboarding");
    }
    // db_error / forbidden / network: fail-fast con error boundary del segment.
    throw new Error(`Error cargando contexto de la app: ${ctx.error.message}`);
  }
  const { organization, profile, session, accessGate } = ctx.data;

  // Si el wizard de onboarding no se completó, no dejamos entrar a la app.
  // El user vería /hoy con datos parciales (org sin nombre, sin servicios,
  // sin horarios). Lo mandamos a terminar primero.
  if (!organization.onboardingCompleted) {
    redirect("/onboarding");
  }

  // Gating de suscripción (M19/S0 billing). Si vencido el grace period y la
  // suscripción no está activa, forzamos al usuario a /configuracion/billing.
  //
  // H-BILLING-1 · billing es la PANTALLA DE RECUPERACIÓN: una org MOROSA con
  // grace vencido (o CANCELADA / PAUSADA / grace_expired) tiene que poder
  // llegar acá para refrescar/repagar/cancelar. La decisión vive en
  // `shouldGateToBilling` (pura, testeable) que garantiza que estando ya bajo
  // el path de billing no se redirige (sería loop / dead-end de cobro). Las
  // server actions de billing no pasan por este gate (solo chequean rol).
  //
  // M37 · is_internal_account bypass: demo/internal/test tenants skip the
  // gate entirely. The flag is auditable (tg_audit_organization_internal_flag
  // logs every flip) and surfaced in the sidebar as a "Cuenta interna" badge
  // so it can never silently affect a real customer.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (
    shouldGateToBilling({
      isInternalAccount: organization.isInternalAccount,
      accessGate,
      pathname,
    })
  ) {
    // Review PR #117 · `?gate=<reason>` alimenta el banner contextual de
    // billing, pero expone la categoría del problema de cobro (moroso /
    // cancelado / pausado). Solo el OWNER ve la página real de billing; el
    // resto del staff cae en BillingLockedMember, que no usa el param →
    // redirect pelado para no filtrarle la razón.
    const gateSuffix =
      session.role === "OWNER" ? `?gate=${accessGate.reason ?? "denied"}` : "";
    redirect(`${BILLING_RECOVERY_PATH}${gateSuffix}`);
  }

  const googleSync = await loadGoogleSyncStatus(session.organizationId, session.memberId);

  // Membresías para el OrgSwitcher (visible solo con >1). Fail-safe: un error
  // acá no puede tirar el shell — se degrada a "sin switcher".
  const membershipsResult = await listUserMemberships();
  const memberships = membershipsResult.ok
    ? membershipsResult.data.map((m) => ({
        organizationId: m.organizationId,
        organizationNombre: m.organizationNombre,
        isInternalAccount: m.isInternalAccount,
      }))
    : [];

  // Override de especialidad (cuentas internas): para resaltar la vista activa
  // del selector del sidebar. Solo se lee si la org es interna.
  let especialidadOverride: EspecialidadSlug | null = null;
  if (organization.isInternalAccount) {
    const raw = (await cookies()).get(ESPECIALIDAD_OVERRIDE_COOKIE)?.value;
    if (raw && isEspecialidadSlug(raw)) especialidadOverride = raw;
  }

  return (
    // ToastProvider (C4): feedback de mutaciones para TODO el shell — los
    // modales de turno y el dashboard disparan useToast() desde cualquier ruta.
    <ToastProvider>
      <div className="fi-app">
        {/* Skip-link (a11y): con nav + búsqueda + switchers antes del contenido,
            un usuario de teclado tabula ~10 veces por página sin esto. Mismo
            patrón .fl-skip del landing, espejado como .fi-skip para el shell. */}
        <a className="fi-skip" href="#main">
          Saltar al contenido
        </a>
        <Sidebar
          organization={{
            nombre: organization.nombre,
            rubro: organization.rubro,
            slug: organization.slug,
            isInternalAccount: organization.isInternalAccount,
          }}
          profile={{
            nombre: profile.nombre,
            apellido: profile.apellido,
          }}
          role={session.role}
          esColegiado={session.esColegiado}
          googleSync={googleSync}
          especialidad={organization.especialidad}
          especialidadOverride={especialidadOverride}
          memberships={memberships}
          activeOrgId={session.organizationId}
          graceDaysLeft={accessGate.graceDaysLeft}
        />
        <main className="fi-main" id="main" tabIndex={-1}>
          {session.emailVerified === false ? (
            <EmailVerifyBanner email={session.email} />
          ) : null}
          {children}
        </main>
        {/* Bottom-nav mobile (C1): display:none en desktop vía CSS; bajo
            ≤920px reemplaza a la sidebar (que se oculta por el mismo media
            query). position:fixed → no ocupa track del grid .fi-app. */}
        <MobileNav
          organization={{
            nombre: organization.nombre,
            slug: organization.slug,
            isInternalAccount: organization.isInternalAccount,
          }}
          role={session.role}
          esColegiado={session.esColegiado}
          especialidad={organization.especialidad}
          especialidadOverride={especialidadOverride}
          memberships={memberships}
          activeOrgId={session.organizationId}
          graceDaysLeft={accessGate.graceDaysLeft}
        />
      </div>
    </ToastProvider>
  );
}

/**
 * Estado de Google Calendar integration del profesional logueado.
 * Si no hay row en `integration` (proveedor='GOOGLE_CALENDAR'), no está conectado.
 * Si hay row pero `ultimo_error_ts` es más reciente que `ultimo_uso_ts`, healthy=false.
 */
async function loadGoogleSyncStatus(
  organizationId: string,
  memberId: string,
): Promise<GoogleSyncStatus> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("integration")
    .select("ultimo_uso_ts, ultimo_error_ts, expira_ts")
    .eq("organization_id", organizationId)
    .eq("profesional_id", memberId)
    .eq("proveedor", "GOOGLE_CALENDAR")
    .maybeSingle();

  if (!data) return { connected: false };

  const ultimoUsoTs = (data.ultimo_uso_ts as string | null) ?? null;
  const ultimoErrorTs = (data.ultimo_error_ts as string | null) ?? null;
  const expiraTs = (data.expira_ts as string | null) ?? null;

  const healthy =
    !ultimoErrorTs || (ultimoUsoTs != null && ultimoUsoTs > ultimoErrorTs) ||
    (expiraTs != null && new Date(expiraTs).getTime() > Date.now());

  return {
    connected: true,
    healthy,
    lastSyncLabel: formatLastSync(ultimoUsoTs),
  };
}

function formatLastSync(ts: string | null): string {
  if (!ts) return "sin sync aún";
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "hace segundos";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `hace ${diffD}d`;
}
