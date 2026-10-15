import { logger } from '../core/logger.js';
import type { FeatureArtifact } from '../core/schema.js';
import { retrieveFeatureCode } from './retrieve.js';
import { llmAnalyzeFeature } from './llmAnalyze.js';

export type AnalyzeOptions = {
  feature: string;
  projectRoot: string;
};

/**
 * 分析功能：强制 DeepSeek LLM，失败直接抛错，无启发式兜底。
 */
export async function analyzeFeature(opts: AnalyzeOptions): Promise<FeatureArtifact> {
  const { snippets } = await retrieveFeatureCode({
    feature: opts.feature,
    projectRoot: opts.projectRoot,
  });
  const artifact = await llmAnalyzeFeature({
    feature: opts.feature,
    snippets,
  });
  logger.info(
    {
      feature: opts.feature,
      analyzer: artifact.analyzer,
      model: artifact.model,
      operations: artifact.operations.length,
    },
    'LLM 分析完成',
  );
  return artifact;
}
