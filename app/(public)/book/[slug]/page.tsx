/**
 * Folio · /book/[slug]
 *
 * Booking público (sin auth). Muestra:
 *   - Info del consultorio (nombre, dirección, foto)
 *   - Servicios disponibles (con precio + duración)
 *   - Calendario con slots libres próximos 14 días
 *   - Form: nombre + tel + email + motivo + captcha → crea pedido
 *
 * Tres tabs/steps:
 *   1. Elegir servicio
 *   2. Elegir slot
 *   3. Confirmar datos + enviar
 *
 * Server Component carga la organization. Client Component maneja el wizard.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { BookLanding } from "@/components/book-landing/book-landing";
import { listProfesionalesPublico } from "@/lib/db/members";
import { formatRubro } from "@/lib/format/identity";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * ISR: la cara pública se sirve estática y se regenera cada 5 minutos (o
 * on-demand vía revalidatePath desde los saves de /configuracion que tocan
 * campos públicos). La página NO usa headers()/cookies() — solo el service
 * client (sin sesión) — así que es cacheable. Los slots NO viven acá: los
 * carga el wizard vía Server Action (fetchSlotsPublico), siempre frescos.
 */
export const revalidate = 300;

/** Sin paths en build: cada /book/<slug> se genera on-demand y queda cacheado. */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [];
}

interface OrgPublicRow {
  id: string;
  slug: string;
  nombre: string;
  ciudad: string | null;
  provincia: string | null;
  acento_hex: string;
  rubro: string | null;
  opt_out_public_listing: boolean;
  logo_url: string | null;
  card_mood: string | null;
  bio: string | null;
  telefono_publico: string | null;
  direccion_completa: string | null;
  instagram_handle: string | null;
  especialidad: string | null;
  auto_confirmar_reservas: boolean;
}

/**
 * Fetch de la org pública compartido entre generateMetadata y el render via
 * React cache() — una sola query por request. Devuelve null si la org no
 * existe, está borrada u optó por no listarse.
 */
const getOrgPublica = cache(async (slug: string): Promise<OrgPublicRow | null> => {
  const service = createSupabaseServiceClient();
  const { data: org } = await service
    .from("organization")
    .select(
      "id, slug, nombre, ciudad, provincia, acento_hex, rubro, opt_out_public_listing, logo_url, card_mood, bio, telefono_publico, direccion_completa, instagram_handle, especialidad, auto_confirmar_reservas",
    )
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (!org || org.opt_out_public_listing) return null;
  return org as OrgPublicRow;
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://folio-app-ten.vercel.app";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const org = await getOrgPublica(slug);

  // Org inexistente/deslistada → metadata default (la page hace notFound()).
  if (!org) {
    return {
      title: "Reservá tu turno · Folio",
      description: "Reservá tu turno online con profesionales de la salud.",
    };
  }

  const title = `Reservá tu turno · ${org.nombre}`;
  const rubro = formatRubro(org.rubro);
  const lugar = [org.ciudad, org.provincia].filter(Boolean).join(", ");
  const description =
    org.bio?.trim() ||
    `Turnos online con ${org.nombre}${rubro ? ` · ${rubro}` : ""}${lugar ? ` · ${lugar}` : ""}. Elegí servicio y horario en menos de un minuto.`;

  return {
    metadataBase: new URL(APP_URL),
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/book/${org.slug}`,
      siteName: "Folio",
      locale: "es_AR",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function BookPage({ params }: PageProps) {
  const { slug } = await params;
  const org = await getOrgPublica(slug);

  if (!org) {
    notFound();
  }

  const service = createSupabaseServiceClient();
  // Servicios + profesionales reservables en paralelo (CLINICA-4). El perfil
  // público rico (M62: foto/bio/matrícula) alimenta el hero, la sección Equipo
  // y el paso "Elegí profesional" del wizard (BookLanding lo reduce a
  // {id, displayName} para el selector). ISR (revalidate=300): el decrypt de
  // nombres corre 1 vez cada 5 min, no por visita. Si la lectura falla,
  // degradamos a [] — el wizard cae al flujo histórico y el server resuelve el
  // default (nunca rompemos el booking por la lista de display).
  const [{ data: servicios }, profesionalesRes] = await Promise.all([
    service
      .from("servicio")
      .select("id, nombre, duracion_min, precio_cents, tipo_canonico, color")
      .eq("organization_id", org.id)
      .eq("activo", true)
      .is("deleted_at", null)
      .order("tipo_canonico"),
    listProfesionalesPublico(org.id),
  ]);

  return (
    <BookLanding
      org={{
        slug: org.slug,
        nombre: org.nombre,
        ciudad: org.ciudad,
        provincia: org.provincia,
        rubro: org.rubro,
        especialidad: org.especialidad,
        acentoHex: org.acento_hex,
        logoUrl: org.logo_url,
        cardMood: (org.card_mood ?? "editorial") as
          | "calido"
          | "clinico"
          | "editorial"
          | "boutique",
        bio: org.bio,
        telefonoPublico: org.telefono_publico,
        direccionCompleta: org.direccion_completa,
        instagramHandle: org.instagram_handle,
        autoConfirmar: org.auto_confirmar_reservas,
      }}
      servicios={servicios ?? []}
      profesionales={profesionalesRes.ok ? profesionalesRes.data : []}
    />
  );
}
