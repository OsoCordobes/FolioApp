/**
 * Folio · findUserByEmail — paginated lookup en auth.users.
 *
 * Audit 2026-05-23 finding A3: el `listUsers({ page: 1, perPage: 200 })` que
 * Supabase admin SDK trae por default rompe el lookup a partir del usuario
 * 201. Este helper itera páginas de 1000 hasta encontrar el match o agotar el
 * universo de users.
 *
 * Cap defensivo: 50 páginas (50k usuarios) para evitar loops si la API trae
 * páginas truncadas mal. Si el cap se alcanza, el helper retorna null y
 * captura un mensaje a Sentry (no es una fail-loud porque el caller a veces
 * usa null como "no existe").
 *
 * Comportamiento idéntico al inline `findUserByEmailPaginated` que vivía en
 * `app/(public)/onboarding/actions.ts` antes de Sprint 0 (Phase 7 M33 fix),
 * extraído aquí para reuso desde `/api/admin/confirm-user` (Task 0.4 / C3+A3).
 */

import { captureException, captureMessage } from "@sentry/nextjs";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type ListUsersUser = Awaited<
  ReturnType<ServiceClient["auth"]["admin"]["listUsers"]>
> extends { data: { users: infer U } | null }
  ? U extends Array<infer T>
    ? T
    : never
  : never;

const PER_PAGE = 1000;
const MAX_PAGES = 50;

export async function findUserByEmail(
  service: ServiceClient,
  email: string,
): Promise<ListUsersUser | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) {
      captureException(error, {
        tags: { helper: "findUserByEmail" },
        extra: { page, perPage: PER_PAGE },
      });
      return null;
    }
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found;
    if (users.length < PER_PAGE) return null; // última página
  }
  captureMessage(
    `findUserByEmail: hit ${MAX_PAGES}-page cap (${MAX_PAGES * PER_PAGE} users) without finding match`,
    {
      level: "warning",
      tags: { helper: "findUserByEmail" },
    },
  );
  return null;
}
