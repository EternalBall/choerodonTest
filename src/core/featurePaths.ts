import fs from 'node:fs/promises';
import path from 'node:path';
import { featureSlug } from '../knowledge/featureSlug.js';
import { PATHS } from './paths.js';

/** 功能产物目录：artifacts / cases/generated / elements 下均按 slug 分子目录 */
export function featureOutputSlug(feature: string): string {
  return featureSlug(feature);
}

export function featureArtifactDir(featureOrSlug: string): string {
  return path.join(PATHS.artifacts, featureOutputSlug(featureOrSlug));
}

/** 分析主产物：artifacts/<slug>/feature.yaml */
export function featureArtifactFile(featureOrSlug: string): string {
  return path.join(featureArtifactDir(featureOrSlug), 'feature.yaml');
}

/** LLM 原始响应：artifacts/<slug>/llm.raw.json */
export function featureLlmRawFile(featureOrSlug: string): string {
  return path.join(featureArtifactDir(featureOrSlug), 'llm.raw.json');
}

/** gen 阶段 LLM 原始响应：artifacts/<slug>/gen.llm.raw.json */
export function featureGenLlmRawFile(featureOrSlug: string): string {
  return path.join(featureArtifactDir(featureOrSlug), 'gen.llm.raw.json');
}

/** 编译用例：cases/generated/<slug>/suite.yaml */
export function featureSuiteFile(featureOrSlug: string): string {
  return path.join(PATHS.generatedCases, featureOutputSlug(featureOrSlug), 'suite.yaml');
}

/** 编译元素：elements/<slug>/generated.yaml */
export function featureElementsFile(featureOrSlug: string): string {
  return path.join(PATHS.elements, featureOutputSlug(featureOrSlug), 'generated.yaml');
}

/** 旧平铺路径（仅读取兼容） */
function legacyArtifactFile(featureOrSlug: string): string {
  return path.join(PATHS.artifacts, `${featureOutputSlug(featureOrSlug)}.feature.yaml`);
}

/**
 * 解析 feature.yaml：优先 artifacts/<slug>/feature.yaml，其次旧平铺路径。
 */
export async function resolveFeatureArtifactFile(feature: string): Promise<string> {
  const next = featureArtifactFile(feature);
  try {
    await fs.access(next);
    return next;
  } catch {
    // fall through
  }
  const legacy = legacyArtifactFile(feature);
  try {
    await fs.access(legacy);
    return legacy;
  } catch {
    return next;
  }
}

/**
 * 从 -i 路径推断功能 slug（用于与 analyze 目录对齐）。
 * 支持 artifacts/<slug>/feature.yaml 与 artifacts/<slug>.feature.yaml。
 */
export function slugFromArtifactInputPath(inputPath: string): string | undefined {
  const abs = path.resolve(inputPath);
  const base = path.basename(abs);
  const parent = path.basename(path.dirname(abs));
  const artifactsBase = path.basename(PATHS.artifacts);

  if (base === 'feature.yaml' && path.basename(path.dirname(path.dirname(abs))) === artifactsBase) {
    return parent;
  }
  const m = base.match(/^(.+)\.feature\.ya?ml$/i);
  if (m && path.basename(path.dirname(abs)) === artifactsBase) {
    return m[1];
  }
  return undefined;
}
