import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录 */
export const ROOT = path.resolve(here, '../..');

export const PATHS = {
  root: ROOT,
  configs: path.join(ROOT, 'configs'),
  elements: path.join(ROOT, 'elements'),
  cases: path.join(ROOT, 'cases'),
  generatedCases: path.join(ROOT, 'cases', 'generated'),
  artifacts: path.join(ROOT, 'artifacts'),
  artifactsDom: path.join(ROOT, 'artifacts', 'dom'),
  knowledge: path.join(ROOT, 'knowledge', 'features'),
  platformKnowledge: path.join(ROOT, 'knowledge', 'platform'),
  authDir: path.join(ROOT, 'playwright', '.auth'),
  authFile: path.join(ROOT, 'playwright', '.auth', 'user.json'),
  reports: path.join(ROOT, 'reports'),
  envFile: path.join(ROOT, 'configs', 'env.yaml'),
} as const;
