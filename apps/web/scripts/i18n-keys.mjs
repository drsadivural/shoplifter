#!/usr/bin/env node
// Lists i18n keys used in src/ (t('...'), labelKey: '...', [tone, '...'] tables) that lack a
// Japanese translation. Usage: node scripts/i18n-keys.mjs [--all]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
export function sourceFiles(dir = root) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/generated/.test(f) && !/i18n\/app\.ts$/.test(p) ? [p] : [];
  });
}
export function extractKeys(src) {
  const keys = new Set();
  const patterns = [
    /\bt\(\s*'((?:[^'\\]|\\.)*)'/g,
    /\bt\(\s*"((?:[^"\\]|\\.)*)"/g,
    /labelKey:\s*'((?:[^'\\]|\\.)*)'/g,
    /\[\s*'(?:ok|info|warning|critical|neutral)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\]/g,
    /\bkey:\s*'((?:[^'\\]|\\.)*)'\s*,\s*tone/g,
    /\['((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\]/g,
    /\b(?:title|body|key):\s*'((?:[^'\\]|\\.)*)'/g,
    /\breturn\s+'((?:[^'\\]|\\.)*)'/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) for (const g of m.slice(1)) if (g) keys.add(g.replace(/\\'/g, "'"));
  // Keep only translatable text: has a space, an uppercase letter, a context bar or a placeholder.
  return new Set([...keys].filter((k) => /[ A-Z|{]/.test(k) && !/^[a-z_]+\/[a-z]+$/.test(k) && !k.startsWith('/') && !k.includes('${')));
}
if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) {
  const all = new Set();
  for (const f of sourceFiles()) for (const k of extractKeys(readFileSync(f, 'utf8'))) all.add(k);
  console.log([...all].sort().join('\n'));
}
