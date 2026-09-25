type RecoveryAuth = {
  initialize: () => Promise<{ error: Error | null }>;
  getSession: () => Promise<{ data: { session: unknown }; error: Error | null }>;
};

/** Let the SSR browser client own URL exchange exactly once. An existing cookie
 * alone cannot validate an expired or reused recovery link. */
export async function resolveRecoveryLink(
  auth: RecoveryAuth,
  initialHref: string,
  currentHref: () => string,
): Promise<boolean> {
  let initial: URL;
  try { initial = new URL(initialHref); } catch { return false; }
  if (initial.searchParams.has("error") || initial.searchParams.has("error_description")) return false;
  const hadCode = initial.searchParams.has("code");
  const fragment = new URLSearchParams(initial.hash.replace(/^#/, ""));
  const hadRecoveryFragment = fragment.get("type") === "recovery"
    && fragment.has("access_token") && fragment.has("refresh_token");
  if (!hadCode && !hadRecoveryFragment) return false;

  try {
    const initialized = await auth.initialize();
    if (initialized.error) return false;
    const current = new URL(currentHref());
    if (current.origin !== initial.origin || current.pathname !== initial.pathname) return false;
    // GoTrue removes the PKCE code (or implicit tokens) only after a successful
    // exchange. If they remain, getSession() could be an unrelated old cookie.
    if (hadCode && current.searchParams.has("code")) return false;
    if (hadRecoveryFragment && new URLSearchParams(current.hash.replace(/^#/, "")).has("access_token")) return false;
    const { data, error } = await auth.getSession();
    return !error && Boolean(data.session);
  } catch { return false; }
}
