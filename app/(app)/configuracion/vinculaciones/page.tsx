/**
 * Folio · /configuracion/vinculaciones (Server Component · Fase 3 · P9) 🔒
 *
 * UI de aprobación de claims de vinculación de pacientes al portal. El matcher del
 * portal (P3) encola en `paciente_claim` los intentos AMBIGUOS (los que no llegan al
 * umbral de auto-link de alta confianza). Acá el clínico de la org los revisa y:
 *   · APRUEBA  → se materializa el link (paciente.cuenta_id), el paciente ve la ficha
 *                desde su portal.
 *   · RECHAZA  → se cierra el claim sin vincular.
 *
 * Gate anti-impersonación: la decisión es explícita, de alguien con acceso clínico a
 * la org. El role-gate acá es UX temprana; la frontera real es el RPC
 * resolver_paciente_claim (M87), que valida can_read_clinical por auth.uid() y setea
 * cuenta_id SÓLO SI NULL (no re-asigna una ficha ya vinculada a otra cuenta).
 *
 * Sólo rol clínico (OWNER / PROFESIONAL / DIRECTOR colegiado). Los demás roles se
 * redirigen a /configuracion (no hay fuga de datos — el data layer ya falla closed —,
 * es UX limpia).
 */

import { redirect } from "next/navigation";

import { getActiveContext } from "@/lib/db/active-context";
import { listPacienteClaimsPendientes, puedeResolverClaims } from "@/lib/db/paciente-claims";

import { VinculacionesClient } from "./vinculaciones-client";

export const dynamic = "force-dynamic";

export default async function VinculacionesPage() {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar /configuracion/vinculaciones: ${ctx.error.message}`);
  }

  if (!puedeResolverClaims(ctx.data.session.role, ctx.data.session.esColegiado)) {
    redirect("/configuracion");
  }

  const claims = await listPacienteClaimsPendientes();
  if (!claims.ok) {
    throw new Error(`Error cargando vinculaciones: ${claims.error.message}`);
  }

  return (
    <main className="fi-content" style={{ maxWidth: 820 }}>
      <header className="fi-page-head">
        <div>
          <span className="fi-eyebrow">Configuración · Portal del paciente</span>
          <h1>Solicitudes de vinculación</h1>
          <p className="fi-page-sub">
            Cuando un paciente crea su cuenta en el portal, Folio intenta vincularla a
            su ficha automáticamente. Cuando el match no es concluyente, la solicitud
            queda acá para que la revises y confirmes.
          </p>
        </div>
      </header>

      <VinculacionesClient initialClaims={claims.data} />
    </main>
  );
}
