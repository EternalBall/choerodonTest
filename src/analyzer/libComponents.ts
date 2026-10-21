import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

/**
 * 库组件（源码不在仓库内，来自 node_modules 的 hzero-front / hcm-components-front 等）的归属与登记。
 * 归属来自根 tsconfig 的 paths；登记项只记「已核实的事实」（导入路径、角色、用法特征），
 * DOM 结构未核实，所以绑定状态一律是 needs_probe，不产出 CSS。
 */

/** 前缀（如 '@components'）→ 库包名（如 'hcm-components-front'）。只收指向 node_modules 的 paths */
export async function loadLibAliases(repoRoot: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = await fs.readFile(path.join(repoRoot, 'tsconfig.json'), 'utf8');
  } catch {
    return out;
  }
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', text);
  const paths = (parsed.config?.compilerOptions?.paths ?? {}) as Record<string, string[]>;
  for (const [k, targets] of Object.entries(paths)) {
    const m = (targets[0] ?? '').match(/node_modules\/([^/]+)\//);
    if (!m) continue;
    out[k.replace(/\/\*$/, '')] = m[1];
  }
  return out;
}

/** import 说明符 → 命中的库别名（最长前缀优先） */
export function matchLibAlias(spec: string, libAliases: Record<string, string>): { prefix: string; pkg: string } | null {
  let best: { prefix: string; pkg: string } | null = null;
  for (const [prefix, pkg] of Object.entries(libAliases)) {
    if (spec === prefix || spec.startsWith(prefix + '/')) {
      if (!best || prefix.length > best.prefix.length) best = { prefix, pkg };
    }
  }
  return best;
}

export type KnownLibComponent = {
  /** 角色，供下游决定探测方式 */
  role: 'lov-field' | 'edit-table' | 'upload' | 'checkbox';
  /** 已核实的用法依据（仓库内实际写法） */
  evidence: string;
};

/**
 * 已登记的库组件，键为「包名/导入路径」。登记依据：全仓库 import 次数与抽样用法
 * （Lov 120 处、EditTable 80、Checkbox 24、Upload 约 35）。DOM 未核实。
 */
export const KNOWN_LIB_COMPONENTS: Record<string, KnownLibComponent> = {
  'hzero-front/components/Lov': {
    role: 'lov-field',
    evidence: "<Lov code=\"SPUC.DEDUCTION_SUPPLIER\" textField=\"…\" queryParams={…} />，常包在 getFieldDecorator(...) 里",
  },
  'hzero-front/components/EditTable': {
    role: 'edit-table',
    evidence: '<EditTable {...tableProps} />，表格属性由外部对象展开传入',
  },
  'hzero-front/components/Checkbox': { role: 'checkbox', evidence: '<Checkbox onChange={…}>文案</Checkbox>' },
  'hzero-front/components/Upload': { role: 'upload', evidence: '<UploadModal {...UploadModalProps} />' },
  'hzero-front/components/Upload/index': { role: 'upload', evidence: '<UploadModal {...UploadModalProps} />' },
  'hzero-front/components/Upload/UploadButton': { role: 'upload', evidence: '<Upload …/>（源码注释标注该组件已不再维护）' },
};

export function lookupKnownLib(pkg: string, spec: string, prefix: string): { key: string; info: KnownLibComponent } | null {
  const rest = spec.slice(prefix.length).replace(/^\//, '');
  const key = `${pkg}/${prefix}/${rest}`.replace(/\/+$/, '');
  const info = KNOWN_LIB_COMPONENTS[key];
  return info ? { key, info } : null;
}
