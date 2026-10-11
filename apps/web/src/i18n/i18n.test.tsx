import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { detectLocale, I18nProvider, LOCALE_STORAGE_KEY, translate, useI18n } from './index';

describe('language detection', () => {
  it('uses Japanese when the browser prefers Japanese', () => {
    expect(detectLocale({ navigatorLanguages: ['ja-JP', 'en-US'] })).toBe('ja');
    expect(detectLocale({ navigatorLanguages: ['en-US', 'ja'] })).toBe('ja');
  });

  it('uses English otherwise', () => {
    expect(detectLocale({ navigatorLanguages: ['en-GB', 'fr'] })).toBe('en');
    expect(detectLocale({ navigatorLanguages: [] })).toBe('en');
    expect(detectLocale({})).toBe('en');
    // "jav" (Javanese) is not Japanese.
    expect(detectLocale({ navigatorLanguages: ['jv', 'jav'] })).toBe('en');
  });

  it('an explicit saved preference wins over the browser', () => {
    expect(detectLocale({ storedLocale: 'en', navigatorLanguages: ['ja-JP'] })).toBe('en');
    expect(detectLocale({ storedLocale: 'ja', navigatorLanguages: ['en-US'] })).toBe('ja');
  });

  it('the server preference wins over local storage and the browser', () => {
    expect(detectLocale({ serverLocale: 'en', storedLocale: 'ja', navigatorLanguages: ['ja-JP'] })).toBe('en');
    expect(detectLocale({ serverLocale: 'ja', storedLocale: 'en', navigatorLanguages: ['en-US'] })).toBe('ja');
    expect(detectLocale({ serverLocale: null, storedLocale: 'invalid', navigatorLanguages: ['ja'] })).toBe('ja');
  });

  it('provider reads localStorage before navigator.languages', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'ja');
    function Probe() {
      const { locale, t } = useI18n();
      return (
        <span>
          {locale}:{t('Open alerts')}
        </span>
      );
    }
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText('ja:未対応アラート')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ja');
  });

  it('setLocale updates <html lang> and persists the explicit choice', () => {
    let setter: (l: 'en' | 'ja') => void = () => undefined;
    function Probe() {
      const { locale, setLocale } = useI18n();
      setter = setLocale;
      return <span>{locale}</span>;
    }
    render(
      <I18nProvider initialLocale="en">
        <Probe />
      </I18nProvider>,
    );
    act(() => setter('ja'));
    expect(document.documentElement.lang).toBe('ja');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
  });
});

describe('translate', () => {
  it('uses design/ja.json for catalog field labels', () => {
    expect(translate('ja', 'Median acknowledgement')).toBe('対応開始時間の中央値');
    expect(translate('en', 'Median acknowledgement')).toBe('Median acknowledgement');
  });

  it('resolves context-qualified keys', () => {
    expect(translate('ja', 'nav|Incidents')).toBe('事案記録');
    expect(translate('ja', 'Incidents')).toBe('事案数');
    expect(translate('en', 'nav|Incidents')).toBe('Incidents');
  });

  it('falls back to English for missing Japanese and interpolates', () => {
    expect(translate('ja', 'A string nobody translated')).toBe('A string nobody translated');
    expect(translate('ja', 'ctx|Only English')).toBe('Only English');
    expect(translate('en', '{count} unread notifications', { count: 3 })).toBe('3 unread notifications');
    expect(translate('ja', '{count} unread notifications', { count: 3 })).toBe('未読の通知 3 件');
  });
});
