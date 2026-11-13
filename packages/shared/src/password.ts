// Runtime-neutral (WebCrypto only): used by the Worker to verify logins and by
// scripts/bootstrap-admin to create the first admin.

// PBKDF2-SHA256, stored as  pbkdf2$<iterations>$<salt b64>$<hash b64>
const PBKDF2_ITERATIONS = 100_000; // Workers' WebCrypto cap

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations },
    key,
    256
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iters, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iters || !salt || !hash) return false;
  const actual = new Uint8Array(await derive(password, unb64(salt), Number(iters)));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0; // constant-time compare
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

