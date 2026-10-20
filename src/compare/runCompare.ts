import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { writeYamlFile } from '../core/config.js';
import {
  featureArtifactFile,
  featureSuiteFile,
  resolveFeatureContext,
} from '../core/featurePaths.js';
import { FeatureArtifactSchema, SuiteSchema } from '../core/schema.js';
import { buildDiffYaml } from './buildDiffYaml.js';
import { diffFeatureArtifacts } from './diffArtifact.js';
import { diffSuites } from './diffSuite.js';
import { fallbackReportFromDiff, llmSummarizeDiff } from './llmSummarizeDiff.js';
import { featureCompareDir } from './paths.js';
import { renderReportMarkdown } from './renderReportMarkdown.js';
import { artifactLogicChanged } from './renderChangeNarrative.js';
import {
  baselineFeatureFile,
  baselineSuiteFile,
  readBaselineManifest,
  resolveBaselineLabel,
} from './snapshot.js';

export async function runCompare(opts: {
  feature: string;
  baselineLabel?: string;
  skipLlm?: boolean;
}): Promise<{
  diffFile: string;
  latestDiffFile: string;
  reportFile: string;
  latestReportFile: string;
  reportMdFile: string;
  logicChanged: boolean;
  suiteOnlyDrift: boolean;
}> {
  const ctx = await resolveFeatureContext(opts.feature);
  const { slug, artifactFile: currentFeature } = ctx;
  const label = await resolveBaselineLabel(slug, opts.baselineLabel);

  const baselineFeature = await baselineFeatureFile(slug, label);
  const baselineSuite = await baselineSuiteFile(slug, label);
  const currentSuite = featureSuiteFile(slug);

  const beforeArtifact = FeatureArtifactSchema.parse(
    parse(await fs.readFile(baselineFeature, 'utf8')),
  );
  const afterArtifact = FeatureArtifactSchema.parse(
    parse(await fs.readFile(currentFeature, 'utf8')),
  );

  let beforeSuite;
  let afterSuite;
  try {
    await fs.access(baselineSuite);
    beforeSuite = SuiteSchema.parse(parse(await fs.readFile(baselineSuite, 'utf8')));
  } catch {
    beforeSuite = undefined;
  }
  try {
    afterSuite = SuiteSchema.parse(parse(await fs.readFile(currentSuite, 'utf8')));
  } catch {
    afterSuite = undefined;
  }

  const artifactDiff = diffFeatureArtifacts(beforeArtifact, afterArtifact);
  const suiteDiff = diffSuites(beforeSuite, afterSuite);
  const logicChanged = artifactLogicChanged(artifactDiff);
  const suiteChanged =
    suiteDiff.added.length > 0 ||
    suiteDiff.removed.length > 0 ||
    suiteDiff.changed.length > 0;
  const suiteOnlyDrift = !logicChanged && suiteChanged;

  const manifest = await readBaselineManifest(slug);
  const createdAt = manifest.baselines[label]?.createdAt;

  const diffDoc = buildDiffYaml({
    feature: afterArtifact.feature || opts.feature,
    slug,
    baselineLabel: label,
    baselineCreatedAt: createdAt,
    beforeArtifact,
    afterArtifact,
    artifactDiff,
    suiteDiff: beforeSuite || afterSuite ? suiteDiff : undefined,
    logicChanged,
    suiteOnlyDrift,
    sides: {
      baseline: {
        role: 'v1',
        feature: baselineFeature,
        suite: beforeSuite ? baselineSuite : undefined,
      },
      current: {
        role: 'current',
        feature: currentFeature,
        suite: afterSuite ? currentSuite : undefined,
      },
    },
  });

  const compareDir = featureCompareDir(slug);
  await fs.mkdir(compareDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const diffFile = path.join(compareDir, `diff-${stamp}.yaml`);
  const latestDiffFile = path.join(compareDir, 'latest-diff.yaml');
  await writeYamlFile(diffFile, diffDoc);
  await writeYamlFile(latestDiffFile, diffDoc);

  let report;
  let llmRaw: string | undefined;
  if (opts.skipLlm) {
    report = fallbackReportFromDiff(diffDoc);
  } else {
    try {
      const llm = await llmSummarizeDiff(diffDoc);
      report = llm.report;
      llmRaw = llm.raw;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('DEEPSEEK_API_KEY') || msg.includes('缺少')) {
        report = fallbackReportFromDiff(diffDoc);
        report.risks = [...report.risks, '未配置 LLM，报告为规则兜底；配置 DEEPSEEK_API_KEY 后可生成完整叙述'];
      } else {
        throw err;
      }
    }
  }

  if (llmRaw) {
    await fs.writeFile(path.join(compareDir, 'report.llm.raw.json'), llmRaw, 'utf8');
  }

  const reportFile = path.join(compareDir, `report-${stamp}.yaml`);
  const latestReportFile = path.join(compareDir, 'latest-report.yaml');
  await writeYamlFile(reportFile, report);
  await writeYamlFile(latestReportFile, report);

  const reportMd = renderReportMarkdown(report);
  const reportMdFile = path.join(compareDir, 'latest-report.md');
  await fs.writeFile(path.join(compareDir, `report-${stamp}.md`), reportMd, 'utf8');
  await fs.writeFile(reportMdFile, reportMd, 'utf8');

  return {
    diffFile,
    latestDiffFile,
    reportFile,
    latestReportFile,
    reportMdFile,
    logicChanged,
    suiteOnlyDrift,
  };
}
