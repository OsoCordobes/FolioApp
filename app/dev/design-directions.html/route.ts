import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

/** Local design studies share the same isolation gate as the component gallery. */
export async function GET() {
  if (process.env.NODE_ENV === "production" || process.env.FOLIO_TEST_ISOLATED !== "1") {
    return new Response("Not found", { status: 404 });
  }
  const html = await readFile(join(process.cwd(), "docs/design/design-directions.html"), "utf8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
