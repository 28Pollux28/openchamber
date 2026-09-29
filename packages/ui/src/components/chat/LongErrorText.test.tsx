import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { I18nProvider } from '@/lib/i18n';
import { LongErrorText } from './LongErrorText';
import { getLongErrorPreview } from './longErrorPreview';

const renderError = (text: string) => renderToStaticMarkup(
  <I18nProvider>
    <LongErrorText text={text}>
      {(visibleText) => <p data-visible-length={visibleText.length}>{visibleText}</p>}
    </LongErrorText>
  </I18nProvider>,
);

describe('getLongErrorPreview', () => {
  test('keeps a short error whole', () => {
    expect(getLongErrorPreview('Unexpected end of JSON input')).toBeNull();
    expect(getLongErrorPreview('x'.repeat(1_000))).toBeNull();
  });

  test('cuts a long single-line error to its first characters', () => {
    const preview = getLongErrorPreview(`JSON parsing failed: ${'{"a":1}'.repeat(30_000)}`);
    expect(preview?.startsWith('JSON parsing failed: ')).toBe(true);
    expect(preview?.endsWith('…')).toBe(true);
    expect(preview?.length).toBeLessThanOrEqual(601);
  });

  test('cuts a long multi-line error to its first lines', () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index}`);
    const preview = getLongErrorPreview(lines.join('\n'));
    expect(preview).toBe(`${lines.slice(0, 8).join('\n')}…`);
  });

  test('does not split an emoji at the cut', () => {
    const preview = getLongErrorPreview(`${'a'.repeat(599)}😀${'b'.repeat(2_000)}`);
    expect(preview).toBe(`${'a'.repeat(599)}…`);
  });
});

describe('LongErrorText', () => {
  test('shows a short error in full with no button', () => {
    const markup = renderError('Model unavailable');
    expect(markup).toBe('<p data-visible-length="17">Model unavailable</p>');
  });

  test('starts a long error collapsed, without rendering the full text', () => {
    const text = `Opencode failed to send message with error: ${'x'.repeat(200_000)}`;
    const markup = renderError(text);
    expect(markup).not.toContain('x'.repeat(1_000));
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('>Show full error</button>');
  });
});
