/**
 * Folio · timeline de modificaciones de la historia clínica de un paciente.
 *
 * "Quiero ver quién tocó qué y cuándo" — el tercero de los cuatro reportes del
 * quiropráctico. La infraestructura existía desde M12 (`audit_log` con
 * before/after) pero no había ninguna UI que la mostrara.
 *
 * ─── El orden de los chequeos ES la seguridad ──────────────────────────────
 * `audit_log` tiene RLS de OWNER (M34) y su payload trae filas enteras, así que
 * leerlo requiere el service client. Un service client es BYPASSRLS: si se lo
 * usa antes de verificar que el usuario puede ver la ficha, este módulo se
 * convierte en un canal lateral que devuelve metadata clínica de pacientes que
 * la ficha le niega.
 *
 * Por eso la secuencia es, sin excepciones:
 *
 *   1. rol ∈ {OWNER, DIRECTOR, PROFESIONAL} — el timeline es información
 *      clínica, no administrativa;
 *   2. **gate RLS-aware**: leer el paciente con el client DEL USUARIO. Si no lo
 *      ve (otra org, no asignado, caja fuerte ajena) → `not_found`, y el
 *      service client no se toca;
 *   3. las sesiones del paciente, también con el client del usuario: así el
 *      profesional hereda su propia caja fuerte y el conjunto de ids que va a
 *      poder consultar ya viene filtrado;
 *   4. recién ahí el service client sobre `audit_log`, acotado a la org y a
 *      esos ids.
 *
 * No se amplía la policy de M34: el payload trae filas completas, así que el
 * lector minimizado es lo seguro. El patrón "service client después del gate"
 * ya existe en el repo.
 *
 * Lo que sale de acá NUNCA incluye valores: sólo labels de campos
 * (lib/ficha/timeline-core).
 */

import { tryDecrypt } from "@/lib/crypto";
import {
  aEventoTimeline,
  agruparEventos,
  type EventoTimeline,
} from "@/lib/ficha/timeline-core";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

import { getActiveContext } from "./active-context";
import { err, ok, type Result } from "./errors";
import { readCompleteCollection } from "./complete-collection";

/** Honest resource ceiling: never return an apparently complete truncated timeline. */
const MAX_TIMELINE_EVENTS = 10_000;
type AuditRow = { id: string; ts: string; action: string; resource_type: string; resource_id: string; actor_id: string | null; payload: unknown };

const ROLES_CON_TIMELINE = new Set(["OWNER", "DIRECTOR", "PROFESIONAL"]);

export async function getFichaTimeline(
  pacienteId: string,
): Promise<Result<EventoTimeline[]>> {
  try {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  // (1) Rol. El timeline dice qué campos clínicos se tocaron: no es información
  // de mostrador.
  if (!ROLES_CON_TIMELINE.has(ctx.data.session.role)) {
    return err("forbidden", "No tenés acceso al historial de cambios de la ficha.");
  }

  const supabase = await createSupabaseServerClient();
  const organizationId = ctx.data.organization.id;

  // (2) Gate RLS-aware. Con el client DEL USUARIO: si no ve la ficha, acá se
  // termina — y el service client no llegó a existir.
  const { data: pac, error: pacienteError } = await supabase
    .from("paciente")
    .select("id")
    .eq("id", pacienteId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (pacienteError) return err("db_error", "No pudimos verificar el acceso a la ficha. Intentá nuevamente.");
  if (!pac) {
    return err("not_found", "No encontramos esa ficha.");
  }

  // (3) Sesiones del paciente, también bajo RLS: el profesional hereda su
  // propia caja fuerte y los ids que va a poder consultar ya vienen filtrados.
  const readSessionScope = () => readCompleteCollection<{id:string}>((from,to) => supabase.from("sesion")
    .select("id", {count:"exact"}).eq("paciente_id",pacienteId).eq("organization_id",organizationId)
    .order("id", {ascending:true}).range(from,to));
  const sesiones = await readSessionScope();
  if (sesiones.error) return err("db_error", "No pudimos verificar todas las sesiones de la ficha. Intentá nuevamente.");
  const sesionIds = sesiones.data.map(s=>s.id);
  // Enumerate every source with the USER client before constructing any
  // privileged query. Chunked IN lists never broaden to the entire organization.
  const resourceIds = [pacienteId, ...sesionIds];
  const service = createSupabaseServiceClient();
  const filas: AuditRow[] = [];
  let tooLarge=false;
  for (let i=0;i<resourceIds.length;i+=200) {
    const batch = await readCompleteCollection<AuditRow>(async(from,to)=>{
      const result=await service.from("audit_log")
        .select("id, ts, action, resource_type, resource_id, actor_id, payload", {count:"exact"})
        .eq("organization_id",organizationId).in("resource_id",resourceIds.slice(i,i+200))
        .order("ts",{ascending:false}).order("id",{ascending:false}).range(from,to);
      if(result.count!=null && filas.length+result.count>MAX_TIMELINE_EVENTS) { tooLarge=true; return {data:null,count:null,error:{message:"timeline_too_large"}}; }
      return {...result,data:result.data?.map((r:AuditRow)=>{
        if(typeof r.id === "number" && !Number.isSafeInteger(r.id)) throw new Error("unsafe_audit_id");
        return {...r,id:String(r.id)};
      })??null};
    });
    if(batch.error) return err("db_error", tooLarge ? "El historial supera los 10.000 eventos de esta consulta. Solicitá una revisión por período." : "No pudimos leer el historial de cambios completo. Intentá nuevamente.");
    filas.push(...batch.data);
  }
  // Stable global ordering across independently paginated resource batches.
  filas.sort((a,b)=>{
    const time=Date.parse(b.ts)-Date.parse(a.ts);if(time)return time;
    return BigInt(a.id)===BigInt(b.id)?0:BigInt(a.id)>BigInt(b.id)?-1:1;
  });
  // Nombres de actor en lotes acotados. `actor_id` es un profile.id, y el nombre está
  // cifrado (M02): se descifra server-side, como el resto de la PII.
  const actorIds = [...new Set(filas.map((f) => f.actor_id).filter((x): x is string => !!x))];
  const nombrePorActor = new Map<string, string>();
  if (actorIds.length > 0) {
    type ActorRow = {id:string; nombre_cifrado:string|null; apellido_cifrado:string|null; email:string|null};
    for(let i=0;i<actorIds.length;i+=200){
    const profiles=await readCompleteCollection<ActorRow>((from,to)=>service.from("profile")
      .select("id, nombre_cifrado, apellido_cifrado, email",{count:"exact"}).in("id",actorIds.slice(i,i+200))
      .order("id",{ascending:true}).range(from,to));
    if(profiles.error)return err("db_error","No pudimos verificar quién realizó los cambios. Intentá nuevamente.");
    for (const p of profiles.data) {
      const nombre = [
        tryDecrypt(p.nombre_cifrado, "profile.nombre"),
        tryDecrypt(p.apellido_cifrado, "profile.apellido"),
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (nombre) nombrePorActor.set(p.id, nombre);
      else if (p.email) nombrePorActor.set(p.id, p.email);
    }
  }

  }
  // Permissions can change during pagination. Revalidate with the user client;
  // never use the service client to repair a denied or incomplete source scope.
  const latestContext=await getActiveContext();
  if(!latestContext.ok)return latestContext;
  if(latestContext.data.organization.id!==organizationId || latestContext.data.session.memberId!==ctx.data.session.memberId
    || !ROLES_CON_TIMELINE.has(latestContext.data.session.role))return err("forbidden","Cambió el acceso a la ficha. Volvé a abrirla.");
  const latestPatient=await supabase.from("paciente").select("id").eq("id",pacienteId).eq("organization_id",organizationId).maybeSingle();
  const latestSessions=await readSessionScope();
  const priorIds=new Set(sesionIds);
  if(latestPatient.error || !latestPatient.data || latestSessions.error || latestSessions.data.length!==priorIds.size
    || latestSessions.data.some(s=>!priorIds.has(s.id)))return err("db_error","Cambió o no pudo verificarse el acceso a la historia. Intentá nuevamente.");

  // El payload muere acá: aEventoTimeline sólo deriva labels de campos.
  const eventos = filas.map((f) =>
    aEventoTimeline({
      id: String(f.id),
      ts: f.ts,
      action: f.action,
      resourceType: f.resource_type,
      resourceId: f.resource_id,
      actorId: f.actor_id,
      actorNombre: f.actor_id ? (nombrePorActor.get(f.actor_id) ?? null) : null,
      payload: f.payload,
    }),
  );

  // Se agrupa por recurso: dos sesiones distintas editadas en la misma ventana
  // son dos eventos, no uno.
  const porRecurso = new Map(filas.map((f, i) => [eventos[i].id, f.resource_id]));
  return ok(agruparEventos(eventos, (e) => porRecurso.get(e.id) ?? ""));
  } catch {
    return err("db_error", "No pudimos leer el historial de cambios completo. Intentá nuevamente.");
  }
}
