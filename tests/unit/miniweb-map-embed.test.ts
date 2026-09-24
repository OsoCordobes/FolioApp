import assert from "node:assert/strict";
import { test } from "node:test";

import { extractGoogleMapsEmbedUrl, normalizeGoogleMapsEmbedUrl } from "../../lib/book-landing/map-embed";

const source = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d123.45";

test("Google Maps Share HTML yields only the allowed iframe src", () => {
  assert.equal(extractGoogleMapsEmbedUrl(`<iframe src="${source}" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`), source);
});

test("map parser rejects other hosts, paths, scripts and arbitrary markup", () => {
  for (const snippet of [
    source,
    `<iframe src="https://evil.test/maps/embed?pb=!1m18!1m12!1m3!1d123.45"></iframe>`,
    `<iframe src="https://www.google.com.evil.test/maps/embed?pb=!1m18!1m12!1m3!1d123.45"></iframe>`,
    `<iframe src="https://www.google.com/maps/embed/v1/place?key=x"></iframe>`,
    `<iframe src="${source}" onload="alert(1)"></iframe>`,
    `<iframe src="${source}"></iframe><script>alert(1)</script>`,
  ]) assert.equal(extractGoogleMapsEmbedUrl(snippet), null);
  assert.equal(normalizeGoogleMapsEmbedUrl("javascript:alert(1)"), null);
});
