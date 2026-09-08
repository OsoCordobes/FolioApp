import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OperationsPanel } from "@/components/operations/panel";
import { getOperationsSnapshot } from "@/lib/db/operations";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Operación", robots: { index: false, follow: false } };
/** Outside the clinic layout: operator authorization is independent of clinic billing. */
export default async function OperationsPage() {
 const result = await getOperationsSnapshot();
 if (!result.ok) {
  if (result.error.code === "auth_required") redirect("/login?redirect=/operacion");
  if (result.error.code === "mfa_required") redirect("/seguridad/mfa?next=/operacion");
  if (result.error.code === "forbidden") notFound();
  return <main style={{maxWidth:760,margin:"0 auto",padding:"var(--space-8)"}}><h1>Estado de operación</h1><p role="alert">No pudimos consultar el estado. No hay una lectura disponible.</p><a className="fi-btn" href="/operacion">Volver a intentar</a></main>;
 }
 return <OperationsPanel snapshot={result.data}/>;
}
