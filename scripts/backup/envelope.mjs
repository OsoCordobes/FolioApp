import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
const MAGIC = Buffer.from("FOLIOBK1");
export const MAX_RESTORE_BYTES = 256 * 1024 * 1024;
const digest = (b) => createHash("sha256").update(b).digest("hex");
export function recipientFingerprint(pem) {
  return digest(createPublicKey(pem).export({ type: "spki", format: "der" }));
}
/** Streaming encryption only: no unencrypted temporary archive exists. */
export async function sealArtifact(source, file, publicKeyPem, context) {
  const recipient = createPublicKey(publicKeyPem);
  if (
    recipient.asymmetricKeyType !== "rsa" ||
    recipient.asymmetricKeyDetails.modulusLength < 3072
  )
    throw new Error("backup_recipient_invalid");
  const key = randomBytes(32),
    iv = randomBytes(12);
  const header = Buffer.from(
    JSON.stringify({
      v: 1,
      algorithm: "RSA-OAEP-SHA256+A256GCM",
      recipient: recipientFingerprint(publicKeyPem),
      context,
      iv: iv.toString("base64"),
      wrappedKey: publicEncrypt(
        {
          key: recipient,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        key,
      ).toString("base64"),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const encryptedHash = createHash("sha256"),
    plainHash = createHash("sha256");
  let bytes = 0,
    total = 0;
  const handle = await open(file, "wx", 0o600);
  const write = async (chunk) => {
    encryptedHash.update(chunk);
    total += chunk.length;
    await handle.writeFile(chunk);
  };
  try {
    await write(Buffer.concat([MAGIC, length, header]));
    for await (const chunk of source) {
      const value = Buffer.from(chunk);
      bytes += value.length;
      if (bytes > MAX_RESTORE_BYTES)
        throw new Error("backup_artifact_memory_limit_exceeded");
      plainHash.update(value);
      await write(cipher.update(value));
    }
    await write(cipher.final());
    await write(cipher.getAuthTag());
    await handle.sync();
    return {
      bytes,
      sha256: plainHash.digest("hex"),
      encryptedBytes: total,
      encryptedSha256: encryptedHash.digest("hex"),
    };
  } finally {
    key.fill(0);
    await handle.close();
  }
}
/** No consumer sees ANY plaintext before GCM final authenticates the complete file. */
export async function openArtifact(
  file,
  privateKeyPem,
  context,
  { passphrase, maxBytes = MAX_RESTORE_BYTES } = {},
) {
  let key, plaintext;
  try {
    const size = (await stat(file)).size;
    if (size > maxBytes + 65536 || size < 44) throw new Error();
    const data = await readFile(file);
    if (!data.subarray(0, 8).equals(MAGIC)) throw new Error();
    const count = data.readUInt32BE(8);
    if (count > 16384 || 12 + count + 16 > data.length) throw new Error();
    const headerBytes = data.subarray(12, 12 + count),
      header = JSON.parse(headerBytes.toString("utf8"));
    if (
      header.v !== 1 ||
      header.algorithm !== "RSA-OAEP-SHA256+A256GCM" ||
      JSON.stringify(header.context) !== JSON.stringify(context)
    )
      throw new Error();
    key = privateDecrypt(
      {
        key: privateKeyPem,
        passphrase,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(header.wrappedKey, "base64"),
    );
    if (key.length !== 32) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(header.iv, "base64"),
    );
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(data.subarray(-16));
    const provisional = decipher.update(data.subarray(12 + count, -16));
    try {
      plaintext = Buffer.concat([provisional, decipher.final()]);
    } finally {
      provisional.fill(0);
    }
    if (plaintext.length > maxBytes) throw new Error();
    return plaintext;
  } catch {
    plaintext?.fill(0);
    throw new Error("backup_authentication_failed_or_limit_exceeded");
  } finally {
    key?.fill(0);
  }
}
export async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
