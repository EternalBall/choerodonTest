import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { PATHS } from '../core/paths.js';
import { toArtifactDirName } from '../core/featurePaths.js';

/**
 * 采纳探测结果：把 probe.json 里 verdict=ok 的定位写进功能级元素库
 * knowledge/features/<slug>/elements.yaml（人工 overlay，优先级最高）。
 * 只加不改：已有条目（人工写的或上次采纳的）默认不动，--refresh 才重写“上次采纳”的条目。
 */

export const ADOPT_NOTE_PREFIX = 'UAT 只读探测通过';
const DEF_FIELDS = ['css', 'role', 'name', 'text', 'label', 'placeholder', 'testId', 'within'] as const;

export type ProbeItemLike = { key: string; verdict: string; def?: Record<string, unknown>; stage?: string };
export type ProbeReportLike = { items: ProbeItemLike[] };

export type AdoptPlan = {
  merged: Record<string, Record<string, unknown>>;
  added: string[];
  refreshed: string[];
  /** 已有条目（人工或非本命令写入）而跳过 */
  keptExisting: string[];
  /** 探测结论不是 ok，不采纳 */
  notOk: string[];
};

const STAGE_LABEL: Record<string, string> = {
  initial: '初始页', row_selected: '选中单据行后', detail: '详情页', edit: '编辑态', create: '新建页',
  create_filled: '新建页填必填项后', create_row: '新建页加行后', create_cell: '新建页点单元格后', create_remove: '新建页点删除图标后',
};

export function planAdoption(
  existing: Record<string, Record<string, unknown>>,
  reports: { label: string; report: ProbeReportLike }[],
  today: string,
  opts: { refresh?: boolean } = {},
): AdoptPlan {
  const merged = { ...existing };
  const plan: AdoptPlan = { merged, added: [], refreshed: [], keptExisting: [], notOk: [] };
  const seen = new Set<string>();
  const okKeys = new Set<string>();
  for (const { label, report } of reports) {
    for (const it of report.items) {
      if (it.verdict !== 'ok') continue;
      okKeys.add(it.key);
      if (seen.has(it.key) || !it.def) continue;
      seen.add(it.key);
      const d: Record<string, unknown> = {};
      for (const f of DEF_FIELDS) if (it.def[f] !== undefined) d[f] = it.def[f];
      if (!Object.keys(d).length) continue;
      const stage = STAGE_LABEL[it.stage ?? 'initial'] ?? it.stage ?? '初始页';
      d.note = `${today} ${ADOPT_NOTE_PREFIX}（${label}，${stage}，匹配 1 个且可见）`;
      const cur = existing[it.key];
      if (cur === undefined) {
        merged[it.key] = d;
        plan.added.push(it.key);
      } else if (opts.refresh && typeof cur.note === 'string' && cur.note.includes(ADOPT_NOTE_PREFIX)) {
        merged[it.key] = d;
        plan.refreshed.push(it.key);
      } else plan.keptExisting.push(it.key);
    }
  }
  for (const { report } of reports) for (const it of report.items) if (it.verdict !== 'ok' && !okKeys.has(it.key) && !plan.notOk.includes(it.key)) plan.notOk.push(it.key);
  return plan;
}

export function featureElementsFile(feature: string): string {
  return path.join(PATHS.knowledge, toArtifactDirName(feature), 'elements.yaml');
}

export async function adoptProbe(opts: {
  feature: string;
  probeFiles: string[];
  dryRun?: boolean;
  refresh?: boolean;
  today?: string;
}): Promise<AdoptPlan & { file: string; backup?: string }> {
  const file = featureElementsFile(opts.feature);
  const existingText = await fs.readFile(file, 'utf8').catch(() => '');
  const existing = (existingText ? YAML.parse(existingText) : {}) ?? {};
  const reports: { label: string; report: ProbeReportLike }[] = [];
  for (const f of opts.probeFiles) {
    const report = JSON.parse(await fs.readFile(f, 'utf8')) as ProbeReportLike;
    reports.push({ label: path.basename(path.dirname(f)), report });
  }
  const plan = planAdoption(existing, reports, opts.today ?? new Date().toISOString().slice(0, 10), { refresh: opts.refresh });
  let backup: string | undefined;
  if (!opts.dryRun && (plan.added.length || plan.refreshed.length)) {
    if (existingText) {
      backup = `${file}.bak`;
      await fs.writeFile(backup, existingText, 'utf8');
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, YAML.stringify(plan.merged), 'utf8');
  }
  return { ...plan, file, backup };
}
