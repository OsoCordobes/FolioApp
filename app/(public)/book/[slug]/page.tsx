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

import { BookingWizard } from "@/components/booking/booking-wizard";
import { formatRubro } from "@/lib/format/identity";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ slug: string }>;
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
      "id, slug, nombre, ciudad, provincia, acento_hex, rubro, opt_out_public_listing, logo_url, card_mood, bio, telefono_publico, direccion_completa, instagram_handle",
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
      ...(org.logo_url ? { images: [{ url: org.logo_url }] } : {}),
    },
    twitter: {
      card: "summary",
      title,
      description,
      ...(org.logo_url ? { images: [org.logo_url] } : {}),
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
  const { data: servicios } = await service
    .from("servicio")
    .select("id, nombre, duracion_min, precio_cents, tipo_canonico, color")
    .eq("organization_id", org.id)
    .eq("activo", true)
    .is("deleted_at", null)
    .order("tipo_canonico");

  return (
    <BookingWizard
      org={{
        slug: org.slug,
        nombre: org.nombre,
        ciudad: org.ciudad,
        provincia: org.provincia,
        rubro: org.rubro,
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
      }}
      servicios={servicios ?? []}
    />
  );
}
