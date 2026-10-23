import path from 'node:path';
import ts from 'typescript';
import type { FactValue, FieldFact } from '../core/schema.js';

export type { FieldFact, FactValue };

const FIELD_GROUPS = ['fields', 'queryFields'] as const;

/** 不可求值表达式的源码文本上限，避免把整段箭头函数塞进产物 */
const EXPR_MAX_CHARS = 300;

/** 枚举常量对象：FieldType.string / FieldIgnore.clean / FieldFormat.uppercase 等，取成员名 */
const ENUM_OBJECT = /^Field[A-Z]\w*$/;

const ANONYMOUS_DS = '(anonymous)';

export function scriptKind(file: string): ts.ScriptKind | undefined {
  switch (path.extname(file).toLowerCase()) {
    case '.ts':
      return ts.ScriptKind.TS;
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.js':
      return ts.ScriptKind.JS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    default:
      return undefined;
  }
}

/** 压缩空白并截断：同一表达式换行/缩进变化不应造成 diff 噪音 */
export function compactExpr(node: ts.Node, sf: ts.SourceFile): string {
  return node.getText(sf).replace(/\s+/g, ' ').trim().slice(0, EXPR_MAX_CHARS);
}

export function propName(name: ts.PropertyName, sf: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  if (ts.isNumericLiteral(name)) return name.text;
  return name.getText(sf);
}

export function unwrap(node: ts.Expression): ts.Expression {
  let cur = node;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isSatisfiesExpression(cur) ||
    ts.isTypeAssertionExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

/** intl.get('key').d('默认中文') → '默认中文'；非该形态返回 undefined */
export function intlDefault(node: ts.Expression): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'd') return undefined;
  const inner = unwrap(callee.expression);
  if (!ts.isCallExpression(inner)) return undefined;
  const innerCallee = inner.expression;
  if (!ts.isPropertyAccessExpression(innerCallee) || innerCallee.name.text !== 'get') return undefined;
  const arg = node.arguments[0];
  if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) return arg.text;
  return undefined;
}

function evalObject(node: ts.ObjectLiteralExpression, sf: ts.SourceFile): { [k: string]: FactValue } {
  const out: { [k: string]: FactValue } = {};
  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop)) {
      out[propName(prop.name, sf)] = evalValue(prop.initializer, sf);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      out[prop.name.text] = { expr: prop.name.text };
    } else if (ts.isMethodDeclaration(prop) || ts.isGetAccessor(prop) || ts.isSetAccessor(prop)) {
      // validator(value) {...} 这类方法简写：属性名即键，值为整段源码
      out[propName(prop.name, sf)] = { expr: compactExpr(prop, sf) };
    } else {
      // 展开 ...base：无法静态展开，以源码文本为键保留，保证变化可被 diff 看到
      out[compactExpr(prop, sf)] = { expr: compactExpr(prop, sf) };
    }
  }
  return out;
}

/** 按规则把 AST 表达式转成 FactValue */
export function evalValue(raw: ts.Expression, sf: ts.SourceFile): FactValue {
  const node = unwrap(raw);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ENUM_OBJECT.test(node.expression.text)
  ) {
    return node.name.text;
  }
  const label = intlDefault(node);
  if (label !== undefined) return label;
  if (ts.isObjectLiteralExpression(node)) return evalObject(node, sf);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((e) => evalValue(e, sf));
  return { expr: compactExpr(node, sf) };
}

/** 取最近的“命名容器”：变量 / 函数 / 方法 / 类属性 */
function declaredName(node: ts.Node): string | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  return undefined;
}

export function fieldNameOf(obj: ts.ObjectLiteralExpression): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
    if (key !== 'name') continue;
    const v = unwrap(prop.initializer);
    if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) return v.text;
  }
  return undefined;
}

function extractFromFile(relativePath: string, content: string): FieldFact[] {
  const kind = scriptKind(relativePath);
  if (kind === undefined) return [];
  const sf = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, kind);
  const facts: FieldFact[] = [];

  const visit = (node: ts.Node, ds: string) => {
    const nextDs = declaredName(node) ?? ds;
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
        const group = FIELD_GROUPS.find((g) => g === key);
        const arr = unwrap(prop.initializer);
        if (!group || !ts.isArrayLiteralExpression(arr)) continue;
        for (const el of arr.elements) {
          const obj = unwrap(el);
          if (!ts.isObjectLiteralExpression(obj)) continue;
          const name = fieldNameOf(obj);
          if (name === undefined) continue;
          const attrs = evalObject(obj, sf);
          delete attrs.name;
          facts.push({ ds: nextDs, group, file: relativePath, name, attrs });
        }
      }
    }
    ts.forEachChild(node, (c) => visit(c, nextDs));
  };
  visit(sf, ANONYMOUS_DS);
  return facts;
}

/**
 * 确定性字段提取：扫描对象字面量里的 fields / queryFields 数组，
 * 每个含 name:'字符串' 的对象即一个字段，属性按 FactValue 规则静态求值。
 * 动机：字段必输/联动/值集这类事实用 AST 直接取，比 LLM 复述稳定，diff 才不会误报。
 * 输出顺序：文件路径升序，文件内按源码出现顺序。
 */
export function extractFieldFacts(
  files: { relativePath: string; content: string }[],
): FieldFact[] {
  const sorted = [...files].sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  return sorted.flatMap((f) => extractFromFile(f.relativePath, f.content));
}

/**
 * 确定性提取“实际渲染的可编辑控件”名：
 * - JSX 元素的 name="x" 属性（注释掉的 JSX 不在 AST 里，自然被排除）；
 * - columns 数组里带 editor 键的列对象（表格行内编辑）。
 */
export function extractRenderedEditableFields(
  files: { relativePath: string; content: string }[],
): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const kind = scriptKind(f.relativePath);
    if (kind === undefined) continue;
    const sf = ts.createSourceFile(f.relativePath, f.content, ts.ScriptTarget.Latest, true, kind);
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'name') {
        const init = node.initializer;
        if (init && ts.isStringLiteral(init)) out.add(init.text);
        else if (init && ts.isJsxExpression(init) && init.expression) {
          const e = unwrap(init.expression);
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) out.add(e.text);
        }
      } else if (ts.isPropertyAssignment(node) && propName(node.name, sf) === 'columns') {
        const arr = unwrap(node.initializer);
        if (ts.isArrayLiteralExpression(arr)) {
          for (const el of arr.elements) {
            const obj = unwrap(el);
            if (!ts.isObjectLiteralExpression(obj)) continue;
            const hasEditor = obj.properties.some((p) => p.name && propName(p.name, sf) === 'editor');
            const name = fieldNameOf(obj);
            if (hasEditor && name !== undefined) out.add(name);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...out].sort();
}
