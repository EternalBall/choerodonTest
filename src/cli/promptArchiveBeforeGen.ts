import fs from 'node:fs/promises';
import readline from 'node:readline';
import { featureArtifactFile } from '../core/featurePaths.js';
import { readBaselineManifest, snapshotBaseline } from '../compare/snapshot.js';

/**
 * 在 gen 覆盖 feature.yaml 之前：若磁盘上已有产物且尚无 v1 基线，询问或自动 snapshot。
 */
export async function maybePromptArchiveV1BeforeGen(opts: {
  feature: string;
  slug: string;
  archiveV1?: boolean;
  noArchivePrompt?: boolean;
}): Promise<void> {
  if (opts.noArchivePrompt) return;

  const featurePath = featureArtifactFile(opts.slug);
  try {
    await fs.access(featurePath);
  } catch {
    return;
  }

  const manifest = await readBaselineManifest(opts.slug);
  if (manifest.baselines.v1) return;

  if (opts.archiveV1) {
    const { dir } = await snapshotBaseline({
      feature: opts.feature,
      label: 'v1',
      note: 'gen 前自动存档（--archive-v1）',
    });
    console.log(`\n✓ 已存档 v1: ${dir}\n`);
    return;
  }

  if (!process.stdin.isTTY) {
    return;
  }

  const answer = await ask(
    '\n检测到已有 feature.yaml 且尚无 v1 基线，是否先存档为 v1？[Y/n] ',
  );
  if (answer === '' || /^y(es)?$/i.test(answer)) {
    const { dir } = await snapshotBaseline({
      feature: opts.feature,
      label: 'v1',
      note: 'gen 前交互存档 v1',
    });
    console.log(`\n✓ 已存档 v1: ${dir}\n`);
  }
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}
