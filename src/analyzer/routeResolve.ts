import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { loadPackageAliases } from './scanRoutes.js';

/**
 * 路由源码判定：HZERO 多包（二开 + 产品）可能对同一路由各自登记组件，运行时取 config 里 priority 最大的那份。
 * 分析必须读同一份源码，否则会把产品版才有的按钮（如二开已删的「预览」）当成存在。
 * priority 缺省按 0；子路由未写时继承父路由。
 */

export type RouteDef = {
  path: string;
  /** 原始 component 字符串 */
  component?: string;
  /** 解析后的组件绝对路径（目录或文件，未必存在） */
  componentAbs?: string;
  priority: number;
  /** 是否显式写了 priority（含继承） */
  priorityExplicit: boolean;
  pkgDir: string;
  /** 所属仓库根在 loadRouteTable(roots) 中的序号：优先级相同时序号小者胜（二开根放前面） */
  rootIndex: number;
  configFile: string;
  line: number;
  parentPath?: string;
};

export type RouteResolution = {
  route: string;
  winner: RouteDef;
  candidates: RouteDef[];
  /** 最高优先级有多个不同组件：运行时取哪份不确定，必须人工确认 */
  ambiguous: boolean;
};

const CONFIG_FILES = ['config/config.ts', 'config/config.js', '.umirc.ts'];

function propOf(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : undefined;
    if (key === name) return p.initializer;
  }
  return undefined;
}

function strOf(e: ts.Expression | undefined): string | undefined {
  return e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined;
}

function numOf(e: ts.Expression | undefined): number | undefined {
  if (!e) return undefined;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) {
    return -Number(e.operand.text);
  }
  return undefined;
}

/** umi 约定：component 相对 src/pages；@/ 指 src/；其他本地别名按 module-resolver */
export function resolveComponentPath(component: string, pkgDir: string, aliases: Record<string, string>): string {
  if (component.startsWith('@/')) return path.join(pkgDir, 'src', component.slice(2));
  if (component.startsWith('.')) return path.resolve(pkgDir, 'src', 'pages', component);
  for (const [k, v] of Object.entries(aliases)) {
    if (component === k || component.startsWith(k + '/')) return path.join(v, component.slice(k.length));
  }
  return path.resolve(pkgDir, 'src', 'pages', component);
}

/** 解析单个 config 文件中的路由对象（带 path 的对象字面量，递归 routes） */
export function parseRouteConfig(
  text: string,
  configFile: string,
  pkgDir: string,
  aliases: Record<string, string> = {},
  rootIndex = 0,
): RouteDef[] {
  const sf = ts.createSourceFile(configFile, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: RouteDef[] = [];
  const visitRoute = (obj: ts.ObjectLiteralExpression, parent?: RouteDef) => {
    const p = strOf(propOf(obj, 'path'));
    const own = numOf(propOf(obj, 'priority'));
    let self = parent;
    if (p) {
      const component = strOf(propOf(obj, 'component'));
      self = {
        path: p,
        component,
        componentAbs: component ? resolveComponentPath(component, pkgDir, aliases) : undefined,
        priority: own ?? parent?.priority ?? 0,
        priorityExplicit: own !== undefined || !!parent?.priorityExplicit,
        pkgDir,
        rootIndex,
        configFile,
        line: sf.getLineAndCharacterOfPosition(obj.getStart(sf)).line + 1,
        parentPath: parent?.path,
      };
      out.push(self);
    }
    const routes = propOf(obj, 'routes');
    if (routes && ts.isArrayLiteralExpression(routes)) {
      for (const el of routes.elements) if (ts.isObjectLiteralExpression(el)) visitRoute(el, self);
    }
  };
  const walk = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : undefined;
      if (key === 'routes' && ts.isArrayLiteralExpression(n.initializer)) {
        // 顶层 routes 数组：交给 visitRoute 递归，不再下钻，避免重复收集
        const parentObj = n.parent;
        if (!(ts.isObjectLiteralExpression(parentObj) && strOf(propOf(parentObj, 'path')))) {
          for (const el of n.initializer.elements) if (ts.isObjectLiteralExpression(el)) visitRoute(el);
          return;
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/** 收集若干前端仓库根（各自含 packages/<包>/config/config.ts）中的全部路由定义 */
export async function loadRouteTable(roots: string[]): Promise<RouteDef[]> {
  const out: RouteDef[] = [];
  for (const [rootIndex, root] of roots.entries()) {
    const pkgsRoot = path.join(path.resolve(root), 'packages');
    let names: string[];
    try {
      names = (await fs.readdir(pkgsRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const pkgDir = path.join(pkgsRoot, name);
      for (const f of CONFIG_FILES) {
        const file = path.join(pkgDir, f);
        let text: string;
        try {
          text = await fs.readFile(file, 'utf8');
        } catch {
          continue;
        }
        out.push(...parseRouteConfig(text, file, pkgDir, await loadPackageAliases(pkgDir), rootIndex));
        break;
      }
    }
  }
  return out;
}

/**
 * 同一路由取 priority 最大的定义；只比较带 component 的定义（纯分组路由除外）。
 * 优先级相同按仓库根顺序（先二开后产品，见空间 AGENTS.md「先查二开，二开没有再查产品源码」）；
 * 同一仓库内优先级仍并列且组件不同，判为 ambiguous。
 */
export function resolveRoute(table: RouteDef[], route: string): RouteResolution | undefined {
  const candidates = table
    .filter((r) => r.path === route && r.component)
    .sort((a, b) => b.priority - a.priority || a.rootIndex - b.rootIndex);
  if (!candidates.length) return undefined;
  const winner = candidates[0];
  const top = candidates.filter((c) => c.priority === winner.priority && c.rootIndex === winner.rootIndex);
  const ambiguous = new Set(top.map((c) => c.componentAbs)).size > 1;
  return { route, winner, candidates, ambiguous };
}

/** 父路由下各子路由按优先级选出组件后，取组件目录的公共祖先作为功能源码目录 */
export function resolveFeatureDir(table: RouteDef[], route: string): { dir: string; resolutions: RouteResolution[] } | undefined {
  const parent = table.filter((r) => r.path === route);
  const childPaths = new Set(table.filter((r) => r.parentPath === route).map((r) => r.path));
  const paths = childPaths.size ? [...childPaths] : parent.length ? [route] : [];
  const resolutions = paths.map((p) => resolveRoute(table, p)).filter((x): x is RouteResolution => !!x);
  if (!resolutions.length) return undefined;
  const dirs = resolutions.map((r) => r.winner.componentAbs!);
  let common = dirs[0];
  for (const d of dirs.slice(1)) {
    while (common !== path.dirname(common) && !(d === common || d.startsWith(common + path.sep))) common = path.dirname(common);
  }
  return { dir: common, resolutions };
}

export function describeResolution(r: RouteResolution, rootForRel = process.cwd()): string {
  const fmt = (c: RouteDef) =>
    `${path.relative(rootForRel, c.configFile)}:${c.line} priority=${c.priorityExplicit ? c.priority : `${c.priority}(缺省)`} → ${c.component}`;
  return [`${r.route}${r.ambiguous ? '（最高优先级不唯一，需人工确认）' : ''}`, ...r.candidates.map((c, i) => `  ${i === 0 ? '✔' : ' '} ${fmt(c)}`)].join('\n');
}

const within = (p: string, dir: string) => p === dir || p.startsWith(dir + path.sep);

export type FeatureDirCheck = {
  /** 组件落在 featureDir 内、但运行时被别处更高优先级定义覆盖的路由 */
  overridden: RouteResolution[];
  /** 组件落在 featureDir 内且胜出的路由 */
  effective: RouteResolution[];
  ambiguous: RouteResolution[];
};

/** 反查：给定功能源码目录，核对其中登记的路由是否真的是运行时生效的那份 */
export function checkFeatureDir(table: RouteDef[], featureDir: string): FeatureDirCheck {
  const dir = path.resolve(featureDir);
  const routes = [...new Set(table.filter((r) => r.componentAbs && within(r.componentAbs, dir)).map((r) => r.path))];
  const res = routes.map((p) => resolveRoute(table, p)!).filter(Boolean);
  return {
    overridden: res.filter((r) => !within(r.winner.componentAbs!, dir)),
    effective: res.filter((r) => within(r.winner.componentAbs!, dir)),
    ambiguous: res.filter((r) => r.ambiguous),
  };
}

/**
 * 分析前确定源码目录：
 * - 给了 route：按优先级选出生效组件目录；同时给了 featureDir 但不一致则报错
 * - 只给 featureDir：反查其中路由，若被更高优先级定义覆盖则报错（防止分析到不生效的那份源码）
 */
export async function pickEffectiveFeatureDir(opts: {
  roots: string[];
  route?: string;
  featureDir?: string;
}): Promise<{ featureDir?: string; report: string[] }> {
  const table = await loadRouteTable(opts.roots);
  const report: string[] = [];
  const fdAbs = opts.featureDir ? path.resolve(opts.featureDir) : undefined;
  if (opts.route) {
    const r = resolveFeatureDir(table, opts.route);
    if (!r) throw new Error(`路由 ${opts.route} 在 ${opts.roots.join(', ')} 的 config 中均未登记`);
    for (const x of r.resolutions) report.push(describeResolution(x));
    const amb = r.resolutions.filter((x) => x.ambiguous);
    if (amb.length) throw new Error(`路由最高优先级不唯一，无法判定生效源码：\n${amb.map((x) => describeResolution(x)).join('\n')}`);
    if (fdAbs && !within(r.dir, fdAbs) && !within(fdAbs, r.dir)) {
      throw new Error(`-d ${opts.featureDir} 不是运行时生效的源码（按 priority 应为 ${r.dir}）：\n${report.join('\n')}`);
    }
    return { featureDir: fdAbs ?? r.dir, report };
  }
  if (fdAbs) {
    const c = checkFeatureDir(table, fdAbs);
    for (const x of [...c.effective, ...c.overridden]) report.push(describeResolution(x));
    if (c.overridden.length) {
      throw new Error(
        `-d ${opts.featureDir} 中的路由被更高 priority 的定义覆盖，运行时不是这份源码：\n${c.overridden.map((x) => describeResolution(x)).join('\n')}`,
      );
    }
    if (c.ambiguous.length) throw new Error(`路由最高优先级不唯一：\n${c.ambiguous.map((x) => describeResolution(x)).join('\n')}`);
  }
  return { featureDir: fdAbs, report };
}
