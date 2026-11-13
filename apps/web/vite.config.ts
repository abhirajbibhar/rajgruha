import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// `vite dev` stays a plain Node dev server (proxying /api to `wrangler dev`); `vite build` targets Cloudflare Workers.
export default defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  server: {
    port: 3000,
    // Same-origin in dev so the HttpOnly session cookie just works.
    // In production, route /api/* to the Worker (Cloudflare route or service binding).
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:8787', changeOrigin: true } }
  },
  css: {
    preprocessorOptions: {
      scss: { silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin', 'color-functions'] }
    }
  },
  plugins: [command === 'build' ? cloudflare({ viteEnvironment: { name: 'ssr' } }) : null, tanstackStart(), react()]
}));
