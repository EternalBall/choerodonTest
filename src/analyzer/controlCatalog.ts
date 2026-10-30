import ts from 'typescript';
import { pruneJsxSource, type PrunedFile, type PrunedNode } from './pruneJsx.js';

/** 源码中枚举出的一个控件：id 为 文件:行号，状态由静态结构确定，不交给 LLM 判断 */
export type CatalogControl = {
  /** 语义指纹：文件|标签|文案|所在容器|触发函数（Table 等绑定数据集的控件为 dataSet:表达式@请求地址）；同指纹冲突时追加 #序号 并 ambiguous=true（不含行号） */
  id: string;
  file: string;
  line: number;
  tag: string;
  label: string;
  state: string; // always | data_dependent | unknown | after:<触发控件 id（首个）>
  note: string;
  /** after 状态下全部直接触发控件的 id（OR 关系，任一即可打开弹窗）；首个与 state 中的一致 */
  triggers?: string[];
  ambiguous?: boolean;
};

type Draft = Omit<CatalogControl, 'id' | 'ambiguous'> & {
  handler: string;
  ctx: string;
  openerLines?: number[];
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

/** 无文案时退回组件名（不带行号），同名冲突由 buildControlCatalog 的 #序号 兜底 */
function labelOf(n: PrunedNode): string {
  const p = n.props;
  const pick = (k: string) => (typeof p[k] === 'string' || typeof p[k] === 'number' ? String(p[k]) : undefined);
  return decodeEntities(n.text?.trim() || pick('name') || pick('placeholder') || pick('id') || pick('title') || lastSeg(n.tag)).slice(0, 60);
}

/** 属性值中的文案：裁剪器已把 `.d('文案')` 解析为字面量；残留的 `{表达式}` 再从中取 .d 文案或引号内容 */
function propText(v: string | number | boolean | undefined): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  if (!v.startsWith('{')) return v;
  const m = v.match(/\.d\(\s*['"`]([^'"`]+)['"`]/) ?? v.match(/^\{\s*['"`]([^'"`]+)['"`]\s*\}$/);
  return m?.[1];
}

/** 可作为控件所在容器标识的组件：取其文案属性（title / tab / key）作为容器名 */
const CTX_TAG = /^(Modal|Drawer|Card|Form|Tabs|Tab)$/;
function ctxOf(n: PrunedNode): string | undefined {
  if (!CTX_TAG.test(lastSeg(n.tag))) return undefined;
  const t = propText(n.props.title) ?? propText(n.props.tab) ?? propText(n.props.key);
  return t ? `${lastSeg(n.tag)}:${t}` : undefined;
}

/** branch 形如 `cx<条件文本>:T` 或 `<位置>:T/F`；取条件文本作为备注 */
function condNote(branch: string[] | undefined): string {
  if (!branch?.length) return '运行时条件渲染';
  const one = (b: string) => {
    const text = b.replace(/:[TF]$/, '').replace(/^cx/, '');
    return /:F$/.test(b) ? `非(${text})` : text;
  };
  return '条件：' + branch.map(one).join(' 且 ');
}

type Range = { start: number; end: number };
type OpenSite = Range & { fn?: string; title?: string };
type ClickSite = Range & { line: number; refs: Set<string>; handler: string };
type CallSite = { callee: string; fn?: string; inEffect: boolean };

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
  /** 调用处是否位于 useEffect 回调内：页面进入时自动执行，不依赖用户点击 */
  const inEffect = (n: ts.Node): boolean => {
    for (let up = n.parent; up; up = up.parent) {
      if (ts.isCallExpression(up) && up.expression.getText(sf) === 'useEffect') return true;
    }
    return false;
  };
  /**
   * 稳定的处理函数指纹：`onClick={fn}` 取 fn；`onClick={() => fn('lit')}` 取 `fn('lit')`（区分同函数不同参数的按钮）；
   * 其余内联逻辑返回空串，不取内部标识符（否则改动内部代码即变 id）
   */
  const handlerOf = (e: ts.Expression | undefined): string => {
    if (!e) return '';
    if (ts.isIdentifier(e)) return e.text;
    const body = ts.isArrowFunction(e) || ts.isFunctionExpression(e) ? e.body : undefined;
    if (body && !ts.isBlock(body) && ts.isCallExpression(body) && ts.isIdentifier(body.expression)) {
      const a0 = body.arguments[0];
      return a0 && ts.isStringLiteral(a0) ? `${body.expression.text}('${a0.text}')` : body.expression.text;
    }
    return '';
  };
  const opens: OpenSite[] = [];
  const clicks: ClickSite[] = [];
  const calls: CallSite[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (OPEN_CALLEES.test(callee)) {
        // Modal.open({ title: intl.get(..).d('工单信息') }) 取 title 的文案作为弹窗标识
        let title: string | undefined;
        const arg = n.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const prop = arg.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'title');
          if (prop && ts.isPropertyAssignment(prop)) {
            const t = prop.initializer.getText(sf);
            const m = t.match(/\.d\(\s*['"`]([^'"`]+)['"`]/) ?? t.match(/^['"`]([^'"`]+)['"`]$/);
            title = m?.[1];
          }
        }
        opens.push({ start: lineOf(n), end: endLineOf(n), fn: fnName(n), title });
      } else if (ts.isIdentifier(n.expression)) {
        calls.push({ callee: n.expression.text, fn: fnName(n), inEffect: inEffect(n) });
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
      clicks.push({ start: lineOf(el), end: endLineOf(el), line: lineOf(el), refs, handler: handlerOf(n.initializer.expression) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { opens, clicks, calls };
}

/**
 * 从弹窗的打开点向上追溯：返回 'enter'（页面进入时自动弹出）、全部直接触发它的点击行号，或 undefined。
 * 逐层向上（BFS，深度 ≤ MAX_DEPTH）：某一层找到点击即停止，同层的多个点击都记录。
 */
function findOpenerLines(
  open: OpenSite,
  scan: ReturnType<typeof scanOpeners>,
): number[] | 'enter' | undefined {
  const inside = scan.clicks.find((c) => open.start >= c.start && open.end <= c.end);
  if (inside) return [inside.line];
  let frontier = open.fn ? [open.fn] : [];
  for (let depth = 0; frontier.length && depth < MAX_DEPTH; depth++) {
    const lines: number[] = [];
    const next: string[] = [];
    for (const name of frontier) {
      // useEffect 里调用（如页面挂载时 login()）优先于点击：进入功能即弹出
      if (scan.calls.some((c) => c.callee === name && c.inEffect)) return 'enter';
      for (const c of scan.clicks) if (c.refs.has(name) && !lines.includes(c.line)) lines.push(c.line);
      for (const c of scan.calls) if (c.callee === name && c.fn && c.fn !== name && !next.includes(c.fn)) next.push(c.fn);
    }
    if (lines.length) return lines.sort((a, b) => a - b);
    frontier = next;
  }
  return undefined;
}

/**
 * 全部源码中顶层具名函数 → 其中首个请求地址（去掉 ${} 占位与重复斜杠，如 `/v1/hme-production-capacitys/wo/dispatch/query`）。
 * 只看顶层声明，避免把函数内部的局部变量误当成函数边界。
 */
function apiByFnName(files: { content: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) {
    const decls = [...f.content.matchAll(/^(?:export\s+)?(?:const|let|var|function)\s+(\w+)/gm)];
    decls.forEach((d, i) => {
      const seg = f.content.slice(d.index ?? 0, decls[i + 1]?.index ?? f.content.length);
      const url = seg.match(/url:\s*[`'"]([^`'"]*)[`'"]/);
      if (url && !out.has(d[1])) out.set(d[1], url[1].replace(/\$\{[^}]*\}/g, '').replace(/\/{2,}/g, '/'));
    });
  }
  return out;
}

/** 单个文件中数据集变量 → 其展开的数据集函数名：`const dataSet = new DataSet({ ...tableDS() })` */
function dataSetFnByVar(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new\s+DataSet\(\s*\{\s*\.\.\.(\w+)\(\)/g)) out.set(m[1], m[2]);
  return out;
}

/** 遍历一个裁剪后的文件，列出其中所有控件（草稿，id 在 buildControlCatalog 中统一生成） */
export function draftsFromPruned(
  pf: PrunedFile,
  content?: string,
  apiOfDataSet?: (expr: string) => string | undefined,
): Draft[] {
  const out: Draft[] = [];
  const scan = content !== undefined ? scanOpeners(content, pf.file) : undefined;
  const handlerAt = (line: number): string => {
    const c = scan?.clicks.find((x) => x.line === line);
    return c ? c.handler : '';
  };
  const walk = (n: PrunedNode, overlayIn: boolean, cond: boolean, branch: string[] | undefined, ctxIn: string) => {
    const c = n.conditional || cond;
    const b = n.branch ?? branch;
    // JSX 形式的 Modal / Drawer：自身与其子树都属于弹窗内容（显隐由外部状态控制）
    const container = /^(Modal|Drawer)$/.test(lastSeg(n.tag));
    const overlay = overlayIn || container;
    // 所在容器取最近一层带文案的容器（弹窗/抽屉/页签/表单等），没有则沿用外层
    let ctx = ctxOf(n) ?? ctxIn;
    if (isControlNode(n)) {
      // Table 等绑定数据集的控件：用 dataSet 表达式（及其请求地址）区分同名表格
      let handler = handlerAt(n.line);
      if (typeof n.props.dataSet === 'string') {
        const expr = n.props.dataSet.replace(/^\{|\}$/g, '').trim();
        const api = apiOfDataSet?.(expr);
        handler = `dataSet:${expr}${api ? `@${api}` : ''}`;
      }
      let state = 'always';
      let note = '';
      let openerLines: number[] | undefined;
      if (container) {
        state = 'unknown';
        note = '弹窗/抽屉容器，显示条件待确认';
      } else if (overlay) {
        const open = scan?.opens.find((o) => n.line >= o.start && n.line <= o.end);
        if (!ctx && open?.title) ctx = `Modal.open:${open.title}`;
        const r = open && scan ? findOpenerLines(open, scan) : undefined;
        if (r === 'enter') {
          state = 'always';
          note = '进入功能时自动弹出（useEffect 挂载时调用）';
        } else if (Array.isArray(r)) {
          openerLines = r;
          state = 'after:(opener)'; // 占位，buildControlCatalog 中替换为首个触发控件的 id
          note = `点击 ${r.map((l) => `${pf.file}:${l}`).join('、')} 之一后弹出`;
        } else {
          state = 'unknown';
          note = '位于弹窗/抽屉内，未能追溯打开它的控件';
        }
      } else if (c) {
        state = 'data_dependent';
        note = condNote(b);
      }
      out.push({
        file: pf.file,
        line: n.line,
        tag: n.tag,
        label: labelOf(n),
        state,
        note,
        handler,
        ctx,
        openerLines,
      });
    }
    for (const ch of n.children) walk(ch, overlay, c, b, ctx);
  };
  pf.roots.forEach((r, i) => walk(r, !!pf.rootOverlay[i], false, undefined, ''));
  return out;
}

/** 对所有源码片段生成控件目录：生成语义指纹 id，并把 after 引用换成触发控件的 id */
export function buildControlCatalog(files: { relativePath: string; absolutePath: string; content: string }[]): CatalogControl[] {
  const drafts: Draft[] = [];
  const apiByFn = apiByFnName(files);
  for (const f of files) {
    if (!/\.(jsx?|tsx?)$/.test(f.relativePath)) continue;
    const pf = pruneJsxSource(f.content, f.relativePath, f.absolutePath);
    const fnOfVar = dataSetFnByVar(f.content);
    const apiOf = (expr: string) => {
      const fn = fnOfVar.get(expr);
      return fn ? apiByFn.get(fn) : undefined;
    };
    drafts.push(...draftsFromPruned(pf, f.content, apiOf));
  }
  // 1) 语义指纹（不含行号）；同指纹出现多次时按出现顺序加 #序号，并标记 ambiguous
  const base = (d: Draft) => `${d.file}|${d.tag}|${d.label}|${d.ctx}|${d.handler}`;
  const total = new Map<string, number>();
  for (const d of drafts) total.set(base(d), (total.get(base(d)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const idOf = new Map<string, string>(); // file:line -> id
  const controls: CatalogControl[] = drafts.map((d) => {
    const key = base(d);
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    const ambiguous = (total.get(key) ?? 1) > 1;
    const id = ambiguous ? `${key}#${k}` : key;
    idOf.set(`${d.file}:${d.line}`, id);
    return { id, file: d.file, line: d.line, tag: d.tag, label: d.label, state: d.state, note: d.note, ...(ambiguous ? { ambiguous: true } : {}) };
  });
  // 2) after 引用：把打开行号换成触发控件的语义 id；找不到则退回 unknown
  for (let i = 0; i < controls.length; i++) {
    const d = drafts[i];
    if (!d.openerLines?.length) continue;
    const targets = d.openerLines.map((l) => idOf.get(`${d.file}:${l}`)).filter((x): x is string => !!x);
    controls[i] = targets.length
      ? { ...controls[i], state: `after:${targets[0]}`, triggers: targets }
      : { ...controls[i], state: 'unknown', note: '位于弹窗/抽屉内，触发控件不在目录中' };
  }
  return controls;
}

/** 提示词中的控件目录：LLM 只能从这里取 element 的值 */
export function catalogPromptBlock(controls: CatalogControl[]): string {
  const rows = controls.map((c) => `- ${c.id} | ${c.tag} | ${c.label} | ${c.state}${c.note ? ` | ${c.note}` : ''}`);
  return [
    '【控件目录（源码静态枚举，唯一可用的控件）】',
    '步骤的 element 必须且只能取下表第一列的 id（原样复制），禁止自造名字；elements_hints 无需输出，由目录生成。',
    ...rows,
  ].join('\n');
}

/**
 * 用控件目录替换 elements_hints，并检查步骤/元操作引用的 element 是否都在目录中。
 * 不在目录中的引用原样保留并返回，供调用方记录为未验证。
 */
export function applyControlCatalog(
  raw: Record<string, unknown>,
  controls: CatalogControl[],
): { artifact: Record<string, unknown>; unverified: string[] } {
  const ids = new Set(controls.map((c) => c.id));
  const unverified = new Set<string>();
  const check = (el: unknown) => {
    if (typeof el === 'string' && el && !ids.has(el)) unverified.add(el);
  };
  const ops = Array.isArray(raw.operations) ? (raw.operations as Array<{ steps?: Array<{ element?: unknown }> }>) : [];
  for (const o of ops) for (const st of o.steps ?? []) check(st.element);
  const metas = Array.isArray(raw.meta_ops) ? (raw.meta_ops as Array<{ element?: unknown }>) : [];
  for (const m of metas) check(m.element);
  const elements_hints = controls.map((c) => ({
    ref: c.id,
    name: c.label,
    role: c.tag,
    state: c.state,
    note: c.note || undefined,
  }));
  return { artifact: { ...raw, elements_hints }, unverified: [...unverified] };
}
