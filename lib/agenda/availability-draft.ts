import type { HorariosContext, HorariosSnapshot, SaveHorariosInput, SaveHorariosResult } from "@/lib/db/configuracion";
import type { Result } from "@/lib/db/errors";
/** One intent survives a lost response; only an explicit reload discards a stale draft. */
export class AvailabilityDraft {
  context: HorariosContext;
  dias: HorariosSnapshot["dias"];
  dirty = false;
  pending = false;
  conflict = false;
  contextChanged = false;
  private baseline: HorariosSnapshot["dias"];
  private latestRevision: number;
  private attempt: SaveHorariosInput | null = null;
  constructor(snapshot: HorariosSnapshot) {
    this.context = { ...snapshot.context };
    this.latestRevision = snapshot.context.revision;
    this.dias = structuredClone(snapshot.dias);
    this.baseline = structuredClone(snapshot.dias);
  }
  get uncertain() { return this.attempt !== null && !this.pending; }
  get locked() { return this.pending || this.attempt !== null || this.conflict || this.contextChanged || this.context.protectedDates; }
  edit(dias: HorariosSnapshot["dias"]) { if (!this.locked) { this.dias = structuredClone(dias); this.dirty = true; } }
  receive(snapshot: HorariosSnapshot) {
    if (snapshot.context.organizationId !== this.context.organizationId || snapshot.context.memberId !== this.context.memberId) { this.contextChanged = true; return; }
    if (snapshot.context.revision <= this.latestRevision) return;
    this.latestRevision = snapshot.context.revision;
    if (this.dirty || this.pending || this.attempt) this.conflict = true;
    else this.reload(snapshot);
  }
  begin(operation: string): SaveHorariosInput | null {
    if (this.pending || this.contextChanged || !this.dirty || (this.conflict && !this.attempt) || this.context.protectedDates) return null;
    this.attempt ??= { organizationId: this.context.organizationId, memberId: this.context.memberId, revision: this.context.revision, operacionId: operation, dias: structuredClone(this.dias) };
    this.pending = true;
    return structuredClone(this.attempt);
  }
  finish(result: Result<SaveHorariosResult>) {
    this.pending = false;
    if (!this.attempt) return;
    if (result.ok) {
      this.context.revision = Math.max(this.context.revision, result.data.revision);
      this.latestRevision = Math.max(this.latestRevision, result.data.revision);
      this.conflict = this.latestRevision > result.data.revision;
      this.baseline = structuredClone(this.attempt.dias) as HorariosSnapshot["dias"];
      this.dirty = false;
      this.attempt = null;
    } else if (result.error.code !== "db_error" && result.error.code !== "network") {
      this.attempt = null;
      if (result.error.code === "conflict") this.conflict = true;
    }
  }
  reload(snapshot: HorariosSnapshot): boolean {
    if (this.pending || this.attempt || this.contextChanged || snapshot.context.organizationId !== this.context.organizationId || snapshot.context.memberId !== this.context.memberId || snapshot.context.revision < this.latestRevision) return false;
    this.context = { ...snapshot.context }; this.latestRevision = snapshot.context.revision;
    this.dias = structuredClone(snapshot.dias); this.baseline = structuredClone(snapshot.dias); this.conflict = false; this.dirty = false;
    return true;
  }
  discard() { if (this.locked) return false; this.dias = structuredClone(this.baseline); this.dirty = false; return true; }
}
