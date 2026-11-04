import { createHash } from 'node:crypto';
import path from 'node:path';
import { logger } from '../core/logger.js';
import type { FeatureArtifact } from '../core/schema.js';
import { assignStableOperationIds } from '../core/operationId.js';
import { loadPlaybooksForSources } from '../knowledge/loadPlaybooks.js';
import { loadFeatureElementsOverlay, loadPlatformKit } from '../knowledge/platformKit.js';
import { compileMetaOpsAndFlows } from './compileFlows.js';
import { retrieveFeatureCode } from './retrieve.js';
import { extractPageModel } from './pageModel.js';
import { extractFieldFacts, extractRenderedEditableFields } from './staticExtract.js';
import { normalizeStepElementRefs } from './validateSteps.js';
import { anchorToBaseline, formatBaselineForPrompt, loadBaselineArtifact, pruneUnrenderedFields, repairFromBaseline } from './baselineAnchor.js';
import { llmAnalyzeFeature } from './llmAnalyze.js';
import { applyControlCatalog, buildControlCatalog, stripUnknownElements } from './controlCatalog.js';
import { locatePages, pickPageEntries } from './llmLocate.js';
import { pickEffectiveFeatureDir } from './routeResolve.js';

export type AnalyzeOptions = {
  feature: string;
  projectRoot: string;
  /** 功能源码目录：读取其下完整文件，优先于关键词检索 */
  featureDir?: string;
  /** 基线标签（默认 v1，存在才启用）；false 表示不锚定 */
  baseline?: string | false;
  /** 功能入口路由（父路由或页面路由）：按 config 的 priority 选出运行时生效的源码目录 */
  route?: string;
  /** 参与 priority 比较的其他前端仓库根（如产品源码）；projectRoot 总是排第一，优先级相同时靠前者胜 */
  routeRoots?: string[];
};

/** 目录模式读的是完整文件，默认 80k 上限不够，放宽到 400k */
const FEATURE_DIR_MAX_TOTAL_CHARS = 400_000;

/**
 * 分析功能：检索源码 + playbooks → DeepSeek（能力层）→ 确定性编译 meta_ops/flows。
 * 失败直接抛错，无启发式兜底（ADR 0011）；缺手册则失败（ADR 0007/0008）。
 */
export async function analyzeFeature(opts: AnalyzeOptions): Promise<FeatureArtifact> {
  // 多包同路由时只分析 priority 最高（运行时生效）的那份源码，避免把产品版才有的控件当成存在
  let featureDir = opts.featureDir;
  if (opts.route || featureDir) {
    const picked = await pickEffectiveFeatureDir({
      roots: [opts.projectRoot, ...(opts.routeRoots ?? [])],
      route: opts.route,
      featureDir: featureDir ? path.resolve(opts.projectRoot, featureDir) : undefined,
    });
    featureDir = picked.featureDir;
    if (picked.report.length) logger.info({ featureDir }, `路由生效源码判定：\n${picked.report.join('\n')}`);
  }
  const { snippets } = await retrieveFeatureCode({
    feature: opts.feature,
    projectRoot: opts.projectRoot,
    featureDir,
  });
  // 按源码 import 来源（choerodon-ui/pro vs choerodon-ui）按需选手册
  const playbooks = await loadPlaybooksForSources(snippets.map((s) => s.content));
  // 页面 DOM 结构解析 + 定位绑定：产出 artifacts/<slug>/page-locators.yaml（元素草案并入元素库）
  const entries = pickPageEntries(snippets);
  const located = entries.length
    ? await locatePages({
        feature: opts.feature,
        projectRoot: opts.projectRoot,
        entries,
        playbookIds: playbooks.map((p) => p.id),
      })
    : null;
  // 分析输入（源码片段 + 手册）哈希：与基线一致说明源码没变，直接复用基线，避免 LLM 重新作答带来的波动
  const sourceHash = createHash('sha256')
    .update(JSON.stringify([snippets.map((s) => [s.relativePath, s.content]), playbooks.map((p) => p.id)]))
    .digest('hex')
    .slice(0, 16);
  const base = opts.baseline === false ? undefined : await loadBaselineArtifact(opts.feature, opts.baseline ?? 'v1');
  if (base) logger.info({ operations: base.operations.length }, '使用基线锚定分析');
  if (base?.source_hash === sourceHash && base.flows?.length) {
    logger.info({ sourceHash }, '源码与基线一致，直接复用基线分析结果（未调用 LLM）');
    const facts = extractFieldFacts(snippets);
    return { ...base, field_facts: facts, page_model: extractPageModel(snippets, facts) };
  }
  // 源码控件目录：静态枚举的全部控件，LLM 只能从中选取 element（语义 id，见 controlCatalog.ts）
  const controlCatalog = buildControlCatalog(snippets);
  let raw = await llmAnalyzeFeature({
    feature: opts.feature,
    snippets,
    playbooks,
    maxTotalChars: featureDir ? FEATURE_DIR_MAX_TOTAL_CHARS : undefined,
    // 有控件目录时不注入旧基线：旧基线里的 id 会被 LLM 原样抄回（见 v1 基线循环问题）
    baselineBlock: !controlCatalog.length && base ? formatBaselineForPrompt(base) : undefined,
    controlCatalog,
  });
  if (controlCatalog.length) {
    const applied = applyControlCatalog(raw as unknown as Record<string, unknown>, controlCatalog);
    raw = applied.artifact as unknown as typeof raw;
    if (applied.unverified.length) {
      logger.warn({ refs: applied.unverified }, '步骤引用的 element 不在控件目录中，将清除并记入审查建议');
    }
  } else if (base) {
    raw = repairFromBaseline(anchorToBaseline(raw, base).artifact, base).artifact;
  }
  const knownElements = [
    ...controlCatalog.map((c) => c.id),
    ...Object.keys(await loadPlatformKit()),
    ...Object.keys(await loadFeatureElementsOverlay(opts.feature)),
    ...Object.keys(located?.result.elements_draft[located.result.slug] ?? {}),
  ];
  raw = normalizeStepElementRefs(raw);
  raw = assignStableOperationIds(raw);
  raw = pruneUnrenderedFields(raw, extractRenderedEditableFields(snippets)).artifact;
  if (controlCatalog.length) {
    // 最终检查：所有 element 必须来自控件目录，否则清除并记入审查建议（不让未知 id 进入流程）
    const stripped = stripUnknownElements(raw as unknown as Record<string, unknown>, controlCatalog);
    raw = stripped.artifact as unknown as typeof raw;
    if (stripped.removed.length) {
      logger.warn({ refs: stripped.removed }, '清除不在控件目录中的 element');
      const risks = stripped.removed.map((r) => `控件引用不在源码目录中，已清除：${r}`);
      raw.review_suggestions = {
        ...(raw.review_suggestions ?? {}),
        risks: [...(raw.review_suggestions?.risks ?? []), ...risks],
      } as typeof raw.review_suggestions;
    }
  }
  const artifact = compileMetaOpsAndFlows(raw, { force: true, knownElements });
  if (located) {
    const g = located.result.gaps;
    const risks = [
      ...g.map((x) => `页面定位缺口[${x.type}]${x.node_id ? ` ${x.node_id}` : ''}：${x.detail}（建议 ${x.suggested_action}）`),
      ...located.violations.map((v) => `定位质量门禁#${v.gate}：${v.message}`),
    ];
    if (risks.length) {
      artifact.review_suggestions = {
        ...(artifact.review_suggestions ?? {}),
        risks: [...(artifact.review_suggestions?.risks ?? []), ...risks],
      } as typeof artifact.review_suggestions;
    }
  }
  // 字段事实由 AST 确定性提取，不让 LLM 参与，保证同源码两次分析结果一致
  artifact.field_facts = extractFieldFacts(snippets);
  artifact.page_model = extractPageModel(snippets, artifact.field_facts);
  artifact.source_hash = sourceHash;
  logger.info(
    {
      feature: opts.feature,
      analyzer: artifact.analyzer,
      model: artifact.model,
      operations: artifact.operations.length,
      meta_ops: artifact.meta_ops?.length ?? 0,
      flows: artifact.flows?.length ?? 0,
      field_facts: artifact.field_facts.length,
      playbooks: playbooks.map((p) => p.id),
    },
    'LLM 分析完成并已编译 flows',
  );
  return artifact;
}
