import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { logger } from '../core/logger.js';
import type { FeatureArtifact, PageNode } from '../core/schema.js';
import type { CodeSnippet } from './retrieve.js';

/** 从各 packages/<pkg>/config/config.ts 抽出的叶子路由 */
export type PackageRoute = {
  path: string;
  /** 归一化后：routes/Foo/Bar（无 @/、无扩展名、无 /index） */
  componentKey: string;
  /** 原始 component 字面量 */
  component: string;
  packageName: string;
  configFile: string;
};

export type PackageRouteIndex = {
  root: string;
  routes: PackageRoute[];
};

/**
 * 解析 HZero/umi 风格 config.ts 中带 component 的叶子路由。
 * 跳过仅有 path + 嵌套 routes、无 component 的父节点。
 */
export function parseConfigRoutes(
  source: string,
  meta: { packageName: string; configFile: string },
): PackageRoute[] {
  const out: PackageRoute[] = [];
  const pathRe = /path:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(source))) {
    const routePath = m[1];
    const after = source.slice(m.index + m[0].length, m.index + m[0].length + 500);
    const beforeComponent = after.split(/component\s*:/)[0] ?? after;
    // 父节点：path 后先出现嵌套 routes，再才是子项 component
    if (/\broutes\s*:/.test(beforeComponent)) continue;
    const cm = after.match(/component:\s*['"]([^'"]+)['"]/);
    if (!cm) continue;
    const component = cm[1];
    out.push({
      path: normalizeRoutePath(routePath),
      componentKey: normalizeComponentKey(component),
      component,
      packageName: meta.packageName,
      configFile: meta.configFile,
    });
  }
  return out;
}

export function normalizeRoutePath(p: string): string {
  const s = p.trim();
  if (!s) return s;
  // 去掉末尾多余 /（保留根 /）
  return s.length > 1 && s.endsWith('/') ? s.replace(/\/+$/, '') : s;
}

export function normalizeComponentKey(component: string): string {
  return component
    .trim()
    .replace(/^@\//, '')
    .replace(/\\/g, '/')
    .replace(/\.(tsx?|jsx?)$/i, '')
    .replace(/\/index$/i, '');
}

/**
 * 扫描 monorepo：packages/<pkg>/config/config.ts
 * projectRoot 可为仓根，或 packages/<pkg>/... 下的任意路径（会向上找 packages）。
 */
export async function loadPackageRouteIndex(projectRoot: string): Promise<PackageRouteIndex> {
  const root = await resolveMonorepoRoot(projectRoot);
  const configs = await fg('packages/*/config/config.ts', {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  });
  const routes: PackageRoute[] = [];
  for (const abs of configs.sort()) {
    const packageName = path.basename(path.dirname(path.dirname(abs)));
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    let text: string;
    try {
      text = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseConfigRoutes(text, { packageName, configFile: rel });
    routes.push(...parsed);
  }
  logger.info(
    { root, configs: configs.length, routes: routes.length },
    'loadPackageRouteIndex',
  );
  return { root, routes };
}

/** 若当前路径在 packages/<pkg>/ 下则升到仓根；否则原样 */
async function resolveMonorepoRoot(projectRoot: string): Promise<string> {
  let cur = path.resolve(projectRoot);
  for (let i = 0; i < 8; i++) {
    const packagesDir = path.join(cur, 'packages');
    try {
      const st = await fs.stat(packagesDir);
      if (st.isDirectory()) return cur;
    } catch {
      // continue
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(projectRoot);
}

/** 从源码相对路径抽出 routes/... 键（含文件则去掉文件名） */
export function routesKeyFromRel(rel: string): string | undefined {
  const n = rel.replace(/\\/g, '/');
  const m = n.match(/(?:^|\/)(routes\/.+)$/i);
  if (!m) return undefined;
  return normalizeComponentKey(m[1]);
}

/**
 * 功能目录 / snippets 推导的候选前缀（长→短），用于匹配 component。
 */
export function collectFeatureRoutePrefixes(opts: {
  snippets: CodeSnippet[];
  projectRoot: string;
  featureDir?: string;
  monorepoRoot?: string;
}): string[] {
  const keys = new Set<string>();
  const addKey = (key: string | undefined) => {
    if (!key || !key.startsWith('routes/')) return;
    const parts = key.split('/');
    // routes/A、routes/A/B、…
    for (let i = parts.length; i >= 2; i--) {
      keys.add(parts.slice(0, i).join('/'));
    }
  };

  for (const s of opts.snippets) {
    addKey(routesKeyFromRel(s.relativePath));
    // -p 直接指功能目录时 relativePath 可能只是 index.tsx，靠绝对路径抽 routes/
    addKey(routesKeyFromRel(s.absolutePath));
  }

  if (opts.featureDir) {
    const root = opts.monorepoRoot ?? opts.projectRoot;
    const abs = path.resolve(opts.projectRoot, opts.featureDir);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    addKey(routesKeyFromRel(rel));
    // featureDir 可能尚未含 routes/ 前缀信息时，再试相对 projectRoot
    const rel2 = path.relative(opts.projectRoot, abs).replace(/\\/g, '/');
    addKey(routesKeyFromRel(rel2));
    addKey(routesKeyFromRel(abs.replace(/\\/g, '/')));
  }

  return [...keys].sort((a, b) => b.length - a.length);
}

export type MatchedFeatureRoutes = {
  prefix: string;
  packageName: string;
  routes: PackageRoute[];
  entry?: PackageRoute;
  list?: PackageRoute;
  detail?: PackageRoute;
};

/**
 * 用最长 routes 前缀匹配 config 叶子路由；优先当前 package（若能从路径看出）。
 *
 * 注意：snippets 常含子组件（如 CommentImport），最长前缀可能只命中 `/:code` 这类
 * 带参子路由。此时应继续缩短前缀，直到拿到无参数的 `/list`（或静态入口），
 * 避免把占位 path（:id / :code）当成可直接 goto 的入口。
 */
export function matchRoutesForFeature(
  index: PackageRouteIndex,
  prefixes: string[],
  preferredPackage?: string,
): MatchedFeatureRoutes | undefined {
  if (!prefixes.length || !index.routes.length) return undefined;

  let paramOnly: MatchedFeatureRoutes | undefined;

  for (const prefix of prefixes) {
    const matched = index.routes.filter((r) => componentMatchesPrefix(r.componentKey, prefix));
    if (!matched.length) continue;

    let pool = matched;
    if (preferredPackage) {
      const inPkg = matched.filter((r) => r.packageName === preferredPackage);
      if (inPkg.length) pool = inPkg;
    }

    const list = pickListRoute(pool);
    const entry = list ?? pickEntryFallback(pool);
    // 子树前缀（如 …/List）池内往往没有兄弟 Detail；按 list 的 URL 基路径在全包内补 detail
    const detail =
      pickDetailRoute(pool, list) ??
      (list ? pickDetailByListPath(index.routes, list, preferredPackage) : undefined);

    const candidate: MatchedFeatureRoutes = {
      prefix,
      packageName: entry?.packageName ?? pool[0]!.packageName,
      routes: pool,
      entry,
      list,
      detail,
    };

    // 有静态 list/入口 → 采用（prefixes 已长→短；已跳过仅 :code 的叶子前缀）
    if (list && !hasPathParam(list.path)) return candidate;
    if (entry && !hasPathParam(entry.path)) return candidate;

    if (!paramOnly && entry) paramOnly = candidate;
  }
  return paramOnly;
}

function componentMatchesPrefix(componentKey: string, prefix: string): boolean {
  return componentKey === prefix || componentKey.startsWith(`${prefix}/`);
}

function isPubPath(p: string): boolean {
  return /(^|\/)pub\//i.test(p);
}

function hasPathParam(p: string): boolean {
  return p.includes(':');
}

function pickListRoute(routes: PackageRoute[]): PackageRoute | undefined {
  const candidates = routes.filter((r) => !isPubPath(r.path) && !hasPathParam(r.path));
  const byList = candidates.filter((r) => /\/list$/i.test(r.path));
  if (byList.length) {
    // 同 /list 时取更长、更具体的 path（workshop vs platform）
    return byList.sort((a, b) => b.path.length - a.path.length)[0];
  }
  // 无 /list：取无参数、最短的静态页
  return candidates.sort((a, b) => a.path.length - b.path.length)[0];
}

function pickDetailRoute(
  routes: PackageRoute[],
  list?: PackageRoute,
): PackageRoute | undefined {
  const base = list?.path.replace(/\/list$/i, '') ?? '';
  const withId = routes.filter(
    (r) =>
      !isPubPath(r.path) &&
      hasPathParam(r.path) &&
      (/\/(dist|detail)\//i.test(r.path) || /\/(dist|detail)$/i.test(r.path.split(':')[0] ?? '')),
  );
  const scoped = base
    ? withId.filter((r) => r.path.startsWith(`${base}/`) || r.path.startsWith(base))
    : withId;
  const pool = scoped.length ? scoped : withId;
  if (!pool.length) return undefined;
  // 优先 dist/:id / detail/:id，排除 :code 这类泛匹配
  const preferred = pool.filter((r) => /\/(dist|detail)\/:/i.test(r.path));
  return (preferred.length ? preferred : pool).sort((a, b) => a.path.length - b.path.length)[0];
}

/** 按 list 的 SPA 路径前缀在全量路由中找 detail（不扩大 component 前缀，避免误绑兄弟功能） */
function pickDetailByListPath(
  allRoutes: PackageRoute[],
  list: PackageRoute,
  preferredPackage?: string,
): PackageRoute | undefined {
  let pool = allRoutes;
  if (preferredPackage) {
    const inPkg = allRoutes.filter((r) => r.packageName === preferredPackage);
    if (inPkg.length) pool = inPkg;
  }
  return pickDetailRoute(pool, list);
}

function pickEntryFallback(routes: PackageRoute[]): PackageRoute | undefined {
  const nonPub = routes.filter((r) => !isPubPath(r.path));
  const staticRoutes = nonPub.filter((r) => !hasPathParam(r.path));
  const pool = staticRoutes.length ? staticRoutes : nonPub;
  return pool.sort((a, b) => a.path.length - b.path.length)[0];
}

/** 从 snippets / featureDir 猜 package 名（packages/<name>/...） */
export function guessPackageName(opts: {
  snippets: CodeSnippet[];
  projectRoot: string;
  featureDir?: string;
  monorepoRoot?: string;
}): string | undefined {
  const root = opts.monorepoRoot ?? opts.projectRoot;
  const rels: string[] = [
    ...opts.snippets.map((s) => s.relativePath.replace(/\\/g, '/')),
    ...opts.snippets.map((s) => s.absolutePath.replace(/\\/g, '/')),
  ];
  if (opts.featureDir) {
    const abs = path.resolve(opts.projectRoot, opts.featureDir);
    rels.push(path.relative(root, abs).replace(/\\/g, '/'));
    rels.push(path.relative(opts.projectRoot, abs).replace(/\\/g, '/'));
    rels.push(abs.replace(/\\/g, '/'));
  }
  for (const rel of rels) {
    const m = rel.match(/(?:^|\/)packages\/([^/]+)\//);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * 用 config.ts 路由覆盖 artifact 的 entry / pages / operations.route。
 * 匹配失败则原样返回，并在 risks 记一条说明。
 */
export function applyConfigRoutes(
  artifact: FeatureArtifact,
  opts: {
    index: PackageRouteIndex;
    snippets: CodeSnippet[];
    projectRoot: string;
    featureDir?: string;
  },
): FeatureArtifact {
  const prefixes = collectFeatureRoutePrefixes({
    snippets: opts.snippets,
    projectRoot: opts.projectRoot,
    featureDir: opts.featureDir,
    monorepoRoot: opts.index.root,
  });
  const preferredPackage = guessPackageName({
    snippets: opts.snippets,
    projectRoot: opts.projectRoot,
    featureDir: opts.featureDir,
    monorepoRoot: opts.index.root,
  });
  const matched = matchRoutesForFeature(opts.index, prefixes, preferredPackage);

  if (!matched?.entry) {
    const risk =
      '未在 packages/*/config/config.ts 匹配到本功能路由，entry.route 仍为模型推断，请核对 -d 路径与 component';
    const risks = [...(artifact.review_suggestions?.risks ?? [])];
    if (!risks.includes(risk)) risks.push(risk);
    return {
      ...artifact,
      review_suggestions: {
        ...artifact.review_suggestions,
        status: artifact.review_suggestions?.status ?? 'pending_human_review',
        risks,
        extend_paths: artifact.review_suggestions?.extend_paths ?? [],
      },
    };
  }

  const entryRoute = matched.entry.path;
  const listRoute = matched.list?.path ?? entryRoute;
  const detailRoute = matched.detail?.path;

  const pages: PageNode[] = (artifact.pages ?? []).map((p) => {
    const next = { ...p };
    if (p.id === 'list' || /list/i.test(p.id)) {
      next.route = listRoute;
    } else if (detailRoute && (p.id === 'detail' || /detail/i.test(p.id))) {
      next.route = detailRoute;
    } else if (p.source_hint) {
      const byHint = matchPageByHint(matched.routes, p.source_hint);
      if (byHint) next.route = byHint.path;
    }
    return next;
  });

  // 无 pages 时至少保证 list
  if (!pages.length) {
    pages.push({
      id: 'list',
      name: '列表',
      route: listRoute,
      scope: 'in_feature',
    });
  } else if (!pages.some((p) => p.id === 'list')) {
    // list 页缺失时不强行插入，仅覆盖 entry
  }

  const pageRouteById = new Map(pages.map((p) => [p.id, p.route]));

  const operations = artifact.operations.map((op) => {
    const pageId = op.page_id;
    if (!pageId) return op;
    const route = pageRouteById.get(pageId);
    if (!route) {
      // query 类默认列表
      if (op.type === 'query') return { ...op, route: listRoute };
      return op;
    }
    return { ...op, route };
  });

  const note = `路由已由 ${matched.packageName}/config/config.ts 覆盖（prefix=${matched.prefix} → ${entryRoute}）`;
  const notes = [...(artifact.notes ?? [])].filter(
    (n) => !/路由路径为推断|列表路由与详情路由为推断|路由已由 .+\/config\/config\.ts 覆盖/.test(n),
  );
  if (!notes.includes(note)) notes.push(note);

  const risks = (artifact.review_suggestions?.risks ?? []).filter(
    (r) => !/路由路径为推断|入口路由仍含路径参数/.test(r),
  );
  // 入口仍带 :id/:code 时不可直接 goto，需人工补真实 id 或核对匹配前缀
  if (hasPathParam(entryRoute)) {
    risks.push(
      `入口路由仍含路径参数（${entryRoute}），不可字面量 goto；请核对 config 是否有静态 /list，或经列表行链入详情`,
    );
  }

  logger.info(
    {
      prefix: matched.prefix,
      package: matched.packageName,
      entry: entryRoute,
      list: listRoute,
      detail: detailRoute,
      matched: matched.routes.map((r) => r.path),
    },
    'applyConfigRoutes',
  );

  return {
    ...artifact,
    entry: {
      ...artifact.entry,
      route: entryRoute,
    },
    pages,
    operations,
    notes,
    review_suggestions: {
      ...artifact.review_suggestions,
      status: artifact.review_suggestions?.status ?? 'pending_human_review',
      risks,
      extend_paths: artifact.review_suggestions?.extend_paths ?? [],
    },
  };
}

function matchPageByHint(routes: PackageRoute[], hint: string): PackageRoute | undefined {
  const key = normalizeComponentKey(hint.replace(/\\/g, '/'));
  // hint 可能是 InspectionPlatform/List 或短名
  const hit = routes.filter(
    (r) =>
      r.componentKey.endsWith(`/${key}`) ||
      r.componentKey.endsWith(key) ||
      r.componentKey.includes(`/${key}/`) ||
      r.componentKey.includes(key),
  );
  if (!hit.length) return undefined;
  return hit.sort((a, b) => a.componentKey.length - b.componentKey.length)[0];
}
