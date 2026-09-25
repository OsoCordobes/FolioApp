import Link from "next/link";
import { notFound } from "next/navigation";

import { CallerScreensPanel } from "@/components/caller/caller-screens-panel";
import { getActiveSession } from "@/lib/db/session";
import { listCallerScreens } from "@/lib/db/caller";
import "@/styles/caller.css";

export const dynamic = "force-dynamic";

export default async function PantallasConfigPage() {
  const session = await getActiveSession();
  if (!session.ok || !["OWNER", "DIRECTOR"].includes(session.data.role)) notFound();
  const initial = await listCallerScreens();
  return <main className="caller-settings">
    <Link href="/configuracion" className="caller-settings-back">← Configuración</Link>
    <header><span className="caller-eyebrow">Recepción</span><h1>Pantallas de espera</h1>
      <p>Mostrá sólo el código de espera y el destino. Podés desconectar cada pantalla desde acá.</p></header>
    <CallerScreensPanel initial={initial} />
  </main>;
}
