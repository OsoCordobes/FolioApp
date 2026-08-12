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

/** Techo de eventos leídos. Después de agrupar quedan muchos menos. */
const LIMITE_EVENTOS = 300;

const ROLES_CON_TIMELINE = new Set(["OWNER", "DIRECTOR", "PROFESIONAL"]);

export async function getFichaTimeline(
  pacienteId: string,
): Promise<Result<EventoTimeline[]>> {
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
  const { data: pac } = await supabase
    .from("paciente")
    .select("id")
    .eq("id", pacienteId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!pac) {
    return err("not_found", "No encontramos esa ficha.");
  }

  // (3) Sesiones del paciente, también bajo RLS: el profesional hereda su
  // propia caja fuerte y los ids que va a poder consultar ya vienen filtrados.
  const { data: sesionesRows } = await supabase
    .from("sesion")
    .select("id")
    .eq("paciente_id", pacienteId)
    .eq("organization_id", organizationId);
  const sesionIds = ((sesionesRows ?? []) as Array<{ id: string }>).map((s) => s.id);

  // Los recursos cuyo historial se muestra: la ficha del paciente + sus
  // sesiones. Cualquier otro resource_id queda fuera del filtro por
  // construcción, no por confianza en el payload.
  const resourceIds = [pacienteId, ...sesionIds];

  // (4) Service client, acotado a org + esos ids.
  const service = createSupabaseServiceClient();
  const { data: auditRows, error } = await service
    .from("audit_log")
    .select("id, ts, action, resource_type, resource_id, actor_id, payload")
    .eq("organization_id", organizationId)
    .in("resource_id", resourceIds)
    .order("ts", { ascending: false })
    .limit(LIMITE_EVENTOS);

  if (error) {
    return err("db_error", "No pudimos leer el historial de cambios.", error.message);
  }

  const filas = (auditRows ?? []) as Array<{
    id: number | string;
    ts: string;
    action: string;
    resource_type: string;
    resource_id: string;
    actor_id: string | null;
    payload: unknown;
  }>;
  if (filas.length === 0) return ok([]);

  // Nombres de actor en UN batch. `actor_id` es un profile.id, y el nombre está
  // cifrado (M02): se descifra server-side, como el resto de la PII.
  const actorIds = [...new Set(filas.map((f) => f.actor_id).filter((x): x is string => !!x))];
  const nombrePorActor = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await service
      .from("profile")
      .select("id, nombre_cifrado, apellido_cifrado, email")
      .in("id", actorIds);
    for (const p of (profiles ?? []) as Array<{
      id: string;
      nombre_cifrado: string | null;
      apellido_cifrado: string | null;
      email: string | null;
    }>) {
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
}
