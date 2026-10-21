import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

/**
 * 用 TypeScript 编译器 API 把 tsx/jsx 源文件裁剪成「只含 JSX 结构 + 字面量 props」的紧凑树，
 * 供页面 DOM 结构解析（LLM 与确定性绑定共用）。不执行代码，只做静态解析。
 */

export type NodeKind = 'c7n' | 'native' | 'custom' | 'unknown';

export type PrunedNode = {
  tag: string;
  kind: NodeKind;
  /** 仅保留字面量 props；非字面量表达式记为 `{表达式原文}`（截断） */
  props: Record<string, string | number | boolean>;
  /** 直接文本子节点（含 intl.get(..).d('文案') 的默认文案） */
  text?: string;
  line: number;
  /** 渲染取决于运行时（条件 / 循环产出）：DOM 顺序与出现与否不可由源码确定 */
  conditional?: boolean;
  /** 所处的三元分支路径（'<位置>:T' / ':F'）：同一三元的 T 与 F 互斥，运行时至多渲染其一 */
  branch?: string[];
  children: PrunedNode[];
  /** custom 且已跟进展开时的来源文件（相对仓库根） */
  followedFrom?: string;
};

export type ColumnInfo = {
  name: string;
  /** renderer 内的可点击元素（a / Button 等）及其文案 */
  link?: { tag: string; text?: string };
  lock?: string;
  /** 所属列数组变量名（如 columns / lineColumns），用于对应 <Table columns={…}> */
  group?: string;
  /** 列 editor 里直接返回的 JSX 控件（标签与行号）：控件本身常无 name，字段名就是列 name */
  editors?: { tag: string; line: number }[];
};

export type PrunedFile = {
  file: string;
  imports: Record<string, string>;
  /** 本地名 → 被导入的原名（默认导入为 'default'，命名空间导入为 '*'），用于穿透 barrel 的 re-export */
  importNames: Record<string, string>;
  /** 文件内每个含 JSX 的顶层组件/函数（按源码顺序）的根 JSX */
  roots: PrunedNode[];
  /** 列配置里出现的 name（含 renderer 链接） */
  columns: ColumnInfo[];
  /** 其它 JSX（如 Modal.open 的 children、menu 变量）也都在 roots 内 */
  truncated: boolean;
  /** 根 JSX 是否位于 Modal.open / Modal.confirm 等调用参数内（弹窗内容，打开前不在 DOM） */
  rootOverlay: boolean[];
  /** 与 rootOverlay 对应：根 JSX 所处的上下文（renderer / editor / header / footer … 属性名，modal，jsxattr；主树为空串） */
  rootCtx: string[];
  /** rc-form 旧写法 getFieldDecorator('字段名')(<控件/>)：控件标签、行号与字段名 */
  decorated: { tag: string; line: number; name: string }[];
  /** 动态写法统计：JSX 展开属性 {...x} 个数、.map 回调内产出 JSX 的次数 */
  stats: { spreads: number; mapJsx: number };
  /** 未能展开的自定义组件及原因 */
  unresolved: { tag: string; source: string; reason: string }[];
};

const C7N_SOURCES = [/^choerodon-ui(\/|$)/, /^components\/Permission$/];
const MAX_NODES = 1200;
const MAX_PROP_LEN = 80;

function lineOf(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

function tagName(el: ts.JsxTagNameExpression, sf: ts.SourceFile): string {
  return el.getText(sf);
}

/** 取 intl.get(...).d('文案') / 纯字符串 / 模板字面量 的文案 */
function literalText(e: ts.Expression, sf: ts.SourceFile): string | undefined {
  if (ts.isStringLiteralLike(e)) return e.text;
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'd') {
    const a = e.arguments[0];
    if (a && ts.isStringLiteralLike(a)) return a.text;
  }
  if (ts.isParenthesizedExpression(e)) return literalText(e.expression, sf);
  return undefined;
}

function propValue(init: ts.JsxAttributeValue | undefined, sf: ts.SourceFile): string | number | boolean {
  if (!init) return true;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    const lit = literalText(e, sf);
    if (lit !== undefined) return lit;
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    const raw = e.getText(sf).replace(/\s+/g, ' ');
    return `{${raw.length > MAX_PROP_LEN ? raw.slice(0, MAX_PROP_LEN) + '…' : raw}}`;
  }
  return '{…}';
}

/** 跳过对定位无用的 props */
const SKIP_PROPS = new Set([
  'onChange', 'onRow', 'onOk', 'onCancel', 'style', 'ref', 'permissionList',
  'highLightRow', 'loading', 'onFieldEnterDown',
]);

export async function pruneJsxFile(absPath: string, repoRoot: string): Promise<PrunedFile> {
  const content = await fs.readFile(absPath, 'utf8');
  return pruneJsxSource(content, path.relative(repoRoot, absPath), absPath);
}

export function pruneJsxSource(content: string, file: string, absPath = file): PrunedFile {
  const isJsx = /\.[jt]sx$/.test(absPath) || /\.js$/.test(absPath);
  const sf = ts.createSourceFile(
    absPath,
    content,
    ts.ScriptTarget.ES2022,
    true,
    isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const imports: Record<string, string> = {};
  /** 局部解构别名：const { Panel } = Collapse → Panel → Collapse */
  const aliases: Record<string, string> = {};
  const importNames: Record<string, string> = {};
  const out: PrunedFile = { file, imports, importNames, roots: [], rootOverlay: [], rootCtx: [], decorated: [], columns: [], truncated: false, stats: { spreads: 0, mapJsx: 0 }, unresolved: [] };
  let nodeCount = 0;

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const src = st.moduleSpecifier.text;
      const c = st.importClause;
      if (!c) continue;
      if (c.name) {
        imports[c.name.text] = src;
        importNames[c.name.text] = 'default';
      }
      if (c.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) {
          imports[c.namedBindings.name.text] = src;
          importNames[c.namedBindings.name.text] = '*';
        } else {
          for (const el of c.namedBindings.elements) {
            imports[el.name.text] = src;
            importNames[el.name.text] = (el.propertyName ?? el.name).text;
          }
        }
      }
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isObjectBindingPattern(d.name) && d.initializer && ts.isIdentifier(d.initializer)) {
          for (const el of d.name.elements) {
            if (ts.isIdentifier(el.name)) aliases[el.name.text] = d.initializer.text;
          }
        }
      }
    }
  }

  const kindOf = (tag: string): NodeKind => {
    if (/^[a-z]/.test(tag)) return 'native';
    const head = tag.split('.')[0];
    const base = aliases[head] ?? head;
    const src = imports[base] ?? imports[head];
    if (!src) return 'unknown';
    if (C7N_SOURCES.some((r) => r.test(src))) return 'c7n';
    if (src.startsWith('.') || src.startsWith('@/') || src.startsWith('@components') || src.startsWith('components/')) {
      return 'custom';
    }
    return 'unknown';
  };

  const jsxChildrenOfExpr = (e: ts.Node, acc: PrunedNode[]) => {
    // 条件 / 逻辑与 / map 回调 里的 JSX
    const visit = (n: ts.Node, cond = false, branches: string[] = []) => {
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
        const got = convert(n);
        // 经过三元 / && / || / ?? / 函数调用（如 map）才到达的 JSX 是否渲染取决于运行时
        if (cond) for (const g of got) g.conditional = true;
        if (branches.length) for (const g of got) g.branch = branches;
        acc.push(...got);
        return;
      }
      const dyn =
        ts.isConditionalExpression(n) ||
        ts.isCallExpression(n) ||
        (ts.isBinaryExpression(n) &&
          [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind));
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'map') {
        let hasJsx = false;
        const probe = (x: ts.Node) => {
          if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) hasJsx = true;
          else ts.forEachChild(x, probe);
        };
        probe(n);
        if (hasJsx) out.stats.mapJsx++;
      }
      // `a && <X/>` 与 `!a && <Y/>`：同一条件文本的正反两侧互斥
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        const lt = n.left.getText(sf).replace(/\s+/g, '');
        const neg = lt.startsWith('!') && !lt.startsWith('!!');
        const id = `cx${(neg ? lt.slice(1) : lt).replace(/:/g, '_')}`;
        visit(n.left, cond, branches);
        visit(n.right, true, [...branches, `${id}:${neg ? 'F' : 'T'}`]);
        return;
      }
      if (ts.isConditionalExpression(n)) {
        visit(n.condition, cond, branches);
        visit(n.whenTrue, true, [...branches, `${n.pos}:T`]);
        visit(n.whenFalse, true, [...branches, `${n.pos}:F`]);
        return;
      }
      ts.forEachChild(n, (c) => visit(c, cond || dyn, branches));
    };
    visit(e);
  };

  const convert = (n: ts.Node): PrunedNode[] => {
    if (++nodeCount > MAX_NODES) {
      out.truncated = true;
      return [];
    }
    if (ts.isJsxFragment(n)) return convertChildren(n.children);
    if (ts.isJsxSelfClosingElement(n)) return [build(n.tagName, n.attributes, [], n)];
    if (ts.isJsxElement(n)) {
      return [build(n.openingElement.tagName, n.openingElement.attributes, n.children, n)];
    }
    return [];
  };

  const convertChildren = (children: readonly ts.JsxChild[]): PrunedNode[] => {
    const acc: PrunedNode[] = [];
    for (const c of children) {
      if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) || ts.isJsxFragment(c)) acc.push(...convert(c));
      else if (ts.isJsxExpression(c) && c.expression) jsxChildrenOfExpr(c.expression, acc);
    }
    return acc;
  };

  const build = (
    tagNode: ts.JsxTagNameExpression,
    attrs: ts.JsxAttributes,
    children: readonly ts.JsxChild[],
    whole: ts.Node,
  ): PrunedNode => {
    const tag = tagName(tagNode, sf);
    const kind = kindOf(tag);
    const props: PrunedNode['props'] = {};
    const extra: PrunedNode[] = [];
    for (const a of attrs.properties) {
      if (ts.isJsxSpreadAttribute(a)) out.stats.spreads++;
      if (!ts.isJsxAttribute(a)) continue;
      const name = a.name.getText(sf);
      // 属性里的 JSX（如 overlay={menu}/children={<Table/>}）也要保留结构
      if (a.initializer && ts.isJsxExpression(a.initializer) && a.initializer.expression) {
        const e = a.initializer.expression;
        if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e)) {
          extra.push(...convert(e));
          continue;
        }
      }
      if (SKIP_PROPS.has(name)) continue;
      const v = propValue(a.initializer, sf);
      // onClick 只保留「标识符形式的处理函数名」，内联箭头函数无定位价值
      if (name === 'onClick' && !(typeof v === 'string' && /^\{[\w.]+\}$/.test(v))) continue;
      props[name] = v;
    }
    let text: string | undefined;
    const parts: string[] = [];
    for (const c of children) {
      if (ts.isJsxText(c)) {
        const t = c.text.replace(/\s+/g, ' ').trim();
        if (t) parts.push(t);
      } else if (ts.isJsxExpression(c) && c.expression) {
        const lit = literalText(c.expression, sf);
        if (lit !== undefined) parts.push(lit);
      }
    }
    if (parts.length) text = parts.join(' ');
    const node: PrunedNode = {
      tag,
      kind,
      props,
      ...(text ? { text } : {}),
      line: lineOf(sf, whole),
      children: [...extra, ...convertChildren(children)],
    };
    return node;
  };

  /** 列配置：{ name: 'x', renderer: ... <a>…</a> } */
  const collectColumns = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      let name: string | undefined;
      let lock: string | undefined;
      let renderer: ts.Node | undefined;
      let editor: ts.Node | undefined;
      for (const p of n.properties) {
        if (!ts.isPropertyAssignment(p) && !ts.isMethodDeclaration(p)) continue;
        const k = p.name.getText(sf);
        if (k === 'name' && ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) name = p.initializer.text;
        if (k === 'lock' && ts.isPropertyAssignment(p)) lock = p.initializer.getText(sf);
        if (k === 'renderer') renderer = p;
        if (k === 'editor') editor = p;
      }
      if (name) {
        const col: ColumnInfo = { name, ...(lock ? { lock } : {}) };
        let up: ts.Node | undefined = n.parent;
        while (up && !(ts.isVariableDeclaration(up) && ts.isIdentifier(up.name))) up = up.parent;
        if (up && ts.isVariableDeclaration(up) && ts.isIdentifier(up.name)) col.group = up.name.text;
        if (renderer) {
          const found: { tag: string; text?: string }[] = [];
          const walk = (x: ts.Node) => {
            if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x)) {
              const tn = tagName(ts.isJsxElement(x) ? x.openingElement.tagName : x.tagName, sf);
              if (tn === 'a' || /Button$/.test(tn)) {
                const txt = ts.isJsxElement(x)
                  ? x.children.map((c) => (ts.isJsxText(c) ? c.text.trim() : ts.isJsxExpression(c) && c.expression ? literalText(c.expression, sf) ?? '' : '')).join(' ').trim()
                  : '';
                found.push({ tag: tn, ...(txt ? { text: txt } : {}) });
              }
            }
            ts.forEachChild(x, walk);
          };
          walk(renderer);
          if (found[0]) col.link = found[0];
        }
        if (editor) {
          const eds: { tag: string; line: number }[] = [];
          const walkEd = (x: ts.Node) => {
            if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x)) {
              eds.push({ tag: tagName(ts.isJsxElement(x) ? x.openingElement.tagName : x.tagName, sf), line: lineOf(sf, x) });
              return; // 只取最外层控件
            }
            ts.forEachChild(x, walkEd);
          };
          walkEd(editor);
          if (eds.length) col.editors = eds;
        }
        out.columns.push(col);
      }
    }
    // getFieldDecorator('x', {...})(<Ctl />)
    if (
      ts.isCallExpression(n) &&
      ts.isCallExpression(n.expression) &&
      /getFieldDecorator$/.test(n.expression.expression.getText(sf))
    ) {
      const a0 = n.expression.arguments[0];
      const jsx = n.arguments[0];
      if (a0 && ts.isStringLiteralLike(a0) && jsx && (ts.isJsxElement(jsx) || ts.isJsxSelfClosingElement(jsx))) {
        out.decorated.push({
          tag: tagName(ts.isJsxElement(jsx) ? jsx.openingElement.tagName : jsx.tagName, sf),
          line: lineOf(sf, jsx),
          name: a0.text,
        });
      }
    }
    ts.forEachChild(n, collectColumns);
  };
  collectColumns(sf);

  // 顶层：对每个声明/函数中「最外层」JSX 取根（避免重复：JSX 内部嵌套的由 convert 递归处理）
  const seen = new Set<ts.Node>();
  const findRoots = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      if (!seen.has(n)) {
        seen.add(n);
        const before = out.roots.length;
        out.roots.push(...convert(n));
        let up: ts.Node | undefined = n.parent;
        let overlay = false;
        let rctx = '';
        while (up) {
          if (ts.isCallExpression(up) && /^(Modal|Drawer)\.\w+$|^(modal|drawer)\w*$/.test(up.expression.getText(sf))) {
            overlay = true;
            rctx = /^(Drawer\.|drawer)/.test(up.expression.getText(sf)) ? 'drawer' : 'modal';
            break;
          }
          // 回调属性里的 JSX（renderer / editor / expandedRowRenderer / 任意 JSX 属性）：随行/随需渲染，不在主树里
          if (
            ts.isJsxAttribute(up) ||
            (ts.isPropertyAssignment(up) && /^(renderer|editor|expandedRowRenderer|header|footer|title|children)$/.test(up.name.getText(sf)))
          ) {
            overlay = true;
            rctx = ts.isJsxAttribute(up) ? 'jsxattr' : (up as ts.PropertyAssignment).name.getText(sf);
            // Modal.open({ children / footer / title: <JSX/> })：属性只是弹窗配置，真正的上下文是弹窗
            if (/^(children|footer|title)$/.test(rctx)) {
              for (let a: ts.Node | undefined = up.parent; a; a = a.parent) {
                if (ts.isCallExpression(a) && /^(Modal|Drawer)\.\w+$|^(modal|drawer)\w*$/.test(a.expression.getText(sf))) {
                  rctx = /^(Drawer\.|drawer)/.test(a.expression.getText(sf)) ? 'drawer' : 'modal';
                  break;
                }
              }
            }
            break;
          }
          up = up.parent;
        }
        for (let i = before; i < out.roots.length; i++) {
          out.rootOverlay[i] = overlay;
          out.rootCtx[i] = rctx;
        }
      }
      return; // 不再深入（子 JSX 已被 convert 递归）
    }
    ts.forEachChild(n, findRoots);
  };
  findRoots(sf);

  return out;
}

/** 解析相对 import 到实际文件（.tsx/.ts/.jsx/.js/index.*） */
export type ResolveOptions = {
  /** 别名前缀 → 绝对目录（如 '@' → <pkg>/src）；仅本地目录，库别名不放这里 */
  aliases?: Record<string, string>;
  /** 跨入口复用的裁剪缓存（按绝对路径） */
  cache?: Map<string, PrunedFile>;
};

/** 把 import 说明符落到绝对基路径：相对路径，或命中本地别名（'@' 需 '@/' 前缀） */
export function baseFromSpec(fromFile: string, spec: string, aliases?: Record<string, string>): string | null {
  if (spec.startsWith('.')) return path.resolve(path.dirname(fromFile), spec);
  for (const [k, dir] of Object.entries(aliases ?? {})) {
    if (spec === k) return dir;
    if (spec.startsWith(k + '/')) return path.join(dir, spec.slice(k.length + 1));
  }
  return null;
}

export async function resolveRelativeImport(
  fromFile: string,
  spec: string,
  aliases?: Record<string, string>,
): Promise<string | null> {
  const base = baseFromSpec(fromFile, spec, aliases);
  if (!base) return null;
  const exts = ['.tsx', '.jsx', '.ts', '.js'];
  for (const e of exts) {
    try {
      await fs.access(base + e);
      return base + e;
    } catch {
      /* next */
    }
  }
  for (const e of exts) {
    try {
      await fs.access(path.join(base, 'index' + e));
      return path.join(base, 'index' + e);
    } catch {
      /* next */
    }
  }
  return null;
}

export type PrunedPage = {
  entry: string;
  files: PrunedFile[];
  followed: { from: string; tag: string; to: string; depth: number }[];
};

/** 从入口文件出发，跟进相对路径的自定义组件（深度≤maxDepth，防环） */
export async function prunePage(
  entryAbs: string,
  repoRoot: string,
  maxDepth = 2,
  ropts: ResolveOptions = {},
): Promise<PrunedPage> {
  const files: PrunedFile[] = [];
  const followed: PrunedPage['followed'] = [];
  const visited = new Set<string>();

  const walk = async (abs: string, depth: number) => {
    if (visited.has(abs)) return;
    visited.add(abs);
    let cached = ropts.cache?.get(abs);
    if (!cached) {
      cached = await pruneJsxFile(abs, repoRoot);
      ropts.cache?.set(abs, cached);
    }
    // 缓存对象共享，unresolved 按本次遍历重算，避免多入口重复累加
    const pf: PrunedFile = { ...cached, unresolved: [] };
    files.push(pf);
    const tags = new Set<string>();
    const collect = (nodes: PrunedNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'custom') tags.add(n.tag.split('.')[0]);
        collect(n.children);
      }
    };
    collect(pf.roots);
    for (const tag of tags) {
      const spec = pf.imports[tag];
      if (!spec) continue;
      let target = await resolveRelativeImport(abs, spec, ropts.aliases);
      if (target && pf.importNames[tag] && pf.importNames[tag] !== '*') {
        target = await retargetBarrel(target, pf.importNames[tag], ropts.aliases);
      }
      if (!target) {
        pf.unresolved.push({
          tag,
          source: spec,
          reason: spec.startsWith('.') ? '相对路径无法解析' : baseFromSpec(abs, spec, ropts.aliases) ? '别名路径无法解析到文件' : '非本地路径（库/未配置别名），未展开',
        });
        continue;
      }
      if (depth >= maxDepth) {
        pf.unresolved.push({ tag, source: spec, reason: `超过跟进深度 ${maxDepth}` });
        continue;
      }
      followed.push({ from: pf.file, tag, to: path.relative(repoRoot, target), depth: depth + 1 });
      await walk(target, depth + 1);
    }
  };
  await walk(entryAbs, 0);
  return { entry: path.relative(repoRoot, entryAbs), files, followed };
}

/**
 * 穿透 barrel：target 文件若是 `export { default as X } from './X'` / `export { X } from './Y'` 这类转发，
 * 返回 imported 名对应的真实文件；不是转发则原样返回。
 */
export async function retargetBarrel(target: string, importedName: string, aliases?: Record<string, string>): Promise<string> {
  let text: string;
  try {
    text = await fs.readFile(target, 'utf8');
  } catch {
    return target;
  }
  if (!/export\s*\{/.test(text)) return target;
  const sf = ts.createSourceFile(target, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    if (st.exportClause.elements.some((e) => e.name.text === importedName)) {
      const next = await resolveRelativeImport(target, st.moduleSpecifier.text, aliases);
      if (next) return next;
    }
  }
  return target;
}

/** 多入口合并：共享 visited，同一文件只裁剪一次 */
export async function prunePages(entriesAbs: string[], repoRoot: string, maxDepth = 2, ropts: ResolveOptions = {}): Promise<PrunedPage> {
  const merged: PrunedPage = { entry: entriesAbs.map((e) => path.relative(repoRoot, e)).join(','), files: [], followed: [] };
  const done = new Set<string>();
  for (const e of entriesAbs) {
    const p = await prunePage(e, repoRoot, maxDepth, ropts);
    for (const f of p.files) {
      if (done.has(f.file)) continue;
      done.add(f.file);
      merged.files.push(f);
    }
    for (const fl of p.followed) {
      if (!merged.followed.some((x) => x.from === fl.from && x.tag === fl.tag)) merged.followed.push(fl);
    }
  }
  return merged;
}

/** 紧凑文本树，供 LLM 阅读 */
export function renderPrunedTree(pf: PrunedFile): string {
  const lines: string[] = [];
  const walk = (n: PrunedNode, d: number) => {
    const props = Object.entries(n.props)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`)
      .join(' ');
    lines.push(`${'  '.repeat(d)}<${n.tag}> [${n.kind}] L${n.line}${props ? ' ' + props : ''}${n.text ? ` "${n.text}"` : ''}`);
    n.children.forEach((c) => walk(c, d + 1));
  };
  pf.roots.forEach((r, i) => {
    lines.push(`# root ${i + 1}`);
    walk(r, 0);
  });
  if (pf.columns.length) {
    lines.push('# columns');
    for (const c of pf.columns) {
      lines.push(`  ${c.group ?? '?'}.${c.name}${c.link ? ` link=<${c.link.tag}>${c.link.text ? ` "${c.link.text}"` : ''}` : ''}${c.lock ? ` lock=${c.lock}` : ''}`);
    }
  }
  return lines.join('\n');
}
