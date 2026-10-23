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
  .action(async (opts: { feature: string; project: string; dir?: string; baseline?: string | boolean }) => {
    await ensureDirs();
    console.warn('\n提示: analyze 已合并到 gen，推荐: pnpm ata gen -f ... -p ...\n');
    const outputSlug = await resolveOutputSlugForFeature(opts.feature);
    const artifact = await analyzeFeatureFromSource(opts.feature, opts.project, {
      featureDir: opts.dir,
      baseline: opts.baseline === false ? false : typeof opts.baseline === 'string' ? opts.baseline : undefined,
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

program.parseAsync(process.argv).catch((err) => {
  // handoff 模式：LLM 请求已落盘等待外部 agent 应答，属正常暂停，退出码 3 供调用方识别
  if (err instanceof LlmHandoffPendingError) {
    console.error(`\n⏸ ${err.message}`);
    process.exit(3);
  }
  console.error(err);
  process.exit(1);
});
