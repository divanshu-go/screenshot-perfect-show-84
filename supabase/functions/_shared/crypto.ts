const version = "v1";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get("CREDENTIAL_ENCRYPTION_KEY");
  if (!encoded) throw new Error("Credential encryption is not configured");
  const raw = base64ToBytes(encoded);
  if (raw.byteLength !== 32) throw new Error("Credential encryption key must contain 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptCredential(value: Record<string, string>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    plaintext,
  );
  return `${version}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptCredential(payload: string): Promise<Record<string, string>> {
  const [payloadVersion, encodedIv, encodedCiphertext] = payload.split(".");
  if (payloadVersion !== version || !encodedIv || !encodedCiphertext) {
    throw new Error("Credential payload version is not supported");
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encodedIv) },
    await encryptionKey(),
    base64ToBytes(encodedCiphertext),
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Credential payload is invalid");
  }
  return parsed as Record<string, string>;
}
