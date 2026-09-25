import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { BookLanding } from "@/components/book-landing/book-landing";
import { getAppUrl } from "@/lib/config/app-url";
import { listProfesionalesPublico } from "@/lib/db/members";
import { personalPageEnabledForOrg } from "@/lib/db/miniweb-public";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

interface Params { params: Promise<{ slug: string; memberId: string }> }
export const dynamic = "force-dynamic";
export const revalidate = 0;

const loadPage = cache(async (slug: string, memberId: string) => {
  if (!/^[a-z0-9-]+$/.test(slug) || !/^[0-9a-f-]{36}$/i.test(memberId)) return null;
  const service = createSupabaseServiceClient();
  const { data: org, error: orgError } = await service.from("organization")
    .select("id, slug, tipo, nombre, ciudad, provincia, rubro, especialidad, acento_hex, logo_url, card_mood, bio, telefono_publico, direccion_completa, maps_embed_url, maps_confirmed_address, instagram_handle, auto_confirmar_reservas, opt_out_public_listing")
    .eq("slug", slug).is("deleted_at", null).maybeSingle();
  if (orgError || !org || org.opt_out_public_listing || org.tipo !== "CLINICA") return null;
  const enabled = await personalPageEnabledForOrg(service, {
    organizationId: org.id, organizationTipo: org.tipo, memberId,
  });
  if (!enabled) return null;
  const [profiles, services] = await Promise.all([
    listProfesionalesPublico(org.id),
    service.from("servicio").select("id, nombre, duracion_min, precio_cents, tipo_canonico, color")
      .eq("organization_id", org.id).eq("activo", true).is("deleted_at", null).order("tipo_canonico"),
  ]);
  if (!profiles.ok || services.error) return null;
  const professional = profiles.data.find((person) => person.id === memberId);
  if (!professional || professional.displayName === "Profesional") return null;
  return { org, profiles: profiles.data, professional, services: services.data ?? [] };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, memberId } = await params;
  const page = await loadPage(slug, memberId);
  return {
    metadataBase: new URL(getAppUrl()),
    title: page ? `${page.professional.displayName} · ${page.org.nombre}` : "Página no disponible · Folio",
    description: page?.professional.bioPublica ?? undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PersonalBookPage({ params }: Params) {
  const { slug, memberId } = await params;
  const page = await loadPage(slug, memberId);
  if (!page) notFound();
  const { org, profiles, professional, services } = page;
  return <BookLanding
    org={{
      slug: org.slug, tipo: "CLINICA", nombre: org.nombre, ciudad: org.ciudad,
      provincia: org.provincia, rubro: org.rubro, especialidad: org.especialidad,
      acentoHex: org.acento_hex, logoUrl: org.logo_url,
      cardMood: (org.card_mood ?? "editorial") as "calido" | "clinico" | "editorial" | "boutique",
      bio: org.bio, telefonoPublico: org.telefono_publico,
      direccionCompleta: org.direccion_completa, mapsEmbedUrl: org.maps_embed_url,
      mapsConfirmedAddress: org.maps_confirmed_address,
      instagramHandle: org.instagram_handle, autoConfirmar: org.auto_confirmar_reservas,
    }}
    servicios={services}
    profesionales={profiles}
    featuredProfessional={professional}
    personalPageMemberId={memberId}
    layout="perfil"
  />;
}
