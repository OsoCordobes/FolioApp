/** A deadline covers both the request and response body. Abort is best effort. */
export async function postIntakeJson(
  path: "exchange" | "submit" | "status",
  data: unknown,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("request_timeout"));
    }, timeoutMs);
  });
  const request = async () => {
    const response = await fetchImpl(`/api/patient-intake/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    const result = await response.json() as Record<string, unknown>;
    if (response.status === 400 && result.code === "invalid_answers") throw new Error("invalid_answers");
    if (!response.ok || result.ok !== true) throw new Error("request_unconfirmed");
    return result;
  };
  try { return await Promise.race([request(), deadline]); }
  finally { if (timer) clearTimeout(timer); }
}
