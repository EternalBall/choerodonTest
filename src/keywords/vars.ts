/** 运行时变量：跨步骤传递（同 case 内），如 create 写入 materialCode 供详情回查 */

export type VarMap = Record<string, string>;

const VAR_RE = /\$\{\s*vars\.([A-Za-z0-9_]+)\s*\}/g;
const ENV_RE = /\$\{\s*(?:ENV\.|env:)?([A-Z0-9_]+)\s*\}/g;

export function interpolateString(input: string, vars: VarMap): string {
  let out = input.replace(VAR_RE, (_, key: string) => {
    if (vars[key] == null || vars[key] === '') {
      throw new Error(
        `未定义变量 \${vars.${key}}（请先 setVar，或走 create→详情完整链路）`,
      );
    }
    return vars[key];
  });
  out = out.replace(ENV_RE, (_, key: string) => process.env[key] ?? '');
  return out;
}

export function interpolateDeep<T>(input: T, vars: VarMap): T {
  if (typeof input === 'string') return interpolateString(input, vars) as T;
  if (Array.isArray(input)) return input.map((v) => interpolateDeep(v, vars)) as T;
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, vars);
    }
    return out as T;
  }
  return input;
}

/** 若字符串含未解析的 vars 引用则返回 true */
export function hasUnresolvedVars(input: unknown): boolean {
  if (typeof input === 'string') return /\$\{\s*vars\./.test(input);
  if (Array.isArray(input)) return input.some(hasUnresolvedVars);
  if (input && typeof input === 'object') {
    return Object.values(input as object).some(hasUnresolvedVars);
  }
  return false;
}
