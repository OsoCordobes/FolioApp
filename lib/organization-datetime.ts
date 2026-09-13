/** Appointment pickers use the organization's wall clock, independently of the browser. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/;

function formatter(timeZone: string): Intl.DateTimeFormat {
  if (!timeZone) throw new RangeError("Falta la zona horaria del consultorio.");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, calendar: "iso8601", numberingSystem: "latn", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function parseDatetime(value: string) {
  const match = DATETIME.exec(value);
  if (!match) throw new RangeError("Fecha y hora inválidas.");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(part => Number(part ?? 0));
  const milliseconds = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    throw new RangeError("Fecha y hora inválidas.");
  }
  const offset = match[8];
  let offsetMinutes = 0;
  if (offset && offset !== "Z") {
    const hours = Number(offset.slice(1, 3)), minutes = Number(offset.slice(4, 6));
    if (hours > 23 || minutes > 59) throw new RangeError("Offset horario inválido.");
    offsetMinutes = (offset[0] === "+" ? 1 : -1) * (hours * 60 + minutes);
  }
  return { wall: value.slice(0, 16), epoch: date.getTime(), offset, offsetMinutes };
}

function formattedParts(format: Intl.DateTimeFormat, epoch: number) {
  if (!Number.isFinite(epoch)) throw new RangeError("Instante inválido.");
  const parts = format.formatToParts(epoch);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  const wall = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  return { wall, second: Number(part("second")), minute: Number(part("minute")) };
}

/** An offset/Z identifies an instant. A calendar wall clock is preserved, without rounding. */
export function organizationDatetimeExact(isoOrWallClock: string, timeZone: string): string {
  const format = formatter(timeZone), parsed = parseDatetime(isoOrWallClock);
  return parsed.offset
    ? formattedParts(format, parsed.epoch - parsed.offsetMinutes * MINUTE).wall
    : parsed.wall;
}

/** Existing picker policy: add five minutes, then round to the nearest five-minute slot. */
export function organizationDatetimeDefault(timeZone: string, now: Date = new Date()): string {
  const format = formatter(timeZone), advanced = now.getTime() + 5 * MINUTE;
  const parts = formattedParts(format, advanced);
  const subsecond = ((advanced % 1000) + 1000) % 1000;
  const rounded = advanced - parts.second * 1000 - subsecond +
    (Math.round(parts.minute / 5) * 5 - parts.minute) * MINUTE;
  return formattedParts(format, rounded).wall;
}

/**
 * Resolve an explicitly zoned wall clock to its unique instant. Reject both DST
 * gaps and repeated hours: choosing either occurrence silently could move a visit.
 */
export function organizationDatetimeToIso(wall: string, timeZone: string): string {
  const format = formatter(timeZone), parsed = parseDatetime(wall);
  if (parsed.offset || wall.length !== 16) throw new RangeError("Se requiere fecha y hora del consultorio, sin offset.");
  const offsets = new Set<number>();
  // A bounded set of probes on both sides captures the adjacent offsets, including
  // half-hour DST changes and a skipped calendar day. No host-local Date parsing.
  for (const hours of [-48, -24, -12, 0, 12, 24, 48]) {
    const probe = parsed.epoch + hours * HOUR;
    const parts = formattedParts(format, probe);
    const represented = parseDatetime(parts.wall).epoch + parts.second * 1000;
    offsets.add(represented - probe);
  }
  const matches = [...offsets].map(offset => parsed.epoch - offset)
    .filter(epoch => {
      const parts = formattedParts(format, epoch);
      return parts.wall === wall && parts.second === 0;
    });
  if (matches.length === 0) throw new RangeError("Ese horario no existe en la zona del consultorio. Elegí otro horario.");
  if (matches.length !== 1) throw new RangeError("Ese horario ocurre dos veces en la zona del consultorio. Elegí otro horario.");
  return new Date(matches[0]).toISOString();
}

/** Toast dates use the same organization calendar as the picker and agenda. */
export function organizationDatetimeToastLabel(wall: string, timeZone: string, now: Date = new Date()): string {
  const format = formatter(timeZone), parsed = parseDatetime(wall);
  if (parsed.offset || wall.length !== 16) throw new RangeError("Se requiere fecha y hora del consultorio, sin offset.");
  const today = formattedParts(format, now.getTime()).wall.slice(0, 10);
  return wall.slice(0, 10) === today ? wall.slice(11) : `${wall.slice(8, 10)}/${wall.slice(5, 7)} ${wall.slice(11)}`;
}
