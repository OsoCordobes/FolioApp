"use server";

import type { fetchSlotsPublico } from "@/app/(public)/book/[slug]/actions";
import { ok } from "@/lib/db/errors";

/** Deterministic isolated calendar for the development-only booking preview. */
export async function previewSlotsAction(
  _input: Parameters<typeof fetchSlotsPublico>[0],
): ReturnType<typeof fetchSlotsPublico> {
  if (process.env.NODE_ENV === "production") throw new Error("Preview slots are development-only.");
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 3);
  start.setUTCHours(13, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return ok([{ inicio: start.toISOString(), fin: end.toISOString() }]);
}
