import assert from "node:assert/strict";
import test from "node:test";

import { findUserByEmail } from "../../lib/auth/find-user-by-email";

// Mock liviano del service client. Solo expone `auth.admin.listUsers` con la
// shape que consume el helper. La fixture de cada test define el comportamiento
// de las páginas.
interface MockUser {
  id: string;
  email: string;
}

interface PageFixture {
  users: MockUser[];
  error?: { message: string };
}

function makeMockService(pages: PageFixture[]): {
  service: Parameters<typeof findUserByEmail>[0];
  calls: Array<{ page: number; perPage: number }>;
} {
  const calls: Array<{ page: number; perPage: number }> = [];
  const service = {
    auth: {
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
          calls.push({ page, perPage });
          const fixture = pages[page - 1];
          if (!fixture) {
            // Páginas más allá del array → vacías (simula fin de userset).
            return { data: { users: [] }, error: null };
          }
          if (fixture.error) {
            return { data: null, error: fixture.error };
          }
          return { data: { users: fixture.users }, error: null };
        },
      },
    },
  } as unknown as Parameters<typeof findUserByEmail>[0];
  return { service, calls };
}

test("findUserByEmail: encuentra user en la primera página", async () => {
  const { service, calls } = makeMockService([
    { users: [{ id: "u1", email: "lautaro@folio.app" }] },
  ]);
  const result = await findUserByEmail(service, "lautaro@folio.app");
  assert.equal(result?.id, "u1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].page, 1);
});

test("findUserByEmail: encuentra user case-insensitive", async () => {
  const { service } = makeMockService([
    { users: [{ id: "u1", email: "Lautaro@Folio.App" }] },
  ]);
  const result = await findUserByEmail(service, "LAUTARO@folio.APP");
  assert.equal(result?.id, "u1");
});

test("findUserByEmail: pagina hasta encontrar (página 3)", async () => {
  const fullPage = (offset: number): PageFixture => ({
    users: Array.from({ length: 1000 }, (_, i) => ({
      id: `u${offset + i}`,
      email: `user${offset + i}@folio.app`,
    })),
  });
  const target: PageFixture = {
    users: [
      ...Array.from({ length: 999 }, (_, i) => ({
        id: `u_p3_${i}`,
        email: `bulk${i}@folio.app`,
      })),
      { id: "target", email: "target@folio.app" },
    ],
  };
  const { service, calls } = makeMockService([fullPage(0), fullPage(1000), target]);
  const result = await findUserByEmail(service, "target@folio.app");
  assert.equal(result?.id, "target");
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((c) => c.page),
    [1, 2, 3],
  );
});

test("findUserByEmail: retorna null si no encuentra y la última página fue truncada", async () => {
  const { service, calls } = makeMockService([
    {
      users: [
        { id: "u1", email: "alguien@folio.app" },
        { id: "u2", email: "otro@folio.app" },
      ],
    },
  ]);
  const result = await findUserByEmail(service, "nope@folio.app");
  assert.equal(result, null);
  assert.equal(calls.length, 1); // se cortó porque users.length < perPage
});

test("findUserByEmail: retorna null cuando listUsers reporta error en alguna página", async () => {
  const { service } = makeMockService([
    {
      users: Array.from({ length: 1000 }, (_, i) => ({
        id: `u${i}`,
        email: `user${i}@folio.app`,
      })),
    },
    { users: [], error: { message: "rate limited" } },
  ]);
  const result = await findUserByEmail(service, "target@folio.app");
  assert.equal(result, null);
});

test("findUserByEmail: ignora users sin email", async () => {
  const { service } = makeMockService([
    {
      users: [
        { id: "u-nullemail", email: "" },
        { id: "u-target", email: "match@folio.app" },
      ],
    },
  ]);
  const result = await findUserByEmail(service, "match@folio.app");
  assert.equal(result?.id, "u-target");
});

test("findUserByEmail: corta en perPage strict (página llena no truncada NO termina prematuramente)", async () => {
  // Página 1 llena (1000), página 2 truncada (500). Debe paginar a página 2.
  const fullPage: PageFixture = {
    users: Array.from({ length: 1000 }, (_, i) => ({
      id: `u${i}`,
      email: `bulk${i}@folio.app`,
    })),
  };
  const lastPage: PageFixture = {
    users: Array.from({ length: 500 }, (_, i) => ({
      id: `last${i}`,
      email: `last${i}@folio.app`,
    })),
  };
  const { service, calls } = makeMockService([fullPage, lastPage]);
  const result = await findUserByEmail(service, "last250@folio.app");
  assert.equal(result?.id, "last250");
  assert.equal(calls.length, 2);
});
