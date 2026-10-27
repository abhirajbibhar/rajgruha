/**
 * Rajgruha frontend build.
 *
 * Deliberately plain esbuild: one script, no meta-framework, no plugin ecosystem to
 * break. Everything the browser runs is emitted into `web/dist`, which wrangler
 * uploads as static assets.
 *
 * Why this shape (and why it should still work in 15 years):
 *  - The only build dependency is esbuild, which is already pinned in package.json.
 *  - Output is plain ES modules; no runtime framework shim beyond React itself.
 *  - Each page is a dynamic import, so the dashboard ships without the PDF engine.
 */
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = path.join(root, 'web');
const srcDir = path.join(webSrc, 'src');
const publicDir = path.join(webSrc, 'public');
const outDir = path.join(webSrc, 'dist');

/**
 * EmbedPDF ships its PDFium engine as WebAssembly. Some builds resolve it from a
 * CDN, which would make the reader depend on a third party staying online. When the
 * wasm files are present in node_modules we vendor them into the bundle instead and
 * expose the local path to the app, so the reader works from our own origin.
 */
async function vendorEmbedPdfAssets() {
  const sources = [
    path.join(root, 'node_modules', '@embedpdf', 'snippet', 'dist', 'pdfium.wasm'),
    path.join(root, 'node_modules', '@embedpdf', 'pdfium', 'dist', 'pdfium.wasm'),
  ];

  const targetDir = path.join(outDir, 'embedpdf');
  await mkdir(targetDir, { recursive: true });

  // Flattened to /embedpdf/pdfium.wasm so the viewer's `wasmUrl` is a stable
  // path we control. Without this the engine falls back to jsDelivr, which would
  // make the reader depend on a third party staying online and on its URLs
  // staying put for the next fifteen years.
  for (const source of sources) {
    if (!existsSync(source)) continue;
    await cp(source, path.join(targetDir, 'pdfium.wasm'));
    return path.join('embedpdf', 'pdfium.wasm');
  }
  console.warn('[build-web] pdfium.wasm not found in node_modules - the viewer will fall back to the CDN');
  return null;
}

export async function buildWeb({ watch = false, minify = true } = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const result = await build({
    absWorkingDir: root,
    entryPoints: {
      main: path.join(srcDir, 'main.tsx'),
    },
    bundle: true,
    splitting: true,
    format: 'esm',
    target: ['es2022', 'safari16', 'chrome110', 'firefox110'],
    platform: 'browser',
    outdir: path.join(outDir, 'assets'),
    entryNames: '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'media/[name]-[hash]',
    loader: {
      '.css': 'css',
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.woff2': 'file',
    },
    minify,
    sourcemap: true,
    metafile: true,
    legalComments: 'none',
    logLevel: 'info',
    define: {
      'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development'),
    },
    jsx: 'automatic',
    logOverride: { 'unsupported-require-call': 'silent' },
  });

  // Work out the emitted entry + stylesheet names from the metafile. Keys are
  // relative to the working directory, so they are re-based onto the public root
  // that the Worker actually serves (/assets/...), not the on-disk path.
  const publicPath = (relative) => `/${path.relative(outDir, path.resolve(root, relative)).replaceAll('\\', '/')}`;

  const outputs = Object.keys(result.metafile.outputs).map((p) => p.replaceAll('\\', '/'));
  const entrySource = outputs.find((p) => /assets\/main-[^/]+\.js$/.test(p));
  if (!entrySource) throw new Error('esbuild did not emit a main entry bundle');
  const entry = publicPath(entrySource);
  const styles = outputs.filter((p) => p.endsWith('.css')).map(publicPath);

  if (existsSync(publicDir)) {
    await cp(publicDir, outDir, { recursive: true });
  }
  await vendorEmbedPdfAssets();

  const template = await readFile(path.join(webSrc, 'index.html'), 'utf8');
  const html = template
    .replace('<!--app-css-->', styles.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n    '))
    .replace('<!--app-script-->', `<script type="module" src="${entry}"></script>`);

  await writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  return { entry, styles, outDir };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('build-web.mjs')) {
  await buildWeb({ minify: process.env.NODE_ENV !== 'development' });
  console.log('Rajgruha frontend built into web/dist');
}
