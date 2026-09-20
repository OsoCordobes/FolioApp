import { renderBookOg } from "@/lib/book-landing/og-image";
import { listProfesionalesPublico } from "@/lib/db/members";
import { getEspecialidadMeta, isEspecialidadSlug } from "@/lib/especialidades/meta";
import { formatRubro } from "@/lib/format/identity";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const alt = "Reservá tu turno online · Folio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Public photos can be withdrawn. Folio should never cache an older OG image.
export const dynamic = "force-dynamic";

/** Only fetch this organization's consented photo from its public Storage bucket. */
async function publicPortraitData(source: string | null, orgId: string): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!source || !base) return null;
  try {
    const url = new URL(source);
    const project = new URL(base);
    if (url.origin !== project.origin || !["https:", "http:"].includes(url.protocol)) return null;
    if (!url.pathname.startsWith(`/storage/v1/object/public/professional-photos/${orgId}/`)) return null;
    if (!/\.(?:png|jpg|webp)$/.test(url.pathname)) return null;
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(2500) });
    const mime = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !["image/png", "image/jpeg", "image/webp"].includes(mime)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 512 * 1024) return null;
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let nombre = "Reservá tu turno";
  let consultorio = "Folio";
  let especialidad = "Turnos online";
  let lugar = "";
  let acento = "#8A6722";
  let solo = false;
  let foto: string | null = null;

  try {
    const service = createSupabaseServiceClient();
    const { data: org } = await service
      .from("organization")
      .select("id, nombre, ciudad, provincia, especialidad, rubro, acento_hex, tipo, opt_out_public_listing")
      .eq("slug", slug)
      .is("deleted_at", null)
      .maybeSingle();
    if (org && !org.opt_out_public_listing) {
      consultorio = org.nombre || consultorio;
      nombre = consultorio;
      acento = /^#[0-9a-fA-F]{6}$/.test(org.acento_hex) ? org.acento_hex : acento;
      especialidad = org.especialidad && isEspecialidadSlug(org.especialidad)
        ? getEspecialidadMeta(org.especialidad).nombre
        : formatRubro(org.rubro) || especialidad;
      lugar = [org.ciudad, org.provincia].filter(Boolean).join(", ");
      if (org.tipo === "INDEPENDIENTE") {
        const perfiles = await listProfesionalesPublico(org.id);
        const profesional = perfiles.ok && perfiles.data.length === 1 ? perfiles.data[0] : null;
        if (profesional?.displayName?.trim() && profesional.displayName !== "Profesional") {
          nombre = profesional.displayName.trim();
          solo = true;
          foto = await publicPortraitData(profesional.fotoUrl, org.id);
        }
      }
    }
  } catch {
    // Unavailable organization: render a generic reservation preview.
  }

  return renderBookOg({ nombre, consultorio, especialidad, lugar, acento, solo, foto });
}
