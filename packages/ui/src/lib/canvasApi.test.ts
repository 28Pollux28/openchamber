import { describe, expect, test } from 'bun:test';

import { parseCanvasToolResult } from './canvasApi';

describe('parseCanvasToolResult', () => {
  test('parses a successful create', () => {
    const result = parseCanvasToolResult(JSON.stringify({
      schemaVersion: 1,
      ok: true,
      action: 'canvas.update',
      data: { id: 'cv-1', title: 'Coverage', version: 1, created: true, hint: '...' },
    }));
    expect(result?.ok).toBe(true);
    expect(result?.data).toEqual({ id: 'cv-1', title: 'Coverage', version: 1, created: true, hint: '...' });
  });

  test('parses a failure and keeps the message', () => {
    const result = parseCanvasToolResult(JSON.stringify({
      schemaVersion: 1,
      ok: false,
      action: 'canvas.update',
      error: { message: 'html is required' },
    }));
    expect(result?.ok).toBe(false);
    expect(result?.error?.message).toBe('html is required');
  });

  test('junk, wrong shapes, and empty content are null, never a guess', () => {
    expect(parseCanvasToolResult('not json')).toBeNull();
    expect(parseCanvasToolResult('{"ok":true}')).toBeNull();
    expect(parseCanvasToolResult('')).toBeNull();
    expect(parseCanvasToolResult(undefined)).toBeNull();
  });
});
