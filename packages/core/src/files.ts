import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function normalizePath(path: string): string {
  return path.split('\\').join('/');
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let out = '^';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charAt(i);
    const next = normalized.charAt(i + 1);
    if (ch === '*' && next === '*') {
      out += '.*';
      i++;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{') {
      const end = normalized.indexOf('}', i);
      if (end !== -1) {
        const body = normalized
          .slice(i + 1, end)
          .split(',')
          .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
          .join('|');
        out += `(${body})`;
        i = end;
      } else {
        out += '\\{';
      }
    } else {
      out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  out += '$';
  return new RegExp(out);
}

function matchesAny(path: string, patterns: string[]): boolean {
  const normalized = normalizePath(path);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function isSourceFile(path: string): boolean {
  const normalized = normalizePath(path);
  if (!SOURCE_EXTENSIONS.has(extname(normalized))) return false;
  return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized) && !normalized.endsWith('.d.ts');
}

export function expandTargets(
  targetPath: string,
  options: { include: string[]; exclude: string[]; rootDir?: string }
): string[] {
  const absolute = resolve(targetPath);
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const stat = statSync(absolute);

  if (stat.isFile()) {
    const rel = normalizePath(relative(rootDir, absolute));
    if (!isSourceFile(absolute)) return [];
    if (matchesAny(rel, options.exclude)) return [];
    return [absolute];
  }

  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const rel = normalizePath(relative(rootDir, fullPath));
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
        if (matchesAny(`${rel}/`, options.exclude) || matchesAny(rel, options.exclude)) continue;
        visit(fullPath);
      } else if (entry.isFile()) {
        if (!isSourceFile(fullPath)) continue;
        if (matchesAny(rel, options.exclude)) continue;
        if (options.include.length > 0 && !matchesAny(rel, options.include)) continue;
        files.push(fullPath);
      }
    }
  };

  visit(absolute);
  return files.sort();
}
