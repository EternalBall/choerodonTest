import { pruneJsxSource, type PrunedFile, type PrunedNode } from './pruneJsx.js';

/** 源码中枚举出的一个控件：id 为 文件:行号，状态由静态渲染结构确定，不交给 LLM 判断 */
export type CatalogControl = {
  id: string;
  file: string;
  line: number;
  tag: string;
  label: string;
  state: 'always' | 'data_dependent' | 'unknown';
  note: string;
};

const CONTROL_TAG = /^(Button|Input|Select|Checkbox|Radio|Switch|Table|Modal|Drawer|Tabs|Tab|DatePicker|RangePicker|Upload|Pagination|TextArea|InputNumber|Dropdown|Menu|Tooltip|Form|Popconfirm)$/;
const NATIVE_CONTROL = new Set(['a', 'button', 'input', 'select', 'textarea', 'li']);

const lastSeg = (tag: string) => tag.split('.').pop() ?? tag;

export function isControlNode(n: PrunedNode): boolean {
  if (NATIVE_CONTROL.has(n.tag)) return true;
  if (CONTROL_TAG.test(lastSeg(n.tag))) return true;
  return 'onClick' in n.props;
}

const decodeEntities = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function labelOf(n: PrunedNode): string {
  const p = n.props;
  const pick = (k: string) => (typeof p[k] === 'string' || typeof p[k] === 'number' ? String(p[k]) : undefined);
  return decodeEntities(
    n.text?.trim() ||
    pick('name') ||
    pick('placeholder') ||
    pick('id') ||
    pick('title') ||
    `${n.tag}@${n.line}`
  ).slice(0, 60);
}

/** branch 形如 `cx<条件文本>:T` 或 `<位置>:T/F`；取条件文本作为备注 */
function condNote(branch: string[] | undefined): string {
  if (!branch?.length) return '运行时条件渲染';
  return '条件：' + branch.map((b) => b.replace(/:[TF]$/, '').replace(/^cx/, '')).join(' 且 ');
}

/** 遍历一个裁剪后的文件，列出其中所有控件；条件/弹窗标记沿子树继承 */
export function catalogFromPruned(pf: PrunedFile): CatalogControl[] {
  const out: CatalogControl[] = [];
  const walk = (n: PrunedNode, overlayIn: boolean, cond: boolean, branch: string[] | undefined) => {
    const c = n.conditional || cond;
    const b = n.branch ?? branch;
    // JSX 形式的 Modal / Drawer：自身与其子树都属于弹窗内容（显隐由外部状态控制）
    const container = /^(Modal|Drawer)$/.test(lastSeg(n.tag));
    const overlay = overlayIn || container;
    if (isControlNode(n)) {
      let state: CatalogControl['state'] = 'always';
      let note = '';
      if (container) {
        state = 'unknown';
        note = '弹窗/抽屉容器，显示条件待确认';
      } else if (overlay) {
        state = 'unknown';
        note = '位于弹窗/抽屉内，打开条件待确认';
      } else if (c) {
        state = 'data_dependent';
        note = condNote(b);
      }
      out.push({ id: `${pf.file}:${n.line}`, file: pf.file, line: n.line, tag: n.tag, label: labelOf(n), state, note });
    }
    for (const ch of n.children) walk(ch, overlay, c, b);
  };
  pf.roots.forEach((r, i) => walk(r, !!pf.rootOverlay[i], false, undefined));
  return out;
}

/** 对所有源码片段生成控件目录（同一 id 去重） */
export function buildControlCatalog(files: { relativePath: string; absolutePath: string; content: string }[]): CatalogControl[] {
  const seen = new Set<string>();
  const all: CatalogControl[] = [];
  for (const f of files) {
    if (!/\.(jsx?|tsx?)$/.test(f.relativePath)) continue;
    const pf = pruneJsxSource(f.content, f.relativePath, f.absolutePath);
    for (const c of catalogFromPruned(pf)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      all.push(c);
    }
  }
  return all;
}
