/**
 * The document the canvas frame renders.
 *
 * Agent HTML is untrusted input: it gets a sandboxed iframe with an opaque
 * origin and a Content-Security-Policy the host injects. The policy is the
 * mechanism, not decoration — with `connect-src 'none'` a document cannot
 * reach the OpenChamber API even though it was served by it, and without
 * `script-src` sources no external script can load. An author's own CSP meta
 * is preserved and can only narrow this.
 *
 * The server never serves canvas content as `text/html` from its own origin,
 * so there is no second path around this.
 */

/**
 * Everything the document may do, stated once. `data:`/`blob:` images cover a
 * document that embeds its own graphics (the tool description says so); fonts
 * and styles stay inline or embedded the same way. `connect-src 'none'` is
 * the load-bearing directive: no fetch, no websocket, no beacon.
 */
export const CANVAS_FRAME_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline' data:",
  "script-src 'unsafe-inline' data:",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Removed: the base style block now carries the full base look. */
const CANVAS_BASE_STYLE = '';

type CanvasDocumentOptions = {
  /** OpenChamber theme variables and base element styles, host-built. */
  themeCss?: string;
};

/**
 * Builds the full document a `sandbox="allow-scripts"` iframe renders from.
 *
 * A canvas is usually a complete document, so the policy is inserted into the
 * head rather than wrapped around it — wrapping would nest a second `<html>`,
 * and the parse quirks that produces are exactly the kind of subtlety a
 * hostile document should not get to play with. A fragment gets a full
 * minimal document around it.
 *
 * The theme style lands before the author's own tags, so a canvas can
 * override the base look but never the security policy. Inline
 * style/script stay allowed, so `unsafe-inline` here is not an escape: the
 * sandboxed frame has no origin, and `connect-src 'none'` closes the one
 * thing inline code could otherwise do.
 */
/**
 * The base look, host-owned: reset, element defaults, and a tiny kit. All
 * colors come from the `--oc-*` theme variables with fallbacks, so the
 * document reads as OpenChamber even before the theme layer lands and when
 * a canvas ignores the variables entirely.
 */
const CANVAS_BASE_CSS = `
html, body { margin: 0; padding: 0; min-height: 100%; }
* { box-sizing: border-box; }
body {
  background: var(--oc-background, #fff);
  color: var(--oc-foreground, #111);
  font-family: var(--oc-font, system-ui, sans-serif);
  font-size: 14px;
  line-height: 1.55;
  padding: 20px;
}
h1, h2, h3 { color: var(--oc-foreground, #111); font-weight: 600; line-height: 1.25; }
h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
h2 { font-size: 1.15rem; margin: 1.5rem 0 .5rem; }
h3 { font-size: 1rem; margin: 1rem 0 .35rem; }
p { margin: 0 0 .75rem; }
a { color: var(--oc-primary, #2563eb); }
code, pre { font-family: var(--oc-mono, ui-monospace, monospace); font-size: .92em; }
pre { background: var(--oc-subtle, #f3f4f6); border-radius: var(--oc-radius, .5625rem); padding: 10px 12px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin: 0 0 1rem; }
th, td { border: 1px solid var(--oc-border, #ddd); padding: 6px 10px; text-align: left; }
th { background: var(--oc-elevated, #f9fafb); color: var(--oc-elevated-foreground, #111); font-weight: 600; }
hr { border: 0; border-top: 1px solid var(--oc-border, #ddd); margin: 1rem 0; }

/* The kit: the simple shapes the tool description points the model at. */
.oc-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin: 0 0 1rem; }
.oc-card { background: var(--oc-elevated, #f9fafb); color: var(--oc-elevated-foreground, #111); border: 1px solid var(--oc-border, #ddd); border-radius: var(--oc-radius, .5625rem); padding: 12px 14px; }
.oc-card .oc-label { color: var(--oc-muted-foreground, #666); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 4px; }
.oc-card .oc-value { font-size: 1.35rem; font-weight: 600; line-height: 1.2; }
.oc-muted { color: var(--oc-muted-foreground, #666); }
`.trim();

/**
 * The policy as CSS plus the base look and kit: one style block the theme
 * layer (which defines the variables) follows.
 */
const policyCss = (): string => CANVAS_BASE_CSS;

export const buildCanvasDocument = (
  html: string,
  options: CanvasDocumentOptions = {},
  policy: string = CANVAS_FRAME_POLICY,
): string => {
  const source = html;
  const themeStyle = options.themeCss ? `<style>${options.themeCss}</style>` : '';
  const head = `<meta name="color-scheme" content="light dark"><style>${policyCss()}</style>${themeStyle}<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, '&quot;')}">`;
  const hasHtmlTag = /<html[\s>]/i.test(source);
  if (hasHtmlTag) {
    const headOpen = /<head[^>]*>/i;
    if (headOpen.test(source)) {
      // The author's own meta tags stay after ours, so an authored CSP can
      // only narrow what we allow.
      return source.replace(headOpen, (match) => `${match}${head}`);
    }
    const htmlOpen = /<html[^>]*>/i;
    return source.replace(htmlOpen, (match) => `${match}<head>${head}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${source}</body></html>`;
};
