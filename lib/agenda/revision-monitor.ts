import { isAgendaRevisionToken } from "./revision-token";

export type AgendaSyncState = "checking" | "active" | "stale";
export interface AgendaRevision { organizationId: string; revision: string }

/** Poll a cheap revision; only a changed revision invalidates the full view.
 * Pausing/unmounting cancels I/O and ignores late answers from that generation. */
export function createAgendaRevisionMonitor(options: {
  organizationId: string;
  renderedRevision?: string | null;
  read: (signal: AbortSignal) => Promise<AgendaRevision>;
  refresh: () => void;
  status: (state: AgendaSyncState) => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;
  let visible = false;
  let stopped = false;
  let rendered: string | null = isAgendaRevisionToken(options.renderedRevision) ? options.renderedRevision : null;
  let observed: string | null = null;
  let unacknowledged = 0;
  let failures = 0;
  function clearTimer() { if (timer !== undefined) cancel(timer); timer = undefined; }
  async function poll() {
    if (stopped || !visible || active) return;
    clearTimer();
    const request = new AbortController();
    active = request;
    try {
      const value = await options.read(request.signal);
      if (active !== request || stopped || !visible) return;
      if (value.organizationId !== options.organizationId || !isAgendaRevisionToken(value.revision)) {
        throw new Error("agenda_revision_invalid");
      }
      observed = value.revision;
      if (rendered !== observed) {
        // router.refresh() is void: only the revision delivered with the
        // subsequent server render acknowledges that refresh. A failed RSC
        // request must be retried even when the marker has not changed again.
        options.refresh();
        unacknowledged++;
        options.status(unacknowledged > 1 ? "stale" : "checking");
      } else {
        unacknowledged = 0;
        options.status("active");
      }
      failures = 0;
    } catch {
      if (active !== request || stopped || !visible) return;
      failures = Math.min(3, failures + 1);
      options.status("stale");
    } finally {
      if (active === request) {
        active = undefined;
        if (!stopped && visible) timer = schedule(() => { timer = undefined; void poll(); }, Math.min(120_000, 25_000 * 2 ** failures));
      }
    }
  }
  return {
    acknowledge(revision: string | null) {
      if (stopped) return;
      rendered = isAgendaRevisionToken(revision) ? revision : null;
      if (failures > 0 || rendered === null || (observed !== null && rendered !== observed)) options.status("stale");
      else if (observed !== null && rendered === observed) {
        unacknowledged = 0;
        options.status("active");
      }
    },
    setVisible(value: boolean) {
      if (stopped) return;
      visible = value;
      if (value) { void poll(); }
      else {
        clearTimer();
        const old = active; active = undefined; old?.abort();
      }
    },
    check() { void poll(); },
    stop() {
      stopped = true;
      clearTimer();
      const old = active; active = undefined; old?.abort();
    },
  };
}
