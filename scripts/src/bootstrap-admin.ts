// Create (or reset) an admin user.
//   pnpm bootstrap-admin -- --email you@example.com --name "Your Name" --password '...'
//   ADMIN_PASSWORD=... pnpm bootstrap-admin -- --email you@example.com [--remote]
import { hashPassword } from '@rajgruha/shared';
import { ARGS, execSql, parseArgs, q } from './lib.ts';

const { values } = parseArgs({
  args: ARGS,
  options: {
    email: { type: 'string' },
    name: { type: 'string', default: 'Administrator' },
    password: { type: 'string' },
    remote: { type: 'boolean' },
    'dry-run': { type: 'boolean' }
  },
  allowPositionals: true
});

const password = values.password ?? process.env.ADMIN_PASSWORD;
if (!values.email || !password) {
  console.error('Usage: pnpm bootstrap-admin -- --email <email> [--name <name>] --password <pw>  (or ADMIN_PASSWORD env)');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Password must be at least 10 characters.');
  process.exit(1);
}

const hash = await hashPassword(password);
const sql = `INSERT INTO users (id, email, name, role, password_hash)
VALUES (${q(crypto.randomUUID())}, ${q(values.email)}, ${q(values.name)}, 'admin', ${q(hash)})
ON CONFLICT (email) DO UPDATE SET role = 'admin', name = excluded.name, password_hash = excluded.password_hash;
`;
execSql(sql, { remote: Boolean(values.remote), dryRun: Boolean(values['dry-run']) });
if (!values['dry-run']) console.log(`Admin ${values.email} ready (${values.remote ? 'remote' : 'local'}).`);
