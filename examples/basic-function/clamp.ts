/**
 * Clamps a value between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Sums all numbers in an array.
 */
export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Normalizes a string: trims whitespace and lowercases.
 */
export function normalizeString(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Returns the first element of an array, or undefined if empty.
 */
export function first<T>(arr: T[]): T | undefined {
  return arr[0];
}
