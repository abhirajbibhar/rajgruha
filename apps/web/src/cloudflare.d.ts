declare module 'cloudflare:workers' {
  /** Bindings declared in apps/web/wrangler.jsonc. */
  export const env: { API: { fetch(request: Request): Promise<Response> } };
}
