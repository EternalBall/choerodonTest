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
import { applyDataStrategy } from './dataStrategy.js';
import { dropSelfReady, findDanglingRefs, formatDangling, type DanglingRefs } from './suiteRefs.js';

export type GenPipelineResult = {
  outputSlug: string;
  artifact: FeatureArtifact;
  /** 本次从源码分析新写入的元操作文件；读已有 artifact 时为 undefined */
  artifactFile?: string;
  caseFile?: string;
  elFile?: string;
  suite?: Suite;
  /** 用例引用了但元素库没有的元素；非空表示这些用例不可执行 */
  dangling?: DanglingRefs[];
  /** 引用检查报告文件 */
  refCheckFile?: string;
};

/**
 * artifacts 路径描述 → DeepSeek LLM → 可执行 suite。
 * 无规则编译兜底；须配置 DEEPSEEK_API_KEY。
 */
export async function featureToSuite(
  artifact: FeatureArtifact,
  baseURL?: string,
): Promise<Suite> {
  const { buildFeatureElementLib } = await import('../knowledge/platformKit.js');
  const lib = await buildFeatureElementLib(artifact.feature, artifact);
  return (await llmGenSuite({ artifact, baseURL, elementKeys: Object.keys(lib) })).suite;
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
  /** 生成用例时模型声明的元素：只补元素库没有的 key，不覆盖 kit / 人工 / 探针定义 */
  generated?: Record<string, Record<string, unknown>>,
): Promise<string> {
  const ns = featureOutputSlug(feature);
  const { buildFeatureElementLib } = await import('../knowledge/platformKit.js');
  const merged = await buildFeatureElementLib(feature, artifact);
  const addedFromGen: string[] = [];
  for (const [k, def] of Object.entries(generated ?? {})) {
    if (k in merged) continue;
    merged[k] = def;
    addedFromGen.push(k);
  }

  const stub: Record<string, Record<string, unknown>> = { [ns]: merged };
  const file = featureElementsFile(outputSlug ?? feature);
  const header =
    `# generated from knowledge/platform + knowledge/features — do not hand-edit as source of truth\n` +
    `# curated overrides: knowledge/features/${featureSlug(feature)}/elements.yaml\n` +
    (addedFromGen.length
      ? `# 由用例生成时声明（仅界面语义定位，未经探针校准）: ${addedFromGen.join(', ')}\n`
      : '');
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

  // 元素库与用例必须来自同一次生成：先建元素库，把可用 key 交给模型；
  // 模型补充声明的元素写回同一份元素库，最后逐条核对引用
  const { buildFeatureElementLib } = await import('../knowledge/platformKit.js');
  const baseLib = await buildFeatureElementLib(artifact.feature, artifact);
  const { suite, elements } = await llmGenSuite({ artifact, baseURL, elementKeys: Object.keys(baseLib) });
  const elFile = await writeFeatureElementsStub(artifact.feature, artifact, outputSlug, elements.accepted);

  const ns = featureOutputSlug(artifact.feature);
  const lib = { [ns]: (YAML.parse(await fs.readFile(elFile, 'utf8')) as Record<string, Record<string, unknown>>)[ns] };
  const selfReady = dropSelfReady(suite, lib);
  if (selfReady.length) {
    logger.warn({ fixes: selfReady }, '已去掉「点击后等被点元素自身可见」的就绪条件（编辑/切换类按钮点完即消失）');
  }
  const dataStrategy = applyDataStrategy(suite);
  const caseFile = await writeGeneratedSuite(suite, artifact.feature, outputSlug);
  const dangling = findDanglingRefs(suite, lib, [ns]);
  const refCheckFile = path.join(path.dirname(caseFile), 'ref-check.json');
  await fs.writeFile(
    refCheckFile,
    JSON.stringify({ ok: dangling.length === 0, dangling, rejectedElements: elements.rejected, selfReadyDropped: selfReady, dataStrategy }, null, 2),
    'utf8',
  );
  if (dangling.length) {
    logger.warn(
      { refCheckFile, cases: dangling.length },
      `用例引用了元素库中不存在的定义，这些用例执行时会直接判为不可执行：\n${formatDangling(dangling)}`,
    );
  } else {
    logger.info({ refCheckFile }, '用例元素引用核对通过');
  }

  return { outputSlug, artifact, artifactFile, caseFile, elFile, suite, dangling, refCheckFile };
}

/** 源码 → 分析元操作（不写盘，由 runGenPipeline 统一落盘） */
export async function analyzeFeatureFromSource(
  feature: string,
  projectRoot: string,
  opts?: { featureDir?: string; baseline?: string | false },
): Promise<FeatureArtifact> {
  return analyzeFeature({ feature, projectRoot, featureDir: opts?.featureDir, baseline: opts?.baseline });
}
