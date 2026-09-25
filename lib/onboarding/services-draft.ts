import type { OnboardingServicesCommand, OnboardingServicesSnapshot } from "@/app/(public)/onboarding/actions";
import { TIPOS_CANONICOS_VALIDOS } from "@/lib/onboarding/templates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session storage contains only the exact command that may be verified again. */
export function parseStoredServicesCommand(raw: string | null, organizationId: string, ownerUserId: string): OnboardingServicesCommand | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const envelope = value as Record<string, unknown>;
    if (!UUID.test(ownerUserId) || envelope.ownerUserId !== ownerUserId) return null;
    const command = envelope.command as Record<string, unknown> | null;
    if (!command || typeof command !== "object") return null;
    if (command.organizationId !== organizationId || !UUID.test(organizationId)
      || typeof command.operacionId !== "string" || !UUID.test(command.operacionId)
      || typeof command.revision !== "number" || !Number.isSafeInteger(command.revision) || command.revision < 0
      || !Array.isArray(command.servicios) || command.servicios.length > 30) return null;
    const ids = new Set<string>();
    for (const row of command.servicios) {
      if (!row || typeof row !== "object") return null;
      const service = row as Record<string, unknown>;
      if (typeof service.id !== "string" || !UUID.test(service.id) || ids.has(service.id)
        || typeof service.nombre !== "string" || !service.nombre.trim() || service.nombre.length > 120
        || typeof service.dur !== "number" || !Number.isInteger(service.dur) || service.dur < 5 || service.dur > 480
        || typeof service.precioCents !== "number" || !Number.isInteger(service.precioCents)
        || service.precioCents < 0 || service.precioCents > 2147483647
        || typeof service.tipoCanonico !== "string"
        || !TIPOS_CANONICOS_VALIDOS.includes(service.tipoCanonico as typeof TIPOS_CANONICOS_VALIDOS[number])) return null;
      ids.add(service.id);
    }
    return structuredClone(command) as OnboardingServicesCommand;
  } catch { return null; }
}

export function storeServicesCommand(command: OnboardingServicesCommand, ownerUserId: string): string {
  return JSON.stringify({ ownerUserId, command });
}

/** The work starts after the flight is visible, including synchronous fixture responses. */
export function beginServicesFlight<T>(ref: { current: Promise<T> | null }, work: () => Promise<T> | T): Promise<T> {
  if (ref.current) return ref.current;
  const flight = Promise.resolve().then(work);
  ref.current = flight;
  const clear = () => { if (ref.current === flight) ref.current = null; };
  void flight.then(clear, clear);
  return flight;
}

/** A full catalog and one immutable write intent for Step 6. */
export class OnboardingServicesDraft {
  readonly organizationId: string;
  rows: OnboardingServicesSnapshot["servicios"];
  revision: number;
  dirty = false;
  writing = false;
  conflict = false;
  private attempted: OnboardingServicesCommand | null = null;

  constructor(organizationId: string, snapshot: OnboardingServicesSnapshot, pending?: OnboardingServicesCommand) {
    this.organizationId = organizationId;
    this.revision = snapshot.revision;
    this.rows = structuredClone(snapshot.servicios);
    if (pending && pending.organizationId === organizationId) {
      this.attempted = structuredClone(pending);
      this.rows = structuredClone(pending.servicios);
      this.dirty = true;
    }
  }

  get uncertain() { return this.attempted !== null && !this.writing; }
  get locked() { return this.writing || this.uncertain || this.conflict; }
  get attemptedCommand() { return this.attempted ? structuredClone(this.attempted) : null; }

  edit(rows: OnboardingServicesSnapshot["servicios"]): boolean {
    if (this.locked) return false;
    this.rows = structuredClone(rows);
    this.dirty = true;
    return true;
  }

  begin(operationId: string, { retry = false, force = false } = {}): OnboardingServicesCommand | null {
    if (this.writing || this.conflict) return null;
    if (this.attempted) {
      if (!retry) return null;
    } else {
      if (!this.dirty && !force) return null;
      this.attempted = {
        organizationId: this.organizationId,
        revision: this.revision,
        operacionId: operationId,
        servicios: structuredClone(this.rows),
      };
    }
    this.writing = true;
    return structuredClone(this.attempted);
  }

  finish(result: { ok: true; data: OnboardingServicesSnapshot } | { ok: false; uncertain: boolean; conflict: boolean }): void {
    this.writing = false;
    if (!this.attempted) return;
    if (result.ok) {
      const newerObserved = this.revision > result.data.revision;
      this.revision = Math.max(this.revision, result.data.revision);
      this.rows = structuredClone(result.data.servicios);
      this.dirty = false;
      this.conflict = newerObserved;
      this.attempted = null;
    } else if (!result.uncertain) {
      this.attempted = null;
      this.conflict = result.conflict;
    }
  }

  reload(snapshot: OnboardingServicesSnapshot): boolean {
    if (this.writing || this.attempted || snapshot.revision < this.revision) return false;
    this.revision = snapshot.revision;
    this.rows = structuredClone(snapshot.servicios);
    this.dirty = false;
    this.conflict = false;
    return true;
  }
}
