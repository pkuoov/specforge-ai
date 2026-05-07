import type { FunctionParam, FunctionSignature } from './types.js';

const EXPORT_FN_REGEX =
  /export\s+(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+?))?\s*\{/g;

const EXPORT_ARROW_REGEX =
  /export\s+(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*([^=>{]+?))?\s*=>/g;

const JSDOC_REGEX = /\/\*\*[\s\S]*?\*\//g;

function parseParams(raw: string): FunctionParam[] {
  if (!raw.trim()) return [];
  return raw.split(',').map((p) => {
    const trimmed = p.trim();
    const optional = trimmed.includes('?');
    const [nameRaw, ...typeParts] = trimmed.replace('?', '').split(':');
    const name = (nameRaw ?? '').trim();
    const type = typeParts.join(':').trim() || 'unknown';
    const [typeName, defaultRaw] = type.split('=');
    return {
      name,
      type: (typeName ?? type).trim(),
      optional,
      defaultValue: defaultRaw?.trim(),
    };
  });
}

function extractJsdoc(source: string, fnIndex: number): string | undefined {
  const preceding = source.slice(0, fnIndex);
  const matches = [...preceding.matchAll(JSDOC_REGEX)];
  const last = matches.at(-1);
  if (!last) return undefined;
  const docEnd = (last.index ?? 0) + last[0].length;
  const gap = preceding.slice(docEnd).trim();
  return gap.length === 0 ? last[0] : undefined;
}

export function extractFunctions(source: string): FunctionSignature[] {
  const results: FunctionSignature[] = [];
  const seen = new Set<string>();

  for (const match of source.matchAll(EXPORT_FN_REGEX)) {
    const name = match[1] ?? '';
    if (seen.has(name)) continue;
    seen.add(name);

    const isAsync = /export\s+async\s+function/.test(match[0]);
    const params = parseParams(match[3] ?? '');
    const returnType = (match[4] ?? 'unknown').trim();
    const jsdoc = extractJsdoc(source, match.index ?? 0);

    results.push({ name, params, returnType, isAsync, jsdoc, isExported: true });
  }

  for (const match of source.matchAll(EXPORT_ARROW_REGEX)) {
    const name = match[1] ?? '';
    if (seen.has(name)) continue;
    seen.add(name);

    const isAsync = /=\s*async\s*\(/.test(match[0]);
    const params = parseParams(match[2] ?? '');
    const returnType = (match[3] ?? 'unknown').trim();
    const jsdoc = extractJsdoc(source, match.index ?? 0);

    results.push({ name, params, returnType, isAsync, jsdoc, isExported: true });
  }

  return results;
}
