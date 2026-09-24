import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { renderBookOg, type BookOgInput } from "../../lib/book-landing/og-image";

const base: BookOgInput = {
  nombre: "Lic. Lorenzo Martínez",
  consultorio: "Consultorio Martínez",
  especialidad: "Kinesiología",
  lugar: "Córdoba, Argentina",
  acento: "#8A6722",
  solo: true,
  foto: null,
};

async function pngBytes(input: BookOgInput): Promise<Buffer> {
  const response = await renderBookOg(input);
  assert.equal(response.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  return bytes;
}

test("OG renders the five specialties and long names at 1200×630", async () => {
  for (const especialidad of ["Quiropraxia", "Cardiología", "Psicología", "Kinesiología", "Nutrición"]) {
    await pngBytes({ ...base, nombre: "Lic. María de los Ángeles Fernández del Valle", especialidad, foto: null });
  }
});

test("OG renders public PNG, JPEG and WebP photos; corrupt bytes fall back to the text layout", async () => {
  for (const [ext, mime] of [["png", "image/png"], ["jpg", "image/jpeg"], ["webp", "image/webp"]]) {
    const bytes = await readFile(join(process.cwd(), `tests/fixtures/d01-portrait.${ext}`));
    await pngBytes({ ...base, foto: `data:${mime};base64,${bytes.toString("base64")}` });
  }
  const initials = await pngBytes(base);
  const corrupt = await pngBytes({ ...base, foto: "data:image/png;base64,bm90LWFuLWltYWdl" });
  assert.deepEqual(corrupt, initials);
});

test("OG keeps Folio's identity regardless of the stored practice accent", async () => {
  assert.deepEqual(
    await pngBytes({ ...base, acento: "#8A6722" }),
    await pngBytes({ ...base, acento: "#3F6B49" }),
  );
});
