import { decryptColumn } from "@/lib/crypto";

/** Null in the database is absence; non-null undecipherable bytes are an error. */
export function decryptClinicalExportField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new Error("invalid_clinical_ciphertext");
  const plain = decryptColumn(value);
  if (plain === null) throw new Error("unreadable_clinical_ciphertext");
  return plain;
}
