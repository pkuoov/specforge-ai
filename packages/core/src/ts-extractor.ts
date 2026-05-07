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

    return {
      name,
      type: typeToString(ts, type, checker),
      optional,
      defaultValue,
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
  exportedNames: Set<string>
): FunctionSignature | null {
  const defaultExport = isDefaultExport(ts, node);
  const name = node.name?.text ?? (defaultExport ? 'defaultExport' : undefined);
  if (!name) return null;
  if (!isNodeExported(ts, node) && !exportedNames.has(name)) return null;

  const signature = checker.getSignatureFromDeclaration(node);
  const returnType = node.type
    ? node.type.getText()
    : signature
      ? typeToString(ts, checker.getReturnTypeOfSignature(signature), checker)
      : 'unknown';

  return {
    name,
    importName: name,
    exportKind: defaultExport ? 'default' : 'named',
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

  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    if (!hasModifier(ts, member, ts.SyntaxKind.StaticKeyword)) continue;
    const methodName = propertyNameToString(ts, member.name);
    if (!methodName) continue;
    results.push(
        signatureFromFunctionLike(ts, member, checker, {
          name: `${className}.${methodName}`,
          importName: className,
          exportKind,
          callExpression: `${className}.${methodName}`,
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

export async function extractFunctionsFromTypeScript(
  filePath: string
): Promise<FunctionSignature[]> {
  const ts: TS = await import('typescript');
  const program = ts.createProgram([filePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    allowJs: true,
    checkJs: false,
  });
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) throw new Error(`testgen: could not open source file: ${filePath}`);

  const checker = program.getTypeChecker();
  const results: FunctionSignature[] = [];
  const exportedNames = collectLocalExportNames(ts, sourceFile);

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node)) {
      const sig = extractFromFunctionDeclaration(ts, node, checker, exportedNames);
      if (sig) results.push(sig);
    } else if (ts.isVariableStatement(node)) {
      results.push(...extractFromVariableStatement(ts, node, checker, exportedNames));
    } else if (ts.isClassDeclaration(node)) {
      results.push(...extractFromClassDeclaration(ts, node, checker, exportedNames));
    } else if (ts.isModuleDeclaration(node)) {
      results.push(...extractFromNamespaceDeclaration(ts, node, checker, exportedNames));
    }
  });

  return results;
}
