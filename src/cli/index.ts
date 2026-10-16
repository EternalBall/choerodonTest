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
  featureOutputSlug,
  resolveFeatureArtifactFile,
  slugFromArtifactInputPath,
} from '../core/featurePaths.js';
import { logger } from '../core/logger.js';
import { PATHS } from '../core/paths.js';
import { listActions } from '../keywords/index.js';
import { loadKnowledgeFeature } from '../knowledge/loadFeature.js';
import { FeatureArtifactSchema } from '../core/schema.js';

dotenv.config();

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
  .option('-p, --project <path>', '被测前端源码根目录', process.env.TARGET_PROJECT || '.')
  .action(async (opts: { feature: string; project: string }) => {
    await ensureDirs();
    console.warn('\n提示: analyze 已合并到 gen，推荐: pnpm ata gen -f ... -p ...\n');
    const outputSlug = featureOutputSlug(opts.feature);
    const artifact = await analyzeFeatureFromSource(opts.feature, opts.project);
    const result = await runGenPipeline({
      artifact,
      outputSlug,
      writeArtifact: true,
      metaOnly: true,
    });
    const out = result.artifactFile ?? featureArtifactFile(opts.feature);
    console.log(`\n✓ 元操作: ${out}`);
    printArtifactSummary(artifact);
    console.log(`  下一步: pnpm ata gen -f ${opts.feature}  或  pnpm ata gen -i ${out}`);
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
    process.env.TARGET_PROJECT,
  )
  .option('-i, --input <file>', '已有 artifacts/<slug>/feature.yaml，仅重新生成测试脚本')
  .option('--meta-only', '只写元操作文件，不生成 suite（需 -f 且 -p）')
  .option('--from-knowledge', '与 -f 同义，优先 knowledge/features')
  .action(
    async (opts: {
      input?: string;
      feature?: string;
      project?: string;
      fromKnowledge?: boolean;
      metaOnly?: boolean;
    }) => {
      await ensureDirs();
      const { parse } = await import('yaml');

      let artifact;
      let outputSlug: string;
      let writeArtifact = false;

      if (opts.feature && opts.project) {
        outputSlug = featureOutputSlug(opts.feature);
        artifact = await analyzeFeatureFromSource(opts.feature, opts.project);
        writeArtifact = true;
      } else if (opts.input) {
        artifact = FeatureArtifactSchema.parse(parse(await fs.readFile(opts.input, 'utf8')));
        outputSlug =
          slugFromArtifactInputPath(opts.input) ?? featureOutputSlug(artifact.feature);
      } else if (opts.feature) {
        outputSlug = featureOutputSlug(opts.feature);
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
  .action(async (opts: { case?: string; skipAuth?: boolean }) => {
    await ensureDirs();
    const caseFile = opts.case || path.join(PATHS.cases, 'example-smoke.yaml');
    process.env.ATA_CASE_FILE = path.resolve(caseFile);
    if (opts.skipAuth) process.env.SKIP_AUTH = '1';
    console.log(`执行: ${process.env.ATA_CASE_FILE}`);
    const code = await runPlaywright([]);
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

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
