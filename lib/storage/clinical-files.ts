import { err, ok, type Result } from "@/lib/db/errors";

export const CLINICAL_BUCKET = "documentos-clinicos";
export const CLINICAL_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const CLINICAL_LEGACY_MAX_BYTES = 50 * 1024 * 1024;
export const CLINICAL_FILE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/tiff,application/dicom";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(`^documentos-clinicos/(${UUID})/(${UUID})/([A-Za-z0-9][A-Za-z0-9_.-]{0,127}\\.[A-Za-z0-9]{1,12})$`);

export function clinicalObjectPath(path: string, organizationId: string, pacienteId: string): string | null {
  const match = PATH.exec(path);
  if (!match || match[1] !== organizationId || match[2] !== pacienteId || match[3].includes("..")) return null;
  return path.slice(CLINICAL_BUCKET.length + 1);
}

export interface ClinicalFileType { mime: string; extension: string }
/** Validate a recognized binary container, never browser MIME or filename. This is
 * format screening, not antivirus or a claim that a clinical document is accurate.
 * Raw/headerless DICOM and truncated/unknown containers require manual review.
 */
export function inspectClinicalFile(bytes: Uint8Array, maxBytes = CLINICAL_UPLOAD_MAX_BYTES): Result<ClinicalFileType> {
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return err("validation", "El archivo está vacío o supera el tamaño permitido.");
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const valid = (mime: string, extension: string) => ok({ mime, extension });
  const starts = (signature: number[]) => signature.every((v, i) => b[i] === v);
  try {
    if (starts([137,80,78,71,13,10,26,10])) {
      let at = 8, header = false, pixels = false;
      while (at + 12 <= b.length) {
        const length = b.readUInt32BE(at), kind = b.toString("ascii", at + 4, at + 8);
        if (at + length + 12 > b.length) break;
        if (at === 8) {
          if (kind !== "IHDR" || length !== 13 || !b.readUInt32BE(at + 8) || !b.readUInt32BE(at + 12)) break;
          header = true;
        }
        if (kind === "IDAT" && length > 0) pixels = true;
        if (kind === "IEND") {
          if (header && pixels && length === 0 && at + 12 === b.length) return valid("image/png", "png");
          break;
        }
        at += length + 12;
      }
    } else if (starts([255,216,255]) && b[b.length - 2] === 255 && b[b.length - 1] === 217) {
      let at = 2, frame = false;
      while (at + 4 < b.length) {
        if (b[at++] !== 255) break;
        while (b[at] === 255) at++;
        const marker = b[at++];
        const length = b.readUInt16BE(at);
        if (length < 2 || at + length > b.length) break;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) frame = length >= 8 && b.readUInt16BE(at + 3) > 0 && b.readUInt16BE(at + 5) > 0;
        if (marker === 218 && frame && length >= 6 && at + length < b.length - 2) return valid("image/jpeg", "jpg");
        at += length;
      }
    } else if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" && b.readUInt32LE(4) + 8 === b.length) {
      let at = 12;
      while (at + 8 <= b.length) {
        const kind = b.toString("ascii", at, at + 4), size = b.readUInt32LE(at + 4);
        if (size < 5 || at + size + 8 > b.length) break;
        if ((kind === "VP8 " && size >= 10 && b.subarray(at + 11, at + 14).equals(Buffer.from([157,1,42]))) || (kind === "VP8L" && b[at + 8] === 47)) return valid("image/webp", "webp");
        at += 8 + size + (size % 2);
      }
    } else if (starts([73,73,42,0]) || starts([77,77,0,42])) {
      const le = b[0] === 73;
      const offset = le ? b.readUInt32LE(4) : b.readUInt32BE(4);
      if (offset >= 8 && offset + 2 < b.length) {
        const count = le ? b.readUInt16LE(offset) : b.readUInt16BE(offset);
        if (count > 0 && offset + 2 + count * 12 + 4 <= b.length) return valid("image/tiff", "tiff");
      }
    } else if (b.length > 132 && b.toString("ascii", 128, 132) === "DICM" && b.readUInt16LE(132) === 2) {
      // Part 10 requires file meta information in explicit little-endian VR.
      if (b.length >= 144 && /^[A-Z]{2}$/.test(b.toString("ascii", 136, 138))) return valid("application/dicom", "dcm");
    } else if (b.toString("ascii", 4, 8) === "ftyp") {
      let at = 0, brand = false, metadata = false, pixels = false;
      while (at + 8 <= b.length) {
        const size = b.readUInt32BE(at), kind = b.toString("ascii", at + 4, at + 8);
        if (size < 8 || at + size > b.length) break;
        if (kind === "ftyp" && size >= 16) brand = /heic|heix|hevc|hevx/.test(b.toString("ascii", at + 8, at + size));
        if (kind === "meta" && size > 12) metadata = true;
        if (kind === "mdat" && size > 8) pixels = true;
        at += size;
      }
      if (at === b.length && brand && metadata && pixels) return valid("image/heic", "heic");
    } else if (/^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(b.toString("ascii", 0, 12))) {
      const text = b.toString("latin1");
      if (/%%EOF\s*$/.test(text) && /\b\d+\s+\d+\s+obj\b/.test(text) && /\bendobj\b/.test(text) && /startxref\s+\d+\s+%%EOF\s*$/.test(text)) return valid("application/pdf", "pdf");
    }
  } catch { /* Truncated binary offsets are invalid files, not server errors. */ }
  return err("validation", "No pudimos reconocer un archivo completo compatible. Usá PDF, JPG, PNG, WebP, HEIC, TIFF o DICOM válido.");
}
