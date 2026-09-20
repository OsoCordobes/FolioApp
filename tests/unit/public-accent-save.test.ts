import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const realRequire = createRequire(import.meta.url);
const orgA = "11300000-0000-4000-8000-000000000010";
const orgB = "11300000-0000-4000-8000-000000000011";
const memberA = "11300000-0000-4000-8000-000000000020";

function load({ activeOrg = orgA, activeMember = memberA, storedAccent = "#8A6722" } = {}) {
  let currentAccent = storedAccent;
  let writes = 0;
  const client = {
    from: () => {
      let mode: "read" | "write" = "read";
      let desired = "";
      const filters: Record<string, string> = {};
      const query = {
        update: (patch: { acento_hex: string }) => { mode = "write"; desired = patch.acento_hex; return query; },
        select: () => query,
        eq: (column: string, value: string) => { filters[column] = value; return query; },
        maybeSingle: async () => {
          if (mode === "write") {
            if (filters.id === activeOrg && filters.acento_hex === currentAccent) {
              currentAccent = desired;
              writes++;
              return { data: { id: activeOrg }, error: null };
            }
            return { data: null, error: null };
          }
          return { data: filters.id === activeOrg ? { acento_hex: currentAccent } : null, error: null };
        },
      };
      return query;
    },
  };
  const mocks: Record<string, unknown> = {
    "@/lib/crypto": {},
    "@/lib/db/members": { listProfesionalesPublico: async () => ({ ok: true, data: [] }) },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client },
    "./active-context": { getActiveContext: async () => ({ ok: true, data: {
      organization: { id: activeOrg }, session: { memberId: activeMember, role: "OWNER" },
    } }) },
  };
  const exports: Record<string, (input: unknown) => Promise<{ ok: boolean; error?: { code: string } }>> = {};
  runInNewContext(ts.transpileModule(readFileSync("lib/db/configuracion.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => name in mocks ? mocks[name] :
    realRequire(name.startsWith("@/") ? resolve(name.slice(2)) : name.startsWith("./") ? resolve("lib/db", name) : name) });
  return { save: exports.savePublicAccent, get writes() { return writes; }, get currentAccent() { return currentAccent; } };
}

const command = { accent: "#3F6B49", expectedAccent: "#8A6722", organizationId: orgA, memberId: memberA };

test("a draft from another organization cannot write even when both colors match", async () => {
  const other = load({ activeOrg: orgB });
  const result = await other.save(command);
  assert.equal(result.ok, false);
  assert.equal(other.writes, 0);
  assert.equal(other.currentAccent, "#8A6722");
});

test("retry after a lost response accepts the already saved target color", async () => {
  const writer = load({ storedAccent: "#3F6B49" });
  assert.equal((await writer.save(command)).ok, true);
  assert.equal(writer.writes, 0);
});

test("a third color remains a conflict and is never overwritten", async () => {
  const writer = load({ storedAccent: "#3F5E75" });
  const result = await writer.save(command);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "conflict");
  assert.equal(writer.writes, 0);
  assert.equal(writer.currentAccent, "#3F5E75");
});
