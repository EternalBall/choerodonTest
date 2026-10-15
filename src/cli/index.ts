import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { featureToSuite, writeFeatureElementsStub, writeGeneratedSuite } from '../codegen/genCase.js';
import { loadEnvConfig, writeYamlFile } from '../core/config.js';
import { logger } from '../core/logger.js';
import { PATHS } from '../core/paths.js';
import { listActions } from '../keywords/index.js';
import { analyzeFeature } from '../analyzer/analyzeFeature.js';
import { featureSlug } from '../knowledge/featureSlug.js';
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

function resolveArtifactPath(feature: string): string {
  return path.join(PATHS.artifacts, `${featureSlug(feature)}.feature.yaml`);
}

const program = new Command();

program
  .name('ata')
  .description('Kit + meta_ops/flows → 用例 YAML → Playwright 执行')
  .version('0.1.0');

program
  .command('actions')
  .description('列出 compile 支持的 Playwright 关键字 action')
  .action(() => {
    console.log(listActions().join('\n'));
  });

program
  .command('analyze')
  .description('从功能源码目录经 DeepSeek LLM 分析并生成路径描述（写入 artifacts；无启发式兜底）')
  .requiredOption('-f, --feature <name>', '功能名，如 Material / 物料维护')
  .option('-p, --project <path>', '被测前端源码根目录', process.env.TARGET_PROJECT || '.')
  .action(async (opts: { feature: string; project: string }) => {
    await ensureDirs();
    const artifact = await analyzeFeature({
      feature: opts.feature,
      projectRoot: opts.project,
    });
    const out = resolveArtifactPath(opts.feature);
    await writeYamlFile(out, artifact);
    logger.info(
      {
        out,
        analyzer: artifact.analyzer,
        operations: artifact.operations.map((o) => o.name),
        confidence: artifact.confidence,
      },
      '分析产物已写入',
    );
    console.log(`\n✓ 分析完成: ${out}`);
    console.log(
      `  引擎: ${artifact.analyzer || 'deepseek'}${artifact.model ? ` (${artifact.model})` : ''}`,
    );
    console.log(`  操作: ${artifact.operations.map((o) => o.name).join('、')}`);
    console.log(`  入口: ${artifact.entry.route}`);
    if (artifact.page_states?.length) {
      console.log(
        `  页面状态: ${artifact.page_states.map((s) => `${s.id}(${s.mode})`).join('、')}`,
      );
    }
    if (artifact.field_rules?.length) {
      const req = artifact.field_rules.filter((f) => f.required).map((f) => f.label || f.name);
      console.log(`  必填字段: ${req.join('、') || '(无)'}`);
    }
    if (artifact.validations?.length) {
      console.log(`  校验: ${artifact.validations.map((v) => v.name).join('、')}`);
    }
    if (artifact.review_suggestions) {
      const rs = artifact.review_suggestions;
      console.log(
        `  审核建议: gaps=${rs.gaps?.length ?? 0} risks=${rs.risks?.length ?? 0} extend=${rs.extend_paths?.length ?? 0}`,
      );
    }
    console.log(`  置信度: ${artifact.confidence}`);
    console.log(`  下一步: pnpm ata gen -f ${opts.feature}  或  pnpm ata gen -i ${out}`);
  });

program
  .command('gen')
  .description('从 feature.yaml（meta_ops + flows）生成 suite YAML 与 elements（合并 platform kit）')
  .option('-i, --input <file>', 'feature.yaml 路径')
  .option('-f, --feature <name>', '从 knowledge/features/<slug>/feature.yaml 读取')
  .option('--from-knowledge', '与 -f 同义，强制 knowledge')
  .action(async (opts: { input?: string; feature?: string; fromKnowledge?: boolean }) => {
    await ensureDirs();
    const { parse } = await import('yaml');

    let artifact;
    if (opts.input) {
      artifact = FeatureArtifactSchema.parse(parse(await fs.readFile(opts.input, 'utf8')));
    } else if (opts.feature) {
      artifact =
        (await loadKnowledgeFeature(opts.feature)) ||
        FeatureArtifactSchema.parse(
          parse(await fs.readFile(resolveArtifactPath(opts.feature), 'utf8')),
        );
    } else {
      throw new Error('请提供 --input 或 --feature');
    }

    let baseURL: string | undefined;
    try {
      baseURL = (await loadEnvConfig()).baseURL;
    } catch {
      baseURL = process.env.BASE_URL;
    }

    const suite = featureToSuite(artifact, baseURL);
    const caseFile = await writeGeneratedSuite(suite, artifact.feature);
    const elFile = await writeFeatureElementsStub(artifact.feature, artifact);

    logger.info({ cases: suite.cases.length, caseFile, elFile }, 'gen 完成');
    console.log(`\n✓ 用例: ${caseFile}`);
    console.log(`✓ 元素: ${elFile}`);
    console.log('  执行: pnpm ata test -c <suite.yaml>');
  });

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
