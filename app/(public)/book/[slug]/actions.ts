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
import { err, mapSupabaseError, ok, type Result } from "@/lib/db/errors";
import { buildBookingIdentity } from "@/lib/db/pedidos";
import { createHash } from "node:crypto";
import { resolveProfesionalPublico } from "@/lib/db/profesional-destino";
import {
  AvailabilityDbError,
  getSlotsDisponibles,
  type Slot,
} from "@/lib/booking/availability";
import { limitByIp } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function clientUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent")?.slice(0, 500) ?? null;
}

const slotsInput = z.object({
  orgSlug: z.string().regex(/^[a-z0-9-]+$/),
  servicioId: z.string().uuid(),
  /**
   * CLINICA-4 · elegido en el paso "Elegí profesional" del wizard (solo
   * orgs con >1 colegiado). Opcional: el flujo Solo no lo manda y el server
   * resuelve el único colegiado — firma aditiva, back-compat total.
   */
  profesionalId: z.string().uuid().optional(),
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
    .select("id, opt_out_public_listing, slot_margen_min")
    .eq("slug", parsed.data.orgSlug)
    .is("deleted_at", null)
    .maybeSingle();

  if (!org || org.opt_out_public_listing) {
    return err("not_found", "Consultorio no disponible.");
  }

  // Servicio + profesional en paralelo: ambas queries dependen solo de org.id
  // (perf: un round-trip a Supabase en vez de dos secuenciales).
  // CLINICA-4: el profesional ya NO es "el primer es_colegiado sin ORDER BY"
  // (no determinístico — con 3 médicos todos los bookings caían en uno
  // arbitrario, que además podía CAMBIAR entre fetchSlots y submit).
  // resolveProfesionalPublico valida el elegido del wizard o resuelve el
  // único colegiado; con >1 sin elección → err de validación.
  const [{ data: servicio }, profesionalRes] = await Promise.all([
    service
      .from("servicio")
      .select("id, organization_id, duracion_min, activo")
      .eq("id", parsed.data.servicioId)
      .eq("organization_id", org.id)
      .eq("activo", true)
      .maybeSingle(),
    resolveProfesionalPublico(service, {
      organizationId: org.id,
      profesionalId: parsed.data.profesionalId ?? null,
    }),
  ]);

  if (!servicio) {
    return err("not_found", "Servicio no disponible.");
  }

  if (!profesionalRes.ok) return profesionalRes;
  const profesionalId = profesionalRes.data;

  const rangeStart = new Date();
  const rangeEnd = new Date();
  rangeEnd.setDate(rangeEnd.getDate() + parsed.data.diasAdelante);

  // getSlotsDisponibles lanza AvailabilityDbError ante un fallo de DB (en vez de
  // devolver []), para no mostrar "sin turnos" y rechazar pacientes reales ante
  // un error transitorio. Lo traducimos a un Result err para honrar el contrato.
  let slots: Slot[];
  try {
    slots = await getSlotsDisponibles({
      organizationId: org.id,
      profesionalId,
      duracionMin: servicio.duracion_min,
      rangeStart,
      rangeEnd,
      margenMin: (org.slot_margen_min as number | null) ?? 0,
    });
  } catch (e) {
    if (e instanceof AvailabilityDbError) {
      return err("db_error", e.message, typeof e.cause === "string" ? e.cause : undefined);
    }
    throw e;
  }

  return ok(slots);
}

const createPedidoInput = z.object({
  operacionId:z.string().uuid(),
  orgSlug: z.string().regex(/^[a-z0-9-]+$/),
  servicioId: z.string().uuid(),
  /** CLINICA-4 · mismo contrato que fetchSlotsPublico (ver slotsInput). */
  profesionalId: z.string().uuid().optional(),
  inicio: z.string().datetime({ offset: true }),
  nombre: z.string().min(2).max(80),
  telefono: z.string().min(6).max(30),
  email: z.string().email().optional(),
  motivo: z.string().max(2000).optional(),
  captchaToken: z.string().optional(),                // F11: validar Turnstile / hCaptcha
  // Consentimiento explícito (Ley 25.326 art. 5). M39 agrega la columna
  // pedido.consent_aceptado_en + constraint pedido_web_requires_consent, que
  // RECHAZA en DB cualquier pedido WEB sin consent. El wizard pasa
  // consentAccepted=true desde la checkbox; este server action lo re-valida.
  consentAccepted: z.boolean().optional(),
  consentVersion: z.string().min(8).max(32).optional(),
});

export async function createPedidoPublico(input:z.infer<typeof createPedidoInput>):Promise<Result<{id:string;autoConfirmado:boolean}>>{
 const parsed=createPedidoInput.safeParse(input);
 if(!parsed.success)return err("validation","Revisá los datos de la solicitud y volvé a intentar.");
 const d=parsed.data;
 if(d.consentAccepted!==true||!d.consentVersion)return err("validation","Para reservar debés aceptar la Política de Privacidad y los Términos.");
 try{
  const ip=await clientIp(),rl=await limitByIp("book.create",ip,5);
  if(!rl.ok)return err("validation",`Demasiados intentos, probá en ${rl.resetIn}s.`);
  const service=createSupabaseServiceClient();
  const hash=createHash("sha256").update(JSON.stringify({org:d.orgSlug,service:d.servicioId,professional:d.profesionalId??null,inicio:new Date(d.inicio).toISOString(),nombre:d.nombre,telefono:d.telefono,email:d.email??null,motivo:d.motivo??null,consent:d.consentVersion})).digest("hex");
  // A durable receipt is recoverable without spending a one-use captcha again.
  const previous=await service.rpc("public_booking_receipt",{p_slug:d.orgSlug,p_operation:d.operacionId,p_hash:hash});
  if(previous.error){const mapped=mapSupabaseError(previous.error);return err(mapped.code,mapped.message);}
  if(previous.data)return publicBookingResult(previous.data);
  if(!await verifyTurnstile(d.captchaToken,ip))return err("validation","Captcha inválido o expirado. Volvé a verificarlo e intentá nuevamente.");
  const {data:org,error:orgError}=await service.from("organization").select("id,opt_out_public_listing").eq("slug",d.orgSlug).is("deleted_at",null).maybeSingle();
  if(orgError)return err("db_error","No pudimos verificar el consultorio.");
  if(!org||org.opt_out_public_listing)return err("not_found","Consultorio no encontrado.");
  const professional=await resolveProfesionalPublico(service,{organizationId:org.id,profesionalId:d.profesionalId??null});
  if(!professional.ok)return professional;
  const {data,error}=await service.rpc("submit_public_booking",{p_slug:d.orgSlug,p_operation:d.operacionId,p_hash:hash,p_profesional:professional.data,p_servicio:d.servicioId,p_inicio:d.inicio,
   p_data:{nombre_cifrado:encryptColumn(d.nombre),telefono_cifrado:encryptColumn(d.telefono),email_cifrado:encryptColumn(d.email??null),motivo_cifrado:encryptColumn(d.motivo??null),consent_version:d.consentVersion,consent_ip:ip,consent_user_agent:await clientUserAgent()},
   p_identity:buildBookingIdentity(d.nombre,d.telefono,d.email??null,org.id)});
  if(error){const mapped=mapSupabaseError(error);return err(mapped.code,mapped.message);}
  return publicBookingResult(data);
 }catch{return err("network","No pudimos confirmar la respuesta. Reintentá esta misma solicitud antes de crear otra.");}
}
function publicBookingResult(data:unknown):Result<{id:string;autoConfirmado:boolean}>{
 const parsed=z.object({id:z.string().uuid(),autoConfirmado:z.boolean()}).safeParse(data);
 return parsed.success?ok(parsed.data):err("db_error","No pudimos confirmar el comprobante de la reserva. Reintentá la misma solicitud.");
}
