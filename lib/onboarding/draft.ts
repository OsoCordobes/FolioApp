/**
 * Folio · Onboarding · draft de localStorage namespaceado por identidad.
 *
 * El wizard guarda un backup del draft en localStorage (red intermitente).
 * Antes usaba una key global sin dueño: en una máquina compartida de clínica,
 * el nombre/teléfono/matrícula del profesional anterior aparecían precargados
 * para el siguiente. Ahora el draft viaja en un sobre con la identidad
 * (email normalizado) de quien lo escribió, y al hidratar se descarta si no
 * coincide con la identidad actual.
 *
 * `password` NUNCA se persiste (secreto + máquina compartida). Los sobres
 * legados (formato viejo sin identidad) se descartan: no se puede atribuir
 * su PII a nadie.
 */

const DRAFT_VERSION = 1;

interface DraftEnvelope {
  v: number;
  identity: string;
  data: Record<string, unknown>;
}

/** Identidad canónica de un draft: email trim + lowercase ("" = anónimo). */
export function normalizeDraftIdentity(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Serializa el draft con identidad. Excluye `password` siempre. */
export function packDraft(email: string | null | undefined, data: Record<string, unknown>): string {
  const { password: _omitPassword, ...safe } = data;
  void _omitPassword;
  const envelope: DraftEnvelope = {
    v: DRAFT_VERSION,
    identity: normalizeDraftIdentity(email),
    data: safe,
  };
  return JSON.stringify(envelope);
}

/**
 * Deserializa un draft si (y solo si) pertenece a la identidad actual.
 * Devuelve null en cualquier otro caso: raw ausente, JSON roto, formato
 * legado sin identidad, o identidad distinta.
 */
export function unpackDraft(
  raw: string | null,
  currentEmail: string | null | undefined,
): Record<string, unknown> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const env = parsed as Partial<DraftEnvelope>;
  if (env.v !== DRAFT_VERSION) return null;
  if (typeof env.identity !== "string") return null;
  if (!env.data || typeof env.data !== "object" || Array.isArray(env.data)) return null;
  if (env.identity !== normalizeDraftIdentity(currentEmail)) return null;
  const data = { ...(env.data as Record<string, unknown>) };
  // Guard defensivo: aunque packDraft nunca lo escribe, un draft manipulado
  // a mano no debe poder inyectar un password al state.
  delete data.password;
  return data;
}
