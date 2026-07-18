import assert from "node:assert/strict";
import test from "node:test";

/**
 * Folio · wrapper Supabase tipado (PR S1).
 *
 * El wrapper de `lib/supabase/typed.ts` delega en los clientes untyped de
 * `server.ts` y sólo re-parametriza el tipo a `SupabaseClient<Database>`. Estos
 * tests fijan el CONTRATO DE RUNTIME del path service (env-only, sin cookies /
 * `next/headers`, por eso es unit-testeable sin request context):
 *
 *   1. devuelve un client Supabase real y usable (no un stub ni `any` roto),
 *   2. preserva la validación de env de `createSupabaseServiceClient` (falla
 *      fuerte si falta el service_role key, no silenciosamente).
 *
 * El chequeo de esquema en sí (que `.from("paceinte")` sea error de tsc) lo
 * garantiza `tsc` sobre el genérico `<Database>`, no un test de runtime — el
 * cliente Supabase es `<any>` en runtime y RLS es la frontera real (CLAUDE.md).
 * El path server (`createTypedServerClient`) usa `next/headers` cookies y no se
 * puede ejercitar fuera de un request; comparte la misma delegación de una
 * línea que el path service que sí cubrimos acá.
 */

const ORIGINAL_ENV = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function restoreEnv() {
  if (ORIGINAL_ENV.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_ENV.url;
  if (ORIGINAL_ENV.serviceKey === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_ENV.serviceKey;
}

test("createTypedServiceClient devuelve un client Supabase real y usable", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  try {
    const { createTypedServiceClient } = await import(
      "../../lib/supabase/typed"
    );
    const client = createTypedServiceClient();
    // Es un client de verdad: expone la superficie query/rpc/auth. Si el
    // wrapper devolviera un `any` roto o el genérico colapsara a `never`, estas
    // aserciones caerían.
    assert.equal(typeof client.from, "function");
    assert.equal(typeof client.rpc, "function");
    assert.equal(typeof client.auth, "object");
    // `.from()` sobre una tabla del scaffold no explota al construir la query.
    const query = client.from("paciente").select("id");
    assert.ok(query, "from().select() debe devolver un query builder");
  } finally {
    restoreEnv();
  }
});

test("createTypedServiceClient preserva la validación de env (falla si falta el service_role key)", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const { createTypedServiceClient } = await import(
      "../../lib/supabase/typed"
    );
    assert.throws(
      () => createTypedServiceClient(),
      /SUPABASE_SERVICE_ROLE_KEY/,
      "debe re-lanzar el error de env de createSupabaseServiceClient, no tragarlo",
    );
  } finally {
    restoreEnv();
  }
});
