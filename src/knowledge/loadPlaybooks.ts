import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from '../core/paths.js';
import { logger } from '../core/logger.js';

export type PlaybookDoc = {
  /** 文件名不含扩展名，如 api-binding */
  id: string;
  /** 相对 knowledge/playbooks 的路径 */
  relativePath: string;
  content: string;
};

/**
 * 加载 knowledge/playbooks 下全部操作手册（跳过 README）。
 * 供 LLM 分析注入；缺目录或空目录时返回 []（由调用方决定是否硬失败）。
 */
export async function loadPlaybooks(dir = PATHS.playbooks): Promise<PlaybookDoc[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const docs: PlaybookDoc[] = [];

  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!/\.md$/i.test(ent.name)) continue;
    if (/^readme\.md$/i.test(ent.name)) continue;

    const absolutePath = path.join(dir, ent.name);
    const content = await fs.readFile(absolutePath, 'utf8');
    const id = ent.name.replace(/\.md$/i, '');
    docs.push({
      id,
      relativePath: path.posix.join('knowledge/playbooks', ent.name),
      content: content.trim(),
    });
  }

  docs.sort((a, b) => a.id.localeCompare(b.id));
  logger.info({ dir, count: docs.length, ids: docs.map((d) => d.id) }, 'loadPlaybooks');
  return docs;
}

/** 拼进 LLM prompt：按 playbook 分块，控制总长度 */
export function formatPlaybooksForPrompt(
  docs: PlaybookDoc[],
  maxTotalChars = 40_000,
): string {
  if (!docs.length) return '';

  const parts: string[] = [
    '【组件操作手册 Playbooks — 识别元操作时必须遵循】',
    '以下文档来自 knowledge/playbooks/；分析 operations / page_states / api / 行编辑时以本文为准，禁止与手册冲突的猜测。',
  ];
  let used = parts.join('\n').length;

  for (const doc of docs) {
    const block = `\n===== PLAYBOOK: ${doc.id} (${doc.relativePath}) =====\n${doc.content}\n`;
    if (used + block.length > maxTotalChars) {
      parts.push(
        `\n===== PLAYBOOK: ${doc.id} =====\n(正文过长已截断；请仍按该主题手册规则分析)\n${doc.content.slice(0, Math.max(0, maxTotalChars - used - 80))}\n`,
      );
      break;
    }
    parts.push(block);
    used += block.length;
  }

  return parts.join('\n');
}
