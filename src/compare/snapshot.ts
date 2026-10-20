import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  featureElementsFile,
  featureSuiteFile,
  resolveFeatureContext,
} from '../core/featurePaths.js';
import { writeYamlFile } from '../core/config.js';
import {
  BASELINE_LABEL_V1,
  featureBaselineDir,
  featureBaselineManifestFile,
  legacyBaselineDir,
  legacyBaselineManifestFile,
} from './paths.js';

export { BASELINE_LABEL_V1 };

export type BaselineManifest = {
  latest?: string;
  baselines: Record<
    string,
    {
      createdAt: string;
      feature: string;
      slug: string;
      note?: string;
    }
  >;
};

export async function readBaselineManifest(slug: string): Promise<BaselineManifest> {
  for (const file of [featureBaselineManifestFile(slug), legacyBaselineManifestFile(slug)]) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return YAML.parse(raw) as BaselineManifest;
    } catch {
      // try next
    }
  }
  return { baselines: {} };
}

async function writeBaselineManifest(slug: string, manifest: BaselineManifest): Promise<void> {
  await writeYamlFile(featureBaselineManifestFile(slug), manifest);
}

async function copyIfExists(src: string, dest: string): Promise<boolean> {
  try {
    await fs.access(src);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    return true;
  } catch {
    return false;
  }
}

/**
 * 将 current（feature.yaml + suite + elements）固化为 artifacts/<slug>/<label>/ 基线。
 */
export async function snapshotBaseline(opts: {
  feature: string;
  label: string;
  note?: string;
}): Promise<{ dir: string; label: string; slug: string }> {
  const ctx = await resolveFeatureContext(opts.feature);
  const { slug, artifactFile } = ctx;
  const dir = featureBaselineDir(slug, opts.label);
  await fs.mkdir(dir, { recursive: true });

  const suiteSrc = featureSuiteFile(slug);
  const elSrc = featureElementsFile(slug);

  try {
    await fs.access(artifactFile);
  } catch {
    throw new Error(
      `缺少当前元操作: ${artifactFile}，请先 pnpm ata gen，或使用 -f artifacts/<slug>/feature.yaml`,
    );
  }

  await fs.copyFile(artifactFile, path.join(dir, 'feature.yaml'));

  const hasSuite = await copyIfExists(suiteSrc, path.join(dir, 'suite.yaml'));
  await copyIfExists(elSrc, path.join(dir, 'generated.yaml'));

  const manifest = await readBaselineManifest(slug);
  manifest.baselines[opts.label] = {
    createdAt: new Date().toISOString(),
    feature: opts.feature,
    slug,
    note: opts.note,
  };
  manifest.latest = opts.label;
  await writeBaselineManifest(slug, manifest);

  if (!hasSuite) {
    console.warn(`警告: 未找到测试脚本 ${suiteSrc}，基线仅含 feature.yaml`);
  }

  return { dir, label: opts.label, slug };
}

/** compare 默认对比 v1 基线与 current；仅当显式 -b 时才用其它标签 */
export async function resolveBaselineLabel(
  slug: string,
  label?: string,
): Promise<string> {
  const target = label ?? BASELINE_LABEL_V1;
  const baselinePath = await baselineFeatureFile(slug, target);
  try {
    await fs.access(baselinePath);
    return target;
  } catch {
    if (label) {
      throw new Error(`基线 ${label} 不存在: ${baselinePath}，请先 pnpm ata snapshot -l ${label}`);
    }
    throw new Error(
      `缺少 v1 基线: ${baselinePath}。请先 pnpm ata snapshot -f artifacts/<slug>/feature.yaml -l v1`,
    );
  }
}

async function firstExistingFile(...candidates: string[]): Promise<string | undefined> {
  for (const f of candidates) {
    try {
      await fs.access(f);
      return f;
    } catch {
      // continue
    }
  }
  return undefined;
}

export async function baselineFeatureFile(slug: string, label: string): Promise<string> {
  const found = await firstExistingFile(
    path.join(featureBaselineDir(slug, label), 'feature.yaml'),
    path.join(legacyBaselineDir(slug, label), 'feature.yaml'),
  );
  return found ?? path.join(featureBaselineDir(slug, label), 'feature.yaml');
}

export async function baselineSuiteFile(slug: string, label: string): Promise<string> {
  const found = await firstExistingFile(
    path.join(featureBaselineDir(slug, label), 'suite.yaml'),
    path.join(legacyBaselineDir(slug, label), 'suite.yaml'),
  );
  return found ?? path.join(featureBaselineDir(slug, label), 'suite.yaml');
}
