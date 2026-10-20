import { logger } from '../core/logger.js';
import type { FeatureArtifact } from '../core/schema.js';
import { loadPlaybooksForSources } from '../knowledge/loadPlaybooks.js';
import { compileMetaOpsAndFlows } from './compileFlows.js';
import { retrieveFeatureCode } from './retrieve.js';
import { llmAnalyzeFeature } from './llmAnalyze.js';

export type AnalyzeOptions = {
  feature: string;
  projectRoot: string;
};

/**
 * 分析功能：检索源码 + playbooks → DeepSeek（能力层）→ 确定性编译 meta_ops/flows。
 * 失败直接抛错，无启发式兜底（ADR 0011）；缺手册则失败（ADR 0007/0008）。
 */
export async function analyzeFeature(opts: AnalyzeOptions): Promise<FeatureArtifact> {
  const { snippets } = await retrieveFeatureCode({
    feature: opts.feature,
    projectRoot: opts.projectRoot,
  });
  // 按源码 import 来源（choerodon-ui/pro vs choerodon-ui）按需选手册
  const playbooks = await loadPlaybooksForSources(snippets.map((s) => s.content));
  const raw = await llmAnalyzeFeature({
    feature: opts.feature,
    snippets,
    playbooks,
  });
  const artifact = compileMetaOpsAndFlows(raw, { force: true });
  artifact.playbooks = playbooks.map((p) => p.id);
  logger.info(
    {
      feature: opts.feature,
      analyzer: artifact.analyzer,
      model: artifact.model,
      operations: artifact.operations.length,
      meta_ops: artifact.meta_ops?.length ?? 0,
      flows: artifact.flows?.length ?? 0,
      playbooks: playbooks.map((p) => p.id),
    },
    'LLM 分析完成并已编译 flows',
  );
  return artifact;
}
