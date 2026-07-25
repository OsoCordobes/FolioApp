import assert from "node:assert/strict";
import test from "node:test";

import { bookingSlugDeOrg } from "../../lib/portal/portal-booking";

/**
 * Folio · bookingSlugDeOrg (F2 · identidad del portal).
 *
 * Decide si una org linkeada al paciente puede ofrecer "Reservar turno" →
 * /book/{slug} desde el portal. Espeja los filtros del booking público:
 * org viva y listada. Nunca linkear a un 404.
 */

test("org viva y listada → slug reservable", () => {
  assert.equal(
    bookingSlugDeOrg({ slug: "dra-perez", optOutPublicListing: false, deletedAt: null }),
    "dra-perez",
  );
});

test("org deslistada (opt-out) → null (el booking público la rechaza)", () => {
  assert.equal(
    bookingSlugDeOrg({ slug: "dra-perez", optOutPublicListing: true, deletedAt: null }),
    null,
  );
});

test("org borrada → null", () => {
  assert.equal(
    bookingSlugDeOrg({
      slug: "dra-perez",
      optOutPublicListing: false,
      deletedAt: "2026-07-01T00:00:00.000Z",
    }),
    null,
  );
});

test("sin slug → null", () => {
  assert.equal(
    bookingSlugDeOrg({ slug: null, optOutPublicListing: false, deletedAt: null }),
    null,
  );
});
