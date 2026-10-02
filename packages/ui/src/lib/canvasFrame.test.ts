import { describe, expect, test } from 'bun:test';

import { buildCanvasDocument, CANVAS_FRAME_POLICY } from './canvasFrame';

describe('buildCanvasDocument', () => {
  test('a fragment becomes a full document with the policy in the head', () => {
    const built = buildCanvasDocument('<h1>hi</h1>');
    expect(built).toContain('<!doctype html>');
    expect(built).toContain(`content="${CANVAS_FRAME_POLICY}"`);
    expect(built.endsWith('<h1>hi</h1></body></html>')).toBe(true);
  });

  test('the theme style lands before the author markup, and the policy after both', () => {
    const built = buildCanvasDocument('<p>x</p>', { themeCss: ':root{--oc-background:#000}' });
    const themeIndex = built.indexOf('--oc-background:#000');
    const policyIndex = built.indexOf(`content="${CANVAS_FRAME_POLICY}"`);
    const authorIndex = built.indexOf('<p>x</p>');
    // The CSP meta is the last thing in the head on purpose: a hostile
    // document cannot remove an earlier meta by writing one of its own, and
    // a document that shipped a CSP already had its chance before ours.
    expect(themeIndex).toBeGreaterThan(0);
    expect(authorIndex).toBeGreaterThan(themeIndex);
    expect(policyIndex).toBeGreaterThan(themeIndex);
    expect(policyIndex).toBeLessThan(authorIndex);
  });

  test('no theme layer when none is given: only the base fallbacks remain', () => {
    // --oc-success is defined only by the theme layer; the base CSS mentions
    // variables with fallbacks but never this one.
    expect(buildCanvasDocument('<p>x</p>').includes('--oc-success')).toBe(false);
    expect(buildCanvasDocument('<p>x</p>', { themeCss: ':root{--oc-success:#0a0}' }).includes('--oc-success')).toBe(true);
  });

  test('a complete document keeps its shape and gains the policy first in the head', () => {
    const source = '<!doctype html><html><head><title>T</title></head><body>x</body></html>';
    const built = buildCanvasDocument(source);
    expect(built.startsWith('<!doctype html><html><head>')).toBe(true);
    expect(built).toContain(`content="${CANVAS_FRAME_POLICY}"`);
    // The author's own tags follow ours, so their CSP can only narrow.
    expect(built.indexOf('Content-Security-Policy')).toBeLessThan(built.indexOf('<title>'));
    expect(built).toContain('<title>T</title>');
  });

  test('a document without a head gets one', () => {
    const built = buildCanvasDocument('<html><body>x</body></html>');
    expect(built).toContain(`<html><head>${'<meta name="color-scheme"'}`);
  });

  test('an authored CSP is preserved and sits after the host one', () => {
    const source = '<html><head><meta http-equiv="Content-Security-Policy" content="img-src \'none\'"></head><body>x</body></html>';
    const built = buildCanvasDocument(source);
    expect(built).toContain('img-src \'none\'');
    expect(built.indexOf(`content="${CANVAS_FRAME_POLICY}"`)).toBeLessThan(built.indexOf('img-src \'none\''));
  });

  test('quotes in the policy cannot break out of the attribute', () => {
    const built = buildCanvasDocument('<p>x</p>', undefined, 'img-src "none"');
    expect(built).toContain('&quot;none&quot;');
    expect(built).not.toContain('content="img-src "');
  });

  test('the host policy closes the network', () => {
    expect(CANVAS_FRAME_POLICY).toContain("default-src 'none'");
    expect(CANVAS_FRAME_POLICY).toContain("connect-src 'none'");
    expect(CANVAS_FRAME_POLICY).toContain("base-uri 'none'");
    expect(CANVAS_FRAME_POLICY).toContain("form-action 'none'");
    expect(CANVAS_FRAME_POLICY).not.toContain('http');
  });

  test('the base layer ships the kit the tool description names', () => {
    const built = buildCanvasDocument('<p>x</p>');
    expect(built).toContain('.oc-card');
    expect(built).toContain('.oc-grid');
    expect(built).toContain('.oc-muted');
    expect(built).toContain('oc-label');
    expect(built).toContain('oc-value');
  });
});
