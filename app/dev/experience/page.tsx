import { notFound } from "next/navigation";

import { ExperiencePreview } from "./preview";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Folio · Vista previa de experiencia",
  robots: { index: false, follow: false },
};

/** Development-only component gallery. It never resolves a real session. */
export default function ExperiencePreviewPage() {
  if (process.env.NODE_ENV === "production" || process.env.FOLIO_TEST_ISOLATED !== "1") {
    notFound();
  }
  return <ExperiencePreview />;
}
