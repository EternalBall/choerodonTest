import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { writeYamlFile } from '../core/config.js';
import {
  FeatureArtifactSchema,
  SuiteSchema,
  type FeatureArtifact,
  type Suite,
} from '../core/schema.js';

const execFileAsync = promisify(execFile);

/**
 * 目标项目功能目录下的 ata/ 版本化备份：
 *   <projectRoot>/<featureDir>/ata/{README.md, manifest.yaml, V1/, V2/, ...}
 * 动机：分析结果随目标项目一起留存，每次「人工确认」固化一个不可变版本，
 * 下次代码更新后用新的分析结果与最新版本对比（见 compare --ata）。
 */

const VERSION_RE = /^V\d+$/;

export type AtaRootManifest = {
  latest: string;
  versions: Record<string, { confirmed_at: string; note?: string }>;
};

export type AtaVersionLoaded = {
  version: string;
  dir: string;
  featureFile: string;
  suiteFile?: string;
  artifact: FeatureArtifact;
  suite?: Suite;
};

/** ata 根目录；featureDir 相对 projectRoot 或绝对路径均可（绝对路径时 resolve 直接采用） */
export function ataRoot(projectRoot: string, featureDir: string): string {
  return path.resolve(projectRoot, featureDir, 'ata');
}

function versionNum(v: string): number {
  return Number(v.slice(1));
}

/** 按数字升序（V2 在 V10 前）；只认 /^V\d+$/ 目录，根不存在返回空 */
export async function listAtaVersions(root: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && VERSION_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => versionNum(a) - versionNum(b));
}

export async function nextAtaVersion(root: string): Promise<string> {
  const list = await listAtaVersions(root);
  const last = list.length ? versionNum(list[list.length - 1]!) : 0;
  return `V${last + 1}`;
}

export async function readAtaRootManifest(root: string): Promise<AtaRootManifest | undefined> {
  try {
    return YAML.parse(await fs.readFile(path.join(root, 'manifest.yaml'), 'utf8')) as AtaRootManifest;
  } catch {
    return undefined;
  }
}

async function sha256File(file: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** 目标项目若在 git 仓库内，取 HEAD 短 hash 与分支；任何失败都省略，不影响确认 */
async function gitInfo(cwd: string): Promise<{ head?: string; branch?: string }> {
  const run = async (args: string[]) => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd, timeout: 5000 });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  };
  const head = await run(['rev-parse', '--short', 'HEAD']);
  if (!head) return {};
  return { head, branch: await run(['rev-parse', '--abbrev-ref', 'HEAD']) };
}

const README_TEXT = `# ata 版本化备份

本目录由 \`ata confirm\` 生成，保存该功能目录的分析结果（feature.yaml / suite.yaml）。

- V1、V2、V3…：每次人工确认生成一个版本，**版本一经生成不可变**，请勿手工修改或删除。
- manifest.yaml：记录最新版本与各版本确认时间。
- 每个版本目录内的 manifest.yaml 记录文件 sha256、数量统计与（若有）git 提交信息。
- 更新代码后，用 \`ata compare --ata <功能目录>\` 将新的分析结果与最新版本对比。
`;

export async function confirmAtaVersion(opts: {
  projectRoot: string;
  featureDir: string;
  slug: string;
  feature: string;
  artifactFile: string;
  suiteFile?: string;
  note?: string;
}): Promise<{ root: string; version: string; dir: string }> {
  const root = ataRoot(opts.projectRoot, opts.featureDir);
  if (!(await exists(opts.artifactFile))) {
    throw new Error(`缺少当前元操作: ${opts.artifactFile}，请先 pnpm ata gen`);
  }
  const artifact = FeatureArtifactSchema.parse(
    YAML.parse(await fs.readFile(opts.artifactFile, 'utf8')),
  );

  const version = await nextAtaVersion(root);
  const dir = path.join(root, version);
  // 不可变：目录已存在（含非规范残留）一律拒绝，绝不覆盖
  if (await exists(dir)) throw new Error(`版本目录已存在，拒绝覆盖: ${dir}`);

  const readmeFile = path.join(root, 'README.md');
  await fs.mkdir(dir, { recursive: true });
  if (!(await exists(readmeFile))) await fs.writeFile(readmeFile, README_TEXT, 'utf8');

  const files: Array<{ name: string; sha256: string }> = [];
  const copy = async (src: string, name: string) => {
    const dest = path.join(dir, name);
    await fs.copyFile(src, dest);
    files.push({ name, sha256: await sha256File(dest) });
  };
  await copy(opts.artifactFile, 'feature.yaml');
  if (opts.suiteFile && (await exists(opts.suiteFile))) await copy(opts.suiteFile, 'suite.yaml');

  const confirmedAt = new Date().toISOString();
  const git = await gitInfo(opts.projectRoot);
  await writeYamlFile(path.join(dir, 'manifest.yaml'), {
    version,
    confirmed_at: confirmedAt,
    feature: opts.feature,
    slug: opts.slug,
    note: opts.note,
    files,
    field_facts: artifact.field_facts?.length ?? 0,
    operations: artifact.operations.length,
    meta_ops: artifact.meta_ops?.length ?? 0,
    flows: artifact.flows?.length ?? 0,
    ...(git.head ? { git: { head: git.head, ...(git.branch ? { branch: git.branch } : {}) } } : {}),
  });

  const prev = await readAtaRootManifest(root);
  const versions = { ...(prev?.versions ?? {}) };
  versions[version] = { confirmed_at: confirmedAt, ...(opts.note ? { note: opts.note } : {}) };
  await writeYamlFile(path.join(root, 'manifest.yaml'), { latest: version, versions });

  return { root, version, dir };
}

/** 读取某版本（缺省 latest）；latest 优先取根 manifest，缺失时退化为目录扫描 */
export async function loadAtaVersion(root: string, version?: string): Promise<AtaVersionLoaded> {
  let target = version;
  if (!target) {
    target = (await readAtaRootManifest(root))?.latest;
    if (!target) {
      const list = await listAtaVersions(root);
      target = list[list.length - 1];
    }
  }
  if (!target) throw new Error(`ata 尚无已确认版本: ${root}，请先 pnpm ata confirm`);
  if (!VERSION_RE.test(target)) throw new Error(`ata 版本号须形如 V1: ${target}`);

  const dir = path.join(root, target);
  const featureFile = path.join(dir, 'feature.yaml');
  if (!(await exists(featureFile))) throw new Error(`ata 版本不存在: ${featureFile}`);
  const artifact = FeatureArtifactSchema.parse(YAML.parse(await fs.readFile(featureFile, 'utf8')));

  const suiteFile = path.join(dir, 'suite.yaml');
  const hasSuite = await exists(suiteFile);
  const suite = hasSuite
    ? SuiteSchema.parse(YAML.parse(await fs.readFile(suiteFile, 'utf8')))
    : undefined;
  return {
    version: target,
    dir,
    featureFile,
    suiteFile: hasSuite ? suiteFile : undefined,
    artifact,
    suite,
  };
}
