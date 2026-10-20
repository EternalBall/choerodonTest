/** 递归排序 key 后 JSON 序列化，用于稳定比较 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeys(obj[k]);
  }
  return out;
}
