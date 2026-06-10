/**
 * Folio · helpers PUROS del export ARCO de invitaciones de equipo
 * (/api/me/export · Ley 25.326 art. 16, portabilidad).
 *
 * La selección y la SANITIZACIÓN de las filas de member_invitation que entran
 * al export viven acá, separadas del route handler, para poder testearlas sin
 * Supabase. Reglas de negocio:
 *
 *   - Se exportan las invitaciones que el titular CREÓ (invited_by_member_id ∈
 *     sus memberships) y las que ACEPTÓ (accepted_by_profile_id = su user.id).
 *   - NUNCA se exporta token_hash (es el secreto de aceptación). La sanitización
 *     es por allow-list explícita: si mañana el SELECT trae una columna nueva,
 *     no se filtra sin tocar este archivo.
 */

/** Fila cruda de member_invitation tal como la trae el SELECT del route. */
export interface RawInvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  estado: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  invited_by_member_id: string | null;
  accepted_by_profile_id: string | null;
}

/** Fila sanitizada que sale en el JSON del export. Sin token_hash. */
export interface ExportedInvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  estado: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  creada_por_el_titular: boolean;
  aceptada_por_el_titular: boolean;
}

/**
 * Construye los filtros `.or()` de PostgREST para traer las invitaciones del
 * titular: las que aceptó (siempre) y las que creó (si tiene memberships).
 * Devuelve el string listo para `.or(...)`.
 */
export function buildInvitationOrFilter(userId: string, memberIds: string[]): string {
  const filters = [`accepted_by_profile_id.eq.${userId}`];
  if (memberIds.length > 0) {
    filters.push(`invited_by_member_id.in.(${memberIds.join(",")})`);
  }
  return filters.join(",");
}

/**
 * Sanitiza las filas crudas a la forma exportable (allow-list de columnas) y
 * anota la relación con el titular. Filtra defensivamente cualquier fila que
 * no calce con ninguno de los dos criterios (no debería pasar dado el `.or()`,
 * pero el export no debe filtrar invitaciones ajenas si la query cambia).
 */
export function sanitizeInvitationsForExport(
  rows: RawInvitationRow[],
  userId: string,
  memberIds: string[],
): ExportedInvitationRow[] {
  const memberIdSet = new Set(memberIds);
  return rows
    .map((inv) => {
      const creada = inv.invited_by_member_id != null && memberIdSet.has(inv.invited_by_member_id);
      const aceptada = inv.accepted_by_profile_id === userId;
      return { inv, creada, aceptada };
    })
    .filter(({ creada, aceptada }) => creada || aceptada)
    .map(({ inv, creada, aceptada }) => ({
      id: inv.id,
      organization_id: inv.organization_id,
      email: inv.email,
      role: inv.role,
      estado: inv.estado,
      expires_at: inv.expires_at,
      accepted_at: inv.accepted_at,
      created_at: inv.created_at,
      creada_por_el_titular: creada,
      aceptada_por_el_titular: aceptada,
      // token_hash, invited_by_member_id, accepted_by_profile_id quedan FUERA.
    }));
}
