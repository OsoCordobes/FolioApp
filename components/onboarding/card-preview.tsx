"use client";

/**
 * @deprecated Use <PublicCard> from "@/components/public-card/public-card".
 *
 * This file is a transitional compat shim that re-exports PublicCard
 * under the legacy CardPreview name + the legacy type names. All current
 * call-sites (step-shell, step9-moment, steps.tsx) continue to compile
 * without changes. F8 (verification + ship) deletes this shim and
 * rewrites the imports to point at the new component directly.
 *
 * Why a shim instead of a rename PR: the spec ships F4 first (component
 * lands), then F5..F7 (mood + onboarding + book integration). Renaming
 * 10+ call-sites in F4 would conflate two changes and make F5..F7
 * harder to review. Keeping the shim makes each phase observable on
 * its own.
 */

export { PublicCard as CardPreview } from "@/components/public-card/public-card";
export type {
  PublicCardData as CardPreviewData,
  PublicCardService as CardPreviewService,
  PublicCardVariant as CardPreviewVariant,
} from "@/components/public-card/public-card";
