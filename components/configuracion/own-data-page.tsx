import "server-only";
import { redirect } from "next/navigation";
import { DatosClient } from "@/app/(app)/configuracion/datos/datos-client";
import { verifyMfaSession } from "@/lib/auth/mfa-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supportMailto } from "@/lib/support";

type ReturnPath = "/mis-datos" | "/configuracion/datos";

/** Personal account rights require current identity, not a paid clinic or an active membership. */
export async function OwnDataPage({ returnPath, standalone = false }: { returnPath: ReturnPath; standalone?: boolean }) {
  const client = await createSupabaseServerClient();
  const verified = await verifyMfaSession(client);
  if (!verified.ok) {
    if (verified.error.code === "mfa_required") redirect(`/seguridad/mfa?next=${returnPath}`);
    if (verified.error.code === "auth_required") redirect(`/login?redirect=${returnPath}`);
    return <main className="fi-content" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>Mis datos</h1><p role="alert">No pudimos verificar tu acceso. Volvé a intentar.</p>
      <a className="fi-btn" href={returnPath}>Volver a intentar</a>
    </main>;
  }
  const { user } = verified.data;
  const { data: profile, error } = await client.from("profile")
    .select("email, deletion_requested_at, deletion_reason, consent_pii_signed_at, consent_pii_text_version")
    .eq("id", user.id).maybeSingle();
  if (error || !profile) {
    return <main className="fi-content" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>Mis datos</h1><p role="alert">No pudimos consultar tus datos ni el estado de tu solicitud.</p>
      <a className="fi-btn" href={returnPath}>Volver a intentar</a>
      <p><a href={supportMailto("Ayuda para acceder a mis datos de Folio")}>Contactar a soporte</a></p>
    </main>;
  }
  return <main className="fi-content" style={{ maxWidth: 760, ...(standalone ? { margin: "0 auto", padding: "var(--space-6)" } : {}) }}>
    {standalone ? <p><a href="/hoy">← Volver a Folio</a></p> : null}
    <header className="fi-page-head"><div>
      <span className="fi-eyebrow">Tu cuenta</span><h1>Mis datos</h1>
      <p className="fi-page-sub">Descargá los datos de tu cuenta y gestioná una solicitud de baja.</p>
    </div></header>
    <p>Esta pantalla sigue disponible cuando la suscripción de tu consultorio está suspendida.</p>
    <DatosClient email={profile.email ?? user.email ?? ""}
      deletionRequestedAt={profile.deletion_requested_at ?? null}
      deletionReason={profile.deletion_reason ?? null}
      consentSignedAt={profile.consent_pii_signed_at ?? null}
      consentTextVersion={profile.consent_pii_text_version ?? null} />
    <section aria-labelledby="personal-data-clinical"><h2 id="personal-data-clinical">Historias clínicas de pacientes</h2>
      <p>La descarga de tu cuenta no incluye las historias clínicas. Su consulta y entrega requieren verificar los permisos sobre cada paciente.</p>
      <p><a href={supportMailto("Coordinar una entrega de historias clínicas")}>Coordinar una entrega con soporte</a>. En el primer mensaje no adjuntes historias ni datos de pacientes; acordaremos el acceso autorizado.</p>
    </section>
  </main>;
}
