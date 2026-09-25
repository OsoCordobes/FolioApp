import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClinicalArchive } from "@/components/clinical-archive/archive";
import { readClinicalArchive } from "@/lib/patient/clinical-archive";
import { supportMailto } from "@/lib/support";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Archivo clínico", robots: { index: false, follow: false } };

/** Deliberately outside (app)/layout: subscription status cannot prevent authorized delivery. */
export default async function ClinicalArchivePage() {
  const result = await readClinicalArchive({});
  if (!result.ok && result.error.code === "auth_required") redirect("/login?redirect=/archivo-clinico");
  if (!result.ok && result.error.code === "mfa_required") redirect("/seguridad/mfa?next=/archivo-clinico");
  return <main className="fi-content" style={{ maxWidth: 960, margin: "0 auto", padding: "var(--space-6)" }}>
    <p><a href="/mis-datos">← Mis datos y solicitudes</a></p>
    <header className="fi-page-head"><div><span className="fi-eyebrow">Continuidad de la atención</span>
      <h1>Archivo clínico</h1>
      <p className="fi-page-sub">Consultá y descargá las historias que estás autorizado a entregar.</p>
    </div></header>
    <p>Este acceso sigue disponible cuando la suscripción está suspendida. Las historias conservan sus permisos de confidencialidad.</p>
    <p>La entrega de historias completas corresponde al titular del consultorio o a la dirección clínica habilitada. Para otros permisos de atención, coordiná la entrega con ese responsable.</p>
    {result.ok ? <ClinicalArchive initialPage={result.data} /> : <section>
      <p role="alert">{result.error.message}</p>
      <a className="fi-btn" href="/archivo-clinico">Volver a intentar</a>
    </section>}
    <section style={{ marginTop: "var(--space-6)" }} aria-labelledby="archive-delivery-help">
      <h2 id="archive-delivery-help">Si necesitás otra entrega</h2>
      <p>Si una entrega excede la descarga disponible o necesitás acceso después de una baja, coordiná una vía autorizada con soporte.</p>
      <p><a href={supportMailto("Coordinar una entrega de historias clínicas")}>Contactar a soporte</a>. En el primer mensaje no adjuntes historias ni datos de pacientes.</p>
    </section>
  </main>;
}
