import fs from 'node:fs/promises';
import path from 'node:path';
import { bindPage, type LocGap, type LocNode } from './kitBinding.js';
import { loadLibAliases } from './libComponents.js';
import { prunePage, type PrunedFile, type PrunedPage } from './pruneJsx.js';

/**
 * 页面 DOM 解析体检：对仓库内所有 packages/<包>/src/routes 的页面入口批量跑
 * pruneJsx + kitBinding，统计定位覆盖率并把缺口按原因聚类。纯静态，不调 LLM、不连 UAT。
 */

const SKIP_DIRS = new Set(['node_modules', 'stores', 'services', 'models', 'assets', 'styles', '__tests__']);
/** 容器/区域类节点：设计上不绑定，不计入覆盖率分母 */
const REGION_ONLY = new Set(['Collapse', 'Panel', 'Collapse.Panel', 'Tabs', 'Tabs.TabPane', 'TabPane']);

export type PageMetrics = {
  pkg: string;
  entry: string;
  files: number;
  nodes: number;
  bound: number;
  needs_kit: number;
  needs_probe: number;
  unresolved_custom: number;
  unbound: number;
  /** 未绑定但已有 role+name 候选（带文案的按钮），只差语义键名，可由 LLM 命名 */
  candidate: number;
  /** bound / (bound + needs_kit + needs_probe + unresolved_custom + unbound)，容器类除外 */
  coverage: number | null;
  spreads: number;
  mapJsx: number;
  truncated: boolean;
  error?: string;
  causes: Record<string, number>;
};

export type ScanSummary = {
  generatedAt: string;
  root: string;
  packages: { name: string; pages: number; nodes: number; bound: number; candidate: number; coverage: number | null; coverageWithCandidate: number | null; aliases: Record<string, string> }[];
  total: { pages: number; nodes: number; bound: number; candidate: number; coverage: number | null; coverageWithCandidate: number | null; errors: number; truncated: number };
  causes: { cause: string; count: number; pages: number; examples: string[] }[];
};

/** 解析包内 config 的 module-resolver alias；只收本地目录（./ 开头），库别名不收 */
export async function loadPackageAliases(pkgDir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of ['config/config.ts', 'config/config.js', '.umirc.ts']) {
    let text: string;
    try {
      text = await fs.readFile(path.join(pkgDir, f), 'utf8');
    } catch {
      continue;
    }
    const m = text.match(/module-resolver['"][\s\S]*?alias:\s*\{([\s\S]*?)\}/);
    if (!m) continue;
    for (const kv of m[1].matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g)) {
      if (kv[2].startsWith('./')) out[kv[1]] = path.resolve(pkgDir, kv[2]);
    }
    break;
  }
  return out;
}

/** 页面入口：routes 下含 index.(tsx|jsx|js) 的目录 */
export async function discoverEntries(routesDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    let ents: import('node:fs').Dirent[];
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const idx = ents.find((e) => e.isFile() && /^index\.(tsx|jsx|js)$/.test(e.name));
    if (idx) out.push(path.join(dir, idx.name));
    for (const e of ents) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name));
  };
  await walk(routesDir);
  return out.sort();
}

/** 未绑定节点的原因（这类节点没有 gap 记录，需要按组件特征归因） */
function unboundCause(n: LocNode, pf: PrunedFile | undefined): string {
  if (/Button$/.test(n.component)) return n.suggest ? 'button_needs_key_name' : 'button_icon_only';
  if (n.component === 'Table') return 'table_no_dataset';
  if (['Lov', 'Select', 'TextField', 'NumberField', 'Switch', 'DatePicker', 'TextArea', 'IntlField'].includes(n.component)) {
    return typeof n.props?.name === 'string' && n.props.name.startsWith('{') ? 'field_dynamic_name' : 'field_no_name_prop';
  }
  void pf;
  return `unbound:${n.component}`;
}

function pct(a: number, b: number): number | null {
  return b ? Math.round((a / b) * 1000) / 10 : null;
}

export type ScanOptions = {
  root: string;
  packages?: string[];
  /** 进度回调 */
  onPackage?: (name: string, pages: number) => void;
};

export async function scanRoutes(opts: ScanOptions): Promise<{ summary: ScanSummary; pages: PageMetrics[]; samples: Record<string, string[]> }> {
  const pkgsRoot = path.join(opts.root, 'packages');
  const names = (await fs.readdir(pkgsRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !opts.packages || opts.packages.includes(n))
    .sort();

  const libAliases = await loadLibAliases(opts.root);
  const pages: PageMetrics[] = [];
  const samples: Record<string, string[]> = {};
  const causePages = new Map<string, Set<string>>();
  const causeCount = new Map<string, number>();
  const pkgInfo: ScanSummary['packages'] = [];

  for (const pkg of names) {
    const pkgDir = path.join(pkgsRoot, pkg);
    const routesDir = path.join(pkgDir, 'src', 'routes');
    const entries = await discoverEntries(routesDir);
    if (!entries.length) continue;
    const aliases = await loadPackageAliases(pkgDir);
    const cache = new Map<string, PrunedFile>();
    opts.onPackage?.(pkg, entries.length);

    // 先对每个入口各自裁剪；被别的入口跟进到的文件不再作为独立页面（它们是页面的一部分）
    const pruned = new Map<string, PrunedPage>();
    const owned = new Set<string>();
    for (const e of entries) {
      try {
        const p = await prunePage(e, opts.root, 2, { aliases, cache });
        pruned.set(e, p);
        for (const f of p.followed) owned.add(path.resolve(opts.root, f.to));
      } catch (err) {
        pages.push(emptyMetrics(pkg, path.relative(opts.root, e), String(err)));
      }
    }

    for (const [e, p] of pruned) {
      if (owned.has(e)) continue;
      const rel = path.relative(opts.root, e);
      const bound = bindPage(p, rel, 'scan', { libAliases });
      const nodes = bound.pages.flatMap((q) => q.nodes);
      const pfByFile = new Map(p.files.map((f) => [f.file, f]));
      const m: PageMetrics = {
        pkg,
        entry: rel,
        files: p.files.length,
        nodes: nodes.length,
        bound: 0,
        needs_kit: 0,
        needs_probe: 0,
        unresolved_custom: 0,
        unbound: 0,
        candidate: 0,
        coverage: null,
        spreads: p.files.reduce((a, f) => a + f.stats.spreads, 0),
        mapJsx: p.files.reduce((a, f) => a + f.stats.mapJsx, 0),
        truncated: p.files.some((f) => f.truncated),
        causes: {},
      };
      const addCause = (c: string) => {
        m.causes[c] = (m.causes[c] ?? 0) + 1;
        causeCount.set(c, (causeCount.get(c) ?? 0) + 1);
        if (!causePages.has(c)) causePages.set(c, new Set());
        causePages.get(c)!.add(rel);
        const arr = (samples[c] ??= []);
        if (arr.length < 3 && !arr.includes(rel)) arr.push(rel);
      };
      const gapOfNode = new Map<string, LocGap>();
      for (const g of bound.gaps) if (g.node_id) gapOfNode.set(g.node_id, g);
      for (const n of nodes) {
        if (REGION_ONLY.has(n.component)) continue;
        if (n.locator_status === 'bound') m.bound++;
        else if (n.locator_status === 'needs_kit') m.needs_kit++;
        else if (n.locator_status === 'needs_probe') m.needs_probe++;
        else if (n.locator_status === 'unresolved_custom') m.unresolved_custom++;
        else {
          m.unbound++;
          if (n.suggest) m.candidate++;
        }
        if (n.locator_status === 'bound') continue;
        const g = gapOfNode.get(n.id);
        const file = n.evidence[0]?.file;
        addCause(g?.cause ?? unboundCause(n, file ? pfByFile.get(file) : undefined));
      }
      for (const g of bound.gaps) if (!g.node_id) addCause(g.type === 'large_file_truncated' ? 'file_truncated' : `gap:${g.type}`);
      if (m.spreads) addCause('props_spread');
      if (m.mapJsx) addCause('map_repeat');
      const denom = m.bound + m.needs_kit + m.needs_probe + m.unresolved_custom + m.unbound;
      m.coverage = pct(m.bound, denom);
      pages.push(m);
    }

    const mine = pages.filter((x) => x.pkg === pkg);
    const nodesN = mine.reduce((a, x) => a + x.bound + x.needs_kit + x.needs_probe + x.unresolved_custom + x.unbound, 0);
    const boundN = mine.reduce((a, x) => a + x.bound, 0);
    const candN = mine.reduce((a, x) => a + x.candidate, 0);
    pkgInfo.push({ name: pkg, pages: mine.length, nodes: nodesN, bound: boundN, candidate: candN, coverage: pct(boundN, nodesN), coverageWithCandidate: pct(boundN + candN, nodesN), aliases });
  }

  const totalNodes = pkgInfo.reduce((a, x) => a + x.nodes, 0);
  const totalBound = pkgInfo.reduce((a, x) => a + x.bound, 0);
  const totalCand = pkgInfo.reduce((a, x) => a + x.candidate, 0);
  const summary: ScanSummary = {
    generatedAt: new Date().toISOString(),
    root: opts.root,
    packages: pkgInfo,
    total: {
      pages: pages.length,
      nodes: totalNodes,
      bound: totalBound,
      candidate: totalCand,
      coverage: pct(totalBound, totalNodes),
      coverageWithCandidate: pct(totalBound + totalCand, totalNodes),
      errors: pages.filter((x) => x.error).length,
      truncated: pages.filter((x) => x.truncated).length,
    },
    causes: [...causeCount.entries()]
      .map(([cause, count]) => ({ cause, count, pages: causePages.get(cause)!.size, examples: samples[cause] ?? [] }))
      .sort((a, b) => b.count - a.count),
  };
  return { summary, pages, samples };
}

function emptyMetrics(pkg: string, entry: string, error: string): PageMetrics {
  return { pkg, entry, files: 0, nodes: 0, bound: 0, needs_kit: 0, needs_probe: 0, unresolved_custom: 0, unbound: 0, candidate: 0, coverage: null, spreads: 0, mapJsx: 0, truncated: false, error, causes: {} };
}

export function renderSummaryMd(s: ScanSummary): string {
  const L: string[] = [];
  L.push(`# 页面 DOM 解析体检`, '', `- 生成时间：${s.generatedAt}`, `- 扫描根：${s.root}`);
  L.push(`- 页面 ${s.total.pages}，节点 ${s.total.nodes}，已绑定 ${s.total.bound}，**严格覆盖率 ${s.total.coverage ?? '-'}%**（含按钮 role+name 候选 ${s.total.coverageWithCandidate ?? '-'}%）`);
  L.push(`- 解析异常 ${s.total.errors}，文件截断 ${s.total.truncated}`, '', '## 按包', '', '| 包 | 页面 | 节点 | 已绑定 | 严格% | 含候选% | 本地别名 |', '|---|---|---|---|---|---|---|');
  for (const p of s.packages) L.push(`| ${p.name} | ${p.pages} | ${p.nodes} | ${p.bound} | ${p.coverage ?? '-'} | ${p.coverageWithCandidate ?? '-'} | ${Object.keys(p.aliases).join(',') || '-'} |`);
  L.push('', '## 缺口原因排行（按节点数）', '', '| 原因 | 节点数 | 涉及页面 | 示例 |', '|---|---|---|---|');
  for (const c of s.causes.slice(0, 40)) L.push(`| ${c.cause} | ${c.count} | ${c.pages} | ${c.examples[0] ?? ''} |`);
  return L.join('\n') + '\n';
}

export function renderPagesCsv(pages: PageMetrics[]): string {
  const head = 'pkg,entry,files,nodes,bound,needs_kit,needs_probe,unresolved_custom,unbound,candidate,coverage,spreads,mapJsx,truncated,error';
  const rows = pages.map((p) =>
    [p.pkg, p.entry, p.files, p.nodes, p.bound, p.needs_kit, p.needs_probe, p.unresolved_custom, p.unbound, p.candidate, p.coverage ?? '', p.spreads, p.mapJsx, p.truncated, JSON.stringify(p.error ?? '')].join(','),
  );
  return [head, ...rows].join('\n') + '\n';
}

export function renderSamplesMd(samples: Record<string, string[]>, causes: ScanSummary['causes']): string {
  const L = ['# 缺口代表页面（每类至多 3 个，用来挑黄金样本）', ''];
  for (const c of causes) L.push(`## ${c.cause}（${c.count} 节点 / ${c.pages} 页）`, ...(samples[c.cause] ?? []).map((x) => `- ${x}`), '');
  return L.join('\n');
}
