/**
 * Folio · /t/[token] — confirmación 1-click de turno desde el email (F7b · M90).
 *
 * Página PÚBLICA (sin login): el paciente llega desde los links "Confirmo mi
 * turno" / "No puedo ir" del recordatorio 24h. El token HMAC stateless
 * (lib/booking/confirm-token) firma turnoId + acción + expiración (= inicio
 * del turno).
 *
 * IMPORTANTE — el GET NO muta: los clientes de correo prefetchean los links a
 * ciegas (Google/Outlook), así que este render solo verifica el token, lee el
 * turno con service client y muestra un panel con UN botón. La transición
 * corre en la server action (POST) del panel, que los prefetchers no ejecutan.
 *
 * Sin datos sensibles: la página muestra solo el resultado + fecha/hora +
 * nombre del consultorio. Nunca el nombre del paciente ni el servicio (el
 * link viaja por email y puede reenviarse).
 *
 * Rate limit por IP fail-open (lib/security/rate-limit) — la página degrada a
 * "Demasiados intentos" sin tocar la DB.
 */

import { headers } from "next/headers";

import { decideResultadoConfirmacion } from "@/lib/booking/confirm-decision";
import { verifyConfirmToken } from "@/lib/booking/confirm-token";
import { fmtHora } from "@/lib/booking/slots-format";
import { limitByIp } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

import { ConfirmPanel } from "./confirm-panel";
import { ConfirmacionResultadoView, type DatosTurnoPublicos } from "./resultado-view";

import type { ResultadoAccion1Click } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Confirmación de turno",
  // El token es un capability link: que no lo indexen los buscadores.
  robots: { index: false, follow: false },
};

const DEFAULT_TZ = "America/Argentina/Cordoba";

/** Valida la timezone contra Intl; inválida/ausente → default AR. */
function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("es-AR", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="fi-confirm-wrap">
      {children}
      <p className="fi-confirm-foot">Agenda gestionada con Folio</p>
    </main>
  );
}

export default async function ConfirmacionTurnoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Rate limit del GET (más laxo que el de la action — los prefetchers de los
  // clientes de correo también pegan acá). Fail-open según la matriz.
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const rl = await limitByIp("confirm-turno.view", ip, 120);
  if (!rl.ok) {
    return (
      <Shell>
        <ConfirmacionResultadoView resultado="rate_limited" />
      </Shell>
    );
  }

  const v = verifyConfirmToken(token);
  if (!v.ok) {
    return (
      <Shell>
        <ConfirmacionResultadoView
          resultado={v.reason === "expirado" ? "link_vencido" : "link_invalido"}
        />
      </Shell>
    );
  }

  // Token válido → leer el turno (service client: no hay sesión; el id viene
  // FIRMADO en el token, no del usuario). Solo columnas operativas, cero PII.
  const service = createSupabaseServiceClient();
  const { data: turno, error } = await service
    .from("turno")
    .select("id, inicio, estado, organization_id")
    .eq("id", v.turnoId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error(`[confirm-1click] GET turno fetch falló: ${error.message}`);
    return (
      <Shell>
        <ConfirmacionResultadoView resultado="error" />
      </Shell>
    );
  }
  if (!turno) {
    return (
      <Shell>
        <ConfirmacionResultadoView resultado="link_invalido" />
      </Shell>
    );
  }

  const { data: org } = await service
    .from("organization")
    .select("nombre, timezone")
    .eq("id", turno.organization_id)
    .maybeSingle();

  const tz = safeTimezone(org?.timezone as string | null | undefined);
  const inicio = new Date(turno.inicio as string);
  const datos: DatosTurnoPublicos = {
    consultorioNombre: (org?.nombre as string | undefined) ?? "el consultorio",
    fecha: inicio.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: tz,
    }),
    // fmtHora fija hourCycle h23: el ICU de Node resuelve es-AR como h12, y
    // la vista concatena " hs" → "mié, 29 jul · 10:00 a. m. hs".
    hora: fmtHora(turno.inicio as string, tz),
  };

  const decision = decideResultadoConfirmacion({
    accion: v.accion,
    estado: turno.estado as string,
    inicioMs: inicio.getTime(),
    nowMs: Date.now(),
  });

  if (decision !== "ejecutar") {
    // Estados que no requieren acción: mensaje directo, sin botón.
    return (
      <Shell>
        <ConfirmacionResultadoView resultado={decision as ResultadoAccion1Click} datos={datos} />
      </Shell>
    );
  }

  return (
    <Shell>
      <ConfirmPanel token={token} accion={v.accion} datos={datos} />
    </Shell>
  );
}
