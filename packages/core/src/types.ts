export type TestStrategy = 'boundary' | 'happy-path' | 'error-path' | 'behavioral-mirror';

export type FailurePattern =
  | 'null-deref'
  | 'off-by-one'
  | 'logic-error'
  | 'async-error'
  | 'type-coerce'
  | 'unknown';

export interface FunctionParam {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string | undefined;
}

export interface FunctionSignature {
  name: string;
  params: FunctionParam[];
  returnType: string;
  isAsync: boolean;
  jsdoc?: string | undefined;
  isExported: boolean;
}

export interface TestExpectation {
  type: 'return' | 'throw' | 'property';
  value?: unknown;
  pattern?: string;
  errorType?: string;
}

export interface TestCase {
  strategy: TestStrategy;
  description: string;
  inputs: unknown[];
  expectation: TestExpectation;
}

export interface TestPlan {
  functionName: string;
  importPath: string;
  cases: TestCase[];
}

export interface TestResult {
  passed: boolean;
  strategy: TestStrategy;
  description: string;
  failurePattern?: FailurePattern;
  error?: string;
}

export interface FunctionReport {
  functionName: string;
  results: TestResult[];
  coverageDelta?: number;
}

export interface TestgenReport {
  sourceFile: string;
  functions: FunctionReport[];
  totalPassed: number;
  totalFailed: number;
  coverageBefore?: number;
  coverageAfter?: number;
}

export interface TestgenOptions {
  auto: boolean;
  silentIfTested: boolean;
  dryRun: boolean;
  runner: 'vitest' | 'jest';
}
