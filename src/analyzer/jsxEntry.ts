/**
 * 大文件分析：以 JSX/render 出口为入口，抽取本地子组件与页头文案，
 * 对巨石 index 做切片，避免只截前 N 字漏掉尾部页头按钮（如工序配置）。
 */

export const MEGALITH_CHARS = 8_000;
/** 巨石切片预算（含头 + JSX 摘要） */
export const MEGALITH_SLICE_CHARS = 12_000;
/** 子组件整文件上限 */
export const CHILD_FULL_MAX_CHARS = 40_000;

/** 常见库组件 / HTML，不当地址解析目标 */
const JSX_SKIP = new Set([
  'Fragment',
  'Suspense',
  'StrictMode',
  'Provider',
  'Consumer',
  'Router',
  'Switch',
  'Route',
  'Redirect',
  'Link',
  'NavLink',
  'Outlet',
  'Form',
  'Table',
  'Modal',
  'Tabs',
  'TabPane',
  'Tab',
  'Button',
  'Select',
  'Input',
  'Lov',
  'Tooltip',
  'Icon',
  'Spin',
  'Row',
  'Col',
  'Card',
  'Drawer',
  'DataSet',
  'PermissionButton',
  'Header',
  'Content',
  'PageHeaderWrapper',
  'ContentPro',
]);

export type JsxEntryInfo = {
  /** JSX 中出现的 PascalCase 标签名 */
  jsxTags: string[];
  /** 本地相对 import 路径（./Foo 或 ../Foo），对应被 JSX 使用的绑定 */
  localImportPaths: string[];
  /** PermissionButton / .d('…') 等入口文案 */
  entryLabels: string[];
};

export type PrioritizedSnippet = {
  relativePath: string;
  absolutePath: string;
  content: string;
  /** 越大越先入 prompt */
  priority: number;
  note?: string;
};

export function isLikelyPageIndex(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/');
  const base = norm.split('/').pop() || '';
  if (!/^index\.(tsx|jsx|ts|js)$/i.test(base)) return false;
  return /List|Detail|Create|Edit|Form|Drawer|Assignment|Workshop|Platform/i.test(norm);
}

export function isMegalith(content: string, threshold = MEGALITH_CHARS): boolean {
  return content.length > threshold;
}

/**
 * 从源码抽取：本地 import ↔ JSX 标签，以及页头类文案。
 */
export function extractJsxEntryInfo(content: string): JsxEntryInfo {
  const jsxTags = [...new Set(matchAll(content, /<([A-Z][A-Za-z0-9]*)\b/g).map((m) => m[1]))].filter(
    (t) => !JSX_SKIP.has(t),
  );

  /** 本地 default / namespace import：Name → ./path */
  const localDefaults = new Map<string, string>();
  const importRe =
    /import\s+(?:type\s+)?(?:(\w+)|(\w+)\s*,\s*\{[^}]*\}|\*\s+as\s+(\w+))\s+from\s+['"](\.[^'"]+)['"]/g;
  for (const m of matchAll(content, importRe)) {
    const name = m[1] || m[2] || m[3];
    const spec = m[4];
    if (name && spec) localDefaults.set(name, spec);
  }
  // import Foo from './x' 已覆盖；再扫 import { X as Y } from './x' 中用于 JSX 的别名较少，MVP 跳过

  const localImportPaths = [
    ...new Set(jsxTags.map((t) => localDefaults.get(t)).filter((p): p is string => Boolean(p))),
  ].sort();

  const entryLabels = extractEntryLabels(content);

  return { jsxTags, localImportPaths, entryLabels };
}

function extractEntryLabels(content: string): string[] {
  const labels = new Set<string>();
  // PermissionButton 块内的 .d('文案')
  const btnRe = /<PermissionButton\b[\s\S]*?<\/PermissionButton>/g;
  for (const block of matchAll(content, btnRe)) {
    for (const d of matchAll(block[0], /\.d\(\s*['"]([^'"]{1,40})['"]\s*\)/g)) {
      labels.add(d[1]);
    }
    for (const m of matchAll(block[0], /meaning:\s*['"]([^'"]{1,60})['"]/g)) {
      labels.add(m[1]);
    }
  }
  // 自封闭少见；再扫 meaning: '详情页-xxx'
  for (const m of matchAll(content, /meaning:\s*['"]((?:详情|列表|页头)?[^'"]{0,40})['"]/g)) {
    if (/按钮|配置|检验|保存|编辑|领取|处置|报废|工序/.test(m[1])) labels.add(m[1]);
  }
  return [...labels].sort();
}

/**
 * 巨石文件切片：文件头 + JSX/render 出口摘要 + 入口标签列表。
 */
export function sliceMegalithForJsxEntry(
  content: string,
  opts?: { sliceChars?: number },
): { content: string; info: JsxEntryInfo } {
  const sliceChars = opts?.sliceChars ?? MEGALITH_SLICE_CHARS;
  const info = extractJsxEntryInfo(content);

  const headerBudget = Math.min(2_500, Math.floor(sliceChars * 0.2));
  const header = content.slice(0, headerBudget);

  const jsxRegion = extractJsxRegion(content);
  const labelsBlock =
    info.entryLabels.length || info.jsxTags.length || info.localImportPaths.length
      ? [
          '/* === JSX_ENTRY (engine) ===',
          info.entryLabels.length ? `entry_labels: ${info.entryLabels.join(' | ')}` : null,
          info.jsxTags.length ? `jsx_tags: ${info.jsxTags.join(', ')}` : null,
          info.localImportPaths.length
            ? `local_children: ${info.localImportPaths.join(', ')}`
            : null,
          '（巨石文件已按 JSX 入口切片；子组件见同目录其它 FILE 块）',
          '=== */',
          '',
        ]
          .filter(Boolean)
          .join('\n')
      : '';

  const remaining = sliceChars - labelsBlock.length - header.length - 80;
  const jsxPart =
    remaining > 0
      ? jsxRegion.length > remaining
        ? jsxRegion.slice(-remaining) // 页头按钮常在 return 末尾，保留尾部
        : jsxRegion
      : '';

  const merged = `${labelsBlock}// --- file head ---\n${header}\n\n// --- jsx / render region (tail-biased) ---\n${jsxPart}\n`;
  return {
    content: merged.slice(0, sliceChars),
    info,
  };
}

/** 取最后一个顶层感的 return ( … ) 或 render() { return ( */
function extractJsxRegion(content: string): string {
  const markers = [
    ...matchAll(content, /\brender\s*\(\s*\)\s*\{/g).map((m) => m.index ?? 0),
    ...matchAll(content, /\breturn\s*\(/g).map((m) => m.index ?? 0),
  ].sort((a, b) => a - b);

  if (!markers.length) {
    // 无 return：退回文件尾部（页头常在那）
    return content.slice(Math.max(0, content.length - MEGALITH_SLICE_CHARS));
  }

  // 取靠后的 return（页面主出口通常最靠后）
  const start = markers[markers.length - 1]!;
  return content.slice(start);
}

/**
 * 将相对 import 解析为相对 project root 的路径候选（带常见扩展名）。
 */
export function resolveLocalImportCandidates(
  fromFileRel: string,
  importSpec: string,
): string[] {
  const fromDir = fromFileRel.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
  let joined = pathPosixResolve(fromDir, importSpec);
  if (joined.endsWith('/')) joined = joined.slice(0, -1);
  const exts = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
  return exts.map((e) => joined + e);
}

function pathPosixResolve(fromDir: string, spec: string): string {
  const parts = (fromDir ? fromDir.split('/') : []).filter(Boolean);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

/**
 * 拼装顺序：子组件/services 优先，巨石切片靠后，同优先级按路径排序。
 */
export function sortSnippetsForPrompt<T extends { relativePath: string; priority?: number }>(
  snippets: T[],
): T[] {
  return [...snippets].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pb !== pa) return pb - pa;
    return a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0;
  });
}

/** 默认优先级：按路径启发 */
export function defaultPriority(rel: string, note?: string): number {
  if (note === 'jsx-child-full') return 100;
  if (note === 'jsx-megalith-slice') return 20;
  const lower = rel.replace(/\\/g, '/').toLowerCase();
  if (/\/services\//.test(lower) || /services\.(ts|js)$/.test(lower)) return 80;
  if (/stories\//.test(lower) || /detailDS|listDS|\/ds\//i.test(lower)) return 70;
  if (/component\.tsx?$/i.test(lower) || /drawer|modal|config/i.test(lower)) return 60;
  if (isLikelyPageIndex(rel)) return 30;
  return 40;
}

function matchAll(text: string, re: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const r = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) out.push(m);
  return out;
}
