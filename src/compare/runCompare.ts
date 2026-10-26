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
import { renderReportHtml, renderReportZh } from './renderReportZh.js';
import { diffFeatureArtifacts } from './diffArtifact.js';
import { diffSuites } from './diffSuite.js';
import { llmSummarizeDiff } from './llmSummarizeDiff.js';
import { ataRoot, loadAtaVersion, readAtaRootManifest } from './ataStore.js';
import { featureCompareDir } from './paths.js';
import { artifactLogicChanged } from './diffArtifact.js';
import { renderReportMarkdown } from './renderReportMarkdown.js';
import {
  baselineFeatureFile,
  baselineSuiteFile,
  readBaselineManifest,
  resolveBaselineLabel,
} from './snapshot.js';

export async function runCompare(opts: {
  feature: string;
  baselineLabel?: string;
  /**
   * 指定后基线取目标项目功能目录下 ata/ 的已确认版本（baselineLabel 此时表示 V2 等版本号，缺省最新），
   * 而不是 artifacts/<slug>/v1。未指定时行为与原来完全一致。
   */
  ata?: { projectRoot: string; featureDir: string };
  /** 连元素名/args/状态词等自由取值也比（默认只比稳定属性） */
  strict?: boolean;
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

  // 基线来源适配：ata 版本映射成与 v1 基线相同的 (label, feature, suite, createdAt) 输入
  let label: string;
  let baselineFeature: string;
  let baselineSuite: string;
  let createdAt: string | undefined;
  let baselineSource: { type: 'ata'; path: string; version: string } | undefined;
  if (opts.ata) {
    const root = ataRoot(opts.ata.projectRoot, opts.ata.featureDir);
    const loaded = await loadAtaVersion(root, opts.baselineLabel);
    label = loaded.version;
    baselineFeature = loaded.featureFile;
    baselineSuite = path.join(loaded.dir, 'suite.yaml');
    baselineSource = { type: 'ata', path: root, version: loaded.version };
    createdAt = (await readAtaRootManifest(root))?.versions?.[label]?.confirmed_at;
  } else {
    label = await resolveBaselineLabel(slug, opts.baselineLabel);
    baselineFeature = await baselineFeatureFile(slug, label);
    baselineSuite = await baselineSuiteFile(slug, label);
    createdAt = (await readBaselineManifest(slug)).baselines[label]?.createdAt;
  }
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

  const artifactDiff = diffFeatureArtifacts(beforeArtifact, afterArtifact, { strict: opts.strict });
  const suiteDiff = diffSuites(beforeSuite, afterSuite);
  const logicChanged = artifactLogicChanged(artifactDiff);
  const suiteChanged =
    suiteDiff.added.length > 0 ||
    suiteDiff.removed.length > 0 ||
    suiteDiff.changed.length > 0;
  const suiteOnlyDrift = !logicChanged && suiteChanged;

  const diffDoc = buildDiffYaml({
    feature: afterArtifact.feature || opts.feature,
    slug,
    baselineLabel: label,
    baselineCreatedAt: createdAt,
    baselineSource,
    beforeArtifact,
    afterArtifact,
    artifactDiff,
    suiteDiff: beforeSuite || afterSuite ? suiteDiff : undefined,
    logicChanged,
    suiteOnlyDrift,
    sides: {
      baseline: {
        role: baselineSource ? 'ata' : 'v1',
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

  // 确定性中文报告：先写，不依赖模型
  const zhFile = path.join(compareDir, 'latest-report.zh.md');
  const zhOpts = { doc: diffDoc, before: beforeArtifact, after: afterArtifact };
  await fs.writeFile(zhFile, renderReportZh(zhOpts), 'utf8');
  await fs.writeFile(path.join(compareDir, 'latest-report.zh.html'), renderReportHtml(zhOpts), 'utf8');

  const { report, raw: llmRaw } = await llmSummarizeDiff(diffDoc);
  await fs.writeFile(path.join(compareDir, 'report.llm.raw.json'), llmRaw, 'utf8');

  const reportFile = path.join(compareDir, `report-${stamp}.yaml`);
  const latestReportFile = path.join(compareDir, 'latest-report.yaml');
  await writeYamlFile(reportFile, report);
  await writeYamlFile(latestReportFile, report);

  const reportMd = renderReportMarkdown(report, diffDoc.fields);
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
