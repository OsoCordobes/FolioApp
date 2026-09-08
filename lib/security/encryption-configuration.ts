const CURRENT_KEYS = ["FOLIO_ENC_KEY", "FOLIO_ENC_HMAC_KEY"] as const;
const OPTIONAL_KEYS = ["FOLIO_ENC_KEY_NEXT", "FOLIO_ENC_HMAC_KEY_NEXT"] as const;

/** OpenSSL-compatible, canonical 32-byte base64. Never returns the key or its length. */
export function isValidEncryptionKey(raw: string): boolean {
  const value = raw.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  try { return bytes.length === 32 && bytes.toString("base64") === value; }
  finally { bytes.fill(0); }
}

/** Shared by startup and authenticated health checks; reports names and booleans only. */
export function encryptionConfigurationStatus(environment: Record<string, string | undefined>) {
  const missing = CURRENT_KEYS.filter(name => !environment[name]?.trim());
  const invalid = [...CURRENT_KEYS, ...OPTIONAL_KEYS].filter(name => {
    const value = environment[name];
    return Boolean(value?.trim()) && !isValidEncryptionKey(value!);
  });
  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing, invalid,
    rotation: {
      enc: Boolean(environment.FOLIO_ENC_KEY_NEXT?.trim()),
      hmac: Boolean(environment.FOLIO_ENC_HMAC_KEY_NEXT?.trim()),
    },
  };
}
