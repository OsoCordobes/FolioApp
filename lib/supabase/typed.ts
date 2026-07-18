import "server-only";

/**
 * Folio · wrapper Supabase TIPADO para CÓDIGO NUEVO (server-side).
 *
 * PROPÓSITO (PR S1): convertir el drift de esquema en errores de compilación
 * para el código nuevo, SIN el flip global. Los clientes runtime de
 * `server.ts` siguen tipados `<any>` (los cientos de call-sites existentes no
 * cambian). Cuando escribas código nuevo y quieras que `tsc` te avise si
 * renombraron una columna/tabla, importá de acá en vez de `server.ts`:
 *
 *   import { createTypedServerClient } from "@/lib/supabase/typed";
 *   const supabase = await createTypedServerClient();
 *   // supabase.from("paciente").select("motivo_consulta_cifrado") ← chequeado
 *   // supabase.from("paceinte")  ← error de tsc (tabla inexistente)
 *
 * IMPLEMENTACIÓN: delega en los clientes untyped de `server.ts` (única fuente
 * de la lógica de cookies/service-role) y sólo re-parametriza el tipo a
 * `SupabaseClient<Database>`. El objeto en runtime es idéntico —
 * `createServerClient<any>` y `createServerClient<Database>` producen la misma
 * instancia; sólo cambia lo que ve el compilador. Por eso no duplicamos el
 * plumbing de cookies (que debe quedar en un solo lugar).
 *
 * SEGURIDAD: la frontera multi-tenant es RLS + el JWT, NO estos tipos
 * (CLAUDE.md). El wrapper no relaja ni sortea RLS: `createTypedServerClient`
 * usa el anon key + cookies de sesión igual que `createSupabaseServerClient`;
 * `createTypedServiceClient` usa el service_role (BYPASSRLS) igual que
 * `createSupabaseServiceClient` — con las mismas restricciones de uso.
 *
 * NOTA sobre `Database`: hoy `database.types.ts` es un scaffold manual curado
 * (no el output completo de `supabase gen types` — no hay Docker ni access
 * token en el entorno del agente). El wrapper ya está listo para el día que se
 * regeneren los tipos reales: sólo cambia `database.types.ts`, este archivo no.
 * La migración incremental módulo-por-módulo detrás de este wrapper es S1b.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

/**
 * Cliente tipado para Server Components / Server Actions / Route Handlers.
 * Respeta RLS vía el JWT de la sesión (cookies). Equivalente tipado de
 * `createSupabaseServerClient`.
 */
export async function createTypedServerClient(): Promise<
  SupabaseClient<Database>
> {
  const client = await createSupabaseServerClient();
  return client as unknown as SupabaseClient<Database>;
}

/**
 * Cliente tipado con service_role — BYPASEA RLS por completo. Mismas reglas de
 * uso que `createSupabaseServiceClient`: SOLO en Server Actions específicas con
 * privilegios admin, NUNCA expuesto al cliente ni usado en Route Handlers
 * públicos. Equivalente tipado de `createSupabaseServiceClient`.
 */
export function createTypedServiceClient(): SupabaseClient<Database> {
  const client = createSupabaseServiceClient();
  return client as unknown as SupabaseClient<Database>;
}
