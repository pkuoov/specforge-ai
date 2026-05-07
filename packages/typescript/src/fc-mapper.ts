export interface FcArbitrary {
  code: string;
  imports: string[];
}

function fc(code: string): FcArbitrary {
  return { code, imports: [] };
}

function parseArrayType(type: string): string | null {
  const readonlyMatch = type.match(/^(?:readonly\s+)?(.+)\[\]$/);
  if (readonlyMatch?.[1]) return readonlyMatch[1];
  const genericMatch = type.match(/^(?:Readonly)?Array<(.+)>$/);
  if (genericMatch?.[1]) return genericMatch[1].trim();
  return null;
}

function parseUnionTypes(type: string): string[] | null {
  // Only split on top-level | (not inside < > or ( ))
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of type) {
    if (ch === '<' || ch === '(' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === '}') depth--;
    else if (ch === '|' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.length > 1 ? parts : null;
}

function parseTupleType(type: string): string[] | null {
  const match = type.match(/^\[(.+)\]$/);
  if (!match?.[1]) return null;
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of match[1]) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.length > 0 ? parts : null;
}

function parseRecordType(type: string): [string, string] | null {
  const match = type.match(/^Record<(.+),\s*(.+)>$/);
  if (!match?.[1] || !match[2]) return null;
  return [match[1].trim(), match[2].trim()];
}

function parseObjectType(type: string): Record<string, string> | null {
  const match = type.match(/^\{(.+)\}$/s);
  if (!match?.[1]) return null;
  const fields: Record<string, string> = {};
  let depth = 0;
  let current = '';
  for (const ch of match[1]) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ';' && depth === 0) {
      const kv = current.trim();
      if (kv) {
        const colonIdx = kv.indexOf(':');
        if (colonIdx !== -1) {
          const key = kv.slice(0, colonIdx).replace(/\?$/, '').trim();
          const val = kv.slice(colonIdx + 1).trim();
          if (key) fields[key] = val;
        }
      }
      current = '';
      continue;
    }
    current += ch;
  }
  // handle last field without trailing semicolon
  const kv = current.trim();
  if (kv) {
    const colonIdx = kv.indexOf(':');
    if (colonIdx !== -1) {
      const key = kv.slice(0, colonIdx).replace(/\?$/, '').trim();
      const val = kv.slice(colonIdx + 1).trim();
      if (key) fields[key] = val;
    }
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

export function typeToFcArbitrary(type: string): FcArbitrary {
  const t = type.trim();

  // Primitives
  if (t === 'string') return fc('fc.string()');
  if (t === 'number') return fc('fc.double({ noNaN: true })');
  if (t === 'boolean') return fc('fc.boolean()');
  if (t === 'bigint') return fc('fc.bigInt()');
  if (t === 'symbol') return fc('fc.string().map(Symbol.for)');
  if (t === 'null') return fc('fc.constant(null)');
  if (t === 'undefined') return fc('fc.constant(undefined)');
  if (t === 'never') return fc('fc.constant(undefined /* never */)');
  if (t === 'unknown' || t === 'any') return fc('fc.anything()');
  if (t === 'void') return fc('fc.constant(undefined)');
  if (t === 'object') return fc('fc.object()');

  // Literal types
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return fc(`fc.constant(${t})`);
  if (/^-?\d+(\.\d+)?$/.test(t)) return fc(`fc.constant(${t})`);
  if (t === 'true' || t === 'false') return fc(`fc.constant(${t})`);

  // Array types: T[] or Array<T>
  const arrayInner = parseArrayType(t);
  if (arrayInner) {
    const inner = typeToFcArbitrary(arrayInner);
    return fc(`fc.array(${inner.code})`);
  }

  // Tuple types: [A, B, C]
  const tupleItems = parseTupleType(t);
  if (tupleItems) {
    const items = tupleItems.map((item) => typeToFcArbitrary(item).code);
    return fc(`fc.tuple(${items.join(', ')})`);
  }

  // Record<K, V>
  const recordPair = parseRecordType(t);
  if (recordPair) {
    const [k, v] = recordPair;
    const keyArb = typeToFcArbitrary(k);
    const valArb = typeToFcArbitrary(v);
    return fc(`fc.dictionary(${keyArb.code}, ${valArb.code})`);
  }

  // Union types: A | B | C
  const unionParts = parseUnionTypes(t);
  if (unionParts) {
    // Handle nullable: T | null → fc.option(T, { nil: null })
    const nonNull = unionParts.filter((p) => p !== 'null' && p !== 'undefined');
    const hasNull = unionParts.includes('null');
    const hasUndefined = unionParts.includes('undefined');

    if (nonNull.length === 1 && nonNull[0]) {
      const inner = typeToFcArbitrary(nonNull[0]);
      if (hasNull && hasUndefined) {
        return fc(`fc.option(${inner.code}, { nil: null })`);
      }
      if (hasNull) return fc(`fc.option(${inner.code}, { nil: null })`);
      if (hasUndefined) return fc(`fc.option(${inner.code})`);
    }

    const arbitraries = nonNull.map((p) => typeToFcArbitrary(p).code);
    let base = `fc.oneof(${arbitraries.join(', ')})`;
    if (hasNull) base = `fc.option(${base}, { nil: null })`;
    return fc(base);
  }

  // Object literal type: { key: Type; key2: Type2 }
  const objFields = parseObjectType(t);
  if (objFields) {
    const entries = Object.entries(objFields)
      .map(([k, v]) => `${JSON.stringify(k)}: ${typeToFcArbitrary(v).code}`)
      .join(', ');
    return fc(`fc.record({ ${entries} })`);
  }

  // Promise<T>
  const promiseMatch = t.match(/^Promise<(.+)>$/);
  if (promiseMatch?.[1]) {
    const inner = typeToFcArbitrary(promiseMatch[1].trim());
    return fc(`${inner.code}.map((v) => Promise.resolve(v))`);
  }

  // Map<K, V>
  const mapMatch = t.match(/^Map<(.+),\s*(.+)>$/);
  if (mapMatch?.[1] && mapMatch[2]) {
    const k = typeToFcArbitrary(mapMatch[1].trim());
    const v = typeToFcArbitrary(mapMatch[2].trim());
    return fc(`fc.array(fc.tuple(${k.code}, ${v.code})).map((entries) => new Map(entries))`);
  }

  // Set<T>
  const setMatch = t.match(/^Set<(.+)>$/);
  if (setMatch?.[1]) {
    const inner = typeToFcArbitrary(setMatch[1].trim());
    return fc(`fc.array(${inner.code}).map((arr) => new Set(arr))`);
  }

  // Fallback for named types, generics, etc.
  return fc('fc.anything()');
}

export function paramsToArbitraries(
  params: Array<{ type: string; name: string; optional: boolean }>
): string[] {
  return params.map((p) => {
    const arb = typeToFcArbitrary(p.type);
    if (p.optional) {
      return `fc.option(${arb.code})`;
    }
    return arb.code;
  });
}
