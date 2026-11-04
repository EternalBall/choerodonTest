import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import dotenv from 'dotenv';
import {
  analyzeFeatureFromSource,
  runGenPipeline,
} from '../codegen/genCase.js';
import { loadEnvConfig } from '../core/config.js';
import {
  featureArtifactFile,
  featureSuiteFile,
  featureOutputSlug,
  resolveFeatureArtifactFile,
  resolveFeatureContext,
  resolveOutputSlugForFeature,
  slugFromArtifactInputPath,
  findLatestOutputSlug,
  featureArtifactDir,
} from '../core/featurePaths.js';
import { logger } from '../core/logger.js';
import { PATHS } from '../core/paths.js';
import { listActions } from '../keywords/index.js';
import { loadKnowledgeFeature } from '../knowledge/loadFeature.js';
import { FeatureArtifactSchema } from '../core/schema.js';
import { runCompare } from '../compare/runCompare.js';
import {
  ataRoot,
  confirmAtaVersion,
  listAtaVersions,
  loadAtaVersion,
  nextAtaVersion,
  readAtaRootManifest,
} from '../compare/ataStore.js';
import { diffFeatureArtifacts } from '../compare/diffArtifact.js';
import { readBaselineManifest, snapshotBaseline } from '../compare/snapshot.js';
import { maybePromptArchiveV1BeforeGen } from './promptArchiveBeforeGen.js';
import { retrieveFeatureCode } from '../analyzer/retrieve.js';
import { buildControlCatalog } from '../analyzer/controlCatalog.js';
import { extractFieldFacts } from '../analyzer/staticExtract.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import readline from 'node:readline';
import { LlmHandoffPendingError } from '../analyzer/deepseekClient.js';
import { compileMetaOpsAndFlows } from '../analyzer/compileFlows.js';

dotenv.config();

/**
 * 被测前端源码根默认值：本仓库放在 /data/pdl/code/choerodonTest，
 * 被测代码在 /data/pdl/repos/pdl-front，故相对路径为 ../../repos/pdl-front。
 * 可用 .env 的 TARGET_PROJECT 或命令行 -p 覆盖。
 */
const TARGET_PROJECT_DEFAULT = process.env.TARGET_PROJECT || '../../repos/pdl-front';
/** 参与路由 priority 比较的其他前端仓库根（逗号分隔，如产品源码）；被测项目根总排第一 */
const ROUTE_ROOTS_DEFAULT = process.env.ATA_ROUTE_ROOTS || '';
const splitRoots = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const ROUTE_OPT = ['--route <path>', '功能入口路由（如 /hmes/acquisition/data-collection）：按各包 config 的 priority 取运行时生效的源码目录'] as const;
const ROUTE_ROOTS_OPT = ['--route-roots <list>', '参与 priority 比较的其他前端仓库根，逗号分隔（默认 ATA_ROUTE_ROOTS）', ROUTE_ROOTS_DEFAULT] as const;

async function ensureDirs() {
  for (const d of [
    PATHS.artifacts,
    PATHS.generatedCases,
    PATHS.authDir,
    PATHS.reports,
    PATHS.elements,
    PATHS.cases,
    PATHS.knowledge,
    PATHS.platformKnowledge,
    PATHS.playbooks,
  ]) {
    await fs.mkdir(d, { recursive: true });
  }
}

function runPlaywright(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['playwright', 'test', ...args], {
      cwd: PATHS.root,
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const program = new Command();

program
  .name('ata')
  .description('gen：元操作 + 测试脚本；test：Playwright 执行')
  .version('0.1.0');

program
  .command('actions')
  .description('列出 compile 支持的 Playwright 关键字 action')
  .action(() => {
    console.log(listActions().join('\n'));
  });

function printArtifactSummary(artifact: import('../core/schema.js').FeatureArtifact) {
  console.log(
    `  引擎: ${artifact.analyzer || 'deepseek'}${artifact.model ? ` (${artifact.model})` : ''}`,
  );
  console.log(`  操作: ${artifact.operations.map((o) => o.name).join('、')}`);
  console.log(`  入口: ${artifact.entry.route}`);
  if (artifact.meta_ops?.length) {
    console.log(`  元操作: ${artifact.meta_ops.length} 条`);
  }
  if (artifact.flows?.length) {
    console.log(`  flows: ${artifact.flows.length} 条`);
  }
  console.log(`  置信度: ${artifact.confidence}`);
}

program
  .command('analyze')
  .description('已合并到 gen；仅写出元操作文件（等同 gen -f -p --meta-only）')
  .requiredOption('-f, --feature <name>', '功能名，如 Material / 物料维护')
  .option('-p, --project <path>', '被测前端源码根目录', TARGET_PROJECT_DEFAULT)
  .option('-d, --dir <path>', '功能源码目录，读取该目录下完整文件，优先于关键词检索')
  .option('--baseline <label>', '用该基线锚定分析 id 与结构（默认 v1，存在才启用）')
  .option('--no-baseline', '不使用基线锚定')
  .option(...ROUTE_OPT)
  .option(...ROUTE_ROOTS_OPT)
  .action(async (opts: { feature: string; project: string; dir?: string; baseline?: string | boolean; route?: string; routeRoots?: string }) => {
    await ensureDirs();
    console.warn('\n提示: analyze 已合并到 gen，推荐: pnpm ata gen -f ... -p ...\n');
    const outputSlug = await resolveOutputSlugForFeature(opts.feature);
    const artifact = await analyzeFeatureFromSource(opts.feature, opts.project, {
      featureDir: opts.dir,
      baseline: opts.baseline === false ? false : typeof opts.baseline === 'string' ? opts.baseline : undefined,
      route: opts.route,
      routeRoots: splitRoots(opts.routeRoots),
    });
    const result = await runGenPipeline({
      artifact,
      outputSlug,
      writeArtifact: true,
      metaOnly: true,
    });
    const out = result.artifactFile ?? featureArtifactFile(outputSlug);
    console.log(`\n✓ 元操作: ${out}`);
    printArtifactSummary(artifact);
    console.log(`  下一步: pnpm ata gen -f ${opts.feature}  或  pnpm ata gen -i ${out}`);
  });

program
  .command('scan-dom')
  .description('页面 DOM 解析体检：批量静态扫描 packages/*/src/routes，输出定位覆盖率与缺口聚类（不调 LLM、不连 UAT）')
  .option('-p, --project <path>', '前端仓库根目录', TARGET_PROJECT_DEFAULT)
  .option('--packages <list>', '只扫指定包，逗号分隔（默认全部）')
  .option('-o, --out <dir>', '报表输出目录', '/tmp/dom-scan')
  .action(async (opts: { project: string; packages?: string; out: string }) => {
    const { scanRoutes, renderSummaryMd, renderPagesCsv, renderSamplesMd } = await import('../analyzer/scanRoutes.js');
    const root = path.resolve(opts.project);
    const r = await scanRoutes({
      root,
      packages: opts.packages?.split(',').map((x) => x.trim()).filter(Boolean),
      onPackage: (n, c) => console.log(`扫描 ${n}：${c} 个入口`),
    });
    await fs.mkdir(opts.out, { recursive: true });
    await fs.writeFile(path.join(opts.out, 'summary.json'), JSON.stringify(r.summary, null, 2), 'utf8');
    await fs.writeFile(path.join(opts.out, 'summary.md'), renderSummaryMd(r.summary), 'utf8');
    await fs.writeFile(path.join(opts.out, 'pages.csv'), renderPagesCsv(r.pages), 'utf8');
    await fs.writeFile(path.join(opts.out, 'samples.md'), renderSamplesMd(r.samples, r.summary.causes), 'utf8');
    const t = r.summary.total;
    console.log(`页面 ${t.pages} 节点 ${t.nodes} 已绑定 ${t.bound} 覆盖率 ${t.coverage}% 异常 ${t.errors} 截断 ${t.truncated}`);
    console.log(`报表: ${opts.out}/{summary.md,summary.json,pages.csv,samples.md}`);
  });

program
  .command('coverage')
  .description('单功能覆盖分析：页面节点绑定率 + 用例触达元素情况（纯静态，不调 LLM、不连 UAT）')
  .requiredOption('-f, --feature <name>', '功能名或 slug（需已有 artifacts/<slug>/feature.yaml 与 cases/generated/<slug>/suite.yaml）')
  .option('-p, --project <path>', '前端仓库根目录', TARGET_PROJECT_DEFAULT)
  .option('--entries <list>', '页面入口文件（相对仓库根，逗号分隔），不填则取 feature.yaml 的 source_hint')
  .option('-o, --out <dir>', '报表输出目录（默认 /tmp/feature-coverage/<slug>）')
  .action(async (opts: { feature: string; project: string; entries?: string; out?: string }) => {
    const { analyzeFeatureCoverage, renderCoverageMd } = await import('../analyzer/featureCoverage.js');
    const r = await analyzeFeatureCoverage({
      feature: opts.feature,
      projectRoot: opts.project,
      entries: opts.entries?.split(',').map((x) => x.trim()).filter(Boolean),
    });
    const out = opts.out ?? path.join('/tmp/feature-coverage', r.slug);
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, 'coverage.json'), JSON.stringify(r, null, 2), 'utf8');
    await fs.writeFile(path.join(out, 'coverage.md'), renderCoverageMd(r), 'utf8');
    console.log(`${r.feature}：页面节点 ${r.dom.nodes} 已绑定 ${r.dom.bound}（${r.dom.coverage}%）；用例 ${r.cases.total} 个；用例元素覆盖 ${r.elementCoverage.ratio}%（强 ${r.elementCoverage.touched} + 弱 ${r.elementCoverage.touchedWeak} / ${r.elementCoverage.locatable}）`);
    console.log(`报表: ${out}/{coverage.md,coverage.json}`);
  });

program
  .command('probe')
  .description('只读探测：打开功能页面，核对 needs_review 定位在真实 DOM 里是否成立（不点击、不输入、不保存）')
  .requiredOption('-f, --feature <name>', '功能名或 slug')
  .option('-p, --project <path>', '前端仓库根目录', TARGET_PROJECT_DEFAULT)
  .option('--proxy <url>', '浏览器代理（访问内网时用 bird-net proxy 的地址）')
  .option('--statuses <list>', '要探测的定位状态，逗号分隔', 'needs_review')
  .option('--doc <单据号>', '列表里的单据号：选中该行并点击单号进入详情，补探测行依赖与详情页定位（只点击，不输入、不保存）')
  .option('--create', '点列表页“新建”进入新建页并探测（不保存）')
  .option('--fill-required', '配合 --create：新增按钮被禁用时，给站点/供应商/退货原因各选第一条再继续（只在未保存草稿里选值）')
  .option('-o, --out <dir>', '报表输出目录（默认 /tmp/feature-probe/<slug>）')
  .action(async (opts: { feature: string; project: string; proxy?: string; statuses: string; doc?: string; create?: boolean; fillRequired?: boolean; out?: string }) => {
    const { probeFeature, renderProbeMd } = await import('../probe/probeFeature.js');
    await import('dotenv/config');
    const baseURL = process.env.BASE_URL;
    if (!baseURL) throw new Error('未设置 BASE_URL（.env）');
    const r = await probeFeature({
      feature: opts.feature,
      projectRoot: opts.project,
      baseURL,
      storageState: path.join(PATHS.authDir, 'user.json'),
      proxy: opts.proxy,
      doc: opts.doc,
      create: opts.create,
      fillRequired: opts.fillRequired,
      statuses: opts.statuses.split(',').map((x) => x.trim()).filter(Boolean),
    });
    const out = opts.out ?? path.join('/tmp/feature-probe', r.slug);
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, 'probe.json'), JSON.stringify(r, null, 2), 'utf8');
    await fs.writeFile(path.join(out, 'probe.md'), renderProbeMd(r), 'utf8');
    console.log(`${r.feature}：${Object.entries(r.summary).map(([k, v]) => `${k} ${v}`).join('，') || '无待探测项'}`);
    console.log(`报表: ${out}/{probe.md,probe.json}`);
  });

program
  .command('adopt')
  .description('采纳探测结果：把 probe 报告里通过（ok）的定位写进功能级元素库 knowledge/features/<slug>/elements.yaml（只加不改，已有条目不动）')
  .requiredOption('-f, --feature <name>', '功能名或 slug')
  .option('--from <files>', 'probe.json 路径，逗号分隔；先出现的优先（默认 /tmp/feature-probe/<slug>/probe.json）')
  .option('--dry-run', '只列出将要写入的条目，不改文件')
  .option('--refresh', '同时重写上次由本命令采纳的条目（note 含“UAT 只读探测通过”）')
  .action(async (opts: { feature: string; from?: string; dryRun?: boolean; refresh?: boolean }) => {
    const { adoptProbe } = await import('../probe/adopt.js');
    const { toArtifactDirName } = await import('../core/featurePaths.js');
    const files = opts.from?.split(',').map((x) => x.trim()).filter(Boolean) ?? [path.join('/tmp/feature-probe', toArtifactDirName(opts.feature), 'probe.json')];
    const r = await adoptProbe({ feature: opts.feature, probeFiles: files, dryRun: opts.dryRun, refresh: opts.refresh });
    console.log(`${opts.dryRun ? '[dry-run] ' : ''}元素库: ${r.file}`);
    console.log(`新增 ${r.added.length}：${r.added.join('、') || '-'}`);
    if (r.refreshed.length) console.log(`重写 ${r.refreshed.length}：${r.refreshed.join('、')}`);
    console.log(`已有条目未动 ${r.keptExisting.length}${r.keptExisting.length ? `：${r.keptExisting.join('、')}` : ''}`);
    console.log(`探测未通过、未采纳 ${r.notOk.length}${r.notOk.length ? `：${r.notOk.join('、')}` : ''}`);
    if (r.backup) console.log(`原文件备份: ${r.backup}`);
  });

program
  .command('catalog')
  .description('枚举功能源码目录中的全部控件及其 state（由渲染结构确定，不调用 LLM），写入 artifacts/<功能>/control-catalog.json')
  .option('-p, --project <path>', '被测前端源码根目录', TARGET_PROJECT_DEFAULT)
  .requiredOption('-f, --feature <name>', '功能名')
  .requiredOption('-d, --dir <path>', '功能源码目录，读取该目录下完整文件')
  .action(async (opts: { project: string; feature: string; dir: string }) => {
    const { snippets } = await retrieveFeatureCode({
      feature: opts.feature,
      projectRoot: opts.project,
      featureDir: opts.dir,
    });
    const controls = buildControlCatalog(snippets);
    const dir = featureArtifactDir(opts.feature);
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, 'control-catalog.json');
    await fs.writeFile(out, JSON.stringify({ feature: opts.feature, source_dir: opts.dir, controls }, null, 2), 'utf8');
    const dist: Record<string, number> = {};
    for (const c of controls) {
      const k = c.state.split(':')[0];
      dist[k] = (dist[k] ?? 0) + 1;
    }
    console.log(`控件 ${controls.length} 个 ${JSON.stringify(dist)} → ${out}`);
  });

program
  .command('catalog-diff')
  .description('按语义 id 对比两份源码的控件目录（确定性，不调用 LLM），输出 control-diff.md / .json 到 artifacts/<功能>/compare/')
  .requiredOption('-f, --feature <name>', '功能名')
  .requiredOption('--before-dir <path>', '旧版功能源码目录（绝对路径）')
  .requiredOption('--before-project <path>', '旧版前端源码根目录')
  .requiredOption('--after-dir <path>', '新版功能源码目录（绝对路径）')
  .requiredOption('--after-project <path>', '新版前端源码根目录')
  .option('--label <text>', '报告标题中的版本说明', '旧版 vs 新版')
  .action(async (opts: { feature: string; beforeDir: string; beforeProject: string; afterDir: string; afterProject: string; label: string }) => {
    const load = async (project: string, dir: string) => {
      const { snippets } = await retrieveFeatureCode({ feature: opts.feature, projectRoot: project, featureDir: dir });
      return buildControlCatalog(snippets);
    };
    const { diffControlCatalogs, renderControlDiffMd } = await import('../compare/controlCatalogDiff.js');
    const before = await load(opts.beforeProject, opts.beforeDir);
    const after = await load(opts.afterProject, opts.afterDir);
    const d = diffControlCatalogs(before, after);
    const dir = path.join(featureArtifactDir(opts.feature), 'compare');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'control-diff.json'), JSON.stringify(d, null, 2), 'utf8');
    const md = path.join(dir, 'control-diff.md');
    await fs.writeFile(md, renderControlDiffMd(d, `${opts.feature}：控件目录差异（${opts.label}）`), 'utf8');
    console.log(`旧 ${before.length} 个 / 新 ${after.length} 个｜未变 ${d.unchanged}｜属性变化 ${d.changed.length}｜新增 ${d.added.length}｜移除 ${d.removed.length}｜疑似移动 ${d.possiblyMoved.length}`);
    console.log(`报告: ${md}`);
  });

program
  .command('narrate')
  .description('按流程逐步输出变化报告（与功能无关）：步骤取自 feature.yaml，控件变化取自控件目录差异，逻辑变化取自源码函数哈希；不调用 LLM，输出 compare/flow-change-report.zh.md')
  .requiredOption('-f, --feature <name>', '功能名')
  .option('--label <text>', '报告中的基线说明', 'V1 vs 当前')
  .option('--v1-yaml <path>', '旧版 feature.yaml，默认 artifacts/<功能>/v1/feature.yaml')
  .option('--current-yaml <path>', '当前 feature.yaml，默认 artifacts/<功能>/feature.yaml')
  .option('--v1-dir <path>', '旧版功能源码目录（用于函数逻辑比对，缺省则不比对）')
  .option('--current-dir <path>', '当前功能源码目录（用于函数逻辑比对，缺省则不比对）')
  .action(async (opts: { feature: string; label: string; v1Yaml?: string; currentYaml?: string; v1Dir?: string; currentDir?: string }) => {
    const base = featureArtifactDir(opts.feature);
    const dir = path.join(base, 'compare');
    const diff = JSON.parse(await fs.readFile(path.join(dir, 'control-diff.json'), 'utf8'));
    const YAML = (await import('yaml')).default;
    const load = async (p: string) => YAML.parse(await fs.readFile(p, 'utf8'));
    const { buildFlowStepReport } = await import('../compare/flowStepReport.js');
    const { fingerprintFunctions, readSourceText } = await import('../compare/sourceFingerprint.js');
    const res = buildFlowStepReport({
      feature: opts.feature,
      label: opts.label,
      diff,
      current: await load(opts.currentYaml ?? path.join(base, 'feature.yaml')),
      v1: await load(opts.v1Yaml ?? path.join(base, 'v1', 'feature.yaml')),
      currentFns: opts.currentDir ? await fingerprintFunctions(opts.currentDir) : undefined,
      v1Fns: opts.v1Dir ? await fingerprintFunctions(opts.v1Dir) : undefined,
      currentText: opts.currentDir ? await readSourceText(opts.currentDir) : undefined,
    });
    const out = path.join(dir, 'flow-change-report.zh.md');
    await fs.writeFile(out, res.markdown, 'utf8');
    console.log(`流程 ${res.totalFlows} 条，有变化 ${res.changedFlows} 条`);
    console.log(`报告: ${out}`);
  });

program
  .command('facts')
  .description('静态提取功能目录下的字段事实（fields / queryFields），不调用 LLM，YAML 输出到 stdout')
  .option('-p, --project <path>', '被测前端源码根目录', TARGET_PROJECT_DEFAULT)
  .requiredOption('-d, --dir <path>', '功能源码目录，读取该目录下完整文件')
  .action(async (opts: { project: string; dir: string }) => {
    const { snippets } = await retrieveFeatureCode({
      feature: opts.dir,
      projectRoot: opts.project,
      featureDir: opts.dir,
    });
    const facts = extractFieldFacts(snippets);
    // stdout 只放 YAML，计数走 stderr，方便管道重定向
    process.stdout.write(stringifyYaml({ field_facts: facts }));
    console.error(`字段总数: ${facts.length}`);
  });

program
  .command('recompile')
  .description(
    '用当前编译器强制重编 feature.yaml 的 meta_ops/flows（编译规则升级后使用；不调用 LLM，会覆盖已有 flows，原文件备份为 .bak）',
  )
  .requiredOption('-i, --input <file>', 'artifacts/<slug>/feature.yaml')
  .action(async (opts: { input: string }) => {
    const raw = await fs.readFile(opts.input, 'utf8');
    const artifact = FeatureArtifactSchema.parse(parseYaml(raw));
    const next = compileMetaOpsAndFlows(artifact, { force: true });
    await fs.writeFile(`${opts.input}.bak`, raw, 'utf8');
    await fs.writeFile(opts.input, stringifyYaml(next), 'utf8');
    console.log(
      `✓ 已重编: ${opts.input}（meta_ops ${next.meta_ops?.length ?? 0}，flows ${next.flows?.length ?? 0}；备份 ${opts.input}.bak）`,
    );
  });

program
  .command('gen')
  .description(
    '生成：源码或已有元操作 → artifacts/feature.yaml + cases/generated/suite.yaml + elements（一步完成）',
  )
  .option('-f, --feature <name>', '功能名')
  .option(
    '-p, --project <path>',
    '被测前端源码根；与 -f 合用则从源码分析并写出元操作，再生成测试脚本',
    TARGET_PROJECT_DEFAULT,
  )
  .option('-i, --input <file>', '已有 artifacts/<slug>/feature.yaml，仅重新生成测试脚本')
  .option('-d, --dir <path>', '功能源码目录，读取该目录下完整文件，优先于关键词检索')
  .option('--meta-only', '只写元操作文件，不生成 suite（需 -f 且 -p）')
  .option(...ROUTE_OPT)
  .option(...ROUTE_ROOTS_OPT)
  .option('--from-knowledge', '与 -f 同义，优先 knowledge/features')
  .option('--archive-v1', '已有元操作时，不询问直接存档 v1（尚无 v1 时）')
  .option('--no-archive-prompt', '跳过「存档 v1」询问（不自动存档）')
  .action(
    async (opts: {
      input?: string;
      feature?: string;
      project?: string;
      fromKnowledge?: boolean;
      metaOnly?: boolean;
      archiveV1?: boolean;
      noArchivePrompt?: boolean;
      dir?: string;
      route?: string;
      routeRoots?: string;
    }) => {
      await ensureDirs();
      const { parse } = await import('yaml');

      let artifact;
      let outputSlug: string;
      let writeArtifact = false;

      if (opts.feature && opts.project) {
        outputSlug = await resolveOutputSlugForFeature(opts.feature);
        artifact = await analyzeFeatureFromSource(opts.feature, opts.project, {
          featureDir: opts.dir,
          route: opts.route,
          routeRoots: splitRoots(opts.routeRoots),
        });
        writeArtifact = true;
      } else if (opts.input) {
        artifact = FeatureArtifactSchema.parse(parse(await fs.readFile(opts.input, 'utf8')));
        outputSlug =
          slugFromArtifactInputPath(opts.input) ??
          (await findLatestOutputSlug(artifact.feature)) ??
          featureOutputSlug(artifact.feature);
      } else if (opts.feature) {
        outputSlug =
          (await findLatestOutputSlug(opts.feature)) ?? featureOutputSlug(opts.feature);
        artifact =
          (await loadKnowledgeFeature(opts.feature)) ||
          FeatureArtifactSchema.parse(
            parse(await fs.readFile(await resolveFeatureArtifactFile(opts.feature), 'utf8')),
          );
      } else {
        throw new Error('请提供 (-f 与 -p) 从源码生成，或 -i / -f 读取已有元操作');
      }

      if (opts.metaOnly && !writeArtifact) {
        throw new Error('--meta-only 仅在与 -f、-p 从源码分析时可用');
      }

      if (opts.archiveV1 && opts.noArchivePrompt) {
        throw new Error('--archive-v1 与 --no-archive-prompt 不能同时使用');
      }

      const featureName = artifact.feature || opts.feature || outputSlug;
      await maybePromptArchiveV1BeforeGen({
        feature: featureName,
        slug: outputSlug,
        archiveV1: opts.archiveV1,
        noArchivePrompt: opts.noArchivePrompt,
      });

      let baseURL: string | undefined;
      try {
        baseURL = (await loadEnvConfig()).baseURL;
      } catch {
        baseURL = process.env.BASE_URL;
      }

      const result = await runGenPipeline({
        artifact,
        outputSlug,
        baseURL,
        writeArtifact,
        metaOnly: opts.metaOnly,
      });

      logger.info(
        {
          outputSlug,
          artifactFile: result.artifactFile,
          caseFile: result.caseFile,
          cases: result.suite?.cases.length,
        },
        'gen 完成',
      );

      if (result.artifactFile) {
        console.log(`\n✓ 元操作: ${result.artifactFile}`);
        printArtifactSummary(result.artifact);
      }
      if (result.caseFile && result.suite) {
        console.log(`✓ 测试脚本: ${result.caseFile}`);
        if (result.elFile) console.log(`✓ 元素库: ${result.elFile}`);
        console.log(`  cases: ${result.suite.cases.map((c) => c.id).join(', ')}`);
        if (result.dangling?.length) {
          console.log(`✗ 元素引用核对: ${result.dangling.length} 条用例引用了未定义元素，执行时会直接判为不可执行（${result.refCheckFile}）`);
          for (const d of result.dangling) console.log(`    ${d.caseId}: ${d.missing.join(', ')}`);
        } else if (result.refCheckFile) {
          console.log(`✓ 元素引用核对通过（${result.refCheckFile}）`);
        }
        console.log(`  执行: pnpm ata test -c ${result.caseFile}`);
      }
    },
  );

program
  .command('test')
  .description('执行 suite YAML（逐步截图 + HTML 报告）')
  .option('-c, --case <file>', 'suite yaml')
  .option('--skip-auth', '跳过登录态（本地 demo）')
  .option('-g, --grep <pattern>', '只运行标题匹配的用例（正则，匹配 "<case.id> <title>"），如先只跑只读用例')
  .action(async (opts: { case?: string; skipAuth?: boolean; grep?: string }) => {
    await ensureDirs();
    const caseFile = opts.case || path.join(PATHS.cases, 'example-smoke.yaml');
    process.env.ATA_CASE_FILE = path.resolve(caseFile);
    if (opts.skipAuth) process.env.SKIP_AUTH = '1';
    console.log(`执行: ${process.env.ATA_CASE_FILE}`);
    // 正则放进双引号；内部双引号转义，避免 shell:true 下被拆分
    const grepArgs = opts.grep ? ['--grep', `"${opts.grep.replace(/"/g, '\\"')}"`] : [];
    const code = await runPlaywright(grepArgs);
    if (code === 0) console.log('\n✓ 完成: pnpm report');
    process.exit(code);
  });

program
  .command('auth')
  .description('登录并写入 playwright/.auth/user.json')
  .action(async () => {
    await ensureDirs();
    delete process.env.SKIP_AUTH;
    const code = await runPlaywright(['--project=setup']);
    process.exit(code);
  });

program
  .command('snapshot')
  .description(
    '固化当前元操作 + 测试脚本为对比基线（artifacts/<slug>/<label>/，与 feature.yaml 同目录）',
  )
  .requiredOption(
    '-f, --feature <name>',
    '功能名 / slug / artifacts/<slug> 目录 / feature.yaml 路径',
  )
  .option('-l, --label <name>', '基线标签，如 v1', 'v1')
  .option('--note <text>', '备注写入 manifest')
  .action(async (opts: { feature: string; label: string; note?: string }) => {
    await ensureDirs();
    const { dir, label, slug } = await snapshotBaseline({
      feature: opts.feature,
      label: opts.label,
      note: opts.note,
    });
    console.log(`\n✓ 基线已保存: ${dir}`);
    console.log(`  slug: ${slug}`);
    console.log(`  标签: ${label}`);
    console.log(`  含: feature.yaml${''}、suite.yaml（若已生成）、generated.yaml（若有）`);
    console.log(`  对比: pnpm ata compare -f ${opts.feature} -b ${label}`);
  });

program
  .command('compare')
  .description(
    'v1 基线 vs 当前 current（artifacts/<slug>/feature.yaml）：diff.yaml → LLM → report.yaml',
  )
  .requiredOption(
    '-f, --feature <name>',
    '功能名 / slug / artifacts/<slug> 目录 / feature.yaml 路径',
  )
  .option('-b, --baseline <label>', '基线标签（默认 v1；配合 --ata 时为版本号如 V2，默认最新）')
  .option('--ata <featureDir>', '基线改取目标项目该功能目录下 ata/ 的已确认版本（配合 -p）')
  .option('-p, --project <path>', '被测前端源码根目录（仅 --ata 使用）', TARGET_PROJECT_DEFAULT)
  .option('--list', '列出已有基线')
  .option('--strict', '连元素名/args/状态词等自由取值也比（默认只比稳定属性）')
  .action(async (opts: {
    feature: string;
    baseline?: string;
    ata?: string;
    project: string;
    list?: boolean;
    strict?: boolean;
  }) => {
    await ensureDirs();
    const { slug } = await resolveFeatureContext(opts.feature);
    if (opts.list) {
      const manifest = await readBaselineManifest(slug);
      const keys = Object.keys(manifest.baselines);
      if (!keys.length) {
        console.log('尚无基线，请先: pnpm ata snapshot -f <功能> -l v1');
        return;
      }
      console.log(`最新基线: ${manifest.latest ?? '（未设置）'}`);
      for (const k of keys) {
        const b = manifest.baselines[k]!;
        console.log(`  - ${k}: ${b.createdAt}${b.note ? ` — ${b.note}` : ''}`);
      }
      return;
    }
    const result = await runCompare({
      feature: opts.feature,
      baselineLabel: opts.baseline,
      ata: opts.ata ? { projectRoot: opts.project, featureDir: opts.ata } : undefined,
      strict: opts.strict,
    });
    console.log(`\n✓ 差异 YAML: ${result.latestDiffFile}`);
    console.log(`  归档: ${result.diffFile}`);
    console.log(`✓ 对比报告 YAML: ${result.latestReportFile}`);
    console.log(`  归档: ${result.reportFile}`);
    console.log(`✓ 可读 Markdown: ${result.reportMdFile}`);
    console.log(`  路径逻辑变更: ${result.logicChanged ? '是' : '否'}`);
  });

function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

program
  .command('confirm')
  .description(
    '人工确认：把 current 分析结果备份为目标项目功能目录下 ata/V<n>/（版本不可变，不碰目标项目 git）',
  )
  .requiredOption('-f, --feature <name>', '功能名')
  .requiredOption('-d, --dir <path>', '功能源码目录（相对项目根或绝对路径），ata/ 建在其下')
  .option('-p, --project <path>', '被测前端源码根目录', TARGET_PROJECT_DEFAULT)
  .option('-n, --note <text>', '备注写入 manifest')
  .option('-y, --yes', '跳过人工确认询问')
  .action(
    async (opts: { feature: string; dir: string; project: string; note?: string; yes?: boolean }) => {
      const slug = await resolveOutputSlugForFeature(opts.feature);
      const artifactFile = featureArtifactFile(slug);
      try {
        await fs.access(artifactFile);
      } catch {
        throw new Error(`缺少当前元操作: ${artifactFile}，请先 pnpm ata gen -f ${opts.feature} -p ...`);
      }
      const suiteFile = featureSuiteFile(slug);
      const root = ataRoot(opts.project, opts.dir);
      const version = await nextAtaVersion(root);
      console.log(`目标目录: ${path.join(root, version)}`);
      console.log(`新版本号: ${version}`);

      const versions = await listAtaVersions(root);
      if (versions.length) {
        // 只打印条数统计；与上一版本的字段级差异让人确认前心里有数
        const prev = await loadAtaVersion(root, versions[versions.length - 1]);
        const cur = FeatureArtifactSchema.parse(parseYaml(await fs.readFile(artifactFile, 'utf8')));
        const d = diffFeatureArtifacts(prev.artifact, cur);
        const count = (t: string) => d.field_facts.filter((x) => x.change === t).length;
        console.log(
          `与 ${prev.version} 的字段差异: 新增 ${count('added')} / 删除 ${count('removed')} / 变更 ${count('changed')}`,
        );
      } else {
        console.log('尚无历史版本，将作为首个版本。');
      }

      if (!opts.yes) {
        if (!(await askYesNo('确认生成该版本？[y/N] '))) {
          console.log('已取消。');
          return;
        }
      }
      const res = await confirmAtaVersion({
        projectRoot: opts.project,
        featureDir: opts.dir,
        slug,
        feature: opts.feature,
        artifactFile,
        suiteFile,
        note: opts.note,
      });
      console.log(`\n✓ 已生成 ${res.version}: ${res.dir}`);
    },
  );

program
  .command('versions')
  .description('列出目标项目功能目录下 ata/ 的已确认版本')
  .requiredOption('-d, --dir <path>', '功能源码目录')
  .option('-p, --project <path>', '被测前端源码根目录', TARGET_PROJECT_DEFAULT)
  .action(async (opts: { dir: string; project: string }) => {
    const root = ataRoot(opts.project, opts.dir);
    const versions = await listAtaVersions(root);
    if (!versions.length) {
      console.log(`尚无版本: ${root}，请先 pnpm ata confirm`);
      return;
    }
    const manifest = await readAtaRootManifest(root);
    console.log(`ata: ${root}\n最新版本: ${manifest?.latest ?? versions[versions.length - 1]}`);
    for (const v of versions) {
      const m = manifest?.versions?.[v];
      console.log(`  - ${v}: ${m?.confirmed_at ?? '（无记录）'}${m?.note ? ` — ${m.note}` : ''}`);
    }
  });

program
  .command('cards')
  .description('生成操作卡（给自主测试 agent 的定位/交互提示，不含预期结果）：artifacts/<slug>/operation-cards.md；需已 gen 过')
  .requiredOption('-f, --feature <slug>', '功能 slug，如 feat_294217dc')
  .option('-p, --project <path>', '被测前端源码根（配合 --route 判定生效源码）', TARGET_PROJECT_DEFAULT)
  .option(...ROUTE_OPT)
  .option(...ROUTE_ROOTS_OPT)
  .option('-o, --out <file>', '输出路径，默认 artifacts/<slug>/operation-cards.md')
  .action(async (opts: { feature: string; project: string; route?: string; routeRoots?: string; out?: string }) => {
    const slug = opts.feature;
    const { renderOperationCards } = await import('../cards/operationCards.js');
    const artifact = FeatureArtifactSchema.parse(parseYaml(await fs.readFile(path.join(PATHS.artifacts, slug, 'feature.yaml'), 'utf8')));
    const suite = parseYaml(await fs.readFile(path.join(PATHS.generatedCases, slug, 'suite.yaml'), 'utf8')) as { cases: never[] };
    const gen = parseYaml(await fs.readFile(path.join(PATHS.elements, slug, 'generated.yaml'), 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
    const notesFile = path.join(PATHS.platformKnowledge, 'choerodon', 'interaction-notes.yaml');
    const notes = (parseYaml(await fs.readFile(notesFile, 'utf8')) as { notes: never[] }).notes;
    let routeReport: string[] | undefined;
    let sourceDir: string | undefined;
    if (opts.route) {
      const { pickEffectiveFeatureDir } = await import('../analyzer/routeResolve.js');
      const picked = await pickEffectiveFeatureDir({ roots: [opts.project, ...splitRoots(opts.routeRoots)], route: opts.route });
      routeReport = picked.report;
      sourceDir = picked.featureDir;
    }
    const md = renderOperationCards({
      feature: artifact.feature,
      slug,
      cases: suite.cases,
      // 用最新 kit/overlay 重新建库（kit 修正立即生效），generated.yaml 只补用例生成时声明的键
      lib: { ...(gen[slug] ?? {}), ...(await (await import('../knowledge/platformKit.js')).buildFeatureElementLib(artifact.feature, artifact)) },
      fieldRules: artifact.field_rules as never,
      fieldFacts: artifact.field_facts as never,
      pages: artifact.pages as never,
      apis: artifact.apis as string[] | undefined,
      notes,
      routeReport,
      sourceDir,
    });
    const out = opts.out ?? path.join(PATHS.artifacts, slug, 'operation-cards.md');
    await fs.writeFile(out, md, 'utf8');
    console.log(`操作卡: ${out}（${suite.cases.length} 个操作）`);
  });

program.parseAsync(process.argv).catch((err) => {
  // handoff 模式：LLM 请求已落盘等待外部 agent 应答，属正常暂停，退出码 3 供调用方识别
  if (err instanceof LlmHandoffPendingError) {
    console.error(`\n⏸ ${err.message}`);
    process.exit(3);
  }
  console.error(err);
  process.exit(1);
});
