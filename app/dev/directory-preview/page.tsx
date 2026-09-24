import Link from "next/link";
import { notFound } from "next/navigation";

import { DirectorioPage } from "@/components/directorio/directorio-page";
import type { DirectorioOrg } from "@/lib/db/directorio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Directorio · Vista previa local", robots: { index: false, follow: false } };

const syntheticLogo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="#245A61"/><path d="M48 68C31 56 21 47 21 35a14 14 0 0 1 27-5 14 14 0 0 1 27 5c0 12-10 21-27 33Z" fill="#fff"/></svg>')}`;

const examples: DirectorioOrg[] = [
  { slug: "folio-test-example-kine", nombre: "Consultorio del Parque", especialidad: "kinesiologia", ciudad: "Córdoba", provincia: "Córdoba", logoUrl: null, acentoHex: "#3F6B49", bio: "Ejemplo ficticio de un consultorio de kinesiología. Atención y seguimiento para acompañar tu recuperación." },
  { slug: "folio-test-example-cardio", nombre: "Espacio Corazón", especialidad: "cardiologia", ciudad: "Rosario", provincia: "Santa Fe", logoUrl: syntheticLogo, acentoHex: "#3F5E75", bio: "Ejemplo ficticio de atención cardiológica. Consultas programadas y controles de seguimiento." },
  { slug: "folio-test-example-psico", nombre: "Consultorio Encuentro", especialidad: "psicologia", ciudad: "Mendoza", provincia: "Mendoza", logoUrl: null, acentoHex: "#8A6722", bio: "Ejemplo ficticio de un espacio de atención psicológica para adultos." },
];

export default async function DirectoryPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.FOLIO_TEST_ISOLATED !== "1") notFound();
  const empty = (await searchParams).state === "empty";
  return <>
    <div role="note" style={{ padding: "12px 23px", background: "var(--accent-soft)", color: "var(--ink)", fontSize: 13, lineHeight: 1.6 }}>
      Vista previa local. Consultorios ficticios; los enlaces no corresponden a cuentas. {" "}
      <Link href={`/dev/directory-preview${empty ? "" : "?state=empty"}`}>{empty ? "Ver ejemplos" : "Ver estado vacío"}</Link>
    </div>
    <DirectorioPage orgs={empty ? [] : examples} title="Encontrá tu próximo consultorio." subtitle="Explorá profesionales por especialidad y reservá tu próxima consulta." />
  </>;
}
