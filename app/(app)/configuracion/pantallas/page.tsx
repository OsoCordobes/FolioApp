import Link from "next/link";
import { notFound } from "next/navigation";

import { CallerScreensPanel } from "@/components/caller/caller-screens-panel";
import { getActiveSession } from "@/lib/db/session";
import { listCallerScreens } from "@/lib/db/caller";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import "@/styles/caller.css";

export const dynamic = "force-dynamic";

export default async function PantallasConfigPage() {
  const session = await getActiveSession();
  if (!session.ok || !["OWNER", "DIRECTOR"].includes(session.data.role)) notFound();
  const client = await createSupabaseServerClient();
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error || !assurance.data) return <main className="caller-settings">
    <Link href="/configuracion" className="caller-settings-back">← Configuración</Link>
    <h1>Pantallas de espera</h1>
    <p role="alert">No pudimos comprobar tu verificación en dos pasos. Actualizá esta página para volver a intentarlo.</p>
  </main>;
  if (assurance.data.currentLevel !== "aal2") return <main className="caller-settings">
    <Link href="/configuracion" className="caller-settings-back">← Configuración</Link>
    <h1>Pantallas de espera</h1>
    <p>Para vincular o desconectar pantallas, completá la verificación en dos pasos de tu cuenta.</p>
    <Link href="/seguridad/mfa?next=/configuracion/pantallas" className="fi-btn fi-btn-primary">Verificar mi acceso</Link>
  </main>;
  const initial = await listCallerScreens();
  return <main className="caller-settings">
    <Link href="/configuracion" className="caller-settings-back">← Configuración</Link>
    <header><span className="caller-eyebrow">Recepción</span><h1>Pantallas de espera</h1>
      <p>Mostrá sólo el código de espera y el destino. Podés desconectar cada pantalla desde acá.</p></header>
    <CallerScreensPanel initial={initial} />
  </main>;
}
