import { describe, expect, test } from 'bun:test';

import { canvasI18n } from './canvas.i18n';

const locales = ['en', 'de', 'fr', 'nl', 'es', 'ja', 'pt-BR', 'uk', 'ko', 'pl', 'zh-CN', 'zh-TW', 'tr'] as const;

describe('agent canvas translations', () => {
  test('provides every key in every supported locale, translated', () => {
    const english: Record<string, string> = canvasI18n.en;
    const keys = Object.keys(english);
    expect(keys.length).toBeGreaterThan(0);
    for (const locale of locales) {
      const dictionary: Record<string, string> = canvasI18n[locale];
      for (const key of keys) {
        const value = dictionary[key];
        expect(value).toBeTruthy();
        if (locale !== 'en') expect(value).not.toBe(english[key]);
      }
    }
  });
});
