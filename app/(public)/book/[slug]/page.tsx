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

import { notFound } from "next/navigation";

import { BookingWizard } from "@/components/booking/booking-wizard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BookPage({ params }: PageProps) {
  const { slug } = await params;
  const service = createSupabaseServiceClient();

  const { data: org } = await service
    .from("organization")
    .select("id, slug, nombre, ciudad, provincia, acento_hex, rubro, opt_out_public_listing")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (!org || org.opt_out_public_listing) {
    notFound();
  }

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
      }}
      servicios={servicios ?? []}
    />
  );
}
