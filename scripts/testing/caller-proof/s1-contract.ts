import assert from "node:assert/strict";

export const S1_FIXTURE_NAME = "folio-s1-indexing-fixture.json";
export const S1_SPECS = ["tests/e2e/private-indexing.spec.ts", "tests/e2e/private-indexing-authenticated.spec.ts"];
export const S1_MARKERS = [
  "@@FOLIO_S1@@staff_html:status=200 route=/hoy head=noindex,nofollow identity=matched aal=2",
  "@@FOLIO_S1@@portal_html:status=200 route=/portal head=noindex,nofollow identity=matched",
  "@@FOLIO_S1@@member_restored:owned=1 active=1",
] as const;

// Exact emitted lines only: codeframes and arbitrary HTML are never evidence.
export function s1Result(output: string): { markers: string[]; passed: boolean } {
  const lines = output.split(/\r?\n/).map(line => line.trim());
  const markers = lines.filter(line => S1_MARKERS.some(marker => marker === line));
  const counts = lines.filter(line => /^\d+ (passed|failed|skipped|flaky|did not run)\b/.test(line));
  const passed = counts.length === 1 && /^3 passed\b/.test(counts[0]) &&
    S1_MARKERS.every(marker => markers.filter(line => line === marker).length === 1);
  return { markers, passed };
}

// Ported from 99415: restrict assertions to the server's head, never the body.
export function privateRobotsDirectives(html: string): string[] {
  const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)?.[0];
  assert.ok(head, "s1_html_head_missing");
  const tag = [...head.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0])
    .find(value => /\bname=(['"])robots\1/i.test(value));
  assert.ok(tag, "s1_head_robots_missing");
  const content = tag.match(/\bcontent=(['"])(.*?)\1/i)?.[2];
  assert.ok(content, "s1_robots_content_missing");
  return content.split(",").map(value => value.trim().toLowerCase());
}
