-- M144 is already applied. Preserve its revision guard while allowing the
-- M84/M91 portal guard to inspect the caller's unchanged row first.
-- PostgreSQL runs same-kind BEFORE triggers alphabetically by trigger name.
-- The intake guard still rejects caller-supplied revisions and increments the
-- revision when a permitted cancellation leaves the intake-eligible states.
ALTER TRIGGER turno_intake_revision_guard ON public.turno
  RENAME TO turno_zz_intake_revision_guard;
