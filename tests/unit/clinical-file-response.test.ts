import assert from "node:assert/strict";
import test from "node:test";
import { clinicalFileResponse } from "../../lib/storage/clinical-response";
import { clinicalObjectPath, inspectClinicalFile } from "../../lib/storage/clinical-files";
const file = { blob: new Blob(["synthetic-content"]), mime: "application/pdf", filename: "doc.pdf" };
test("private file response streams without shared caching, executable MIME or unsafe filename", async () => {
  const r = clinicalFileResponse(new Request("https://app.invalid/file"), { ...file, filename: 'bad"\r\nname.pdf' });
  assert.equal(r.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("content-disposition"), 'attachment; filename="bad___name.pdf"');
  assert.equal(r.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(await r.text(), "synthetic-content");
});
for (const [range, expected, code] of [["bytes=0-3", "synt", 206], ["bytes=-7", "content", 206], ["bytes=99-", "", 416], ["bytes=0-1,4-5", "", 416], ["bytes=-0", "", 416]] as const) {
  test(`range ${range} is bounded and cannot bypass authorization at the caller`, async () => {
    const r = clinicalFileResponse(new Request("https://app.invalid/file", { headers: { range } }), file);
    assert.equal(r.status, code); assert.equal(await r.text(), expected);
  });
}
test("HEAD exposes no body", async () => {
  const r = clinicalFileResponse(new Request("https://app.invalid/file", { method: "HEAD" }), file);
  assert.equal(await r.text(), ""); assert.equal(r.headers.get("content-length"), String(file.blob.size));
});
test("namespace validation rejects traversal, encoded delimiters and wrong patient", () => {
  const org = "10200000-0000-4000-8000-000000000010", patient = "10200000-0000-4000-8000-000000000020";
  for (const leaf of ["../file.png", "%2e%2e.png", "..png", "a%2fb.png", "a\\b.png", ".hidden.png"]) assert.equal(clinicalObjectPath(`documentos-clinicos/${org}/${patient}/${leaf}`, org, patient), null);
  assert.equal(clinicalObjectPath(`documentos-clinicos/${org}/${patient}/scan.png`, org, org), null);
});
test("empty and truncated containers are rejected regardless of their extension", () => {
  for (const data of [new Uint8Array(), Buffer.from("%PDF-1.7\n<html>"), Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from([255,216,255,217])]) assert.equal(inspectClinicalFile(data).ok, false);
});
