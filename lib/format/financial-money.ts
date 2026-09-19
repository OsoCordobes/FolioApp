/** Monetary authorities are integer cent strings. Numbers are only chart coordinates. */
export function centsInteger(value: string): bigint {
  if (!/^-?\d+$/.test(value)) throw new Error("invalid_financial_amount");
  return BigInt(value);
}

export function centsToDecimal(value: string): string {
  const amount = centsInteger(value);
  const absolute = amount < BigInt(0) ? -amount : amount;
  return `${amount < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

export function formatCents(value: string): string {
  const amount = centsInteger(value);
  const absolute = amount < BigInt(0) ? -amount : amount;
  const [whole, fraction] = centsToDecimal(String(absolute)).split(".");
  return `$ ${amount < BigInt(0) ? "-" : ""}${BigInt(whole).toLocaleString("es-AR")},${fraction}`;
}

export function roundedRatio(cents: string, numerator: number, denominator: number): string {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error("invalid_financial_ratio");
  }
  const amount = centsInteger(cents) * BigInt(numerator);
  const divisor = BigInt(denominator);
  // Same half-up convention used by PostgreSQL round(numeric).
  const sign = amount < BigInt(0) ? BigInt(-1) : BigInt(1);
  return String(sign * ((amount * sign + divisor / BigInt(2)) / divisor));
}

/** AR locale: optional $, grouped thousands, comma and at most two decimals. */
export function parseAmountCents(input: string): string | null {
  const value = input.trim().replace(/^\$\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replaceAll(".", "").split(",");
  return String(BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0")));
}
