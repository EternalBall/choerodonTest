import { logger } from '../core/logger.js';
import type { FeatureArtifact } from '../core/schema.js';
import { loadPlaybooks } from '../knowledge/loadPlaybooks.js';
import { retrieveFeatureCode } from './retrieve.js';
import { llmAnalyzeFeature } from './llmAnalyze.js';

export type AnalyzeOptions = {
  feature: string;
  projectRoot: string;
};

/**
 * 分析功能：检索源码 + 加载 playbooks → DeepSeek LLM → artifacts。
 * 失败直接抛错，无启发式兜底（ADR 0011）；缺手册则失败（ADR 0007/0008）。
 */
export async function analyzeFeature(opts: AnalyzeOptions): Promise<FeatureArtifact> {
  const playbooks = await loadPlaybooks();
  const { snippets } = await retrieveFeatureCode({
    feature: opts.feature,
    projectRoot: opts.projectRoot,
  });
  const artifact = await llmAnalyzeFeature({
    feature: opts.feature,
    snippets,
    playbooks,
  });
  logger.info(
    {
      feature: opts.feature,
      analyzer: artifact.analyzer,
      model: artifact.model,
      operations: artifact.operations.length,
      playbooks: playbooks.map((p) => p.id),
    },
    'LLM 分析完成',
  );
  return artifact;
}
