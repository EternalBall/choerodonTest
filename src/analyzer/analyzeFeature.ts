import { createHash } from 'node:crypto';
import { logger } from '../core/logger.js';
import type { FeatureArtifact } from '../core/schema.js';
import { loadPlaybooksForSources } from '../knowledge/loadPlaybooks.js';
import { loadFeatureElementsOverlay, loadPlatformKit } from '../knowledge/platformKit.js';
import { compileMetaOpsAndFlows } from './compileFlows.js';
import { retrieveFeatureCode } from './retrieve.js';
import { extractFieldFacts } from './staticExtract.js';
import { anchorToBaseline, formatBaselineForPrompt, loadBaselineArtifact } from './baselineAnchor.js';
import { llmAnalyzeFeature } from './llmAnalyze.js';
import { locatePages, pickPageEntries } from './llmLocate.js';

export type AnalyzeOptions = {
  feature: string;
  projectRoot: string;
  /** 功能源码目录：读取其下完整文件，优先于关键词检索 */
  featureDir?: string;
  /** 基线标签（默认 v1，存在才启用）；false 表示不锚定 */
  baseline?: string | false;
};

/** 目录模式读的是完整文件，默认 80k 上限不够，放宽到 400k */
const FEATURE_DIR_MAX_TOTAL_CHARS = 400_000;

/**
 * 分析功能：检索源码 + playbooks → DeepSeek（能力层）→ 确定性编译 meta_ops/flows。
 * 失败直接抛错，无启发式兜底（ADR 0011）；缺手册则失败（ADR 0007/0008）。
 */
export async function analyzeFeature(opts: AnalyzeOptions): Promise<FeatureArtifact> {
  const { snippets } = await retrieveFeatureCode({
    feature: opts.feature,
    projectRoot: opts.projectRoot,
    featureDir: opts.featureDir,
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
    return { ...base, field_facts: extractFieldFacts(snippets) };
  }
  let raw = await llmAnalyzeFeature({
    feature: opts.feature,
    snippets,
    playbooks,
    maxTotalChars: opts.featureDir ? FEATURE_DIR_MAX_TOTAL_CHARS : undefined,
    baselineBlock: base ? formatBaselineForPrompt(base) : undefined,
  });
  if (base) raw = anchorToBaseline(raw, base).artifact;
  const knownElements = [
    ...Object.keys(await loadPlatformKit()),
    ...Object.keys(await loadFeatureElementsOverlay(opts.feature)),
    ...Object.keys(located?.result.elements_draft[located.result.slug] ?? {}),
  ];
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
