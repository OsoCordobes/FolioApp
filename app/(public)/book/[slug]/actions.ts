"use server";

/**
 * Folio · Server Actions del booking público.
 *
 * Estas actions corren SIN sesión (cualquier visitante del link público).
 * Defense-in-depth:
 *   - Zod estricto (validación de inputs)
 *   - Rate limit por IP (Upstash) en fetchSlots + createPedido
 *   - Captcha Cloudflare Turnstile obligatorio en createPedido
 *   - Re-chequeo del slot antes de insertar (race condition)
 *   - service client + Zod (RLS no aplica porque no hay session)
 */

import { headers } from "next/headers";
import { z } from "zod";

import { encryptColumn } from "@/lib/crypto";
import { err, ok, type Result } from "@/lib/db/errors";
import { getSlotsDisponibles, type Slot } from "@/lib/booking/availability";
import { trackEvent } from "@/lib/observability/events";
import { limitByIp } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

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

  // Rate limit: hasta 60 consultas de slots por IP por hora.
  const ip = await clientIp();
  const rl = await limitByIp("book.slots", ip, 60);
  if (!rl.ok) {
    return err("validation", `Demasiadas consultas, probá en ${rl.resetIn}s.`);
  }

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

  const ip = await clientIp();

  // Rate limit más estricto en el submit final.
  const rl = await limitByIp("book.create", ip, 5);
  if (!rl.ok) {
    return err("validation", `Demasiados intentos, probá en ${rl.resetIn}s.`);
  }

  // Captcha obligatorio. En dev (sin secret), verifyTurnstile retorna true
  // para no bloquear el flow local. En producción es fail-closed.
  const captchaOk = await verifyTurnstile(parsed.data.captchaToken, ip);
  if (!captchaOk) {
    return err("validation", "Captcha inválido o expirado. Recargá la página.");
  }

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

  // Re-chequear que el slot siga libre. Race window mínimo: alguien podría haber
  // tomado el mismo horario entre que el wizard cargó la lista y este submit.
  // F11 podría usar un advisory_lock o constraint exclusivo en SQL para garantía dura.
  const inicioDate = new Date(parsed.data.inicio);
  const finDate = new Date(inicioDate.getTime() + servicio.duracion_min * 60_000);

  const overlap = await service.rpc("slot_ocupado", {
    p_org: org.id,
    p_inicio: inicioDate.toISOString(),
    p_fin: finDate.toISOString(),
  });

  // Fallback en caso de que el RPC no exista todavía: chequear manualmente.
  let ocupado = false;
  if (overlap.error || overlap.data === null) {
    const finIso = finDate.toISOString();

    const [{ data: turnoConflict }, { data: pedidoConflict }, { data: bloqueoConflict }] =
      await Promise.all([
        service
          .from("turno")
          .select("id")
          .eq("organization_id", org.id)
          .in("estado", ["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO"])
          .lt("inicio", finIso)
          .gte("inicio", new Date(inicioDate.getTime() - 4 * 60 * 60_000).toISOString())
          .limit(20),
        service
          .from("pedido")
          .select("id, fecha_propuesta, duracion_min")
          .eq("organization_id", org.id)
          .eq("estado", "PENDIENTE")
          .not("fecha_propuesta", "is", null)
          .gte("fecha_propuesta", new Date(inicioDate.getTime() - 4 * 60 * 60_000).toISOString())
          .lt("fecha_propuesta", finIso)
          .limit(20),
        service
          .from("bloqueo")
          .select("id, inicio, duracion_min")
          .eq("organization_id", org.id)
          .gte("inicio", new Date(inicioDate.getTime() - 4 * 60 * 60_000).toISOString())
          .lt("inicio", finIso)
          .limit(20),
      ]);

    const overlapsWith = (
      rows: Array<{ inicio?: string; fecha_propuesta?: string; duracion_min: number }> | null,
      field: "inicio" | "fecha_propuesta",
    ) =>
      (rows ?? []).some((r) => {
        const startMs = new Date(r[field]!).getTime();
        const endMs = startMs + r.duracion_min * 60_000;
        return startMs < finDate.getTime() && endMs > inicioDate.getTime();
      });

    ocupado =
      overlapsWith(turnoConflict as Array<{ inicio: string; duracion_min: number }> | null, "inicio") ||
      overlapsWith(
        pedidoConflict as Array<{ fecha_propuesta: string; duracion_min: number }> | null,
        "fecha_propuesta",
      ) ||
      overlapsWith(bloqueoConflict as Array<{ inicio: string; duracion_min: number }> | null, "inicio");
  } else {
    ocupado = overlap.data === true;
  }

  if (ocupado) {
    return err("conflict", "Ese horario ya no está disponible. Por favor elegí otro.");
  }

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

  // Business event: pedido público creado (Sprint 2 T2.2). distinctId =
  // org.slug porque el pedido es anónimo (no hay user authenticated en el
  // contexto público); tracking a nivel org.
  void trackEvent.bookingPublicCompleted({
    orgSlug: parsed.data.orgSlug,
    servicioId: servicio.id,
  });

  return ok({ id: pedido.id });
}
