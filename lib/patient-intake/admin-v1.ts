import { createHash, createHmac, randomBytes } from "node:crypto";
import { decryptColumn, encryptColumn } from "@/lib/crypto";
import {
  COBERTURA_NOMBRE_MAX, COBERTURA_PLAN_MAX, COBERTURA_NRO_AFILIADO_MAX,
} from "@/lib/pacientes/cobertura";

export const ADMIN_VERSION = "admin.v1";
export const MAX_ADMIN_BYTES = 16 * 1024;

type AdminAnswers = {
  nombre?: string;
  apellido?: string;
  tipoDocumento?: "DNI" | "LE" | "LC" | "CI" | "PASAPORTE";
  numeroDocumento?: string;
  fechaNacimiento?: string;
  email?: string;
  telefono?: string;
  cobertura?: {
    nombre?: string;
    plan?: string;
    numeroAfiliado?: string;
  };
};

const topKeys = new Set([
  "nombre", "apellido", "tipoDocumento", "numeroDocumento", "fechaNacimiento",
  "email", "telefono", "cobertura",
]);
const coverageKeys = new Set(["nombre", "plan", "numeroAfiliado"]);
const documentTypes = new Set(["DNI", "LE", "LC", "CI", "PASAPORTE"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: objeto requerido`);
  }
  return value as Record<string, unknown>;
}

function assertKeys(value: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Campo administrativo no admitido: ${key}`);
  }
}

function field(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name}: texto requerido`);
  const normalized = value.normalize("NFC").trim();
  if (normalized.length < 1 || normalized.length > max || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${name}: longitud o caracteres inválidos`);
  }
  return normalized;
}

function validDate(value: unknown, today: string): string | undefined {
  const date = field(value, "fechaNacimiento", 10);
  if (date === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("fechaNacimiento: formato YYYY-MM-DD requerido");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > today || date < "1900-01-01") {
    throw new Error("fechaNacimiento: fecha inválida");
  }
  return date;
}

/** Omission means unanswered. `null`, empty strings and unknown keys are rejected. */
export function canonicalAdminV1(input: unknown, today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date())): string {
  const data = record(input, "aporte");
  assertKeys(data, topKeys);
  const output: AdminAnswers = {};
  const nombre = field(data.nombre, "nombre", 100);
  const apellido = field(data.apellido, "apellido", 100);
  if (nombre !== undefined) output.nombre = nombre;
  if (apellido !== undefined) output.apellido = apellido;
  if (data.tipoDocumento !== undefined) {
    if (typeof data.tipoDocumento !== "string" || !documentTypes.has(data.tipoDocumento)) {
      throw new Error("tipoDocumento: valor inválido");
    }
    output.tipoDocumento = data.tipoDocumento as AdminAnswers["tipoDocumento"];
  }
  const numeroDocumento = field(data.numeroDocumento, "numeroDocumento", 32);
  if (numeroDocumento !== undefined) output.numeroDocumento = numeroDocumento;
  const fechaNacimiento = validDate(data.fechaNacimiento, today);
  if (fechaNacimiento !== undefined) output.fechaNacimiento = fechaNacimiento;
  const email = field(data.email, "email", 254);
  if (email !== undefined) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error("email: formato inválido");
    output.email = email;
  }
  const telefono = field(data.telefono, "telefono", 30);
  if (telefono !== undefined) {
    if (telefono.length < 6 || !/^[+0-9() .-]{6,30}$/u.test(telefono) || !/[0-9]/u.test(telefono)) {
      throw new Error("telefono: formato inválido");
    }
    output.telefono = telefono;
  }
  if (data.cobertura !== undefined) {
    const raw = record(data.cobertura, "cobertura");
    assertKeys(raw, coverageKeys);
    const coverage: NonNullable<AdminAnswers["cobertura"]> = {};
    const company = field(raw.nombre, "cobertura.nombre", COBERTURA_NOMBRE_MAX);
    const plan = field(raw.plan, "cobertura.plan", COBERTURA_PLAN_MAX);
    const affiliate = field(raw.numeroAfiliado, "cobertura.numeroAfiliado", COBERTURA_NRO_AFILIADO_MAX);
    if (company !== undefined) coverage.nombre = company;
    if (plan !== undefined) coverage.plan = plan;
    if (affiliate !== undefined) coverage.numeroAfiliado = affiliate;
    if (Object.keys(coverage).length === 0) throw new Error("cobertura: al menos un dato requerido");
    output.cobertura = coverage;
  }
  if (Object.keys(output).length === 0) throw new Error("aporte: al menos un dato requerido");
  const canonical = JSON.stringify(output);
  if (Buffer.byteLength(canonical, "utf8") > MAX_ADMIN_BYTES) throw new Error("aporte: supera 16 KiB");
  return canonical;
}

/** The same stable secret survives FOLIO_ENC_HMAC_KEY_NEXT rotation. */
export function newInvitationFingerprintKeyCipher(): string {
  return encryptColumn(randomBytes(32).toString("base64"))!;
}

export function tokenHash(rawHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(rawHex)) throw new Error("Credencial inválida");
  return createHash("sha256").update(Buffer.from(rawHex, "hex")).digest("hex");
}

export function contributionFingerprint(
  keyCipher: string | Buffer | Uint8Array, invitationId: string, operationId: string,
  canonical: string,
): string {
  if (!uuid.test(invitationId) || !uuid.test(operationId)) throw new Error("Identificadores inválidos");
  if (Buffer.byteLength(canonical, "utf8") > MAX_ADMIN_BYTES) throw new Error("aporte: supera 16 KiB");
  const encoded = decryptColumn(keyCipher);
  if (!encoded) throw new Error("Clave de invitación ausente");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("Clave de invitación inválida");
  return createHmac("sha256", key)
    .update("folio.patient-intake.admin.v1\0", "utf8")
    .update(invitationId.toLowerCase(), "utf8").update("\0", "utf8")
    .update(operationId.toLowerCase(), "utf8").update("\0", "utf8")
    .update(ADMIN_VERSION, "utf8").update("\0", "utf8")
    .update(canonical, "utf8").digest("hex");
}

export function prepareAdminContribution(
  input: unknown, keyCipher: string | Buffer | Uint8Array,
  invitationId: string, operationId: string,
): { questionnaireVersion: typeof ADMIN_VERSION; fingerprint: string; answersCipher: string } {
  const canonical = canonicalAdminV1(input);
  return {
    questionnaireVersion: ADMIN_VERSION,
    fingerprint: contributionFingerprint(keyCipher, invitationId, operationId, canonical),
    answersCipher: encryptColumn(canonical)!,
  };
}
