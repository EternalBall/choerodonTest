import path from 'node:path';
import ts from 'typescript';
import type { FactValue, FieldFact, PageModel } from '../core/schema.js';
import { compactExpr, evalValue, intlDefault, propName, scriptKind, unwrap } from './staticExtract.js';

type Field = PageModel['forms'][number]['fields'][number];

/** JSX 上值得记录的字段控件属性（其余如 onChange 回调不记，避免噪声） */
const FIELD_PROPS = new Set([
  'disabled', 'readOnly', 'required', 'newLine', 'colSpan', 'label', 'lookupCode', 'lovCode',
  'multiple', 'range', 'min', 'max', 'maxLength', 'precision', 'step',
]);
/** DS 字段里纳入结构模型的静态属性 */
const DS_ATTRS = new Set([
  'type', 'label', 'required', 'lookupCode', 'lovCode', 'bind', 'defaultValue', 'trueValue', 'falseValue',
  'min', 'max', 'maxLength', 'precision', 'step', 'dynamicProps', 'lovPara', 'ignore', 'format', 'multiple',
]);
const BUTTON_TAGS = new Set(['Button', 'PermissionButton']);

const base = (file: string) => path.basename(file).replace(/\.[^.]+$/, '');

function tagName(el: ts.JsxOpeningLikeElement, sf: ts.SourceFile): string {
  return el.tagName.getText(sf);
}

function attrMap(el: ts.JsxOpeningLikeElement, sf: ts.SourceFile): Map<string, { text: string; lit?: string }> {
  const m = new Map<string, { text: string; lit?: string }>();
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name)) continue;
    const init = a.initializer;
    if (!init) {
      m.set(a.name.text, { text: 'true', lit: 'true' });
    } else if (ts.isStringLiteral(init)) {
      m.set(a.name.text, { text: init.text, lit: init.text });
    } else if (ts.isJsxExpression(init) && init.expression) {
      const e = unwrap(init.expression);
      const lit = ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined;
      m.set(a.name.text, { text: lit ?? compactExpr(init.expression, sf), lit });
    }
  }
  return m;
}

/** 表达式里引用到的其他字段名：record.get('x') / toData()[0].x */
function refsOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\.get\(\s*['"](\w+)['"]\s*\)/g)) out.add(m[1]!);
  for (const m of text.matchAll(/toData\(\)\[0\]\s*(?:\|\|\s*\{\})?\)?\.(\w+)/g)) out.add(m[1]!);
  return [...out];
}

/** JSX 元素里的可见文案：纯文本 或 intl.get().d('默认') */
function textOf(node: ts.JsxElement, sf: ts.SourceFile): string | undefined {
  const parts: string[] = [];
  for (const c of node.children) {
    if (ts.isJsxText(c)) {
      const t = c.text.replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    } else if (ts.isJsxExpression(c) && c.expression) {
      const d = intlDefault(unwrap(c.expression));
      if (d) parts.push(d);
    }
  }
  void sf;
  return parts.join('') || undefined;
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const n = (seen.get(it.id) ?? 0) + 1;
    seen.set(it.id, n);
    return n === 1 ? it : { ...it, id: `${it.id}#${n}` };
  });
}

/**
 * 页面结构模型：从 JSX/DS 静态提取表单、字段（含属性/依赖/带出）、页签、按钮、抽屉、表格。
 * 全部确定性，不经 LLM；同源码两次提取结果一致。
 */
export function extractPageModel(
  files: { relativePath: string; content: string }[],
  facts: FieldFact[],
): PageModel {
  const factsByName = new Map<string, FieldFact[]>();
  for (const f of facts.filter((x) => x.group === 'fields')) {
    factsByName.set(f.name, [...(factsByName.get(f.name) ?? []), f]);
  }
  const pickFact = (name: string, ds?: string): FieldFact | undefined => {
    const list = factsByName.get(name);
    if (!list?.length) return undefined;
    const hit = ds ? list.find((x) => x.ds.toLowerCase() === ds.toLowerCase()) : undefined;
    return hit ?? list[0];
  };

  const forms: PageModel['forms'] = [];
  const tabs: PageModel['tabs'] = [];
  const buttons: PageModel['buttons'] = [];
  const drawers: PageModel['drawers'] = [];
  const tables: PageModel['tables'] = [];
  const panels: NonNullable<PageModel['panels']> = [];

  for (const f of [...files].sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1))) {
    const kind = scriptKind(f.relativePath);
    if (kind === undefined) continue;
    const sf = ts.createSourceFile(f.relativePath, f.content, ts.ScriptTarget.Latest, true, kind);
    const file = f.relativePath;

    const collectFields = (root: ts.Node, ds: string | undefined): Field[] => {
      const fields: Field[] = [];
      const walk = (n: ts.Node) => {
        if (ts.isJsxElement(n) && tagName(n.openingElement, sf) === 'Form' && n !== root) return; // 嵌套表单单独算
        const el = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : undefined;
        if (el) {
          const attrs = attrMap(el, sf);
          const nm = attrs.get('name')?.lit;
          const tag = tagName(el, sf);
          if (nm && tag !== 'Form' && !BUTTON_TAGS.has(tag)) {
            const props: Record<string, string> = {};
            for (const [k, v] of attrs) if (FIELD_PROPS.has(k)) props[k] = v.text;
            const fact = pickFact(nm, ds);
            const dsAttrs: Record<string, FactValue> = {};
            for (const [k, v] of Object.entries(fact?.attrs ?? {})) if (DS_ATTRS.has(k)) dsAttrs[k] = v;
            const bind = typeof dsAttrs.bind === 'string' ? dsAttrs.bind.split('.')[0] : undefined;
            const deps = new Set<string>();
            for (const t of [...Object.values(props), JSON.stringify(dsAttrs.dynamicProps ?? '')]) {
              refsOf(t).forEach((r) => r !== nm && deps.add(r));
            }
            const fld: Field = { name: nm, control: tag };
            if (Object.keys(props).length) fld.props = props;
            if (Object.keys(dsAttrs).length) fld.ds_attrs = dsAttrs;
            if (deps.size) fld.depends_on = [...deps].sort();
            if (bind && bind !== nm) fld.derived_from = [bind];
            fields.push(fld);
          }
        }
        ts.forEachChild(n, walk);
      };
      ts.forEachChild(root, walk);
      return fields;
    };

    const visit = (node: ts.Node, container: string) => {
      let next = container;
      // Modal.open({...}) 视为抽屉/弹窗容器，名字取被赋值的变量
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sf) === 'Modal' &&
        node.expression.name.text === 'open'
      ) {
        let name = 'modal';
        const p = node.parent;
        if (ts.isBinaryExpression(p) && ts.isIdentifier(p.left)) name = p.left.text;
        else if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) name = p.name.text;
        let title: string | undefined;
        const arg = node.arguments[0] && unwrap(node.arguments[0]);
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const t = arg.properties.find((x) => ts.isPropertyAssignment(x) && propName(x.name, sf) === 'title');
          if (t && ts.isPropertyAssignment(t)) {
            const v = evalValue(t.initializer, sf);
            title = typeof v === 'string' ? v : undefined;
          }
        }
        drawers.push({ id: `${base(file)}/${name}`, ...(title ? { title } : {}), file });
        next = name;
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const el = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = tagName(el, sf);
        const attrs = attrMap(el, sf);
        if (tag === 'Form' && ts.isJsxElement(node)) {
          const ds = attrs.get('dataSet')?.text ?? attrs.get('record')?.text;
          forms.push({
            id: `${base(file)}/${next}/${ds ?? 'form'}`,
            file,
            container: next,
            ...(ds ? { ds } : {}),
            ...(attrs.get('disabled') ? { disabled: attrs.get('disabled')!.text } : {}),
            fields: collectFields(node, attrs.get('dataSet')?.text),
          });
        } else if (tag === 'Panel') {
          const key = attrs.get('key')?.lit ?? '';
          const hdr = el.attributes.properties.find(
            (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === 'header',
          );
          let title: string | undefined;
          if (hdr?.initializer && ts.isJsxExpression(hdr.initializer) && hdr.initializer.expression) {
            title = intlDefault(unwrap(hdr.initializer.expression));
          } else if (hdr?.initializer && ts.isStringLiteral(hdr.initializer)) title = hdr.initializer.text;
          if (key || title) panels.push({ id: `${base(file)}/${key || title}`, key, ...(title ? { title } : {}), file });
        } else if (tag === 'TabPane') {
          const key = attrs.get('key')?.lit ?? '';
          const tabAttr = el.attributes.properties.find(
            (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === 'tab',
          );
          let title: string | undefined;
          if (tabAttr?.initializer && ts.isJsxExpression(tabAttr.initializer) && tabAttr.initializer.expression) {
            title = intlDefault(unwrap(tabAttr.initializer.expression));
          } else if (tabAttr?.initializer && ts.isStringLiteral(tabAttr.initializer)) title = tabAttr.initializer.text;
          if (key) tabs.push({ id: `${base(file)}/${key}`, key, ...(title ? { title } : {}), file });
        } else if (BUTTON_TAGS.has(tag)) {
          const text = ts.isJsxElement(node) ? textOf(node, sf) : undefined;
          const icon = attrs.get('icon')?.lit;
          const onClick = attrs.get('onClick')?.text;
          const perm = attrs.get('permissionList')?.text.match(/code:\s*([^,}]+)/)?.[1]?.trim();
          buttons.push({
            // 身份取图标/处理函数名，文案只是属性：按钮改名不会变成“删一个加一个”
            id: `${base(file)}/${next}/${icon ?? (onClick && onClick.length <= 40 ? onClick : undefined) ?? text ?? tag}`,
            tag,
            ...(text ? { text } : {}),
            ...(icon ? { icon } : {}),
            ...(onClick ? { on_click: onClick } : {}),
            ...(attrs.get('disabled') ? { disabled: attrs.get('disabled')!.text } : {}),
            ...(perm ? { permission: perm } : {}),
            container: next,
            file,
          });
        } else if (tag === 'Table') {
          const ds = attrs.get('dataSet')?.text;
          const colAttr = el.attributes.properties.find(
            (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === 'columns',
          );
          const columns: { name: string; editor: boolean }[] = [];
          const scan = (n: ts.Node) => {
            if (ts.isArrayLiteralExpression(n)) {
              for (const e of n.elements) {
                const o = unwrap(e);
                if (!ts.isObjectLiteralExpression(o)) continue;
                const nm = o.properties.find((x) => ts.isPropertyAssignment(x) && propName(x.name, sf) === 'name');
                const nmv = nm && ts.isPropertyAssignment(nm) ? unwrap(nm.initializer) : undefined;
                if (nmv && ts.isStringLiteral(nmv)) {
                  columns.push({
                    name: nmv.text,
                    editor: o.properties.some((x) => x.name && propName(x.name, sf) === 'editor'),
                  });
                }
              }
            }
            ts.forEachChild(n, scan);
          };
          if (colAttr) {
            scan(colAttr);
            // columns={columns}：追到同文件里的变量声明
            const ex = colAttr.initializer && ts.isJsxExpression(colAttr.initializer) ? colAttr.initializer.expression : undefined;
            if (ex && ts.isIdentifier(ex) && !columns.length) {
              const find = (n: ts.Node): void => {
                if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ex.text && n.initializer) scan(n.initializer);
                ts.forEachChild(n, find);
              };
              find(sf);
            }
          }
          tables.push({ id: `${base(file)}/${next}/${ds ?? 'table'}`, file, ...(ds ? { ds } : {}), columns });
        }
      }
      ts.forEachChild(node, (c) => visit(c, next));
    };
    visit(sf, 'page');
  }

  const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    forms: dedupe(forms).sort(byId).map((f) => ({ ...f, fields: [...f.fields].sort((a, b) => (a.name < b.name ? -1 : 1)) })),
    tabs: dedupe(tabs).sort(byId),
    buttons: dedupe(buttons).sort(byId),
    drawers: dedupe(drawers).sort(byId),
    tables: dedupe(tables).sort(byId),
    panels: dedupe(panels).sort(byId),
  };
}
