import fs from 'node:fs/promises';
import path from 'node:path';
import {
  featureBaseSlugFromOutput,
  featureSlug,
  isRunOutputSlug,
  makeRunOutputSlug,
} from '../knowledge/featureSlug.js';
import { PATHS } from './paths.js';

/**
 * 元素命名空间 / 稳定功能键。
 * 产物目录请用 `toArtifactDirName` / `resolveOutputSlugForFeature`。
 */
export function featureOutputSlug(feature: string): string {
  return featureSlug(feature);
}

/**
 * 产物目录名：已是历史带时间戳的 run slug 则原样使用（读取兼容）；
 * 否则按功能名得到稳定 slug。
 */
export function toArtifactDirName(featureOrSlug: string): string {
  if (isRunOutputSlug(featureOrSlug)) return featureOrSlug;
  return featureSlug(featureOrSlug);
}

export function featureArtifactDir(featureOrSlug: string): string {
  return path.join(PATHS.artifacts, toArtifactDirName(featureOrSlug));
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
  return path.join(PATHS.generatedCases, toArtifactDirName(featureOrSlug), 'suite.yaml');
}

/** 编译元素：elements/<slug>/generated.yaml */
export function featureElementsFile(featureOrSlug: string): string {
  return path.join(PATHS.elements, toArtifactDirName(featureOrSlug), 'generated.yaml');
}

/** 旧平铺路径（仅读取兼容） */
function legacyArtifactFile(featureOrSlug: string): string {
  return path.join(PATHS.artifacts, `${toArtifactDirName(featureOrSlug)}.feature.yaml`);
}

/**
 * 列出某功能在 artifacts 下的产物目录（稳定 slug + 历史 `base_timestamp`）。
 * 稳定 slug 优先；历史带时间戳目录按时间戳新→旧。
 */
export async function listOutputSlugsForFeature(feature: string): Promise<string[]> {
  const base = featureSlug(feature);
  let entries: string[];
  try {
    entries = await fs.readdir(PATHS.artifacts);
  } catch {
    return [];
  }

  const matches: string[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (name === base) {
      matches.push(name);
      continue;
    }
    if (isRunOutputSlug(name) && featureBaseSlugFromOutput(name) === base) {
      matches.push(name);
    }
  }

  matches.sort((a, b) => {
    if (a === base && b !== base) return -1;
    if (b === base && a !== base) return 1;
    const ta = isRunOutputSlug(a) ? a.slice(base.length + 1) : '';
    const tb = isRunOutputSlug(b) ? b.slice(base.length + 1) : '';
    return tb.localeCompare(ta);
  });
  return matches;
}

/** 该功能最新产物目录 slug；无则 undefined */
export async function findLatestOutputSlug(feature: string): Promise<string | undefined> {
  const list = await listOutputSlugsForFeature(feature);
  for (const name of list) {
    try {
      await fs.access(path.join(PATHS.artifacts, name, 'feature.yaml'));
      return name;
    } catch {
      // empty / incomplete dir
    }
  }
  return list[0];
}

/**
 * 解析 gen 落盘目录：始终为功能 slug（无时间戳；同功能再次 gen 覆盖同目录）。
 */
export async function resolveOutputSlugForFeature(feature: string): Promise<string> {
  return featureSlug(feature);
}

/**
 * 解析 feature.yaml：优先最新 artifacts/<slug>/feature.yaml，其次旧平铺路径。
 */
export async function resolveFeatureArtifactFile(feature: string): Promise<string> {
  const latest = await findLatestOutputSlug(feature);
  if (latest) {
    return path.join(PATHS.artifacts, latest, 'feature.yaml');
  }
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
 * 从 -i 路径推断功能产物目录名（用于与 analyze 目录对齐）。
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

export type FeatureContext = {
  slug: string;
  artifactFile: string;
  featureDir: string;
};

/**
 * 解析 artifacts 下 feature.yaml 路径 → slug。
 * 支持根目录 current 与 v1/ 等子目录中的副本（compare 时 current 仍指向根目录）。
 */
export function artifactLocationFromFeatureFile(
  featureYamlPath: string,
): { slug: string } | undefined {
  const abs = path.resolve(featureYamlPath);
  if (path.basename(abs) !== 'feature.yaml') return undefined;
  const artifactsBase = path.basename(PATHS.artifacts);
  const dir = path.dirname(abs);
  if (path.basename(path.dirname(dir)) === artifactsBase) {
    return { slug: path.basename(dir) };
  }
  if (path.basename(path.dirname(path.dirname(dir))) === artifactsBase) {
    return { slug: path.basename(path.dirname(dir)) };
  }
  return undefined;
}

/**
 * 从功能名、slug、artifacts/<slug> 目录或 feature.yaml 路径解析产物目录。
 * **current** 始终为 artifacts/<slug>/feature.yaml（不是 v1/ 内副本）。
 * 传入功能名时解析为该功能最新产物目录。
 */
export async function resolveFeatureContext(input: string): Promise<FeatureContext> {
  const trimmed = input.trim();
  const abs = path.isAbsolute(trimmed) ? trimmed : path.resolve(PATHS.root, trimmed);

  if (/\.ya?ml$/i.test(trimmed)) {
    const fromPath = slugFromArtifactInputPath(abs);
    const loc =
      artifactLocationFromFeatureFile(abs) ?? (fromPath ? { slug: fromPath } : undefined);
    if (loc) {
      const featureDir = featureArtifactDir(loc.slug);
      return {
        slug: loc.slug,
        artifactFile: path.join(featureDir, 'feature.yaml'),
        featureDir,
      };
    }
  }

  const featureInDir = path.join(abs, 'feature.yaml');
  try {
    await fs.access(featureInDir);
    if (path.basename(path.dirname(abs)) === path.basename(PATHS.artifacts)) {
      const slug = path.basename(abs);
      return { slug, artifactFile: featureInDir, featureDir: abs };
    }
  } catch {
    // not a feature directory
  }

  // 已是历史带时间戳的产物目录名 → 精确定位
  if (isRunOutputSlug(trimmed)) {
    const featureDir = featureArtifactDir(trimmed);
    return {
      slug: trimmed,
      artifactFile: path.join(featureDir, 'feature.yaml'),
      featureDir,
    };
  }

  // 功能名或 slug → 该功能产物目录（稳定 slug 优先，其次历史带时间戳）
  const latest = await findLatestOutputSlug(trimmed);
  const slug = latest ?? featureSlug(trimmed);
  const featureDir = featureArtifactDir(slug);
  return { slug, artifactFile: path.join(featureDir, 'feature.yaml'), featureDir };
}

export { makeRunOutputSlug, isRunOutputSlug, featureBaseSlugFromOutput };
