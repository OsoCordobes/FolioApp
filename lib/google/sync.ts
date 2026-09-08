/**
 * Outbound intent is persisted by the turno transaction (M107). These callers
 * opportunistically dispatch one job; the authenticated cron recovers missed
 * calls and provider failures without affecting the committed appointment.
 */

import type { createSupabaseServerClient } from "@/lib/supabase/server";


type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const DEFAULT_TZ = "America/Argentina/Cordoba";

/** Generic provider payload. Patient and practice details are deliberately omitted. */
export function buildCalendarEventPayload(input: {
  organizationNombre: string;
  servicioNombre: string;
  pacienteNombre: string;
  inicioIso: string;
  finIso: string;
  organizationTimezone: string | null;
  organizationDireccion: string | null;
  pacienteEmail: string | null;
}): {
  summary: string;
  description: string;
  start: string;
  end: string;
  location?: string;
  attendeeEmail?: string;
  timeZone: string;
} {
  const summary = "Turno reservado";
  const description = "Reserva gestionada por Folio.";
  const payload: {
    summary: string;
    description: string;
    start: string;
    end: string;
    location?: string;
    attendeeEmail?: string;
    timeZone: string;
  } = {
    summary,
    description,
    start: input.inicioIso,
    end: input.finIso,
    timeZone: input.organizationTimezone || DEFAULT_TZ,
  };
  return payload;
}

// The database trigger persists intent in the turn transaction. These legacy
// callers only attempt a claimed job sooner; the cron can recover any missed call.
export async function pushTurnoToGoogle(input: {client:ServerClient;turnoId:string;organizationId:string;profesionalMemberId:string}):Promise<void>{
  try {
    const access=await input.client.from("turno").select("id").eq("id",input.turnoId).eq("organization_id",input.organizationId).eq("profesional_id",input.profesionalMemberId).maybeSingle();
    if(access.error||!access.data)return;
    const {dispatchGoogleOutbound}=await import("./outbound");
    await dispatchGoogleOutbound(1,input.turnoId,AbortSignal.timeout(40_000));
  }catch(error){
    const {captureException}=await import("@sentry/nextjs");
    captureException(error,{tags:{component:"gcal-sync",op:"pushTurnoToGoogle"}});
  }
}
export const cancelTurnoEnGoogle=pushTurnoToGoogle;
