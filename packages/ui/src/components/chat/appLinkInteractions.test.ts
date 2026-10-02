import { describe, expect, test } from 'bun:test';

import { attachAppLinkInteractions } from './appLinkInteractions';
import type { SessionLinkTarget } from '@/lib/sessionLinks';

const TestElement = class Element {};
const TestHTMLAnchorElement = class HTMLAnchorElement extends TestElement {};
Object.assign(globalThis, { Element: TestElement, HTMLAnchorElement: TestHTMLAnchorElement });

class TestAnchor extends HTMLAnchorElement {
  constructor(private readonly rawHref: string) {
    super();
  }

  getAttribute(name: string): string | null {
    return name === 'href' ? this.rawHref : null;
  }

  closest(): TestAnchor {
    return this;
  }
}

class TestContainer {
  listeners = new Map<string, EventListener>();

  addEventListener(name: string, listener: (event: MouseEvent) => void): void {
    // SAFETY: dispatch constructs every mouse field read by the production listener.
    this.listeners.set(name, (event) => listener(event as MouseEvent));
  }

  removeEventListener(name: string, listener: (event: MouseEvent) => void): void {
    void listener;
    this.listeners.delete(name);
  }

  dispatch(name: string, href: string, init: Partial<MouseEvent> = {}): Event {
    const event = new Event(name, { cancelable: true });
    Object.defineProperties(event, {
      target: { value: new TestAnchor(href) },
      button: { value: init.button ?? 0 },
      metaKey: { value: init.metaKey ?? false },
      ctrlKey: { value: init.ctrlKey ?? false },
      altKey: { value: init.altKey ?? false },
      shiftKey: { value: init.shiftKey ?? false },
    });
    this.listeners.get(name)?.(event);
    return event;
  }
}

const setup = (allowExternalHttp = true) => {
  const container = new TestContainer();
  const appLinks: string[] = [];
  const httpLinks: string[] = [];
  const sessionLinks: SessionLinkTarget[] = [];
  const canvasLinks: string[] = [];
  const cleanup = attachAppLinkInteractions(container, {
    allowExternalHttp,
    openAppLink: (url) => appLinks.push(url),
    openExternalHttp: (url) => httpLinks.push(url),
    openSessionLink: (target) => sessionLinks.push(target),
    openCanvasLink: (canvasId) => canvasLinks.push(canvasId),
    ownOrigins: ['https://chamber.example'],
  });
  return { container, appLinks, httpLinks, sessionLinks, canvasLinks, cleanup };
};

describe('app link interactions', () => {
  test('confirms plain, modifier, and middle-click activations', () => {
    const { container, appLinks } = setup();
    const href = 'obsidian://open?vault=Notes';

    expect(container.dispatch('click', href).defaultPrevented).toBe(true);
    expect(container.dispatch('click', href, { metaKey: true }).defaultPrevented).toBe(true);
    expect(container.dispatch('auxclick', href, { button: 1 }).defaultPrevented).toBe(true);
    expect(appLinks).toEqual([href, href, href]);
  });

  test('blocks drag activation without opening immediately', () => {
    const { container, appLinks } = setup();
    const href = 'obsidian://open?vault=Notes';

    expect(container.dispatch('dragstart', href).defaultPrevented).toBe(true);
    expect(appLinks).toEqual([]);
  });

  test('keeps HTTP modifier behavior and the disabled HTTP path unchanged', () => {
    const enabled = setup();
    const disabled = setup(false);
    const href = 'https://example.com';

    expect(enabled.container.dispatch('click', href, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(enabled.container.dispatch('click', href).defaultPrevented).toBe(true);
    expect(disabled.container.dispatch('click', href).defaultPrevented).toBe(false);
    expect(enabled.httpLinks).toEqual([href]);
    expect(disabled.httpLinks).toEqual([]);
  });

  test('opens session links in place', () => {
    const { container, sessionLinks, httpLinks } = setup();

    expect(container.dispatch('click', 'openchamber://session/ses_a?message=msg_1').defaultPrevented).toBe(true);
    expect(container.dispatch('click', 'https://chamber.example/?session=ses_b').defaultPrevented).toBe(true);
    expect(sessionLinks).toEqual([
      { sessionId: 'ses_a', messageId: 'msg_1' },
      { sessionId: 'ses_b', messageId: null },
    ]);
    expect(httpLinks).toEqual([]);
  });

  test('opens canvas links in place on every activation, without the trust dialog', () => {
    const { container, canvasLinks, appLinks } = setup();
    const href = 'canvas:cv-coverage';

    expect(container.dispatch('click', href).defaultPrevented).toBe(true);
    expect(container.dispatch('click', href, { metaKey: true }).defaultPrevented).toBe(true);
    expect(container.dispatch('auxclick', href, { button: 1 }).defaultPrevented).toBe(true);
    expect(container.dispatch('dragstart', href).defaultPrevented).toBe(true);
    // Plain and middle clicks open; a modifier click is refused in place and
    // a drag only blocks — no external handler exists for the scheme.
    expect(canvasLinks).toEqual(['cv-coverage', 'cv-coverage']);
    expect(appLinks).toEqual([]);
  });

  test('accepts both canvas link spellings and blocks junk ids without the trust dialog', () => {
    const { container, canvasLinks, appLinks } = setup();

    expect(container.dispatch('click', 'canvas://cv-coverage').defaultPrevented).toBe(true);
    expect(canvasLinks).toEqual(['cv-coverage']);
    // A `canvas:` href with a malformed id is still ours: blocked in place,
    // never confirmed as an app link and never opened.
    expect(container.dispatch('click', 'canvas:../escape').defaultPrevented).toBe(true);
    expect(canvasLinks).toEqual(['cv-coverage']);
    expect(appLinks).toEqual([]);
  });

  test('leaves a modifier click on a web session link and other origins to the browser path', () => {
    const { container, sessionLinks, httpLinks } = setup();

    expect(container.dispatch('click', 'https://chamber.example/?session=ses_b', { metaKey: true }).defaultPrevented).toBe(false);
    container.dispatch('click', 'https://elsewhere.example/?session=ses_b');
    expect(sessionLinks).toEqual([]);
    expect(httpLinks).toEqual(['https://elsewhere.example/?session=ses_b']);
  });
});
