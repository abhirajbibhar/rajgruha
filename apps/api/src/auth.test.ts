import { describe, expect, it } from 'vitest';
import { hashPassword, signSession, verifyPassword } from './auth';

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('salts: same password hashes differently', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'nope')).toBe(false);
  });
});

describe('session token', () => {
  it('signs a compact JWT', async () => {
    const t = await signSession({ id: 'u1', email: 'a@b.co', name: 'A', role: 'admin' }, 0, 'secret-secret-secret');
    expect(t.split('.')).toHaveLength(3);
  });
});
