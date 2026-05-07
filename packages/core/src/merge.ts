export const TESTGEN_START = '// <testgen:generated>';
export const TESTGEN_END = '// </testgen:generated>';

export function wrapGeneratedTestSource(testSource: string): string {
  return `${TESTGEN_START}\n${testSource.trim()}\n${TESTGEN_END}\n`;
}

export function mergeGeneratedTestSource(existingSource: string, generatedSource: string): string {
  const wrapped = wrapGeneratedTestSource(generatedSource);
  const start = existingSource.indexOf(TESTGEN_START);
  const end = existingSource.indexOf(TESTGEN_END);

  if (start !== -1 && end !== -1 && end > start) {
    const afterEnd = end + TESTGEN_END.length;
    return `${existingSource.slice(0, start)}${wrapped}${existingSource.slice(afterEnd).replace(/^\n/, '')}`;
  }

  return `${existingSource.trimEnd()}\n\n${wrapped}`;
}
