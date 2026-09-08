import { createHash } from "node:crypto";
const signature = (rows) =>
  JSON.stringify(
    rows
      .map((x) => ({
        bucket: x.bucket,
        name: x.name,
        id: x.id,
        updatedAt: new Date(x.updatedAt).toISOString(),
        size: x.size,
        etag: x.etag,
      }))
      .sort((a, b) =>
        `${a.bucket}/${a.name}`.localeCompare(`${b.bucket}/${b.name}`),
      ),
  );
export function requireStorageMatch(expected, actual) {
  if (signature(expected) !== signature(actual))
    throw new Error("storage_inventory_changed");
}
export function createStorageReader({
  url,
  serviceKey,
  fetchImpl = fetch,
  pageSize = 100,
}) {
  const base = new URL(url);
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("storage_url_invalid");
  if (
    base.protocol === "http:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
  )
    throw new Error("storage_requires_tls");
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const request = async (endpoint, options = {}) => {
    const res = await fetchImpl(
      new URL(`storage/v1/${endpoint}`, `${base.origin}/`),
      {
        ...options,
        headers: { ...headers, ...options.headers },
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    );
    if (!res.ok) throw new Error(`storage_http_${res.status}`);
    return res;
  };
  return {
    async inventory(buckets) {
      const foundBuckets = await (await request("bucket")).json();
      if (
        !Array.isArray(foundBuckets) ||
        JSON.stringify(foundBuckets.map((b) => b.id).sort()) !==
          JSON.stringify(buckets.map((b) => b.id).sort())
      )
        throw new Error("storage_buckets_mismatch");
      const rows = [];
      const visited = new Set();
      const list = async (bucket, prefix = "") => {
        if (visited.has(`${bucket}/${prefix}`))
          throw new Error("storage_listing_cycle");
        visited.add(`${bucket}/${prefix}`);
        let offset = 0;
        for (;;) {
          const page = await (
            await request(`object/list/${encodeURIComponent(bucket)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prefix,
                limit: pageSize,
                offset,
                sortBy: { column: "name", order: "asc" },
              }),
            })
          ).json();
          if (!Array.isArray(page)) throw new Error("storage_listing_invalid");
          for (const item of page) {
            if (
              typeof item.name !== "string" ||
              item.name.includes("/") ||
              item.name === "." ||
              item.name === ".."
            )
              throw new Error("storage_name_invalid");
            const name = prefix ? `${prefix}/${item.name}` : item.name;
            if (!item.id) await list(bucket, name);
            else
              rows.push({
                bucket,
                name,
                id: item.id,
                updatedAt: item.updated_at,
                size: Number(item.metadata?.size),
                etag: item.metadata?.eTag ?? item.metadata?.etag ?? null,
              });
          }
          if (page.length < pageSize) break;
          offset += page.length;
          if (offset > 1000000) throw new Error("storage_listing_limit");
        }
      };
      for (const bucket of buckets) await list(bucket.id);
      return rows;
    },
    async download(object) {
      const res = await request(
        `object/${encodeURIComponent(object.bucket)}/${object.name.split("/").map(encodeURIComponent).join("/")}`,
        { headers: object.etag ? { "If-Match": object.etag } : {} },
      );
      if (!res.body) throw new Error("storage_body_missing");
      if (object.etag) {
        const returned = res.headers.get("etag");
        const normalized = (value) =>
          String(value).replace(/^W\//, "").replace(/^"|"$/g, "");
        if (!returned || normalized(returned) !== normalized(object.etag))
          throw new Error("storage_version_mismatch");
      }
      let count = 0;
      const hash = createHash("sha256");
      return {
        stream: (async function* () {
          for await (const chunk of res.body) {
            count += chunk.length;
            hash.update(chunk);
            yield chunk;
          }
          if (!Number.isFinite(object.size) || count !== object.size)
            throw new Error("storage_size_mismatch");
        })(),
        hash: () => hash.digest("hex"),
      };
    },
  };
}
