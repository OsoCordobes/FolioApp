/**
 * Folio · helpers PUROS de la purga de cuentas (/api/cron/account-purge ·
 * Ley 25.326 art. 16, supresión tras el período de gracia de 30 días).
 *
 * La SECUENCIA de la purga (pseudonimizar → soft-delete member/org → revocar
 * invitaciones → hard-delete profile + auth.user) es destructiva e
 * IRREVERSIBLE. Antes del hard-delete del profile, la purga revoca y
 * desvincula las `member_invitation` que ese profile aceptó: la FK
 * `accepted_by_profile_id` es `ON DELETE SET NULL` (M49), así que borrar el
 * profile SIN revocar primero dejaría filas `ACEPTADA` con acceptor NULL —
 * un estado incoherente (figuran aceptadas por nadie).
 *
 * La invariante crítica: **el hard-delete del profile NO debe correr si ese
 * paso previo de revocación falló**. Si corre igual, perdemos la única
 * oportunidad de dejar el rastro coherente (el profile ya no existe para
 * reintentar la revocación). Esta decisión vive acá, PURA y testeable, para
 * fijar la invariante sin un mock de Supabase: si alguien vuelve a ignorar el
 * error de la revocación, el test lo marca.
 */

/** Forma mínima de error que devuelve el cliente Supabase (`{ error }`). */
export interface PurgeStepError {
  message?: string | null;
}

/**
 * ¿Es seguro hard-deletear el profile? Solo si la revocación previa de las
 * invitaciones aceptadas NO falló. Un error en ese paso debe ABORTAR el
 * hard-delete de ESTE profile (el cron reintenta en la próxima corrida con la
 * fila aún presente), nunca proceder y dejar invitaciones colgadas.
 *
 * `null`/`undefined` = sin error = seguro.
 */
export function isSafeToHardDeleteProfile(
  invitationRevokeError: PurgeStepError | null | undefined,
): boolean {
  return !invitationRevokeError;
}

/** Mensaje de error coherente cuando se aborta la purga por la revocación. */
export function invitationRevokeAbortMessage(
  invitationRevokeError: PurgeStepError | null | undefined,
): string {
  const detail = invitationRevokeError?.message?.trim();
  return detail && detail.length > 0
    ? `No se pudo revocar las invitaciones aceptadas antes del borrado: ${detail}`
    : "No se pudo revocar las invitaciones aceptadas antes del borrado.";
}
