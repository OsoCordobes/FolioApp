export const CLINICAL_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie",
};

/** Stream a validated object. Range is single-range only, including suffix ranges. */
export function clinicalFileResponse(request: Request, file: { blob: Blob; mime: string; filename: string }): Response {
  const inline = ["image/png", "image/jpeg", "image/webp"].includes(file.mime);
  const filename = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const headers = new Headers({ ...CLINICAL_RESPONSE_HEADERS, "Content-Type": file.mime,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`, "Accept-Ranges": "bytes" });
  let blob = file.blob, status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = 0, end = blob.size - 1;
    if (match?.[1]) { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
    else if (match?.[2]) start = Math.max(0, blob.size - Number(match[2]));
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= blob.size) {
      headers.set("Content-Range", `bytes */${blob.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${blob.size}`);
    blob = blob.slice(start, end + 1);
    status = 206;
  }
  headers.set("Content-Length", String(blob.size));
  return new Response(request.method === "HEAD" ? null : blob.stream(), { status, headers });
}
