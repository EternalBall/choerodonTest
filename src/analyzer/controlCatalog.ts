import ts from 'typescript';
import { pruneJsxSource, type PrunedFile, type PrunedNode } from './pruneJsx.js';

/** 源码中枚举出的一个控件：id 为 文件:行号，状态由静态结构确定，不交给 LLM 判断 */
export type CatalogControl = {
  id: string;
  file: string;
  line: number;
  tag: string;
  label: string;
  state: string; // always | data_dependent | unknown | after:<触发控件 id>
  note: string;
};

const CONTROL_TAG = /^(Button|Input|Select|Checkbox|Radio|Switch|Table|Modal|Drawer|Tabs|Tab|DatePicker|RangePicker|Upload|Pagination|TextArea|InputNumber|Dropdown|Menu|Tooltip|Form|Popconfirm)$/;
const NATIVE_CONTROL = new Set(['a', 'button', 'input', 'select', 'textarea', 'li']);
const OPEN_CALLEES = /^Modal\.(open|confirm|info|success|error|warning)$/;
const MAX_DEPTH = 3;

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
    n.text?.trim() || pick('name') || pick('placeholder') || pick('id') || pick('title') || `${n.tag}@${n.line}`,
  ).slice(0, 60);
}

/** branch 形如 `cx<条件文本>:T` 或 `<位置>:T/F`；取条件文本作为备注 */
function condNote(branch: string[] | undefined): string {
  if (!branch?.length) return '运行时条件渲染';
  return '条件：' + branch.map((b) => b.replace(/:[TF]$/, '').replace(/^cx/, '')).join(' 且 ');
}

type Range = { start: number; end: number };
type OpenSite = Range & { fn?: string };
type ClickSite = Range & { line: number; refs: Set<string> };
type CallSite = { callee: string; fn?: string };

/** 扫描源码：Modal.open 调用、onClick 属性及其引用的标识符、函数间调用关系 */
function scanOpeners(content: string, absPath: string) {
  const isJsx = /\.[jt]sx$/.test(absPath) || /\.js$/.test(absPath);
  const sf = ts.createSourceFile(absPath, content, ts.ScriptTarget.ES2022, true, isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const endLineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
  const fnName = (n: ts.Node): string | undefined => {
    for (let up = n.parent; up; up = up.parent) {
      if (ts.isVariableDeclaration(up) && ts.isIdentifier(up.name) && up.initializer &&
          (ts.isArrowFunction(up.initializer) || ts.isFunctionExpression(up.initializer))) return up.name.text;
      if (ts.isFunctionDeclaration(up) && up.name) return up.name.text;
    }
    return undefined;
  };
  const opens: OpenSite[] = [];
  const clicks: ClickSite[] = [];
  const calls: CallSite[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (OPEN_CALLEES.test(callee)) {
        opens.push({ start: lineOf(n), end: endLineOf(n), fn: fnName(n) });
      } else if (ts.isIdentifier(n.expression)) {
        calls.push({ callee: n.expression.text, fn: fnName(n) });
      }
    }
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'onClick' && n.initializer && ts.isJsxExpression(n.initializer)) {
      const refs = new Set<string>();
      const collect = (x: ts.Node) => {
        if (ts.isIdentifier(x)) refs.add(x.text);
        ts.forEachChild(x, collect);
      };
      if (n.initializer.expression) collect(n.initializer.expression);
      const el = n.parent.parent;
      clicks.push({ start: lineOf(el), end: endLineOf(el), line: lineOf(el), refs });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { opens, clicks, calls };
}

/** 从弹窗的打开点向上追溯：找到哪个 onClick 最终触发了它（最多追溯 MAX_DEPTH 层函数调用） */
function findOpenerLine(
  open: OpenSite,
  scan: ReturnType<typeof scanOpeners>,
): number | undefined {
  const inside = scan.clicks.find((c) => open.start >= c.start && open.end <= c.end);
  if (inside) return inside.line;
  let name = open.fn;
  for (let depth = 0; name && depth < MAX_DEPTH; depth++) {
    const direct = scan.clicks.find((c) => c.refs.has(name!));
    if (direct) return direct.line;
    const caller = scan.calls.find((c) => c.callee === name && c.fn && c.fn !== name);
    name = caller?.fn;
  }
  return undefined;
}

/** 遍历一个裁剪后的文件，列出其中所有控件；条件/弹窗标记沿子树继承 */
export function catalogFromPruned(pf: PrunedFile, content?: string): CatalogControl[] {
  const out: CatalogControl[] = [];
  const scan = content !== undefined ? scanOpeners(content, pf.file) : undefined;
  const walk = (n: PrunedNode, overlayIn: boolean, cond: boolean, branch: string[] | undefined) => {
    const c = n.conditional || cond;
    const b = n.branch ?? branch;
    // JSX 形式的 Modal / Drawer：自身与其子树都属于弹窗内容（显隐由外部状态控制）
    const container = /^(Modal|Drawer)$/.test(lastSeg(n.tag));
    const overlay = overlayIn || container;
    if (isControlNode(n)) {
      let state = 'always';
      let note = '';
      if (container) {
        state = 'unknown';
        note = '弹窗/抽屉容器，显示条件待确认';
      } else if (overlay) {
        const open = scan?.opens.find((o) => n.line >= o.start && n.line <= o.end);
        const openerLine = open && scan ? findOpenerLine(open, scan) : undefined;
        if (openerLine !== undefined) {
          state = `after:${pf.file}:${openerLine}`;
          note = `点击 ${pf.file}:${openerLine} 后弹出`;
        } else {
          state = 'unknown';
          note = '位于弹窗/抽屉内，未能追溯打开它的控件';
        }
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
    for (const c of catalogFromPruned(pf, f.content)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      all.push(c);
    }
  }
  return all;
}
