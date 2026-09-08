/** Operational restriction, not evidence of clinical validation in adults.
 * Any broader population needs a separately reviewed, versioned policy.
 */
export const INSTRUMENT_POPULATION_POLICY = {
  version: "adult-only-pending-validation.v1",
  minimumAge: 18,
  clinicalValidation: "pending-professional-review",
  pediatricApproval: null,
} as const;

export const POPULATION_BLOCK_MESSAGE =
  "No se generan nuevas clasificaciones de estas escalas en menores de 18 años o sin fecha de nacimiento válida. Su validación poblacional está pendiente. Podés documentar la evaluación, la atención y el plan de seguridad en texto libre.";
export interface InstrumentPopulationContext {
  fechaNacimiento?: string | null;
  /** Server-supplied date of the encounter; never an age asserted by a caller. */
  fechaAtencion?: string | null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function cordobaDate(value: string | Date): string | null {
  if (typeof value === "string" && validDate(value)) return value;
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T/.test(value))
    return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Cordoba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function instrumentPopulationEligibility(
  context: InstrumentPopulationContext = {},
) {
  const reference = context.fechaAtencion
    ? cordobaDate(context.fechaAtencion)
    : null;
  const dob = context.fechaNacimiento;
  if (!validDate(dob) || !reference || dob > reference)
    return {
      allowed: false,
      age: null,
      reason: "unknown_or_invalid_dob" as const,
      policy: INSTRUMENT_POPULATION_POLICY.version,
    };
  const age =
    Number(reference.slice(0, 4)) -
    Number(dob.slice(0, 4)) -
    (reference.slice(5) < dob.slice(5) ? 1 : 0);
  return {
    allowed: age >= INSTRUMENT_POPULATION_POLICY.minimumAge,
    age,
    reason:
      age >= 18
        ? ("adult_provisional" as const)
        : ("pediatric_validation_pending" as const),
    policy: INSTRUMENT_POPULATION_POLICY.version,
  };
}

const SCALE_PATHS: Record<string, readonly string[][]> = {
  psicologia: [["phq9"], ["gad7"], ["crisisPlan", "cssrs"]],
  kinesiologia: [["ndi"], ["odi"], ["borg"]],
};

function atPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function sameInstrumentPayload(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
export function hasInstrumentPayload(
  specialty: string,
  value: unknown,
): boolean {
  return (SCALE_PATHS[specialty] ?? []).some(
    (path) => atPath(value, path) !== undefined,
  );
}
/** Narrative can change while EXACT historical answers remain untouched.
 * Removing an old scale is also a change; the population block never erases it.
 */
export function instrumentFieldsUnchanged(
  specialty: string,
  next: unknown,
  previous: unknown,
): boolean {
  return (SCALE_PATHS[specialty] ?? []).every((path) =>
    sameInstrumentPayload(atPath(next, path), atPath(previous, path)),
  );
}
export function omitInstrumentFields(
  specialty: string,
  value: unknown,
): unknown {
  if (!value || typeof value !== "object") return value;
  const output = JSON.parse(JSON.stringify(value));
  for (const path of SCALE_PATHS[specialty] ?? []) {
    let node = output;
    for (const key of path.slice(0, -1)) node = node?.[key];
    if (node) delete node[path[path.length - 1]];
  }
  return output;
}
export function retainInstrumentFields(
  specialty: string,
  narrative: unknown,
  previous: unknown,
): unknown {
  if (!hasInstrumentPayload(specialty, previous)) return narrative;
  const output = JSON.parse(
    JSON.stringify(narrative ?? { v: atPath(previous, ["v"]) ?? 1 }),
  );
  for (const path of SCALE_PATHS[specialty] ?? []) {
    const value = atPath(previous, path);
    if (value === undefined) continue;
    let node = output;
    for (const key of path.slice(0, -1)) node = node[key] ??= {};
    node[path[path.length - 1]] = value;
  }
  return output;
}
