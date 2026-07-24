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

import { setActiveOrg } from "@/lib/db/session";

export async function switchActiveOrgAction(
  organizationId: string,
): Promise<{ ok: boolean; message: string | null }> {
  const result = await setActiveOrg(organizationId);
  if (!result.ok) {
    return { ok: false, message: result.error.message };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: null };
}
