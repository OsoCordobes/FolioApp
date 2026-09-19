"use client";

import type { AgendaSync } from "@/lib/use-agenda-refresh";

export function AgendaSyncNotice({ sync }: { sync?: AgendaSync }) {
  if (sync?.status !== "stale") return null;
  return (
    <div className="agenda-sync-notice" role="status">
      <span>La agenda puede estar desactualizada. No pudimos comprobar cambios.</span>
      <button className="fi-btn fi-btn-ghost" type="button" onClick={sync.retry}>Volver a comprobar</button>
    </div>
  );
}
