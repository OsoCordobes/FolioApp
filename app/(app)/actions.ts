"use server";

/**
 * Folio · server actions del shell autenticado (layout-level).
 *
 * switchActiveOrgAction: cambia la organización activa del user (cookie
 * `folio.active_org`). La validación de membresía vive en setActiveOrg
 * (lib/db/session.ts) — acá solo se traduce el Result a un shape serializable
 * para el cliente y se revalida el layout completo (todo el árbol depende de
 * la org activa: sidebar, gate de billing, datos de cada página).
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { setActiveOrg } from "@/lib/db/session";
import { ESPECIALIDAD_OVERRIDE_COOKIE } from "@/lib/especialidades/meta";

export async function switchActiveOrgAction(
  organizationId: string,
): Promise<{ ok: boolean; message: string | null }> {
  const result = await setActiveOrg(organizationId);
  if (!result.ok) {
    return { ok: false, message: result.error.message };
  }
  // La cookie de override de especialidad (EspecialidadSwitcher, orgs
  // internas) es GLOBAL del browser, no está scopeada por org: un override
  // residual de la org anterior haría que la ficha de ESTA org muestre la
  // herramienta clínica equivocada. Al cambiar de org se resetea — cada org
  // demo ya tiene su especialidad real seteada.
  (await cookies()).delete(ESPECIALIDAD_OVERRIDE_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true, message: null };
}
