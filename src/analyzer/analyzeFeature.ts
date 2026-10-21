import { logger } from '../core/logger.js';
import type { FeatureArtifact } from '../core/schema.js';
import { loadPlaybooksForSources } from '../knowledge/loadPlaybooks.js';
import { loadFeatureElementsOverlay, loadPlatformKit } from '../knowledge/platformKit.js';
import { compileMetaOpsAndFlows } from './compileFlows.js';
import {
  applyConfigRoutes,
  loadPackageRouteIndex,
} from './extractPackageRoutes.js';
import { retrieveFeatureCode } from './retrieve.js';
import { extractFieldFacts } from './staticExtract.js';
import { llmAnalyzeFeature } from './llmAnalyze.js';

export type AnalyzeOptions = {
  feature: string;
  projectRoot: string;
  /** 功能源码目录：读取其下完整文件，优先于关键词检索 */
  featureDir?: string;
};

/** 目录模式读的是完整文件，默认 80k 上限不够，放宽到 400k */
const FEATURE_DIR_MAX_TOTAL_CHARS = 400_000;

/**
 * 分析功能：检索源码 + playbooks → DeepSeek（能力层）→ config.ts 覆盖路由 → 编译 meta_ops/flows。
 * 失败直接抛错，无启发式兜底（ADR 0011）；缺手册则失败（ADR 0007/0008）。
 * entry/pages 路由以 packages 下各包 config/config.ts 为准，不采信模型推断。
 */
export async function analyzeFeature(opts: AnalyzeOptions): Promise<FeatureArtifact> {
  const { snippets } = await retrieveFeatureCode({
    feature: opts.feature,
    projectRoot: opts.projectRoot,
    featureDir: opts.featureDir,
  });
  // 按源码 import 来源（choerodon-ui/pro vs choerodon-ui）按需选手册
  const playbooks = await loadPlaybooksForSources(snippets.map((s) => s.content));
  const raw = await llmAnalyzeFeature({
    feature: opts.feature,
    snippets,
    playbooks,
    maxTotalChars: opts.featureDir ? FEATURE_DIR_MAX_TOTAL_CHARS : undefined,
  });
  // 路由：从 monorepo packages/<pkg>/config/config.ts 按 component 对齐覆盖（确定性）
  const routeIndex = await loadPackageRouteIndex(opts.projectRoot);
  const withRoutes = applyConfigRoutes(raw, {
    index: routeIndex,
    snippets,
    projectRoot: opts.projectRoot,
    featureDir: opts.featureDir,
  });
  const knownElements = [
    ...Object.keys(await loadPlatformKit()),
    ...Object.keys(await loadFeatureElementsOverlay(opts.feature)),
  ];
  const artifact = compileMetaOpsAndFlows(withRoutes, { force: true, knownElements });
  // 字段事实由 AST 确定性提取，不让 LLM 参与，保证同源码两次分析结果一致
  artifact.field_facts = extractFieldFacts(snippets);
  artifact.playbooks = playbooks.map((p) => p.id);
  logger.info(
    {
      feature: opts.feature,
      analyzer: artifact.analyzer,
      model: artifact.model,
      entry: artifact.entry.route,
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
