import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { featureArtifactFile, featureSuiteFile, featureArtifactDir, toArtifactDirName } from '../core/featurePaths.js';
import { buildFeatureElementLib } from '../knowledge/platformKit.js';
import { bindPage, type LocatorDef, type LocNode } from './kitBinding.js';
import { loadLibAliases } from './libComponents.js';
import { prunePage } from './pruneJsx.js';
import { loadPackageAliases, REGION_ONLY, unboundCause } from './scanRoutes.js';

/**
 * 单功能覆盖分析（纯静态，不调 LLM、不连 UAT）：
 *  1) 页面侧：功能涉及的页面源码 → 当前绑定逻辑 → 节点绑定率与缺口原因
 *  2) 用例侧：suite 引用的元素键 ↔ 页面已绑定节点（按键名 / role+name / css / 字段名关联）
 */

const SKIP_DIRS = new Set(['node_modules', 'stores', 'services', 'models', 'assets', 'styles', '__tests__']);

export type NodeCoverage = {
  page: string;
  node: string;
  component: string;
  status: LocNode['locator_status'];
  locator_key?: string;
  cause?: string;
  /** 命中的用例元素键与关联依据；空 = 没有用例触达 */
  matched: { element: string; basis: 'key' | 'role_name' | 'css' | 'field' | 'text' | 'within'; cases: string[] }[];
};

export type FeatureCoverage = {
  feature: string;
  slug: string;
  entries: { file: string; source: 'feature.yaml' | 'page-locators' | 'arg'; nodes: number; bound: number; coverage: number | null; causes: Record<string, number> }[];
  unresolvedHints: string[];
  dom: { nodes: number; bound: number; coverage: number | null };
  cases: { total: number; readonly: number; write: number; steps: number };
  elementCoverage: {
    /** 页面侧已绑定的去重定位键数 */
    locatable: number;
    touched: number;
    touchedWeak: number;
    ratio: number | null;
  };
  nodes: NodeCoverage[];
  /** 页面已绑定、但没有任何用例触达 */
  untouched: NodeCoverage[];
  /** 用例引用了、但元素库里没有定义 */
  dangling: { element: string; cases: string[] }[];
  /** 用例引用了、元素库有定义，但页面静态节点里找不到对应（多为 kit 通用元素或手写元素） */
  noStaticNode: { element: string; cases: string[] }[];
};

function pct(a: number, b: number): number | null {
  return b ? Math.round((a / b) * 1000) / 10 : null;
}

async function listRouteFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(p);
      } else if (/\.(tsx|jsx|js)$/.test(e.name)) out.push(p);
    }
  };
  const pkgs = await fs.readdir(path.join(root, 'packages')).catch(() => [] as string[]);
  for (const pkg of pkgs) await walk(path.join(root, 'packages', pkg, 'src', 'routes'));
  return out;
}

/** source_hint 形如 "A/B/index.tsx + stores/X.ts" 或 "Material/MaterialList"：只取页面文件/目录，按路径后缀匹配 */
export function resolveHints(hint: string, files: string[]): { hits: string[]; miss: string[] } {
  const hits: string[] = [];
  const miss: string[] = [];
  const tokens = hint.split(/\s*\+\s*|\s+/).map((t) => t.trim()).filter(Boolean);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 带目录的 token 先解析；不带目录的裸文件名只在已命中文件的同目录里找（避免全仓同名文件误命中）
  for (const t of tokens.filter((x) => x.includes('/'))) {
    if (/(^|\/)(stores|services|models)\//.test(t) || /\.(ts|less|css)$/.test(t)) continue;
    const norm = t.replace(/^\.?\//, '').replace(/\/$/, '');
    const found = files.filter((f) =>
      /\.(tsx|jsx|js)$/.test(norm) ? f.endsWith(`/${norm}`) : new RegExp(`/${esc(norm)}/index\\.(tsx|jsx|js)$`).test(f),
    );
    if (found.length) hits.push(...found);
    else miss.push(t);
  }
  for (const t of tokens.filter((x) => !x.includes('/') && /\.(tsx|jsx|js)$/.test(x))) {
    const dirs = new Set(hits.map((h) => path.dirname(h)));
    const found = [...dirs].map((d) => path.join(d, t)).filter((f) => files.includes(f));
    if (found.length) hits.push(...found);
    else miss.push(t);
  }
  return { hits: [...new Set(hits)], miss };
}

function sigs(key: string, def: Record<string, unknown> | undefined): { strong: string[]; field: string[]; text: string[]; css?: string } {
  const strong = [`k:${key}`];
  const field: string[] = [];
  const text: string[] = [];
  if (!def) return { strong, field, text };
  if (def.role && def.name) {
    strong.push(`rn:${def.role}|${def.name}`);
    text.push(String(def.name));
  }
  if (typeof def.css === 'string') {
    strong.push(`c:${def.css.replace(/\s+/g, ' ').trim()}`);
    for (const m of def.css.matchAll(/\[name\^?="([^"]+)"\]/g)) field.push(m[1]);
    for (const m of def.css.matchAll(/data-index="([^"]+)"/g)) field.push(m[1]);
    for (const m of def.css.matchAll(/(?:has-text|text-is)\("([^"]+)"\)/g)) text.push(m[1]);
  }
  return { strong, field, text, css: typeof def.css === 'string' ? def.css.replace(/\s+/g, ' ').trim() : undefined };
}

function collectRefs(v: unknown, slug: string, out: Set<string>): void {
  if (typeof v === 'string') {
    const m = new RegExp(`^${slug}\\.([A-Za-z_]\\w*)$`).exec(v);
    if (m) out.add(m[1]);
  } else if (Array.isArray(v)) v.forEach((x) => collectRefs(x, slug, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectRefs(x, slug, out));
}

export type CoverageOptions = { feature: string; projectRoot: string; entries?: string[] };

export async function analyzeFeatureCoverage(opts: CoverageOptions): Promise<FeatureCoverage> {
  const slug = toArtifactDirName(opts.feature);
  const root = path.resolve(opts.projectRoot);
  const featureYaml = YAML.parse(await fs.readFile(featureArtifactFile(opts.feature), 'utf8')) as Record<string, any>;
  const suite = YAML.parse(await fs.readFile(featureSuiteFile(opts.feature), 'utf8')) as { cases?: Record<string, any>[] };
  const lib = (await buildFeatureElementLib(opts.feature, featureYaml as never)) as Record<string, Record<string, unknown>>;

  // 1. 页面入口
  const allFiles = await listRouteFiles(root);
  const entryMap = new Map<string, 'feature.yaml' | 'page-locators' | 'arg'>();
  const unresolvedHints: string[] = [];
  if (opts.entries?.length) {
    for (const e of opts.entries) entryMap.set(path.resolve(root, e), 'arg');
  } else {
    for (const p of (featureYaml.pages ?? []) as { scope?: string; source_hint?: string }[]) {
      if (p.scope !== 'in_feature' || !p.source_hint) continue;
      const { hits, miss } = resolveHints(p.source_hint, allFiles);
      hits.forEach((h) => entryMap.set(h, 'feature.yaml'));
      unresolvedHints.push(...miss);
    }
    const prior = await fs.readFile(path.join(featureArtifactDir(opts.feature), 'page-locators.yaml'), 'utf8').catch(() => '');
    if (prior) {
      for (const p of (YAML.parse(prior)?.pages ?? []) as { file_entry?: string }[]) {
        if (p.file_entry) {
          const abs = path.resolve(root, p.file_entry);
          if (!entryMap.has(abs)) entryMap.set(abs, 'page-locators');
        }
      }
    }
  }

  // 2. 逐入口绑定（同一个文件被别的入口跟进到时，只算跟进它的那个入口）
  const libAliases = await loadLibAliases(root);
  const entries = [...entryMap.keys()].sort();
  const cacheByPkg = new Map<string, { aliases: Record<string, string>; cache: Map<string, never> }>();
  const pruned = new Map<string, Awaited<ReturnType<typeof prunePage>>>();
  const owned = new Set<string>();
  for (const e of entries) {
    const m = /^(.*\/packages\/[^/]+)\//.exec(e);
    const pkgDir = m ? m[1] : root;
    if (!cacheByPkg.has(pkgDir)) cacheByPkg.set(pkgDir, { aliases: await loadPackageAliases(pkgDir), cache: new Map<string, never>() });
    const ro = cacheByPkg.get(pkgDir)!;
    const p = await prunePage(e, root, 2, ro as never);
    pruned.set(e, p);
    for (const f of p.followed) owned.add(path.resolve(root, f.to));
  }

  const nodes: NodeCoverage[] = [];
  const locByNode = new Map<NodeCoverage, LocatorDef | undefined>();
  const entryRows: FeatureCoverage['entries'] = [];
  for (const [e, p] of pruned) {
    if (owned.has(e)) continue;
    const rel = path.relative(root, e);
    const res = bindPage(p, opts.feature, slug, { libAliases });
    const gapOf = new Map(res.gaps.filter((g) => g.node_id).map((g) => [g.node_id!, g]));
    const pfByFile = new Map(p.files.map((f) => [f.file, f]));
    const row = { file: rel, source: entryMap.get(e)!, nodes: 0, bound: 0, coverage: null as number | null, causes: {} as Record<string, number> };
    for (const q of res.pages) {
      for (const n of q.nodes) {
        if (REGION_ONLY.has(n.component) || n.transparent) continue;
        row.nodes++;
        const nc: NodeCoverage = {
          page: rel,
          node: n.name,
          component: n.component,
          status: n.locator_status,
          locator_key: n.locator_key,
          matched: [],
        };
        if (n.locator_status === 'bound') row.bound++;
        else {
          const file = n.evidence[0]?.file;
          nc.cause = gapOf.get(n.id)?.cause ?? unboundCause(n, file ? pfByFile.get(file) : undefined);
          row.causes[nc.cause] = (row.causes[nc.cause] ?? 0) + 1;
        }
        nodes.push(nc);
        locByNode.set(nc, n.locator_key ? res.locators[n.locator_key] : undefined);
      }
    }
    row.coverage = pct(row.bound, row.nodes);
    entryRows.push(row);
  }

  // 3. 用例引用
  const refCases = new Map<string, Set<string>>();
  let readonly = 0;
  let steps = 0;
  const cases = suite.cases ?? [];
  for (const c of cases) {
    if ((c.tags ?? []).includes('readonly')) readonly++;
    for (const s of (c.steps ?? []) as unknown[]) {
      steps++;
      const found = new Set<string>();
      collectRefs(s, slug, found);
      for (const k of found) {
        if (!refCases.has(k)) refCases.set(k, new Set());
        refCases.get(k)!.add(c.id);
      }
    }
  }

  // 4. 关联：用例元素键 ↔ 页面节点
  const refSigs = new Map<string, ReturnType<typeof sigs>>();
  for (const k of refCases.keys()) refSigs.set(k, sigs(k, lib[k]));
  for (const nc of nodes) {
    if (nc.status !== 'bound' || !nc.locator_key) continue;
    const ns = sigs(nc.locator_key, locByNode.get(nc) as Record<string, unknown> | undefined);
    for (const [k, rs] of refSigs) {
      const cs = [...refCases.get(k)!];
      if (rs.strong.some((s) => ns.strong.includes(s))) {
        const basis = rs.strong.find((s) => ns.strong.includes(s))!;
        nc.matched.push({ element: k, basis: basis.startsWith('k:') ? 'key' : basis.startsWith('rn:') ? 'role_name' : 'css', cases: cs });
      } else if (rs.field.some((f) => ns.field.includes(f))) {
        nc.matched.push({ element: k, basis: 'field', cases: cs });
      } else if (rs.text.some((t) => ns.text.includes(t))) {
        nc.matched.push({ element: k, basis: 'text', cases: cs });
      } else if (rs.css && ns.css && !ns.css.includes('data-index') && rs.css.startsWith(`${ns.css} >> `)) {
        // 用例元素落在该节点（多为表格）之内
        nc.matched.push({ element: k, basis: 'within', cases: cs });
      }
    }
  }

  // 5. 汇总（页面侧按定位键去重）
  const byKey = new Map<string, NodeCoverage[]>();
  for (const nc of nodes) if (nc.status === 'bound' && nc.locator_key) (byKey.get(`${nc.page}::${nc.locator_key}`) ?? byKey.set(`${nc.page}::${nc.locator_key}`, []).get(`${nc.page}::${nc.locator_key}`)!).push(nc);
  let touched = 0;
  let weak = 0;
  const untouched: NodeCoverage[] = [];
  for (const group of byKey.values()) {
    const ms = group.flatMap((g) => g.matched);
    if (ms.some((m) => ['key', 'role_name', 'css'].includes(m.basis))) touched++;
    else if (ms.length) weak++;
    else untouched.push(group[0]);
  }
  const matchedElements = new Set(nodes.flatMap((n) => n.matched.map((m) => m.element)));
  const dangling: FeatureCoverage['dangling'] = [];
  const noStaticNode: FeatureCoverage['noStaticNode'] = [];
  for (const [k, cs] of refCases) {
    if (!lib[k]) dangling.push({ element: k, cases: [...cs] });
    else if (!matchedElements.has(k)) noStaticNode.push({ element: k, cases: [...cs] });
  }

  const domNodes = nodes.length;
  const domBound = nodes.filter((n) => n.status === 'bound').length;
  return {
    feature: String(featureYaml.feature ?? opts.feature),
    slug,
    entries: entryRows,
    unresolvedHints,
    dom: { nodes: domNodes, bound: domBound, coverage: pct(domBound, domNodes) },
    cases: { total: cases.length, readonly, write: cases.length - readonly, steps },
    elementCoverage: { locatable: byKey.size, touched, touchedWeak: weak, ratio: pct(touched + weak, byKey.size) },
    nodes,
    untouched,
    dangling,
    noStaticNode,
  };
}

export function renderCoverageMd(r: FeatureCoverage): string {
  const L: string[] = [];
  L.push(`# ${r.feature} 覆盖分析`, '', `slug: \`${r.slug}\`（纯静态分析，未连 UAT；用例未执行）`, '');
  L.push('## 汇总', '');
  L.push('| 维度 | 数值 |', '|---|---|');
  L.push(`| 页面入口 | ${r.entries.length} |`);
  L.push(`| 页面节点 | ${r.dom.nodes}（已绑定 ${r.dom.bound}，页面覆盖率 ${r.dom.coverage ?? '-'}%） |`);
  L.push(`| 用例 | ${r.cases.total}（只读 ${r.cases.readonly} / 写操作 ${r.cases.write}），步骤 ${r.cases.steps} |`);
  L.push(
    `| 用例元素覆盖 | 可定位元素 ${r.elementCoverage.locatable}，用例触达 ${r.elementCoverage.touched}（另弱关联 ${r.elementCoverage.touchedWeak}），覆盖率 ${r.elementCoverage.ratio ?? '-'}% |`,
  );
  L.push('', '## 页面入口', '', '| 入口 | 来源 | 节点 | 已绑定 | 覆盖率 | 缺口原因 |', '|---|---|---|---|---|---|');
  for (const e of r.entries) {
    const c = Object.entries(e.causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('；') || '-';
    L.push(`| ${e.file} | ${e.source} | ${e.nodes} | ${e.bound} | ${e.coverage ?? '-'}% | ${c} |`);
  }
  if (r.unresolvedHints.length) L.push('', `未在仓库中找到的 source_hint：${r.unresolvedHints.join('、')}`);
  L.push('', '## 页面可定位但没有用例触达（待补用例）', '');
  if (!r.untouched.length) L.push('无');
  else {
    L.push('| 页面 | 节点 | 组件 | 定位键 |', '|---|---|---|---|');
    for (const n of r.untouched) L.push(`| ${n.page.split('/').slice(-2).join('/')} | ${n.node} | ${n.component} | ${n.locator_key} |`);
  }
  L.push('', '## 用例引用但元素库无定义（悬空引用）', '');
  L.push(r.dangling.length ? r.dangling.map((d) => `- \`${d.element}\`（${d.cases.join('、')}）`).join('\n') : '无');
  L.push('', '## 用例引用且有定义，但页面静态节点里找不到对应', '', '多为 kit 通用元素（如 pageReady）或手写元素，不代表有问题。', '');
  L.push(r.noStaticNode.length ? r.noStaticNode.map((d) => `- \`${d.element}\`（${d.cases.length} 个用例）`).join('\n') : '无');
  L.push('', '## 页面节点未绑定（影响覆盖判断）', '');
  const un = r.nodes.filter((n) => n.status !== 'bound');
  if (!un.length) L.push('无');
  else {
    L.push('| 页面 | 节点 | 组件 | 状态 | 原因 |', '|---|---|---|---|---|');
    for (const n of un) L.push(`| ${n.page.split('/').slice(-2).join('/')} | ${n.node} | ${n.component} | ${n.status} | ${n.cause ?? '-'} |`);
  }
  L.push('', '## 说明', '', '- 关联依据：键名 / role+name / css 相同为强关联；仅字段名相同、仅按钮文案相同（用例 css 里的 has-text）、或用例元素落在该表格之内为弱关联，按触达计入但单独标出。用例元素库多为手写 css（如 `.page-head button:has(.icon-save)`），与页面按 role+name 绑定的键常对不上，这类会落在“找不到对应”里，实际可能已覆盖，需人工判断。', '- 页面节点未绑定的部分无法判断是否被用例触达，不计入“可定位元素”。');
  return L.join('\n') + '\n';
}
