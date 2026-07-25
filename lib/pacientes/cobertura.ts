/**
 * Folio · cobertura del paciente (obra social / prepaga) — lógica PURA (F7a, M89).
 *
 * Compartida por el cliente (datalist del alta/edición, columna del directorio)
 * y el server (writers de lib/db + importador CSV): por eso NO importa crypto
 * ni supabase. El cifrado del nº de afiliado vive en los writers.
 *
 * Modelo de datos (M89, paciente_identidad):
 *   - cobertura_nombre  text NULL — EN CLARO (filtro/export). NULL = particular.
 *   - cobertura_plan    text NULL — en claro.
 *   - cobertura_nro_afiliado_cifrado bytea NULL — CIFRADO app-side (mismo
 *     tratamiento que el DNI; nunca se busca por él).
 *
 * Testeado en tests/unit/cobertura-paciente.test.ts.
 */

import { z } from "zod";

// ─── Obras sociales / prepagas más comunes en AR (datalist del alta) ─────────
// Lista sugerida, NO cerrada: el input es texto libre con datalist — cualquier
// mutual/obra social provincial se puede tipear igual.

export const OBRAS_SOCIALES_AR: readonly string[] = [
  "OSDE",
  "Swiss Medical",
  "Galeno",
  "Medifé",
  "Omint",
  "PAMI",
  "IOMA",
  "OSECAC",
  "OSDEPYM",
  "Sancor Salud",
  "Accord Salud",
  "Prevención Salud",
  "Federada Salud",
  "Jerárquicos Salud",
  "OSPE",
  "OSPRERA",
  "OSUTHGRA",
  "Luis Pasteur",
  "William Hope",
  "Avalian",
  "Particular",
];

// ─── Validación (límites del dominio, compartidos por alta/edición/action) ───

export const COBERTURA_NOMBRE_MAX = 120;
export const COBERTURA_PLAN_MAX = 40;
export const COBERTURA_NRO_AFILIADO_MAX = 40;

/**
 * Shape zod de los 3 campos de cobertura, todos opcionales (la cobertura nunca
 * es requerida — NULL = particular). Se spreadea en los schemas de
 * createPaciente / updatePacienteCobertura con `...coberturaInputSchema.shape`.
 */
export const coberturaInputSchema = z.object({
  coberturaNombre: z.string().max(COBERTURA_NOMBRE_MAX).optional(),
  coberturaPlan: z.string().max(COBERTURA_PLAN_MAX).optional(),
  coberturaNroAfiliado: z.string().max(COBERTURA_NRO_AFILIADO_MAX).optional(),
});

export type CoberturaInput = z.infer<typeof coberturaInputSchema>;

// ─── Normalización previa al INSERT/UPDATE ───────────────────────────────────

export interface CoberturaNormalizada {
  nombre: string | null;
  plan: string | null;
  nroAfiliado: string | null;
}

/**
 * Normaliza los campos de cobertura antes de persistir:
 *   - trim; vacío → null.
 *   - "Particular" (case-insensitive) → null: el modelo canónico de
 *     "particular" es cobertura_nombre NULL (M89) — así el filtro del
 *     directorio no termina con dos buckets ("Particular" tipeado vs null).
 *   - plan y nº de afiliado se normalizan INDEPENDIENTES del nombre (una
 *     planilla importada puede traer solo el nº de afiliado — no se descarta).
 */
export function normalizarCobertura(input: {
  nombre?: string | null;
  plan?: string | null;
  nroAfiliado?: string | null;
}): CoberturaNormalizada {
  const limpiar = (v: string | null | undefined): string | null => {
    const t = (v ?? "").trim();
    return t.length > 0 ? t : null;
  };
  const nombre = limpiar(input.nombre);
  return {
    nombre: nombre !== null && /^particular$/i.test(nombre) ? null : nombre,
    plan: limpiar(input.plan),
    nroAfiliado: limpiar(input.nroAfiliado),
  };
}

// ─── Display ─────────────────────────────────────────────────────────────────

/**
 * Texto de display de la cobertura para la ficha/directorio:
 *   - ("OSDE", "210", "123456")  → "OSDE 210 · Nº 123456"
 *   - ("PAMI", null, null)       → "PAMI"
 *   - (null, …)                  → "Particular"
 * El nº de afiliado es opcional (el directorio/export no lo muestran — queda
 * cifrado y solo se descifra en la ficha).
 */
export function formatCobertura(
  nombre: string | null | undefined,
  plan?: string | null,
  nroAfiliado?: string | null,
): string {
  const n = (nombre ?? "").trim();
  if (n.length === 0) return "Particular";
  let out = n;
  if (plan && plan.trim().length > 0) out += ` ${plan.trim()}`;
  if (nroAfiliado && nroAfiliado.trim().length > 0) out += ` · Nº ${nroAfiliado.trim()}`;
  return out;
}
