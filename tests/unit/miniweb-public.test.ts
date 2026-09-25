import assert from "node:assert/strict";
import { test } from "node:test";

import { personalPageEnabledForOrg } from "../../lib/db/miniweb-public";
import type { createSupabaseServiceClient } from "../../lib/supabase/server";

type Service = ReturnType<typeof createSupabaseServiceClient>;
const own = { organizationId: "org-1", organizationTipo: "CLINICA", memberId: "member-1" };

function service(member: object | null, consent: object | null, failConsent = false): Service {
  return {
    from(table: string) {
      const query = {
        select() { return query; },
        eq() { return query; },
        maybeSingle() {
          return Promise.resolve(table === "member"
            ? { data: member, error: null }
            : { data: consent, error: failConsent ? { message: "unavailable" } : null });
        },
      };
      return query;
    },
  } as unknown as Service;
}

test("personal page eligibility fails closed on revoke, inactive member and consent read failure", async () => {
  const member = { id: "member-1", es_colegiado: true, deleted_at: null, accepted_at: "2026-09-01", invited_by_id: null };
  assert.equal(await personalPageEnabledForOrg(service(member, { enabled: true }), own), true);
  assert.equal(await personalPageEnabledForOrg(service(member, { enabled: false }), own), false);
  assert.equal(await personalPageEnabledForOrg(service(member, null), own), false);
  assert.equal(await personalPageEnabledForOrg(service(member, { enabled: true }, true), own), false);
  assert.equal(await personalPageEnabledForOrg(service({ ...member, deleted_at: "2026-09-25" }, { enabled: true }), own), false);
  assert.equal(await personalPageEnabledForOrg(service({ ...member, es_colegiado: false }, { enabled: true }), own), false);
  assert.equal(await personalPageEnabledForOrg(service({ ...member, accepted_at: null, invited_by_id: "owner-1" }, { enabled: true }), own), false);
  assert.equal(await personalPageEnabledForOrg(service(member, { enabled: true }), { ...own, organizationTipo: "INDEPENDIENTE" }), false);
});
