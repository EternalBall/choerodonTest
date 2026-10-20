import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { analyzeFeature } from '../analyzer/analyzeFeature.js';
import { ensureCompiledFlows } from '../analyzer/compileFlows.js';
import { writeYamlFile } from '../core/config.js';
import {
  featureArtifactFile,
  featureElementsFile,
  featureOutputSlug,
  featureSuiteFile,
} from '../core/featurePaths.js';
import type { FeatureArtifact, Suite } from '../core/schema.js';
import { logger } from '../core/logger.js';
import { featureSlug } from '../knowledge/featureSlug.js';
import { llmGenSuite } from './llmGenSuite.js';

export type GenPipelineResult = {
  outputSlug: string;
  artifact: FeatureArtifact;
  /** 本次从源码分析新写入的元操作文件；读已有 artifact 时为 undefined */
  artifactFile?: string;
  caseFile?: string;
  elFile?: string;
  suite?: Suite;
};

/**
 * artifacts 路径描述 → DeepSeek LLM → 可执行 suite。
 * 无规则编译兜底；须配置 DEEPSEEK_API_KEY。
 */
export async function featureToSuite(
  artifact: FeatureArtifact,
  baseURL?: string,
): Promise<Suite> {
  return llmGenSuite({ artifact, baseURL });
}

export async function writeGeneratedSuite(
  suite: Suite,
  feature: string,
  /** 落盘目录 slug；默认与 feature 名一致，便于与 analyze -f 对齐 */
  outputSlug?: string,
): Promise<string> {
  const file = featureSuiteFile(outputSlug ?? feature);
  await writeYamlFile(file, suite);
  logger.info({ file }, '已生成用例配置');
  return file;
}

export async function writeFeatureElementsStub(
  feature: string,
  artifact?: FeatureArtifact,
  /** 落盘目录 slug；默认与 feature 名一致 */
  outputSlug?: string,
): Promise<string> {
  const ns = featureOutputSlug(feature);
  const { buildFeatureElementLib } = await import('../knowledge/platformKit.js');
  const merged = await buildFeatureElementLib(feature, artifact);

  const stub: Record<string, Record<string, unknown>> = { [ns]: merged };
  const file = featureElementsFile(outputSlug ?? feature);
  const header =
    `# generated from knowledge/platform + knowledge/features — do not hand-edit as source of truth\n` +
    `# curated overrides: knowledge/features/${featureSlug(feature)}/elements.yaml\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = YAML.stringify(stub);
  await fs.writeFile(file, header + body, 'utf8');
  logger.info({ file, keys: Object.keys(merged).length }, '已生成元素库（平台 kit 合并）');
  return file;
}

/**
 * 生成阶段统一入口：可选从源码分析元操作，并产出 suite + 元素库。
 * - `fromSource`：LLM 分析源码 → 写入 artifacts/feature.yaml → 再生成测试脚本
 * - 否则：使用已有 artifact，仅生成（或刷新）suite / elements
 */
export async function runGenPipeline(opts: {
  artifact: FeatureArtifact;
  outputSlug: string;
  baseURL?: string;
  /** 从本次 analyze 新得到的产物，落盘元操作文件 */
  writeArtifact?: boolean;
  /** 仅写元操作文件，不生成 suite（兼容旧 analyze） */
  metaOnly?: boolean;
}): Promise<GenPipelineResult> {
  const { outputSlug, baseURL, metaOnly } = opts;
  const hadFlows = !!(opts.artifact.flows?.length && opts.artifact.meta_ops?.length);
  // 旧产物无 flows 时升级编译；已有编排则保留
  const artifact = ensureCompiledFlows(opts.artifact);
  const upgradedFlows = !hadFlows && !!(artifact.flows?.length && artifact.meta_ops?.length);
  let artifactFile: string | undefined;

  if (opts.writeArtifact || upgradedFlows) {
    artifactFile = featureArtifactFile(outputSlug);
    await writeYamlFile(artifactFile, artifact);
    logger.info(
      {
        artifactFile,
        meta_ops: artifact.meta_ops?.length ?? 0,
        flows: artifact.flows?.length ?? 0,
        upgradedFlows,
      },
      '已写入元操作产物',
    );
  }

  if (metaOnly) {
    return { outputSlug, artifact, artifactFile };
  }

  const suite = await featureToSuite(artifact, baseURL);
  const caseFile = await writeGeneratedSuite(suite, artifact.feature, outputSlug);
  const elFile = await writeFeatureElementsStub(artifact.feature, artifact, outputSlug);

  return { outputSlug, artifact, artifactFile, caseFile, elFile, suite };
}

/** 源码 → 分析元操作（不写盘，由 runGenPipeline 统一落盘） */
export async function analyzeFeatureFromSource(
  feature: string,
  projectRoot: string,
): Promise<FeatureArtifact> {
  return analyzeFeature({ feature, projectRoot });
}
