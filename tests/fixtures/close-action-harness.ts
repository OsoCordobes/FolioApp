import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Role } from "../../lib/auth/capabilities";

const actual = createRequire(import.meta.url);
export const ids = { turno: "10000000-0000-4000-8000-000000000001", operation: "10000000-0000-4000-8000-000000000002",
  pago: "10000000-0000-4000-8000-000000000003", org: "10000000-0000-4000-8000-000000000004", member: "10000000-0000-4000-8000-000000000005",
  other: "10000000-0000-4000-8000-000000000006" };
export const timestamp = "2026-09-12T12:00:00.000Z";
export const payment = { id: ids.pago, montoCents: 12500, metodo: "EFECTIVO", estado: "PAGADO", pagadoTs: timestamp, updatedAt: timestamp };
export const status = { turnoId: ids.turno, estado: "CERRADO", closedAt: timestamp, origen: "AGENDA", clasificacion: "REQUIERE_REGISTRO", pago: null, puedeRegistrar: true };
export const receipt = { ...status, operationId: ids.operation, pagoOrigen: "SIN_DECISION" };
export const binding = { id: ids.pago, turno_id: ids.turno, turno: { organization_id: ids.org, profesional_id: ids.member, estado: "CERRADO" } };
type Response = { data: unknown; error: null | { code?: string; message?: string } };
export type HarnessOptions = {
  role?: Role; sessionError?: boolean; cacheThrows?: boolean; response?: Response; rpcThrows?: boolean;
  binding?: unknown; readError?: { code: string }; updateRows?: unknown[];
};

/** Load actual adapters and action bodies, replacing only session/DB/framework/provider boundaries. */
export function closeHarness(options: HarnessOptions = {}) {
  const rpcCalls: { name: string; args: Record<string, unknown>; options: unknown }[] = [];
  const reads: string[] = [], updates: unknown[] = [], cached: string[] = [], after: unknown[] = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>, rpcOptions?: unknown) {
      rpcCalls.push({ name, args, options: rpcOptions });
      if (options.rpcThrows) throw Error("synthetic private transport detail");
      return options.response ?? { data: receipt, error: null };
    },
    from(table: string) {
      return {
        select(columns: string) {
          assert.equal(table, "pago");
          assert.equal(columns, "id, turno_id, turno:turno_id!inner(organization_id, profesional_id, estado)");
          return { eq(column: string, id: string) {
            assert.equal(column, "id"); reads.push(id);
            return { async maybeSingle() { return { data: "binding" in options ? options.binding : binding, error: options.readError ?? null }; } };
          } };
        },
        update(patch: unknown) {
          assert.equal(table, "turno", "settlement must never use REST UPDATE"); updates.push(patch);
          const query = { eq() { return query; }, async select() { return { data: options.updateRows ?? [{ profesional_id: ids.member }], error: null }; } };
          return query;
        },
        upsert() { assert.fail("close must never upsert a payment"); },
      };
    },
  };
  const modules = new Map<string, Record<string, unknown>>();
  const realModules = new Set(["lib/db/turno-close.ts", "lib/db/payment-settlement.ts", "lib/db/mutation-result.ts", "lib/turnos/close-contract.ts", "lib/db/turnos.ts"].map(p => resolve(p)));
  function load(file: string): Record<string, unknown> {
    const full = resolve(file);
    const prior = modules.get(full); if (prior) return prior;
    const exports: Record<string, unknown> = {}; modules.set(full, exports);
    const source = ts.transpileModule(readFileSync(full, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(source, { exports, require(name: string) {
      const local = name.startsWith("@/") ? resolve(name.slice(2) + ".ts") : name.startsWith(".") ? resolve(dirname(full), name + ".ts") : null;
      if (local && realModules.has(local)) return load(local);
      if (name === "zod") return actual(name);
      if (name === "next/cache") return { revalidatePath(path: string) { cached.push(path); if (options.cacheThrows) throw Error("cache failure"); } };
      if (local === resolve("lib/db/session.ts")) return { getActiveSession: async () => options.sessionError ? { ok: false, error: { code: "auth_required", message: "Iniciá sesión." } }
        : { ok: true, data: { organizationId: ids.org, memberId: ids.member, role: options.role ?? "PROFESIONAL", esColegiado: true } } };
      if (name === "@/lib/supabase/server") return { createSupabaseServerClient: async () => client };
      if (name === "@/lib/after-response") return { runAfterResponse: (fn: unknown) => after.push(fn) };
      if (local && ["lib/db/errors.ts", "lib/auth/capabilities.ts", "lib/format/currency.ts"].some(p => resolve(p) === local)) return actual(local);
      return {};
    } });
    return exports;
  }
  return { load, rpcCalls, reads, updates, cached, after };
}
