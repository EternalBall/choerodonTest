import path from 'node:path';
import { featureArtifactDir } from '../core/featurePaths.js';

/** 默认基线标签；compare 固定为 v1（基线） vs 功能目录根部的 current */
export const BASELINE_LABEL_V1 = 'v1';

/** artifacts/<slug>/<label>/（与 feature.yaml 同目录，如 v1） */
export function featureBaselineDir(slug: string, label: string): string {
  return path.join(featureArtifactDir(slug), label);
}

/** 旧布局：artifacts/<slug>/confirmed/<label>/ */
export function legacyBaselineDir(slug: string, label: string): string {
  return path.join(featureArtifactDir(slug), 'confirmed', label);
}

/** artifacts/<slug>/compare/ */
export function featureCompareDir(slug: string): string {
  return path.join(featureArtifactDir(slug), 'compare');
}

/** artifacts/<slug>/baseline-manifest.yaml */
export function featureBaselineManifestFile(slug: string): string {
  return path.join(featureArtifactDir(slug), 'baseline-manifest.yaml');
}

export function legacyBaselineManifestFile(slug: string): string {
  return path.join(featureArtifactDir(slug), 'confirmed', 'manifest.yaml');
}
