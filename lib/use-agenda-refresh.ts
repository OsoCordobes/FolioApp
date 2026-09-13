"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createAgendaRevisionMonitor, type AgendaSyncState } from "@/lib/agenda/revision-monitor";
import { useRealtimeTable } from "@/lib/db/realtime";

const REALTIME_ENABLED = process.env.NEXT_PUBLIC_AGENDA_REALTIME === "1";
export interface AgendaSync { status: AgendaSyncState; retry: () => void }

/** Check a small, scoped marker. Fetch the complete view only after a change.
 * Hidden tabs cancel requests; reconnecting checks immediately. Realtime is an
 * optional nudge, never the only way to notice changes. */
export function useAgendaAutoRefresh(organizationId: string | null, agendaRevision: string | null = null): AgendaSync {
  const router = useRouter();
  const [status, setStatus] = useState<AgendaSyncState>("checking");
  const [visible, setVisible] = useState(false);
  const monitorRef = useRef<ReturnType<typeof createAgendaRevisionMonitor> | null>(null);
  const renderedRevision = useRef(agendaRevision);
  renderedRevision.current = agendaRevision;
  const retry = useCallback(() => monitorRef.current?.check(), []);

  useEffect(() => {
    if (!organizationId) return;
    setStatus("checking");
    const monitor = createAgendaRevisionMonitor({
      organizationId,
      renderedRevision: renderedRevision.current,
      status: setStatus,
      refresh: () => router.refresh(),
      async read(signal) {
        const response = await fetch("/api/agenda/revision", {
          credentials: "same-origin", cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        });
        if (signal.aborted) throw new Error("agenda_revision_cancelled");
        if (!response.ok) {
          // Re-evaluate session/MFA without presenting a failed permission
          // check as an unchanged agenda.
          if (response.status === 401 || response.status === 403) router.refresh();
          throw new Error("agenda_revision_unavailable");
        }
        return await response.json();
      },
    });
    monitorRef.current = monitor;
    const onVisibility = () => {
      const next = document.visibilityState === "visible";
      setVisible(next);
      monitor.setVisible(next);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", retry);
    onVisibility();
    return () => {
      monitor.stop();
      if (monitorRef.current === monitor) monitorRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", retry);
    };
  }, [organizationId, router, retry]);

  useEffect(() => { monitorRef.current?.acknowledge(agendaRevision); }, [agendaRevision]);

  useRealtimeTable("turno", REALTIME_ENABLED && visible ? organizationId : null, retry);
  return { status, retry };
}
