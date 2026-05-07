import ts from 'typescript';
import type { FunctionParam, FunctionSignature } from '@testgen/core';

function isNodeExported(node: ts.Node): boolean {
  return (
    (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0
  );
}

function typeToString(type: ts.Type, checker: ts.TypeChecker): string {
  return checker.typeToString(
    type,
    undefined,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType
  );
}

function extractParams(
  params: ts.NodeArray<ts.ParameterDeclaration>,
  checker: ts.TypeChecker
): FunctionParam[] {
  return params.map((p) => {
    const name = ts.isIdentifier(p.name) ? p.name.text : '...rest';
    const optional = !!p.questionToken || !!p.initializer;
    const type = checker.getTypeAtLocation(p);
    const typeStr = typeToString(type, checker);
    const defaultValue = p.initializer
      ? p.initializer.getText()
      : undefined;

    return { name, type: typeStr, optional, defaultValue };
  });
}

function extractJsdoc(node: ts.Node): string | undefined {
  const tags = ts.getJSDocCommentsAndTags(node);
  if (tags.length === 0) return undefined;
  return tags
    .map((t) => t.getText())
    .join('\n')
    .trim();
}

function extractFromFunctionDeclaration(
  node: ts.FunctionDeclaration,
  checker: ts.TypeChecker
): FunctionSignature | null {
  if (!node.name || !isNodeExported(node)) return null;

  const name = node.name.text;
  const isAsync = !!(
    ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async
  );
  const params = extractParams(node.parameters, checker);
  const returnType = node.type
    ? node.type.getText()
    : typeToString(
        checker.getReturnTypeOfSignature(
          checker.getSignatureFromDeclaration(node)!
        ),
        checker
      );

  return {
    name,
    params,
    returnType: returnType.replace(/\s+/g, ' ').trim(),
    isAsync,
    jsdoc: extractJsdoc(node),
    isExported: true,
  };
}

function extractFromVariableStatement(
  node: ts.VariableStatement,
  checker: ts.TypeChecker
): FunctionSignature[] {
  if (!isNodeExported(node)) return [];
  const results: FunctionSignature[] = [];

  for (const decl of node.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name)) continue;
    if (!decl.initializer) continue;

    const init = decl.initializer;
    const isArrow = ts.isArrowFunction(init);
    const isFnExpr = ts.isFunctionExpression(init);
    if (!isArrow && !isFnExpr) continue;

    const fn = init as ts.ArrowFunction | ts.FunctionExpression;
    const name = decl.name.text;
    const isAsync = !!(
      ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async ||
      fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    );
    const params = extractParams(fn.parameters, checker);
    const sig = checker.getSignatureFromDeclaration(fn);
    const returnType = fn.type
      ? fn.type.getText()
      : sig
      ? typeToString(checker.getReturnTypeOfSignature(sig), checker)
      : 'unknown';

    results.push({
      name,
      params,
      returnType: returnType.replace(/\s+/g, ' ').trim(),
      isAsync,
      jsdoc: extractJsdoc(decl),
      isExported: true,
    });
  }

  return results;
}

export interface ExtractOptions {
  tsConfigPath?: string;
}

export function extractFunctionsFromAST(
  filePath: string,
  options: ExtractOptions = {}
): FunctionSignature[] {
  const compilerOptions: ts.CompilerOptions = options.tsConfigPath
    ? (() => {
        const cfg = ts.readConfigFile(options.tsConfigPath, ts.sys.readFile);
        return ts.parseJsonConfigFileContent(cfg.config, ts.sys, '.')
          .options;
      })()
    : {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
      };

  const program = ts.createProgram([filePath], compilerOptions);
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`testgen: could not open source file: ${filePath}`);
  }

  const checker = program.getTypeChecker();
  const results: FunctionSignature[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node)) {
      const sig = extractFromFunctionDeclaration(node, checker);
      if (sig) results.push(sig);
    } else if (ts.isVariableStatement(node)) {
      results.push(...extractFromVariableStatement(node, checker));
    }
  });

  return results;
}
