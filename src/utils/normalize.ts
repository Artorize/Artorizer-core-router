/**
 * Convert camelCase to snake_case
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert snake_case to camelCase
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert object keys from camelCase to snake_case
 */
export function objectToSnakeCase<T extends Record<string, any>>(obj: T): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = toSnakeCase(key);
    result[snakeKey] = value;
  }

  return result;
}

/**
 * Convert object keys from snake_case to camelCase
 */
export function objectToCamelCase<T extends Record<string, any>>(obj: T): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const camelKey = toCamelCase(key);
    result[camelKey] = value;
  }

  return result;
}

/**
 * Parse comma-separated string to array
 */
export function parseCommaSeparated(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Coerce string boolean to actual boolean
 */
export function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return false;
}

/**
 * Normalize tags field (handles both array and comma-separated string)
 */
export function normalizeTags(tags?: string | string[]): string[] | undefined {
  if (!tags) return undefined;
  const parsed = parseCommaSeparated(tags);
  if (parsed.length > 25) {
    throw new Error('Too many tags (max 25)');
  }
  for (const tag of parsed) {
    if (tag.length > 50) {
      throw new Error(`Tag too long: "${tag}" (max 50 chars)`);
    }
  }
  return parsed;
}

/**
 * Normalize processors field
 */
export function normalizeProcessors(processors?: string | string[]): string[] | undefined {
  if (!processors) return undefined;
  return parseCommaSeparated(processors);
}

/**
 * Parse extra_metadata (handles both object and JSON string)
 */
export function parseExtraMetadata(extra?: string | Record<string, any>): Record<string, any> | undefined {
  if (!extra) return undefined;
  if (typeof extra === 'string') {
    try {
      return JSON.parse(extra);
    } catch {
      throw new Error('Invalid JSON in extra_metadata');
    }
  }
  return extra;
}
