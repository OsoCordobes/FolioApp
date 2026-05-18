"use server";

/**
 * Folio · Server Actions del booking público.
 *
 * Estas actions corren SIN sesión (cualquier visitante del link público).
 * Por eso usamos service client en todo + Zod estricto + rate limiting
 * (en F9/F11 con Upstash o middleware Vercel Edge).
 */

import { z } from "zod";

import { encryptColumn } from "@/lib/crypto";
import { err, ok, type Result } from "@/lib/db/errors";
import { getSlotsDisponibles, type Slot } from "@/lib/booking/availability";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const slotsInput = z.object({
  orgSlug: z.string().regex(/^[a-z0-9-]+$/),
  servicioId: z.string().uuid(),
  diasAdelante: z.number().int().min(1).max(60).default(14),
});

export async function fetchSlotsPublico(
  input: z.infer<typeof slotsInput>,
): Promise<Result<Slot[]>> {
  const parsed = slotsInput.safeParse(input);
  if (!parsed.success) return err("validation", "Parámetros inválidos.");

  const service = createSupabaseServiceClient();
  const { data: org } = await service
    .from("organization")
    .select("id, opt_out_public_listing")
    .eq("slug", parsed.data.orgSlug)
    .maybeSingle();

  if (!org || org.opt_out_public_listing) {
    return err("not_found", "Consultorio no disponible.");
  }

  const { data: servicio } = await service
    .from("servicio")
    .select("id, organization_id, duracion_min, activo")
    .eq("id", parsed.data.servicioId)
    .eq("organization_id", org.id)
    .eq("activo", true)
    .maybeSingle();

  if (!servicio) {
    return err("not_found", "Servicio no disponible.");
  }

  // Buscar OWNER o primer PROFESIONAL es_colegiado como profesional default
  // (en MVP solo hay 1; F12 multi-profesional permite elegir)
  const { data: profesional } = await service
    .from("member")
    .select("id")
    .eq("organization_id", org.id)
    .eq("es_colegiado", true)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (!profesional) {
    return err("not_found", "Sin profesional disponible.");
  }

  const rangeStart = new Date();
  const rangeEnd = new Date();
  rangeEnd.setDate(rangeEnd.getDate() + parsed.data.diasAdelante);

  const slots = await getSlotsDisponibles({
    organizationId: org.id,
    profesionalId: profesional.id,
    duracionMin: servicio.duracion_min,
    rangeStart,
    rangeEnd,
  });

  return ok(slots);
}

const createPedidoInput = z.object({
  orgSlug: z.string().regex(/^[a-z0-9-]+$/),
  servicioId: z.string().uuid(),
  inicio: z.string().datetime({ offset: true }),
  nombre: z.string().min(2).max(80),
  telefono: z.string().min(6).max(30),
  email: z.string().email().optional(),
  motivo: z.string().max(2000).optional(),
  captchaToken: z.string().optional(),                // F11: validar Turnstile / hCaptcha
});

export async function createPedidoPublico(
  input: z.infer<typeof createPedidoInput>,
): Promise<Result<{ id: string }>> {
  const parsed = createPedidoInput.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del pedido inválidos.", parsed.error.message);
  }
  // TODO[F11]: validar captchaToken contra Cloudflare Turnstile.

  const service = createSupabaseServiceClient();
  const { data: org } = await service
    .from("organization")
    .select("id")
    .eq("slug", parsed.data.orgSlug)
    .maybeSingle();
  if (!org) return err("not_found", "Consultorio no encontrado.");

  const { data: servicio } = await service
    .from("servicio")
    .select("id, organization_id, duracion_min, precio_cents")
    .eq("id", parsed.data.servicioId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!servicio) return err("not_found", "Servicio no disponible.");

  const { data: pedido, error } = await service
    .from("pedido")
    .insert({
      organization_id: org.id,
      canal: "WEB",
      estado: "PENDIENTE",
      nombre_cifrado: encryptColumn(parsed.data.nombre)!,
      telefono_cifrado: encryptColumn(parsed.data.telefono)!,
      email_cifrado: encryptColumn(parsed.data.email ?? null),
      fecha_propuesta: parsed.data.inicio,
      duracion_min: servicio.duracion_min,
      servicio_id: servicio.id,
      motivo_cifrado: encryptColumn(parsed.data.motivo ?? null),
      precio_cents: servicio.precio_cents,
    })
    .select("id")
    .single();

  if (error || !pedido) {
    return err("db_error", "No se pudo crear el pedido.", error?.message);
  }
  return ok({ id: pedido.id });
}
