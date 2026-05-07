import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type * as TypeScript from 'typescript';
import type { FunctionParam, FunctionSignature } from './types.js';

type TS = typeof TypeScript;

function isNodeExported(ts: TS, node: TypeScript.Node): boolean {
  return (
    (ts.getCombinedModifierFlags(node as TypeScript.Declaration) &
      ts.ModifierFlags.Export) !==
    0
  );
}

function hasModifier(ts: TS, node: TypeScript.Node, kind: TypeScript.SyntaxKind): boolean {
  return !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === kind);
}

function isDefaultExport(ts: TS, node: TypeScript.Node): boolean {
  return hasModifier(ts, node, ts.SyntaxKind.DefaultKeyword);
}

function propertyNameToString(ts: TS, name: TypeScript.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function typeToString(ts: TS, type: TypeScript.Type, checker: TypeScript.TypeChecker): string {
  return checker.typeToString(
    type,
    undefined,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType
  );
}

function primitiveFixtureForType(typeName: string, paramName: string): unknown {
  const normalized = typeName.toLowerCase();
  const compact = normalized.replace(/\s/g, '');
  const name = paramName.toLowerCase();

  if (compact.startsWith('{')) return undefined;
  if (compact.includes('[]') || compact.includes('array')) return [1, 2, 3];
  if (/\bdate\b/.test(normalized)) return '2024-01-02T00:00:00.000Z';
  if (/\bstring\b/.test(normalized)) {
    if (name.includes('email')) return 'alice@example.com';
    if (name.includes('url')) return 'https://example.com';
    if (name.includes('id')) return 'abc-123';
    if (name.includes('name') || name.includes('title')) return 'Alice';
    return 'hello';
  }
  if (/\bnumber\b/.test(normalized)) {
    if (name.includes('min')) return 0;
    if (name.includes('max')) return 100;
    if (name.includes('count') || name.includes('total') || name.includes('size')) return 5;
    return 42;
  }
  if (/\bboolean\b/.test(normalized)) return true;
  return undefined;
}

function fixtureFromType(
  ts: TS,
  type: TypeScript.Type,
  checker: TypeScript.TypeChecker,
  paramName: string,
  depth = 0
): unknown {
  if (depth > 2) return undefined;

  const typeName = typeToString(ts, type, checker);
  const primitive = primitiveFixtureForType(typeName, paramName);
  if (primitive !== undefined) return primitive;

  const properties = checker.getPropertiesOfType(type);
  if (properties.length === 0 || properties.length > 12) return undefined;

  const fixture: Record<string, unknown> = {};
  for (const property of properties) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration) continue;
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
    const propertyTypeName = typeToString(ts, propertyType, checker);
    const value =
      primitiveFixtureForType(propertyTypeName, property.name) ??
      fixtureFromType(ts, propertyType, checker, property.name, depth + 1);
    if (value !== undefined) fixture[property.name] = value;
  }

  return Object.keys(fixture).length > 0 ? fixture : undefined;
}

function literalValueFromExpression(ts: TS, node: TypeScript.Expression | undefined): unknown {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  return undefined;
}

function literalReturnValueFromBody(
  ts: TS,
  body: TypeScript.ConciseBody | TypeScript.Block | undefined
): unknown {
  if (!body) return undefined;
  if (!ts.isBlock(body)) return literalValueFromExpression(ts, body);

  const [statement] = body.statements;
  if (body.statements.length !== 1 || !statement || !ts.isReturnStatement(statement)) {
    return undefined;
  }
  return literalValueFromExpression(ts, statement.expression);
}

function extractParams(
  ts: TS,
  params: TypeScript.NodeArray<TypeScript.ParameterDeclaration>,
  checker: TypeScript.TypeChecker
): FunctionParam[] {
  return params.map((p) => {
    const name = ts.isIdentifier(p.name) ? p.name.text : '...rest';
    const optional = !!p.questionToken || !!p.initializer;
    const type = checker.getTypeAtLocation(p);
    const defaultValue = p.initializer ? p.initializer.getText() : undefined;
    const fixtureValue = fixtureFromType(ts, type, checker, name);

    return {
      name,
      type: typeToString(ts, type, checker),
      optional,
      defaultValue,
      fixtureValue,
    };
  });
}

function extractJsdoc(ts: TS, node: TypeScript.Node): string | undefined {
  const tags = ts.getJSDocCommentsAndTags(node);
  if (tags.length === 0) return undefined;
  return tags
    .map((t) => t.getText())
    .join('\n')
    .trim();
}

function extractFromFunctionDeclaration(
  ts: TS,
  node: TypeScript.FunctionDeclaration,
  checker: TypeScript.TypeChecker,
  exportedNames: Set<string>,
  options: {
    name?: string;
    importName?: string;
    callExpression?: string;
    overloadIndex?: number;
  } = {}
): FunctionSignature | null {
  const defaultExport = isDefaultExport(ts, node);
  const baseName = node.name?.text ?? (defaultExport ? 'defaultExport' : undefined);
  const name = options.name ?? baseName;
  if (!name) return null;
  if (!baseName) return null;
  if (!isNodeExported(ts, node) && !exportedNames.has(baseName)) return null;

  const signature = checker.getSignatureFromDeclaration(node);
  const returnType = node.type
    ? node.type.getText()
    : signature
      ? typeToString(ts, checker.getReturnTypeOfSignature(signature), checker)
      : 'unknown';

  return {
    name,
    importName: options.importName ?? baseName,
    exportKind: defaultExport ? 'default' : 'named',
    callExpression: options.callExpression,
    overloadIndex: options.overloadIndex,
    literalReturnValue: literalReturnValueFromBody(ts, node.body),
    params: extractParams(ts, node.parameters, checker),
    returnType: returnType.replace(/\s+/g, ' ').trim(),
    isAsync:
      (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) !== 0,
    jsdoc: extractJsdoc(ts, node),
    isExported: true,
  };
}

function extractFromVariableStatement(
  ts: TS,
  node: TypeScript.VariableStatement,
  checker: TypeScript.TypeChecker,
  exportedNames: Set<string>
): FunctionSignature[] {
  const results: FunctionSignature[] = [];
  const statementExported = isNodeExported(ts, node);

  for (const decl of node.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
    const exportKind = isDefaultExport(ts, node) ? 'default' : 'named';
    const declarationExported = statementExported || exportedNames.has(decl.name.text);
    if (!declarationExported) continue;

    const init = decl.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      const sig = signatureFromFunctionLike(ts, init, checker, {
        name: decl.name.text,
        importName: decl.name.text,
        exportKind,
        jsdocNode: decl,
      });
      results.push(sig);
      continue;
    }

    if (ts.isObjectLiteralExpression(init) && exportKind === 'named') {
      results.push(...extractFromObjectLiteral(ts, decl.name.text, init, checker));
    }
  }

  return results;
}

function signatureFromFunctionLike(
  ts: TS,
  fn: TypeScript.ArrowFunction | TypeScript.FunctionExpression | TypeScript.MethodDeclaration,
  checker: TypeScript.TypeChecker,
  options: {
    name: string;
    importName: string;
    exportKind: 'named' | 'default';
    callExpression?: string;
    overloadIndex?: number;
    jsdocNode: TypeScript.Node;
  }
): FunctionSignature {
  const signature = checker.getSignatureFromDeclaration(fn);
  const returnType = fn.type
    ? fn.type.getText()
    : signature
      ? typeToString(ts, checker.getReturnTypeOfSignature(signature), checker)
      : 'unknown';

  return {
    name: options.name,
    importName: options.importName,
    exportKind: options.exportKind,
    callExpression: options.callExpression,
    overloadIndex: options.overloadIndex,
    literalReturnValue: literalReturnValueFromBody(ts, fn.body),
    params: extractParams(ts, fn.parameters, checker),
    returnType: returnType.replace(/\s+/g, ' ').trim(),
    isAsync:
      (ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async) !== 0 ||
      hasModifier(ts, fn, ts.SyntaxKind.AsyncKeyword),
    jsdoc: extractJsdoc(ts, options.jsdocNode),
    isExported: true,
  };
}

function extractFromObjectLiteral(
  ts: TS,
  objectName: string,
  node: TypeScript.ObjectLiteralExpression,
  checker: TypeScript.TypeChecker
): FunctionSignature[] {
  const results: FunctionSignature[] = [];

  for (const prop of node.properties) {
    if (ts.isMethodDeclaration(prop)) {
      const methodName = propertyNameToString(ts, prop.name);
      if (!methodName) continue;
      results.push(
        signatureFromFunctionLike(ts, prop, checker, {
          name: `${objectName}.${methodName}`,
          importName: objectName,
          exportKind: 'named',
          callExpression: `${objectName}.${methodName}`,
          jsdocNode: prop,
        })
      );
      continue;
    }

    if (!ts.isPropertyAssignment(prop)) continue;
    const methodName = propertyNameToString(ts, prop.name);
    if (!methodName) continue;
    const init = prop.initializer;
    if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue;
    results.push(
      signatureFromFunctionLike(ts, init, checker, {
        name: `${objectName}.${methodName}`,
        importName: objectName,
        exportKind: 'named',
        callExpression: `${objectName}.${methodName}`,
        jsdocNode: prop,
      })
    );
  }

  return results;
}

function staticMethodName(ts: TS, member: TypeScript.ClassElement): string | undefined {
  if (!ts.isMethodDeclaration(member)) return undefined;
  if (!hasModifier(ts, member, ts.SyntaxKind.StaticKeyword)) return undefined;
  return propertyNameToString(ts, member.name);
}

function extractFromClassDeclaration(
  ts: TS,
  node: TypeScript.ClassDeclaration,
  checker: TypeScript.TypeChecker,
  exportedNames: Set<string>
): FunctionSignature[] {
  const defaultExport = isDefaultExport(ts, node);
  const className = node.name?.text ?? (defaultExport ? 'DefaultExport' : undefined);
  if (!className) return [];
  if (!isNodeExported(ts, node) && !exportedNames.has(className)) return [];
  const exportKind = defaultExport ? 'default' : 'named';
  const results: FunctionSignature[] = [];
  const overloadedMethods = new Set<string>();
  const overloadIndexes = new Map<string, number>();

  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    const methodName = staticMethodName(ts, member);
    if (!methodName || member.body) continue;
    overloadedMethods.add(methodName);
  }

  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    const methodName = staticMethodName(ts, member);
    if (!methodName) continue;
    if (overloadedMethods.has(methodName) && member.body) continue;
    const overloadIndex = overloadedMethods.has(methodName)
      ? (overloadIndexes.get(methodName) ?? 0) + 1
      : undefined;
    if (overloadIndex !== undefined) overloadIndexes.set(methodName, overloadIndex);
    results.push(
      signatureFromFunctionLike(ts, member, checker, {
        name:
          overloadIndex !== undefined
            ? `${className}.${methodName} overload ${overloadIndex}`
            : `${className}.${methodName}`,
        importName: className,
        exportKind,
        callExpression: `${className}.${methodName}`,
        overloadIndex,
        jsdocNode: member,
      })
    );
  }

  return results;
}

function extractFromNamespaceDeclaration(
  ts: TS,
  node: TypeScript.ModuleDeclaration,
  checker: TypeScript.TypeChecker,
  exportedNames: Set<string>
): FunctionSignature[] {
  if (!ts.isIdentifier(node.name)) return [];
  if (!isNodeExported(ts, node) && !exportedNames.has(node.name.text)) return [];
  if (!node.body || !ts.isModuleBlock(node.body)) return [];

  const namespaceName = node.name.text;
  const results: FunctionSignature[] = [];

  for (const statement of node.body.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const methodName = statement.name?.text;
      if (!methodName || !isNodeExported(ts, statement)) continue;
      const sig = extractFromFunctionDeclaration(ts, statement, checker, new Set([methodName]));
      if (!sig) continue;
      results.push({
        ...sig,
        name: `${namespaceName}.${methodName}`,
        importName: namespaceName,
        exportKind: 'named',
        callExpression: `${namespaceName}.${methodName}`,
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const inner = extractFromVariableStatement(ts, statement, checker, new Set());
      for (const sig of inner) {
        results.push({
          ...sig,
          name: `${namespaceName}.${sig.name}`,
          importName: namespaceName,
          exportKind: 'named',
          callExpression: `${namespaceName}.${sig.name}`,
        });
      }
    }
  }

  return results;
}

function collectLocalExportNames(ts: TS, sourceFile: TypeScript.SourceFile): Set<string> {
  const exportedNames = new Set<string>();

  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isExportDeclaration(node) || node.moduleSpecifier) return;
    const clause = node.exportClause;
    if (!clause || !ts.isNamedExports(clause)) return;
    for (const element of clause.elements) {
      exportedNames.add(element.propertyName?.text ?? element.name.text);
    }
  });

  return exportedNames;
}

function resolveModulePath(filePath: string, moduleSpecifier: string): string | undefined {
  if (!moduleSpecifier.startsWith('.')) return undefined;
  const base = resolve(dirname(filePath), moduleSpecifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    resolve(base, 'index.js'),
    resolve(base, 'index.jsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function reexportedSignature(
  sig: FunctionSignature,
  exportedName: string,
  alias: string
): FunctionSignature {
  if (sig.name === exportedName) {
    return {
      ...sig,
      name: alias,
      importName: alias,
      exportKind: 'named',
      callExpression: alias,
    };
  }

  if (sig.importName === exportedName && sig.callExpression?.startsWith(`${exportedName}.`)) {
    return {
      ...sig,
      name: sig.name.replace(exportedName, alias),
      importName: alias,
      exportKind: 'named',
      callExpression: sig.callExpression.replace(exportedName, alias),
    };
  }

  if (sig.importName === exportedName && sig.callExpression === exportedName) {
    return {
      ...sig,
      name: sig.name.replace(exportedName, alias),
      importName: alias,
      exportKind: 'named',
      callExpression: alias,
    };
  }

  return {
    ...sig,
    exportKind: 'named',
  };
}

function namespaceReexportedSignature(sig: FunctionSignature, alias: string): FunctionSignature {
  const targetCall = sig.callExpression ?? sig.name;
  return {
    ...sig,
    name: `${alias}.${sig.name}`,
    importName: alias,
    exportKind: 'named',
    callExpression: `${alias}.${targetCall}`,
  };
}

async function extractFromReExportDeclaration(
  ts: TS,
  filePath: string,
  node: TypeScript.ExportDeclaration,
  visited: Set<string>
): Promise<FunctionSignature[]> {
  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return [];
  const targetPath = resolveModulePath(filePath, node.moduleSpecifier.text);
  if (!targetPath) return [];

  const targetSigs = await extractFunctionsFromTypeScript(targetPath, visited);
  const clause = node.exportClause;
  if (!clause) {
    return targetSigs.filter((sig) => sig.exportKind !== 'default');
  }
  if (ts.isNamespaceExport(clause)) {
    return targetSigs
      .filter((sig) => sig.exportKind !== 'default')
      .map((sig) => namespaceReexportedSignature(sig, clause.name.text));
  }
  if (!ts.isNamedExports(clause)) return [];

  const results: FunctionSignature[] = [];
  for (const element of clause.elements) {
    const exportedName = element.propertyName?.text ?? element.name.text;
    const alias = element.name.text;
    const matches = targetSigs.filter((sig) =>
      exportedName === 'default'
        ? sig.exportKind === 'default'
        : sig.name === exportedName || sig.importName === exportedName
    );
    results.push(...matches.map((sig) => reexportedSignature(sig, exportedName, alias)));
  }
  return results;
}

function collectOverloadedFunctionNames(
  ts: TS,
  sourceFile: TypeScript.SourceFile,
  exportedNames: Set<string>
): Set<string> {
  const overloaded = new Set<string>();
  const declarationCounts = new Map<string, number>();

  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
    if (statement.body) continue;
    const name = statement.name.text;
    if (!isNodeExported(ts, statement) && !exportedNames.has(name)) continue;
    declarationCounts.set(name, (declarationCounts.get(name) ?? 0) + 1);
  }

  for (const [name, count] of declarationCounts) {
    if (count > 0) overloaded.add(name);
  }

  return overloaded;
}

export async function extractFunctionsFromTypeScript(
  filePath: string,
  visited: Set<string> = new Set()
): Promise<FunctionSignature[]> {
  const absolutePath = resolve(filePath);
  if (visited.has(absolutePath)) return [];
  visited.add(absolutePath);

  const ts: TS = await import('typescript');
  const program = ts.createProgram([absolutePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    allowJs: true,
    checkJs: false,
  });
  const sourceFile = program.getSourceFile(absolutePath);
  if (!sourceFile) throw new Error(`testgen: could not open source file: ${filePath}`);

  const checker = program.getTypeChecker();
  const results: FunctionSignature[] = [];
  const exportedNames = collectLocalExportNames(ts, sourceFile);
  const overloadedFunctionNames = collectOverloadedFunctionNames(ts, sourceFile, exportedNames);
  const overloadIndexes = new Map<string, number>();

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node)) {
      const baseName = node.name?.text;
      if (baseName && overloadedFunctionNames.has(baseName) && node.body) return;
      const overloadIndex =
        baseName && overloadedFunctionNames.has(baseName)
          ? (overloadIndexes.get(baseName) ?? 0) + 1
          : undefined;
      if (baseName && overloadIndex !== undefined) overloadIndexes.set(baseName, overloadIndex);
      const sig = extractFromFunctionDeclaration(ts, node, checker, exportedNames, {
        name:
          baseName && overloadIndex !== undefined
            ? `${baseName} overload ${overloadIndex}`
            : undefined,
        importName: baseName,
        callExpression: baseName && overloadIndex !== undefined ? baseName : undefined,
        overloadIndex,
      });
      if (sig) results.push(sig);
    } else if (ts.isVariableStatement(node)) {
      results.push(...extractFromVariableStatement(ts, node, checker, exportedNames));
    } else if (ts.isClassDeclaration(node)) {
      results.push(...extractFromClassDeclaration(ts, node, checker, exportedNames));
    } else if (ts.isModuleDeclaration(node)) {
      results.push(...extractFromNamespaceDeclaration(ts, node, checker, exportedNames));
    }
  });

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      results.push(...(await extractFromReExportDeclaration(ts, absolutePath, statement, visited)));
    }
  }

  return results;
}
