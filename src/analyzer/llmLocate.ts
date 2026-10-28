import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { PATHS } from '../core/paths.js';
import { featureArtifactDir } from '../core/featurePaths.js';
import { logger } from '../core/logger.js';
import { featureSlug } from '../knowledge/featureSlug.js';
import { loadPlatformKit } from '../knowledge/platformKit.js';
import { deepSeekChat } from './deepseekClient.js';
import { loadLibAliases } from './libComponents.js';
import { bindPage, type PageLocateResult } from './kitBinding.js';
import { prunePages, renderPrunedTree } from './pruneJsx.js';
import { applyQualityGates, type LocateViolation } from './validateLocate.js';

const PROMPT_FILE = path.join(PATHS.knowledge, '..', 'prompts', 'page-dom-and-locator.md');

export type LocateOptions = {
  feature: string;
  /** 仓库根（裁剪结果里的相对路径以此为基） */
  projectRoot: string;
  /** 页面入口文件（tsx/jsx/js 绝对路径） */
  entries: string[];
  playbookIds?: string[];
};

export type LocateOutcome = {
  result: PageLocateResult;
  violations: LocateViolation[];
  prebinding: PageLocateResult;
};

export function locateOutputFile(feature: string): string {
  return path.join(featureArtifactDir(feature), 'page-locators.yaml');
}

/** 入口文件筛选：从检索片段里取 JSX 页面文件（排除 stores/services/less） */
export function pickPageEntries(snippets: { absolutePath: string; relativePath: string }[]): string[] {
  return snippets
    .filter((s) => /\.(tsx|jsx)$/.test(s.relativePath) || /\/index\.js$/.test(s.relativePath))
    .filter((s) => !/\/(stores|services|models)\//.test(s.relativePath))
    .map((s) => s.absolutePath);
}

export function parseLocateResponse(text: string): unknown {
  const fence = text.match(/```(?:ya?ml|json)?\s*\n([\s\S]*?)```/);
  // 无收尾围栏（输出被截断或模型漏写）时，去掉开头围栏行再解析
  const body = fence ? fence[1] : text.replace(/^\s*```(?:ya?ml|json)?[ \t]*\r?\n/, '');
  // 模型常把以反引号开头的列表项写成未加引号的纯文本，YAML 无法解析
  const quoted = body.replace(/^(\s*- )(`[^\n]*)$/gm, (_, pre: string, rest: string) => `${pre}${JSON.stringify(rest)}`);
  return YAML.parse(quoted);
}

/** 模型常把 locator.evidence 写成 [{file,note}] 列表（与节点 evidence 混淆）：统一压成一行字符串，其余非字符串字段丢弃 */
export function normalizeLocatorDef(d: unknown): Record<string, unknown> {
  const src = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  const ev = src.evidence;
  if (ev !== undefined && typeof ev !== 'string') {
    const items = Array.isArray(ev) ? ev : [ev];
    const text = items
      .map((x) => (x && typeof x === 'object' ? [(x as Record<string, unknown>).file, (x as Record<string, unknown>).note].filter((v) => typeof v === 'string').join(' ') : typeof x === 'string' ? x : ''))
      .filter(Boolean)
      .join('；');
    if (text) out.evidence = text;
    else delete out.evidence;
  }
  for (const f of ['css', 'role', 'name', 'text', 'label', 'placeholder', 'testId', 'within', 'kit', 'status']) {
    if (out[f] !== undefined && typeof out[f] !== 'string') delete out[f];
  }
  return out;
}

export function coerce(raw: unknown, pre: PageLocateResult): PageLocateResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PageLocateResult>;
  const locators = Object.fromEntries(Object.entries(r.locators ?? {}).map(([k, v]) => [k, normalizeLocatorDef(v)])) as PageLocateResult['locators'];
  // 确定性预绑定是权威：模型丢掉的补回，改写过的还原（自动应答曾把 `.c7n-pro-table >> nth=0` 改成不带 nth 的 kit 引用，
  // 会同时匹配两张表）。模型只负责新增预绑定没有的键，不得改动预绑定已产出的定义
  for (const [k, v] of Object.entries(pre.locators)) locators[k] = v;
  // 模型偶尔返回缺 nodes 的页面：丢弃坏页，全坏则退回确定性预绑定的页面
  const goodPages = Array.isArray(r.pages) ? r.pages.filter((p) => p && Array.isArray((p as { nodes?: unknown }).nodes)) : [];
  const pages = goodPages.length ? goodPages : pre.pages;
  // 对账：unbound 节点的 suggest（角色+名称）若恰好有同定义的 locator，就绑到该 key
  for (const p of pages) {
    for (const n of p.nodes) {
      if (n.locator_status !== 'unbound' || !n.suggest?.role) continue;
      const hits = Object.entries(locators).filter(([, d]) => d.role === n.suggest!.role && d.name === n.suggest!.name && d.status !== 'blocked');
      const file = n.evidence?.[0]?.file;
      // 同角色同名多个 key 时，优先证据指向本节点所在文件的那个
      const hit = hits.find(([, d]) => file && d.evidence?.includes(file)) ?? hits[0];
      if (hit) {
        n.locator_key = hit[0];
        n.locator_status = 'bound';
      }
    }
  }
  return {
    schema_version: 'page_dom_locator/v1',
    feature: r.feature ?? pre.feature,
    slug: r.slug ?? pre.slug,
    confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
    pages,
    locators,
    elements_draft_namespace: r.elements_draft_namespace ?? pre.slug,
    elements_draft: r.elements_draft ?? {},
    gaps: [...(Array.isArray(r.gaps) ? r.gaps : []), ...pre.gaps.filter((g) => !(r.gaps ?? []).some((x) => x.node_id && x.node_id === g.node_id && x.type === g.type))],
    followups: Array.isArray(r.followups) ? r.followups : pre.followups,
    notes: Array.isArray(r.notes) ? r.notes : [],
  };
}

/**
 * 页面 DOM 结构解析 + 定位绑定：
 * 1) AST 裁剪 JSX；2) 确定性 kit 预绑定；3) LLM 补全（handoff 模式下会抛 LlmHandoffPendingError）；4) 质量门禁。
 */
export async function locatePages(opts: LocateOptions): Promise<LocateOutcome> {
  const slug = featureSlug(opts.feature);
  const pruned = await prunePages(opts.entries, opts.projectRoot);
  const pre = bindPage(pruned, opts.feature, slug, { libAliases: await loadLibAliases(opts.projectRoot) });
  const kit = await loadPlatformKit();
  const kitKeys = Object.keys(kit);

  const system = await fs.readFile(PROMPT_FILE, 'utf8');
  const user = JSON.stringify(
    {
      feature: opts.feature,
      slug,
      pruned_structure: pruned.files.map((f) => ({ file: f.file, tree: renderPrunedTree(f), unresolved: f.unresolved })),
      followed: pruned.followed,
      deterministic_prebinding: {
        locators: pre.locators,
        gaps: pre.gaps,
        nodes: pre.pages.flatMap((p) =>
          p.nodes.map((n) => ({ id: n.id, component: n.component, status: n.locator_status, key: n.locator_key, suggest: n.suggest })),
        ),
      },
      kit_keys: kitKeys,
      playbook_ids: opts.playbookIds ?? [],
    },
    null,
    1,
  );

  logger.info({ feature: opts.feature, files: pruned.files.length }, '页面 DOM 结构解析：请求 LLM');
  const { content } = await deepSeekChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
  });

  const dir = featureArtifactDir(opts.feature);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'page-locators.raw.txt'), content, 'utf8');

  const merged = coerce(parseLocateResponse(content), pre);
  const { result, violations } = applyQualityGates(merged, { kitKeys: new Set(kitKeys) });
  await fs.writeFile(locateOutputFile(opts.feature), YAML.stringify({ ...result, quality_violations: violations }), 'utf8');
  logger.info(
    { feature: opts.feature, confidence: result.confidence, locators: Object.keys(result.locators).length, gaps: result.gaps.length, violations: violations.length },
    '页面 DOM 结构解析完成',
  );
  return { result, violations, prebinding: pre };
}

/** 读取已生成的定位草案（无则 null） */
export async function loadLocateResult(feature: string): Promise<PageLocateResult | null> {
  try {
    const text = await fs.readFile(locateOutputFile(feature), 'utf8');
    const y = YAML.parse(text) as PageLocateResult;
    return y?.schema_version === 'page_dom_locator/v1' ? y : null;
  } catch {
    return null;
  }
}
