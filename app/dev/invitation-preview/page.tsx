import Link from "next/link";
import { notFound } from "next/navigation";

import { InvitationPreviewSurface } from "./preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitación · Vista previa local", robots: { index: false, follow: false } };

const states = ["auth", "pending", "expired", "revoked", "accepted", "mismatch", "missing"] as const;

export default async function InvitationPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.FOLIO_TEST_ISOLATED !== "1") notFound();
  const requested = (await searchParams).state;
  const state = states.find((value) => value === requested) ?? "auth";
  return <>
    <nav aria-label="Estados de muestra de invitación" style={{ padding: "16px 24px", display: "flex", gap: 16, flexWrap: "wrap", background: "var(--accent-soft)", fontSize: 13 }}>
      <span>Vista local. Cuenta y clínica ficticias; los envíos están bloqueados.</span>
      {states.map((value) => <Link key={value} href={`/dev/invitation-preview?state=${value}`} aria-current={value === state ? "page" : undefined}>{value}</Link>)}
    </nav>
    <main style={{ minHeight: "calc(100svh - 120px)", display: "grid", placeItems: "center", padding: "32px 24px", background: "var(--bg)" }}>
      <InvitationPreviewSurface state={state} />
    </main>
  </>;
}
