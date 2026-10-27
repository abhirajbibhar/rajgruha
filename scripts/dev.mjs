/**
 * Development runner: esbuild in watch mode plus `wrangler dev` for the API and
 * local R2. Both write into the same tree, so the Worker picks up new bundles on
 * reload without a second terminal.
 */
import { spawn } from 'node:child_process';
import { context } from 'esbuild';
import { buildWeb } from './build-web.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  children.push(child);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev] ${command} exited with ${code}`);
      shutdown(code);
    }
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) child.kill();
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// First pass is a real build so index.html references existing files.
await buildWeb({ minify: false });

// Then rebuild on change for a fast edit loop.
const watchCtx = await context({
  absWorkingDir: root,
  entryPoints: { main: path.join(root, 'web/src/main.tsx') },
  bundle: true,
  splitting: true,
  format: 'esm',
  target: ['es2022'],
  platform: 'browser',
  outdir: path.join(root, 'web/dist/assets'),
  entryNames: '[name]',
  chunkNames: 'chunks/[name]',
  loader: { '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl' },
  sourcemap: true,
  minify: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  logLevel: 'info',
});
await watchCtx.watch();

run('npx', ['wrangler', 'dev', '--port', '8787']);
