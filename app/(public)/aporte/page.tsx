import type { Metadata } from "next";
import { PatientForm } from "./patient-form";

export const metadata: Metadata = { title: "Datos para tu turno · Folio", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default function AportePage() {
  return <>
    <script dangerouslySetInnerHTML={{ __html: `(() => { const raw = location.hash; history.replaceState(null, '', location.pathname); const match = /^#token=([0-9a-f]{64})$/.exec(raw); if (match) { window.__folioIntakeToken = match[1]; } })();` }} />
    <PatientForm />
  </>;
}
