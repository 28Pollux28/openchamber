import { isAppLinkUrl, isExternalHttpUrl } from '@/lib/url';
import { parseSessionLink, type SessionLinkTarget } from '@/lib/sessionLinks';

type AppLinkInteractionOptions = {
  allowExternalHttp: boolean;
  openAppLink: (url: string) => void;
  openExternalHttp: (url: string) => void;
  /** Opens a link to a session or message of this app in place. */
  openSessionLink?: (target: SessionLinkTarget) => void;
  /** Opens an agent-built canvas in place: `canvas:<id>` / `canvas://<id>`. */
  openCanvasLink?: (canvasId: string) => void;
  /** Addresses serving this instance; web session links count only when they point at one. */
  ownOrigins?: readonly string[];
};

/**
 * The canvas links the canvas tool tells the model to write in prose. A
 * canvas reference is app state, not an external handler: without this
 * branch the scheme falls into the app-link confirmation flow, asks the user
 * to trust it, and then fails on the desktop shell — a canvas link never
 * leaves the app. The whole `canvas:` scheme is ours, so a link with a
 * malformed id is blocked in place too, never handed to the trust dialog.
 */
const CANVAS_LINK_PATTERN = /^canvas:(?:\/\/)?([a-z0-9][a-z0-9_-]{2,79})$/i;

const isCanvasLink = (href: string): boolean => /^canvas:/i.test(href.trim());

const parseCanvasLink = (href: string): string | null => {
  const match = CANVAS_LINK_PATTERN.exec(href.trim());
  return match ? match[1] : null;
};

type LinkInteractionContainer = {
  addEventListener: (type: string, listener: (event: MouseEvent) => void) => void;
  removeEventListener: (type: string, listener: (event: MouseEvent) => void) => void;
};

const findLink = (event: MouseEvent | DragEvent): HTMLAnchorElement | null => {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.getAttribute('data-openchamber-file-link') === 'true') return null;
  return anchor;
};

const interceptAppLink = (
  event: MouseEvent | DragEvent,
  openAppLink?: (url: string) => void,
): boolean => {
  if (event.defaultPrevented) return false;
  const anchor = findLink(event);
  const href = anchor?.getAttribute('href') ?? '';
  if (!isAppLinkUrl(href)) return false;

  event.preventDefault();
  event.stopPropagation();
  openAppLink?.(href);
  return true;
};

const interceptCanvasLink = (
  event: MouseEvent | DragEvent,
  options: AppLinkInteractionOptions,
  open: boolean,
): boolean => {
  if (event.defaultPrevented || !options.openCanvasLink) return false;
  const href = findLink(event)?.getAttribute('href') ?? '';
  if (!isCanvasLink(href)) return false;

  event.preventDefault();
  event.stopPropagation();
  const canvasId = parseCanvasLink(href);
  if (canvasId && open) options.openCanvasLink(canvasId);
  return true;
};

const isPlainPrimaryClick = (event: MouseEvent): boolean => (
  event.button === 0
  && !event.metaKey
  && !event.ctrlKey
  && !event.altKey
  && !event.shiftKey
);

// A session link opens in place. A web session link clicked with a modifier
// keeps the browser's own meaning (a new tab); the native deep link has no
// other place to open.
const interceptSessionLink = (event: MouseEvent, options: AppLinkInteractionOptions): boolean => {
  const openSessionLink = options.openSessionLink;
  if (!openSessionLink || event.defaultPrevented) return false;
  const href = findLink(event)?.getAttribute('href') ?? '';
  const target = parseSessionLink(href, options.ownOrigins ?? []);
  if (!target) return false;
  if (!href.toLowerCase().startsWith('openchamber:') && !isPlainPrimaryClick(event)) return false;

  event.preventDefault();
  event.stopPropagation();
  openSessionLink(target);
  return true;
};

export const attachAppLinkInteractions = (
  container: LinkInteractionContainer,
  options: AppLinkInteractionOptions,
): (() => void) => {
  const handleClick = (event: MouseEvent) => {
    if (interceptSessionLink(event, options)) return;
    // A modifier click on a canvas link keeps the open-in-place behavior —
    // the scheme has no external handler for the browser path to mean
    // anything, and letting it through would run the trust dialog.
    if (interceptCanvasLink(event, options, isPlainPrimaryClick(event))) return;
    if (interceptAppLink(event, options.openAppLink)) return;
    if (!options.allowExternalHttp || event.defaultPrevented || !isPlainPrimaryClick(event)) return;

    const href = findLink(event)?.getAttribute('href') ?? '';
    if (!isExternalHttpUrl(href)) return;
    event.preventDefault();
    event.stopPropagation();
    options.openExternalHttp(href);
  };
  const handleAuxClick = (event: MouseEvent) => {
    if (event.button === 1) {
      if (interceptCanvasLink(event, options, true)) return;
      interceptAppLink(event, options.openAppLink);
    }
  };
  const blockAlternateAppLinkActivation = (event: MouseEvent | DragEvent) => {
    if (interceptCanvasLink(event, options, false)) return;
    interceptAppLink(event);
  };

  container.addEventListener('click', handleClick);
  container.addEventListener('auxclick', handleAuxClick);
  container.addEventListener('dragstart', blockAlternateAppLinkActivation);
  return () => {
    container.removeEventListener('click', handleClick);
    container.removeEventListener('auxclick', handleAuxClick);
    container.removeEventListener('dragstart', blockAlternateAppLinkActivation);
  };
};
