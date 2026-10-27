import { describe, expect, it } from 'vitest';
import { createTestClient, post, registerOwner } from './helpers';

describe('accounts', () => {
  it('starts with sign-ups open and no owner', async () => {
    const client = createTestClient();
    const status = await client.json<{
      initialized: boolean;
      registrationOpen: boolean;
      user: unknown;
    }>('/api/auth/status');

    expect(status.initialized).toBe(false);
    expect(status.registrationOpen).toBe(true);
    expect(status.user).toBeNull();
  });

  it('makes the first account the owner and closes sign-ups behind them', async () => {
    const client = createTestClient();
    const owner = await registerOwner(client, { name: 'First' });

    expect(owner.role).toBe('owner');
    expect(owner.isOwner).toBe(true);

    const status = await client.json<{ initialized: boolean; registrationOpen: boolean }>('/api/auth/status');
    expect(status.initialized).toBe(true);
    expect(status.registrationOpen).toBe(false);
  });

  it('refuses a second sign-up while registration is closed', async () => {
    const client = createTestClient();
    await registerOwner(client);

    const response = await client.fetch(
      '/api/auth/register',
      post({ email: 'someone@example.com', name: 'Someone', password: 'another-long-password' }),
    );
    expect(response.status).toBe(403);
  });

  it('lets the owner reopen registration and then allows another account', async () => {
    const client = createTestClient();
    await registerOwner(client);

    await client.json('/api/settings/instance', post({ registrationOpen: true }, 'PUT'));

    const second = await client.json<{ user: { role: string; isOwner: boolean } }>(
      '/api/auth/register',
      post({ email: 'second@example.com', name: 'Second', password: 'another-long-password' }),
    );
    expect(second.user.role).toBe('member');
    expect(second.user.isOwner).toBe(false);
  });

  it('rejects a weak password', async () => {
    const client = createTestClient();
    const response = await client.fetch(
      '/api/auth/register',
      post({ email: 'a@b.com', name: 'A', password: 'short' }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a malformed email', async () => {
    const client = createTestClient();
    const response = await client.fetch(
      '/api/auth/register',
      post({ email: 'not-an-email', name: 'A', password: 'a-long-enough-password' }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a duplicate email', async () => {
    const client = createTestClient();
    await registerOwner(client, { email: 'dup@example.com' });
    await client.json('/api/settings/instance', post({ registrationOpen: true }, 'PUT'));

    const response = await client.fetch(
      '/api/auth/register',
      post({ email: 'DUP@example.com', name: 'Copy', password: 'a-long-enough-password' }),
    );
    expect(response.status).toBe(409);
  });
});

describe('sessions', () => {
  it('signs in with the right password and out again', async () => {
    const client = createTestClient();
    await registerOwner(client, { email: 'me@example.com', password: 'my-secret-password' });

    await client.json('/api/auth/logout', { method: 'POST' });
    expect(client.cookie()).toBeNull();

    const meAnonymous = await client.fetch('/api/auth/me');
    expect(meAnonymous.status).toBe(401);

    await client.json('/api/auth/login', post({ email: 'me@example.com', password: 'my-secret-password' }));
    const me = await client.json<{ user: { email: string } }>('/api/auth/me');
    expect(me.user.email).toBe('me@example.com');
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const client = createTestClient();
    await registerOwner(client, { email: 'me@example.com', password: 'my-secret-password' });
    await client.json('/api/auth/logout', { method: 'POST' });

    const wrongPassword = await client.fetch(
      '/api/auth/login',
      post({ email: 'me@example.com', password: 'definitely-wrong' }),
    );
    const unknownUser = await client.fetch(
      '/api/auth/login',
      post({ email: 'nobody@example.com', password: 'my-secret-password' }),
    );

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.text()).toBe(await unknownUser.text());
  });

  it('protects every API route when there is no session', async () => {
    const client = createTestClient();
    for (const path of [
      '/api/library',
      '/api/annotations',
      '/api/quotes',
      '/api/notebook',
      '/api/settings',
      '/api/dashboard',
      '/api/export',
    ]) {
      const response = await client.fetch(path);
      expect(response.status, path).toBe(401);
    }
  });

  it('changes the password and invalidates the old one', async () => {
    const client = createTestClient();
    await registerOwner(client, { email: 'me@example.com', password: 'the-original-password' });

    await client.json(
      '/api/auth/password',
      post({ currentPassword: 'the-original-password', newPassword: 'a-brand-new-password' }),
    );

    await client.json('/api/auth/logout', { method: 'POST' });
    const withOld = await client.fetch(
      '/api/auth/login',
      post({ email: 'me@example.com', password: 'the-original-password' }),
    );
    expect(withOld.status).toBe(401);

    const withNew = await client.json<{ user: { email: string } }>(
      '/api/auth/login',
      post({ email: 'me@example.com', password: 'a-brand-new-password' }),
    );
    expect(withNew.user.email).toBe('me@example.com');
  });

  it('refuses a password change with the wrong current password', async () => {
    const client = createTestClient();
    await registerOwner(client, { password: 'the-original-password' });

    const response = await client.fetch(
      '/api/auth/password',
      post({ currentPassword: 'nope', newPassword: 'a-brand-new-password' }),
    );
    expect(response.status).toBe(401);
  });

  it('updates the profile and moves the email pointer', async () => {
    const client = createTestClient();
    await registerOwner(client, { email: 'old@example.com', password: 'a-long-enough-password' });

    await client.json('/api/auth/me', post({ name: 'Renamed', email: 'new@example.com' }, 'PATCH'));

    const keys = [...client.store.snapshot().keys()];
    expect(keys.some((key) => key.startsWith('users/by-email/'))).toBe(true);

    await client.json('/api/auth/logout', { method: 'POST' });
    const login = await client.json<{ user: { name: string; email: string } }>(
      '/api/auth/login',
      post({ email: 'new@example.com', password: 'a-long-enough-password' }),
    );
    expect(login.user.name).toBe('Renamed');

    const withOldEmail = await client.fetch(
      '/api/auth/login',
      post({ email: 'old@example.com', password: 'a-long-enough-password' }),
    );
    expect(withOldEmail.status).toBe(401);
  });

  it('refuses a cross-origin state change', async () => {
    const client = createTestClient();
    const response = await client.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'a@b.com', password: 'whatever-long-enough' }),
    });
    expect(response.status).toBe(403);
  });
});
