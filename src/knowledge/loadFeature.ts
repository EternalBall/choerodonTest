import path from 'node:path';
import { readYamlFile } from '../core/config.js';
import { PATHS } from '../core/paths.js';
import { FeatureArtifactSchema, type FeatureArtifact } from '../core/schema.js';
import { featureSlug } from './featureSlug.js';

export function knowledgeDir(feature: string): string {
  return path.join(PATHS.knowledge, featureSlug(feature));
}

export async function loadKnowledgeFeature(feature: string): Promise<FeatureArtifact | null> {
  const file = path.join(knowledgeDir(feature), 'feature.yaml');
  try {
    const data = await readYamlFile<unknown>(file);
    return FeatureArtifactSchema.parse(data);
  } catch {
    return null;
  }
}
