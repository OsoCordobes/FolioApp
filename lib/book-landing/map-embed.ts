/** Accept only the src from Google Maps' Share > Embed a map snippet. */
export function normalizeGoogleMapsEmbedUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 3000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.google.com" || url.port ||
        url.username || url.password || url.pathname !== "/maps/embed" || url.hash) return null;
    const entries = [...url.searchParams.entries()];
    const pb = entries[0]?.[1] ?? "";
    if (entries.length !== 1 || entries[0][0] !== "pb" || pb.length < 20 || pb.length > 2500 ||
        !pb.startsWith("!") || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>"`]/u.test(pb)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function extractGoogleMapsEmbedUrl(snippet: string): string | null {
  if (snippet.length > 4000) return null;
  const match = /^<iframe\b([\s\S]*?)>\s*<\/iframe>$/i.exec(snippet.trim());
  if (!match) return null;
  const allowed = new Set(["src", "width", "height", "style", "allowfullscreen", "loading", "referrerpolicy", "frameborder", "title"]);
  let attrs = match[1];
  let src: string | null = null;
  while (attrs.trim()) {
    const attr = /^\s+([a-z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/i.exec(attrs);
    if (!attr) return null;
    const name = attr[1].toLowerCase();
    if (!allowed.has(name)) return null;
    if (name === "src") {
      if (src !== null) return null;
      src = attr[2] ?? attr[3] ?? attr[4] ?? null;
    }
    attrs = attrs.slice(attr[0].length);
  }
  return normalizeGoogleMapsEmbedUrl(src?.replaceAll("&amp;", "&"));
}
