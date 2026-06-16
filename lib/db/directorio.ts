/**
 * Folio · Directorio público de profesionales (Fase 3 · M64).
 *
 * Lecturas para `/profesionales`: orgs que OPTARON IN (listar_en_directorio).
 * Service client (las rutas son anónimas, sin sesión) con filtrado explícito.
 * SOLO datos públicos a nivel consultorio — sin PII, sin decrypt, sin datos de
 * profesionales individuales (el directorio lista consultorios, no personas).
 *
 * GUARDED: todo va en try/catch y degrada a vacío/false si la columna
 * listar_en_directorio no existe todavía (ventana entre mergear Fase 3 y
 * aplicar M64 a prod). Así /profesionales y la metadata de /book nunca rompen.
 */

import { isEspecialidadSlug } from "@/lib/especialidades/meta";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export interface DirectorioOrg {
  slug: string;
  nombre: string;
  /** quiropraxia | cardiologia | psicologia | null (rubro libre). */
  especialidad: string | null;
  ciudad: string | null;
  provincia: string | null;
  logoUrl: string | null;
  acentoHex: string;
  bio: string | null;
}

export interface DirectorioFilter {
  especialidad?: string | null;
  provincia?: string | null;
  ciudad?: string | null;
}

const SELECT = "slug, nombre, especialidad, ciudad, provincia, logo_url, acento_hex, bio";

/**
 * Orgs elegibles para el directorio. Predicado de inclusión:
 *   listar_en_directorio (opt-IN) · NOT opt_out_public_listing · NOT
 *   is_internal_account · deleted_at IS NULL · nombre presente.
 * (No se exige onboarding_completed: optar in ya implica una org real, y se
 * evita acoplar a un nombre de columna que podría variar.)
 */
export async function listDirectorioOrgs(filter: DirectorioFilter = {}): Promise<DirectorioOrg[]> {
  try {
    const service = createSupabaseServiceClient();
    let q = service
      .from("organization")
      .select(SELECT)
      .eq("listar_en_directorio", true)
      .eq("opt_out_public_listing", false)
      .eq("is_internal_account", false)
      .is("deleted_at", null)
      .not("nombre", "is", null);

    if (filter.especialidad && isEspecialidadSlug(filter.especialidad)) {
      q = q.eq("especialidad", filter.especialidad);
    }
    if (filter.provincia) q = q.eq("provincia", filter.provincia);
    if (filter.ciudad) q = q.eq("ciudad", filter.ciudad);

    const { data, error } = await q.order("nombre", { ascending: true }).limit(200);
    if (error) {
      console.warn("[directorio] listDirectorioOrgs falló (¿M64 sin aplicar?):", error.message);
      return [];
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((o) => ({
      slug: o.slug as string,
      nombre: o.nombre as string,
      especialidad: (o.especialidad as string | null) ?? null,
      ciudad: (o.ciudad as string | null) ?? null,
      provincia: (o.provincia as string | null) ?? null,
      logoUrl: (o.logo_url as string | null) ?? null,
      acentoHex: (o.acento_hex as string | null) ?? "#8A6722",
      bio: (o.bio as string | null) ?? null,
    }));
  } catch (e) {
    console.warn("[directorio] excepción:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

/**
 * ¿Esta org optó por listarse en el directorio? Gobierna la indexabilidad de
 * /book/[slug] (robots) + el JSON-LD. GUARDED → false si la columna no existe
 * (M64 sin aplicar) o ante cualquier error: el default privacy-safe es noindex.
 */
export async function isOrgListedInDirectory(slug: string): Promise<boolean> {
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("organization")
      .select("listar_en_directorio")
      .eq("slug", slug)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return false;
    return !!(data as { listar_en_directorio?: boolean } | null)?.listar_en_directorio;
  } catch {
    return false;
  }
}
