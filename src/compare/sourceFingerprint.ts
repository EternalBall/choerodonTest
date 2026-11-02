import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const EXTS = new Set(['.js', '.jsx', '.ts', '.tsx']);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (EXTS.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

/**
 * 扫描目录下所有 JS/TS 文件，得到「具名函数 → 规范化源码哈希」。
 * 规范化：去掉注释与多余空白，只反映代码逻辑变化，注释改动不计入。
 * 同名函数出现多处时，哈希合并计算。
 */
export async function fingerprintFunctions(dir: string): Promise<Map<string, string>> {
  const printer = ts.createPrinter({ removeComments: true });
  const bodies = new Map<string, string[]>();
  for (const file of await walk(dir)) {
    const text = await fs.readFile(file, 'utf8');
    const kind = path.extname(file).startsWith('.ts') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const add = (name: string, node: ts.Node) => {
      const norm = printer.printNode(ts.EmitHint.Unspecified, node, sf).replace(/\s+/g, ' ').trim();
      bodies.set(name, [...(bodies.get(name) ?? []), norm]);
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        add(node.name.text, node.initializer);
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        add(node.name.text, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const out = new Map<string, string>();
  for (const [name, list] of bodies) {
    out.set(name, crypto.createHash('sha1').update([...list].sort().join('\n')).digest('hex').slice(0, 12));
  }
  return out;
}

/** 读取目录下所有 JS/TS 源码的拼接文本，用于按接口路径等字符串核对 */
export async function readSourceText(dir: string): Promise<string> {
  const parts: string[] = [];
  for (const file of await walk(dir)) parts.push(await fs.readFile(file, 'utf8'));
  return parts.join('\n');
}
