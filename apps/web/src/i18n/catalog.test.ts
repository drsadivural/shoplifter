// Guards: (1) generated catalog matches design/, (2) every UI string used in src/ has Japanese.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractKeys, sourceFiles } from '../../scripts/i18n-keys.mjs';
import { errorMessageKey } from '../api/hooks';
import { ApiError } from '../api/client';
import { CHANNEL_LABEL } from '../components/domain';
import { DEPENDENCY_TEXT } from '../components/states';
import { WEB_SCREENS } from '../screens.generated';
import { NAV } from '../routes.meta';
import { CATALOGS, hasTranslation } from './index';
import designJa from './design-ja.generated.json';

const repo = resolve(__dirname, '../../../..');

describe('design catalog', () => {
  it('is in sync with design/ja.json and design/screens.json (run npm run sync:design)', () => {
    const ja = JSON.parse(readFileSync(resolve(repo, 'design/ja.json'), 'utf8')) as Record<string, string>;
    for (const [k, v] of Object.entries(ja)) expect((designJa as Record<string, string>)[k]).toBe(v);
    const screens = JSON.parse(readFileSync(resolve(repo, 'design/screens.json'), 'utf8')) as { platform: string; id: string; route: string }[];
    const web = screens.filter((s) => s.platform === 'web');
    expect(WEB_SCREENS.map((s) => `${s.id} ${s.route}`)).toEqual(web.map((s) => `${s.id} ${s.route}`));
    expect(WEB_SCREENS).toHaveLength(54);
  });

  it('every catalog field of every web screen has Japanese', () => {
    const missing = WEB_SCREENS.flatMap((s) => s.fields.filter((f) => !hasTranslation('ja', f)).map((f) => `${s.id}: ${f}`));
    expect(missing).toEqual([]);
  });
});

describe('app strings', () => {
  it('every literal t() key in src/ has a Japanese translation', () => {
    const keys = new Set<string>();
    for (const f of sourceFiles()) for (const k of extractKeys(readFileSync(f, 'utf8'))) keys.add(k);
    const missing = [...keys].filter((k) => !hasTranslation('ja', k));
    expect(missing).toEqual([]);
    expect(keys.size).toBeGreaterThan(200);
  });

  it('dynamic keys (nav, roles, channels, dependencies, API errors) have Japanese', () => {
    const dynamic = [
      ...NAV.flatMap((g) => [g.labelKey, ...g.items.map((i) => i.labelKey)]),
      ...['viewer', 'responder', 'investigator', 'store_admin', 'org_admin'].map((r) => `role|${r}`),
      ...Object.values(CHANNEL_LABEL),
      ...Object.values(DEPENDENCY_TEXT).flatMap((d) => [d.title, d.body]),
      ...[0, 403, 404, 409, 413, 415, 422, 429, 500, 503].map((status) =>
        errorMessageKey(new ApiError({ status, code: status === 0 ? 'network_error' : 'x', message: 'm' })),
      ),
      errorMessageKey(new ApiError({ status: 0, code: 'timeout', message: 'm' })),
      errorMessageKey(new ApiError({ status: 403, code: 'csrf_failed', message: 'm' })),
    ];
    expect(dynamic.filter((k) => !hasTranslation('ja', k))).toEqual([]);
  });

  it('Japanese strings keep their {placeholders}', () => {
    const bad = Object.entries(CATALOGS.ja).filter(([k, v]) => {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      return ph(k.split('|').pop()!) !== ph(v) && !k.startsWith('field_error|');
    });
    expect(bad).toEqual([]);
  });
});
