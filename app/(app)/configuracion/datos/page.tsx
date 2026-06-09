import { redirect } from "next/navigation";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

import { DatosClient } from "./datos-client";

/**
 * Folio · /configuracion/datos · Habeas Data (Ley 25.326 art. 14-16).
 *
 * Two affordances, both required for an external audit pass:
 *   1. Descargar mis datos (art. 15 right of access + portability)
 *   2. Eliminar cuenta (art. 16 right of erasure, with a 30-day grace)
 *
 * Server Component reads the current profile to surface whether a deletion
 * request is already pending. The actions live in actions.ts (server).
 */

export const dynamic = "force-dynamic";

export default async function DatosPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/configuracion/datos");
  }

  const service = createSupabaseServiceClient();
  const { data: profile } = await service
    .from("profile")
    .select("email, deletion_requested_at, deletion_reason, consent_pii_signed_at, consent_pii_text_version")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="fi-content" style={{ maxWidth: 760 }}>
      {/* fi-page-head es flex row (bloque de título + acciones): el título
          va envuelto en un div para que eyebrow/h1/sub apilen en columna. */}
      <header className="fi-page-head">
        <div>
          <span className="fi-eyebrow">Configuración · Datos</span>
          <h1>Mis datos</h1>
          <p className="fi-page-sub">
            Tus derechos bajo la Ley 25.326 (Habeas Data) — exportar tus datos y eliminar tu cuenta.
          </p>
        </div>
      </header>

      <DatosClient
        email={profile?.email ?? user.email ?? ""}
        deletionRequestedAt={profile?.deletion_requested_at ?? null}
        deletionReason={profile?.deletion_reason ?? null}
        consentSignedAt={profile?.consent_pii_signed_at ?? null}
        consentTextVersion={profile?.consent_pii_text_version ?? null}
      />
    </main>
  );
}
