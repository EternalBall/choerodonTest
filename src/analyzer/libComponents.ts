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
  role: 'lov-field' | 'edit-table' | 'upload' | 'checkbox' | 'wrapper' | 'drawer' | 'composite-field' | 'opaque-control';
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

/**
 * 库入口（barrel）按导出名登记：键为「包名/导入路径」。登记依据为全仓库实际用法（括号内为引用处数）：
 * wrapper = 以 JSX 包裹子节点使用，子节点按普通节点继续解析（透明性按用法推断，DOM 未核实）；
 * drawer = 带 visible/onClose 的抽屉，内容按需渲染；composite-field / opaque-control = 自带 DOM 的组合控件。
 */
export const KNOWN_LIB_EXPORTS: Record<string, Record<string, KnownLibComponent>> = {
  'hcm-components-front/@components/tarzan-ui': {
    TarzanSpin: { role: 'wrapper', evidence: '<TarzanSpin dataSet spinning>包裹 Header/Content（53 处）' },
    LocaleProvider: { role: 'wrapper', evidence: '<LocaleProvider>包裹整页内容（16 处）' },
    ExpandCardC7n: { role: 'wrapper', evidence: '<ExpandCardC7n title showExpandIcon>内含 Form 等子节点（31 处）' },
    C7nFormItemSort: { role: 'wrapper', evidence: '<C7nFormItemSort name itemWidth>内含 <Lov name/><Select name/>（50 处）' },
    TarzanDrawer: { role: 'drawer', evidence: '<TarzanDrawer visible onOk onClose title>（28 处），按 visible 渲染' },
    AttributeDrawer: { role: 'opaque-control', evidence: '<AttributeDrawer type kid className canEdit/> 无子节点（73 处）' },
    LovSelect: { role: 'composite-field', evidence: '<LovSelect dataSet name selectName/>：Lov 与 Select 合一（10 处）' },
  },
};

export function lookupKnownLib(
  pkg: string,
  spec: string,
  prefix: string,
  importedName?: string,
): { key: string; info: KnownLibComponent } | null {
  const rest = spec.slice(prefix.length).replace(/^\//, '');
  const key = `${pkg}/${prefix}/${rest}`.replace(/\/+$/, '');
  const byExport = importedName ? KNOWN_LIB_EXPORTS[key]?.[importedName] : undefined;
  if (byExport) return { key: `${key}#${importedName}`, info: byExport };
  const info = KNOWN_LIB_COMPONENTS[key];
  return info ? { key, info } : null;
}
