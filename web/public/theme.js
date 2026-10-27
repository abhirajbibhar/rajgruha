/**
 * Applies the saved theme before first paint.
 *
 * A separate file rather than an inline script on purpose: an inline script would
 * need a CSP hash (which breaks silently whenever the script is edited) or
 * `unsafe-inline` (which weakens the whole policy). This is ~300 bytes, served
 * from our own origin and edge-cached.
 *
 * Loaded with a plain blocking <script> so it runs during HTML parsing, before
 * the deferred app bundle, which is what prevents a flash of the wrong theme.
 */
(function () {
  try {
    var stored = localStorage.getItem('rajgruha-theme') || 'system';
    var dark =
      stored === 'dark' ||
      (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (error) {
    // Private browsing can refuse storage; light is a safe default.
    document.documentElement.dataset.theme = 'light';
  }
})();
