import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
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

/** knowledge/playbooks/index.yaml：按 import 来源选手册 */
export type PlaybookIndex = {
  always: string[];
  fallback: string[];
  dataset_hints?: Record<string, string>;
  pro: Record<string, string[]>;
  legacy: Record<string, string[]>;
};

export type DetectedComponents = { pro: Set<string>; legacy: Set<string> };

export async function loadPlaybookIndex(dir = PATHS.playbooks): Promise<PlaybookIndex> {
  const raw = await fs.readFile(path.join(dir, 'index.yaml'), 'utf8');
  return YAML.parse(raw) as PlaybookIndex;
}

/** DatePicker / date-picker / datepicker 视为同一组件 */
const normKey = (name: string) => name.replace(/-/g, '').toLowerCase();

const IMPORT_RE =
  /import\s+([^;'"]*?)\s+from\s+['"](choerodon-ui(\/pro)?(?:\/lib\/([\w-]+)(?:\/[\w./-]*)?)?)['"]/g;

/**
 * 从源码识别 choerodon-ui 组件：带 /pro 的进 pro，否则进 legacy。
 * 支持 `import { Table, Select as S } from 'choerodon-ui/pro'` 与 `import Table from 'choerodon-ui/pro/lib/table'`。
 */
export function detectChoerodonComponents(
  sources: string[],
  hints: Record<string, string> = {},
): DetectedComponents {
  const found: DetectedComponents = { pro: new Set(), legacy: new Set() };
  for (const src of sources) {
    for (const m of src.matchAll(IMPORT_RE)) {
      const [, clause, , isPro, libDir] = m;
      const bucket = isPro ? found.pro : found.legacy;
      if (libDir) {
        bucket.add(normKey(libDir));
        continue;
      }
      const named = clause.match(/\{([\s\S]*)\}/)?.[1] ?? '';
      for (const part of named.split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0]?.replace(/^type\s+/, '').trim();
        if (name) bucket.add(normKey(name));
      }
    }
    for (const [attr, component] of Object.entries(hints)) {
      if (new RegExp(`\\b${attr}\\s*:`).test(src)) found.pro.add(normKey(component));
    }
  }
  return found;
}

/**
 * 按需挑选手册：always + 识别到的组件对应手册；一个都没识别到时用 fallback。
 * 顺序按 index.yaml 中出现顺序（always → pro → legacy），截断时靠前的先保留。
 */
export function selectPlaybooks(
  docs: PlaybookDoc[],
  index: PlaybookIndex,
  detected: DetectedComponents,
): PlaybookDoc[] {
  const pick = (map: Record<string, string[]>, names: Set<string>) =>
    Object.entries(map)
      .filter(([k]) => names.has(normKey(k)))
      .flatMap(([, ids]) => ids);
  const matched = [...pick(index.pro, detected.pro), ...pick(index.legacy, detected.legacy)];
  const wanted = new Set([...index.always, ...(matched.length ? matched : index.fallback)]);

  const order = [
    ...index.always,
    ...Object.values(index.pro).flat(),
    ...Object.values(index.legacy).flat(),
    ...index.fallback,
  ];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return docs.filter((d) => wanted.has(d.id)).sort((a, b) => rank(a.id) - rank(b.id));
}

/** 加载全部手册并按源码 import 选取；index.yaml 缺失时退回全部手册 */
export async function loadPlaybooksForSources(
  sources: string[],
  dir = PATHS.playbooks,
): Promise<PlaybookDoc[]> {
  const docs = await loadPlaybooks(dir);
  const index = await loadPlaybookIndex(dir).catch(() => null);
  if (!index) return docs;
  const detected = detectChoerodonComponents(sources, index.dataset_hints);
  const selected = selectPlaybooks(docs, index, detected);
  logger.info(
    { pro: [...detected.pro], legacy: [...detected.legacy], selected: selected.map((d) => d.id) },
    'selectPlaybooks',
  );
  return selected;
}

/** 按 id 取手册（gen 阶段沿用 analyze 选定的 artifact.playbooks） */
export async function loadPlaybooksByIds(ids: string[], dir = PATHS.playbooks): Promise<PlaybookDoc[]> {
  const docs = await loadPlaybooks(dir);
  return ids.map((id) => docs.find((d) => d.id === id)).filter((d): d is PlaybookDoc => !!d);
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
