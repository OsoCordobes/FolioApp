import { sha256 } from "@noble/hashes/sha256";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const CHUNK = 3 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_ARCHIVE_BYTES = 10000 * 50 * 1024 * 1024 + 32 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const PAGE_SIZE = 50;

export type PackageArchiveEntry = {
  entry_id: string; kind: "json" | "document" | "signature" | "withdrawn_document";
  source_id: string; source_index: number; expected_fragments: number;
  total_bytes: number; source_hash_kind: "recorded" | "not_recorded" | "not_applicable";
  source_sha256: string | null; computed_sha256: string | null;
  registered_at: string;
};
export type PackageArchivePage = {
  format: "folio.export-package.v1"; captureMeaning: "preparation_time_not_global_snapshot";
  expectedEntries: number; expiresAt: string; preparedAt: string;
  entries: PackageArchiveEntry[];
};
export type PackageArchiveFragment = {
  bytes: Uint8Array; sha256: string; fileSha256: string; totalFragments: number;
};
export type PackageArchiveTransport = {
  page(offset: number, limit: number): Promise<PackageArchivePage>;
  fragment(entry: PackageArchiveEntry, ordinal: number): Promise<PackageArchiveFragment>;
};
export type PackageArchiveSink = {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};
export type PackageArchiveProgress = { completedEntries: number; totalEntries: number };

export class PackageArchiveFailure extends Error {
  constructor(public readonly code: "invalid_inventory" | "fragment_mismatch" | "source_changed" |
    "archive_limit" | "write_failed" | "unconfirmed", public readonly abortConfirmed = false) {
    super(code);
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const digest = (bytes: Uint8Array) => hex(sha256(bytes));
const validTime = (value: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
const fail = (code: PackageArchiveFailure["code"]): never => { throw new PackageArchiveFailure(code); };
const byteText = (text: string) => new TextEncoder().encode(text);

function validateEntry(entry: PackageArchiveEntry) {
  if (!UUID.test(entry.entry_id) || !UUID.test(entry.source_id) ||
      !Number.isSafeInteger(entry.source_index) || entry.source_index < 0 || entry.source_index > 1 ||
      !Number.isSafeInteger(entry.expected_fragments) || entry.expected_fragments < 0 ||
      !Number.isSafeInteger(entry.total_bytes) || entry.total_bytes < 0 ||
      !["json", "document", "signature", "withdrawn_document"].includes(entry.kind) ||
      !["recorded", "not_recorded", "not_applicable"].includes(entry.source_hash_kind) ||
      !Number.isFinite(Date.parse(entry.registered_at))) fail("invalid_inventory");
  if (entry.kind === "withdrawn_document") {
    if (entry.expected_fragments !== 0 || entry.total_bytes !== 0 || entry.computed_sha256 !== null) {
      fail("invalid_inventory");
    }
    return;
  }
  const max = entry.kind === "json" ? MAX_JSON_BYTES :
    entry.kind === "signature" ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
  if (entry.total_bytes < 1 || entry.total_bytes > max ||
      entry.expected_fragments !== Math.ceil(entry.total_bytes / CHUNK) ||
      !SHA.test(entry.computed_sha256 ?? "") ||
      (entry.source_hash_kind === "recorded" &&
        entry.source_sha256 !== entry.computed_sha256) ||
      (entry.kind === "json" && (entry.source_index !== 0 ||
        entry.source_hash_kind !== "not_applicable" || entry.source_sha256 !== null))) {
    fail("invalid_inventory");
  }
}

async function readInventory(transport: PackageArchiveTransport) {
  let total = 0, expiresAt = "", preparedAt = "";
  const entries: PackageArchiveEntry[] = [];
  const seen = new Set<string>();
  const seenSources = new Set<string>();
  do {
    const page = await transport.page(entries.length, PAGE_SIZE);
    if (page.format !== "folio.export-package.v1" ||
        page.captureMeaning !== "preparation_time_not_global_snapshot" ||
        !Number.isSafeInteger(page.expectedEntries) || page.expectedEntries < 1 ||
        page.expectedEntries > MAX_ENTRIES || !validTime(page.expiresAt) ||
        !Number.isFinite(Date.parse(page.preparedAt)) || !Array.isArray(page.entries)) {
      fail("invalid_inventory");
    }
    if (entries.length === 0) {
      total = page.expectedEntries; expiresAt = page.expiresAt; preparedAt = page.preparedAt;
    }
    const expected = Math.min(PAGE_SIZE, total - entries.length);
    if (page.expectedEntries !== total || page.expiresAt !== expiresAt ||
        page.preparedAt !== preparedAt || page.entries.length !== expected) fail("invalid_inventory");
    for (const entry of page.entries) {
      validateEntry(entry);
      const source = `${entry.kind}:${entry.source_id}:${entry.source_index}`;
      if (seen.has(entry.entry_id) || seenSources.has(source)) fail("invalid_inventory");
      seen.add(entry.entry_id); seenSources.add(source); entries.push(entry);
    }
  } while (entries.length < total);
  if (entries.filter(entry => entry.kind === "json").length !== 1) fail("invalid_inventory");
  const sum = entries.reduce((size, entry) => size + entry.total_bytes, 0);
  // TAR has no global 32-bit offset. Each file is below the ustar size-field limit.
  if (!Number.isSafeInteger(sum) || sum > MAX_ARCHIVE_BYTES - 32 * 1024 * 1024) fail("archive_limit");
  return { entries, expiresAt, preparedAt };
}

function documentExtensions(jsonBytes: Uint8Array) {
  const extensions = new Map<string, string>();
  const known: Record<string, string> = {
    "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
    "image/webp": "webp", "image/heic": "heic", "image/tiff": "tiff",
    "application/dicom": "dcm",
  };
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes));
    const documents = parsed?.historia_clinica?.documentos;
    if (!Array.isArray(documents)) return extensions;
    for (const row of documents) {
      if (row && UUID.test(row.id) && row.bytes_incluidos === false &&
          typeof row.mime_type === "string" && known[row.mime_type]) {
        extensions.set(row.id, known[row.mime_type]);
      }
    }
  } catch { fail("invalid_inventory"); }
  return extensions;
}

function archiveName(entry: PackageArchiveEntry, extensions: Map<string, string>) {
  if (entry.kind === "json") return "historia.json";
  if (entry.kind === "document") return `documentos/${entry.source_id}.${extensions.get(entry.source_id) ?? "bin"}`;
  if (entry.kind === "signature") return `firmas/${entry.source_id}-${entry.source_index}.bin`;
  return null;
}

async function verifiedFragment(transport: PackageArchiveTransport,
  entry: PackageArchiveEntry, ordinal: number) {
  const fragment = await transport.fragment(entry, ordinal);
  const last = ordinal === entry.expected_fragments - 1;
  const expected = last ? entry.total_bytes - ordinal * CHUNK : CHUNK;
  if (!(fragment.bytes instanceof Uint8Array) || fragment.bytes.byteLength !== expected ||
      fragment.bytes.byteLength > CHUNK || !SHA.test(fragment.sha256) ||
      fragment.sha256 !== digest(fragment.bytes) ||
      fragment.fileSha256 !== entry.computed_sha256 ||
      fragment.totalFragments !== entry.expected_fragments) fail("fragment_mismatch");
  return fragment.bytes;
}

const README = byteText(
  "Folio · Entrega clínica verificada\n\n" +
  "Este paquete TAR reúne la historia clínica y los archivos disponibles de esta entrega.\n" +
  "Puede requerir una herramienta de archivos compatible con TAR para abrirlo.\n" +
  "historia.json contiene los datos clínicos preparados en la fecha indicada por el manifiesto.\n" +
  "Esa fecha no representa una instantánea transaccional global ni el estado clínico actual.\n" +
  "documentos/ y firmas/ contienen bytes reconstruidos y comprobados con SHA-256.\n" +
  "manifiesto.jsonl identifica cada archivo, tamaño y hash calculado durante la entrega.\n" +
  "Los documentos retirados figuran en el inventario sin bytes: su acceso no se reactiva.\n" +
  "Un hash calculado durante la entrega no reemplaza un hash histórico ausente.\n",
);

function tarHeader(name: string, size: number) {
  if (!/^[a-zA-Z0-9._/-]+$/.test(name) || byteText(name).byteLength > 100 ||
      !Number.isSafeInteger(size) || size < 0 || size >= 8 ** 11) fail("archive_limit");
  const header = new Uint8Array(512);
  const put = (offset: number, text: string) => header.set(byteText(text), offset);
  const octal = (offset: number, width: number, number: number) => {
    const value = number.toString(8).padStart(width - 1, "0");
    if (value.length !== width - 1) fail("archive_limit");
    put(offset, value); header[offset + width - 1] = 0;
  };
  put(0, name); octal(100, 8, 0o600); octal(108, 8, 0); octal(116, 8, 0);
  octal(124, 12, size); octal(136, 12, 0);
  header.fill(32, 148, 156); header[156] = "0".charCodeAt(0);
  put(257, "ustar\0"); put(263, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  octal(148, 7, checksum); header[155] = 32;
  return header;
}

function tarPadding(size: number) {
  return new Uint8Array((512 - size % 512) % 512);
}

/** Writes only to a browser-selected, uncommitted writable stream. The caller
 * must use an explicit user gesture to obtain that stream. */
export async function writeVerifiedPackageArchive(transport: PackageArchiveTransport,
  sink: PackageArchiveSink, onProgress: (value: PackageArchiveProgress) => void = () => {}) {
  let closed = false;
  try {
    const initial = await readInventory(transport);
    let archiveBytes = 0;
    const archiveHash = sha256.create();
    const write = async (bytes: Uint8Array) => {
      if (archiveBytes + bytes.byteLength > MAX_ARCHIVE_BYTES) fail("archive_limit");
      try { await sink.write(bytes); } catch { fail("write_failed"); }
      archiveBytes += bytes.byteLength;
      archiveHash.update(bytes);
    };
    const addSmall = async (name: string, bytes: Uint8Array) => {
      await write(tarHeader(name, bytes.byteLength));
      await write(bytes);
      await write(tarPadding(bytes.byteLength));
    };
    await addSmall("LEEME.txt", README);
    const json = initial.entries.find(entry => entry.kind === "json")!;
    const jsonParts: Uint8Array[] = [];
    const jsonHash = sha256.create();
    for (let ordinal = 0; ordinal < json.expected_fragments; ordinal++) {
      const bytes = await verifiedFragment(transport, json, ordinal);
      jsonHash.update(bytes); jsonParts.push(bytes);
    }
    if (hex(jsonHash.digest()) !== json.computed_sha256) fail("fragment_mismatch");
    const jsonBytes = new Uint8Array(json.total_bytes);
    let position = 0;
    for (const part of jsonParts) { jsonBytes.set(part, position); position += part.byteLength; }
    const extensions = documentExtensions(jsonBytes);
    await addSmall("historia.json", jsonBytes);
    jsonParts.length = 0;
    const header = byteText(JSON.stringify({ format: "folio.export-package.archive.v1",
      preparedAt: initial.preparedAt, expiresAt: initial.expiresAt,
      captureMeaning: "preparation_time_not_global_snapshot",
      expectedEntries: initial.entries.length }) + "\n");
    const manifestLines = [header];
    let manifestBytes = header.byteLength;
    let completed = 0;
    for (const entry of initial.entries) {
      const name = archiveName(entry, extensions);
      if (entry.kind !== "json" && entry.kind !== "withdrawn_document") {
        await write(tarHeader(name!, entry.total_bytes));
        const fileHash = sha256.create();
        for (let ordinal = 0; ordinal < entry.expected_fragments; ordinal++) {
          const bytes = await verifiedFragment(transport, entry, ordinal);
          fileHash.update(bytes);
          if (ordinal === entry.expected_fragments - 1) {
            if (hex(fileHash.digest()) !== entry.computed_sha256) fail("fragment_mismatch");
          }
          await write(bytes);
        }
        await write(tarPadding(entry.total_bytes));
      }
      const line = byteText(JSON.stringify({ kind: entry.kind, sourceId: entry.source_id,
        sourceIndex: entry.source_index, file: name, bytes: entry.total_bytes,
        calculatedSha256: entry.computed_sha256, sourceHashKind: entry.source_hash_kind,
        sourceSha256: entry.source_sha256,
        status: entry.kind === "withdrawn_document" ? "retirado_sin_bytes" : "verificado" }) + "\n");
      manifestBytes += line.byteLength;
      if (manifestBytes > 8 * 1024 * 1024) fail("archive_limit");
      manifestLines.push(line);
      completed++; onProgress({ completedEntries: completed, totalEntries: initial.entries.length });
    }
    await write(tarHeader("manifiesto.jsonl", manifestBytes));
    let pending: Uint8Array[] = [], pendingBytes = 0;
    for (const line of manifestLines) {
      pending.push(line); pendingBytes += line.byteLength;
      if (pendingBytes >= 256 * 1024) {
        const chunk = new Uint8Array(pendingBytes);
        let cursor = 0;
        for (const item of pending) { chunk.set(item, cursor); cursor += item.byteLength; }
        await write(chunk); pending = []; pendingBytes = 0;
      }
    }
    const last = new Uint8Array(pendingBytes);
    let cursor = 0;
    for (const item of pending) { last.set(item, cursor); cursor += item.byteLength; }
    await write(last);
    await write(tarPadding(manifestBytes));
    await write(new Uint8Array(1024));
    const final = await readInventory(transport);
    if (JSON.stringify(final) !== JSON.stringify(initial) || !validTime(final.expiresAt)) {
      fail("source_changed");
    }
    await sink.close(); closed = true;
    return { archiveSha256: hex(archiveHash.digest()), archiveBytes,
      entries: initial.entries.length, preparedAt: initial.preparedAt };
  } catch (cause) {
    let abortConfirmed = false;
    if (!closed) try { await sink.abort(); abortConfirmed = true; } catch { /* Save state is uncertain. */ }
    const code = cause instanceof PackageArchiveFailure ? cause.code : "unconfirmed";
    throw new PackageArchiveFailure(code, abortConfirmed);
  }
}
