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
const userA = "11300000-0000-4000-8000-000000000030";

interface AccentFixture {
  activeOrg?: string;
  activeMember?: string;
  storedAccent?: string;
  role?: string;
  currentRole?: string;
  memberOrg?: string;
  memberUser?: string;
  memberDeleted?: boolean;
  memberPending?: boolean;
  orgDeleted?: boolean;
}

function load({ activeOrg = orgA, activeMember = memberA, storedAccent = "#8A6722", role = "OWNER",
  currentRole = role, memberOrg = activeOrg, memberUser = userA, memberDeleted = false,
  memberPending = false, orgDeleted = false,
}: AccentFixture = {}) {
  let currentAccent = storedAccent;
  let writes = 0;
  let membershipReads = 0;
  const client = {
    from: (table: string) => {
      let mode: "read" | "write" = "read";
      let desired = "";
      const filters: Record<string, string> = {};
      const query = {
        update: (patch: { acento_hex: string }) => {
          assert.equal(table, "organization");
          assert.deepEqual(Object.keys(patch), ["acento_hex"]);
          mode = "write"; desired = patch.acento_hex; return query;
        },
        select: () => query,
        eq: (column: string, value: string) => { filters[column] = value; return query; },
        is: (column: string, value: null) => { filters[column] = String(value); return query; },
        maybeSingle: async () => {
          if (table === "member") {
            membershipReads++;
            return { data: filters.id === activeMember && filters.profile_id === memberUser && filters.organization_id === memberOrg ? {
              id: activeMember, profile_id: memberUser, organization_id: memberOrg,
              role: currentRole, deleted_at: memberDeleted ? "2026-09-20" : null,
              accepted_at: memberPending ? null : "2026-09-01",
              invited_by_id: memberPending ? memberA : null,
            } : null, error: null };
          }
          if (mode === "write") {
            if (filters.id === activeOrg && filters.deleted_at === "null" && !orgDeleted && filters.acento_hex === currentAccent) {
              currentAccent = desired;
              writes++;
              return { data: { id: activeOrg }, error: null };
            }
            return { data: null, error: null };
          }
          return { data: filters.id === activeOrg && filters.deleted_at === "null" && !orgDeleted ? { acento_hex: currentAccent } : null, error: null };
        },
      };
      return query;
    },
  };
  const mocks: Record<string, unknown> = {
    "@/lib/crypto": {},
    "@/lib/db/members": { listProfesionalesPublico: async () => ({ ok: true, data: [] }) },
    "@/lib/supabase/server": {
      createSupabaseServerClient: async () => { throw new Error("authenticated UPDATE would deny DIRECTOR under M02"); },
      createSupabaseServiceClient: () => client,
    },
    "./active-context": { getActiveContext: async () => ({ ok: true, data: {
      organization: { id: activeOrg }, session: { memberId: activeMember, userId: userA, role },
    } }) },
  };
  const exports: Record<string, (input: unknown) => Promise<{ ok: boolean; error?: { code: string } }>> = {};
  runInNewContext(ts.transpileModule(readFileSync("lib/db/configuracion.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => name in mocks ? mocks[name] :
    realRequire(name.startsWith("@/") ? resolve(name.slice(2)) : name.startsWith("./") ? resolve("lib/db", name) : name) });
  return { save: exports.savePublicAccent, get writes() { return writes; },
    get membershipReads() { return membershipReads; }, get currentAccent() { return currentAccent; } };
}

const command = { accent: "#3F6B49", expectedAccent: "#8A6722", organizationId: orgA, memberId: memberA };

test("DIRECTOR with current membership can save the public color through scoped service access", async () => {
  const director = load({ role: "DIRECTOR" });
  assert.equal((await director.save(command)).ok, true);
  assert.equal(director.membershipReads, 1);
  assert.equal(director.writes, 1);
  assert.equal(director.currentAccent, command.accent);
});

test("a non-editor role cannot use service access", async () => {
  const professional = load({ role: "PROFESIONAL" });
  const result = await professional.save(command);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "forbidden");
  assert.equal(professional.membershipReads, 0);
  assert.equal(professional.writes, 0);
});

test("a draft from another organization cannot write even when both colors match", async () => {
  const other = load({ activeOrg: orgB });
  const result = await other.save(command);
  assert.equal(result.ok, false);
  assert.equal(other.writes, 0);
  assert.equal(other.currentAccent, "#8A6722");
});

test("a stale member identifier cannot use the active context", async () => {
  const writer = load({ role: "DIRECTOR" });
  const result = await writer.save({ ...command, memberId: "11300000-0000-4000-8000-000000000021" });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "conflict");
  assert.equal(writer.membershipReads, 0);
  assert.equal(writer.writes, 0);
});

test("a changed or revoked membership cannot write after the active context was read", async () => {
  for (const changed of [{ memberOrg: orgB }, { memberUser: "11300000-0000-4000-8000-000000000031" },
    { currentRole: "PROFESIONAL" }, { memberDeleted: true }, { memberPending: true }]) {
    const writer = load({ role: "DIRECTOR", ...changed });
    const result = await writer.save(command);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "forbidden");
    assert.equal(writer.writes, 0);
  }
});

test("an organization deleted after context resolution cannot receive a service write", async () => {
  const writer = load({ role: "DIRECTOR", orgDeleted: true });
  const result = await writer.save(command);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "db_error");
  assert.equal(writer.writes, 0);
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
