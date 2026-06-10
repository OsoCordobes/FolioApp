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

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { EmailVerifyBanner } from "@/components/auth/email-verify-banner";
import { Sidebar, type GoogleSyncStatus } from "@/components/sidebar";
import { getActiveContext } from "@/lib/db/active-context";
import { BILLING_RECOVERY_PATH, shouldGateToBilling } from "@/lib/db/suscripcion";
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
    redirect(`${BILLING_RECOVERY_PATH}?gate=${accessGate.reason ?? "denied"}`);
  }

  const googleSync = await loadGoogleSyncStatus(session.organizationId, session.memberId);

  return (
    <div className="fi-app">
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
      />
      <main className="fi-main">
        {session.emailVerified === false ? (
          <EmailVerifyBanner email={session.email} />
        ) : null}
        {children}
      </main>
    </div>
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
