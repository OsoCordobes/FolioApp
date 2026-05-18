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

import { redirect } from "next/navigation";

import { Sidebar, type GoogleSyncStatus } from "@/components/sidebar";
import { getActiveContext } from "@/lib/db/active-context";
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
  const { organization, profile, session } = ctx.data;

  const googleSync = await loadGoogleSyncStatus(session.organizationId, session.memberId);

  return (
    <div className="fi-app">
      <Sidebar
        organization={{
          nombre: organization.nombre,
          rubro: organization.rubro,
        }}
        profile={{
          nombre: profile.nombre,
          apellido: profile.apellido,
        }}
        role={session.role}
        googleSync={googleSync}
      />
      <main className="fi-main">{children}</main>
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
