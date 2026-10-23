import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { featureBaselineDir } from '../compare/paths.js';
import { featureOutputSlug } from '../core/featurePaths.js';
import { logger } from '../core/logger.js';
import type { FeatureArtifact } from '../core/schema.js';

/**
 * 基线锚定：让“改动前后两次分析”的 id 与结构保持一致，对比才只剩真实改动。
 *
 * 做法两层：
 * 1. 提示词里带上基线（v1）的页面、操作、步骤骨架，要求未变化处原样沿用；
 * 2. 分析后确定性对齐：LLM 仍改了 id 的操作，按（类型, 页面, 接口/名称）唯一匹配回基线 id，
 *    并按“基线顺序在前、新增在后（按 id 字母序）”固定排序。
 */

type Op = FeatureArtifact['operations'][number];

export async function loadBaselineArtifact(
  feature: string,
  label = 'v1',
): Promise<FeatureArtifact | undefined> {
  const dir = featureBaselineDir(featureOutputSlug(feature), label);
  try {
    const text = await fs.readFile(path.join(dir, 'feature.yaml'), 'utf8');
    const y = parse(text) as FeatureArtifact;
    return y && Array.isArray(y.operations) ? y : undefined;
  } catch {
    return undefined;
  }
}

/** 提示词用的基线骨架：只放 id/类型/页面/接口/步骤要点，不放长文本 */
export function formatBaselineForPrompt(base: FeatureArtifact): string {
  const skeleton = {
    pages: (base.pages ?? []).map((p) => ({ id: p.id, route: p.route })),
    operations: base.operations.map((o) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      page_id: o.page_id,
      api: o.api,
      steps: (o.steps ?? []).map((s) => ({ kind: s.kind, element: s.element, api: s.api })),
    })),
    field_rules: (base.field_rules ?? []).map((r) => ({
      name: r.name,
      label: r.label,
      control: r.control,
      editable_when: r.editable_when,
      readonly_when: r.readonly_when,
      row_gate: r.row_gate,
    })),
  };
  return [
    '【基线分析（沿用，非本次输入）】',
    '下面是改动前的分析骨架。要求：',
    '1. pages[].id、operations[].id、steps 的 kind/element 顺序，凡基线已有且源码未体现变化的，必须原样沿用，禁止改名、拆分、合并、重排；',
    '2. 只有源码中确有证据的增、删、改才允许与基线不同；新增 operation 的 id 沿用基线的命名风格；',
    '3. 不要因为表述习惯不同而重写基线已有内容。',
    JSON.stringify(skeleton),
  ].join('\n');
}

const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** 对齐键：接口优先，其次类型+页面+名称 */
function matchKeys(o: Op): string[] {
  const keys: string[] = [];
  if (o.api) keys.push(`api|${o.type}|${norm(o.api)}`);
  keys.push(`name|${o.type}|${norm(o.page_id)}|${norm(o.name)}`);
  return keys;
}

export type AnchorReport = { renamed: { from: string; to: string }[]; added: string[]; removed: string[] };

/** 把 LLM 改了 id 的操作映射回基线 id（唯一匹配才改），并固定排序 */
export function anchorToBaseline(
  artifact: FeatureArtifact,
  base: FeatureArtifact,
): { artifact: FeatureArtifact; report: AnchorReport } {
  const baseIds = new Set(base.operations.map((o) => o.id));
  const index = new Map<string, Op[]>();
  for (const o of base.operations) {
    for (const k of matchKeys(o)) index.set(k, [...(index.get(k) ?? []), o]);
  }
  const used = new Set(artifact.operations.filter((o) => baseIds.has(o.id)).map((o) => o.id));
  const renamed: AnchorReport['renamed'] = [];

  const ops = artifact.operations.map((o) => {
    if (baseIds.has(o.id)) return o;
    for (const k of matchKeys(o)) {
      const cands = (index.get(k) ?? []).filter((c) => !used.has(c.id));
      if (cands.length === 1) {
        used.add(cands[0]!.id);
        renamed.push({ from: o.id, to: cands[0]!.id });
        return { ...o, id: cands[0]!.id };
      }
    }
    return o;
  });

  const order = new Map(base.operations.map((o, i) => [o.id, i]));
  ops.sort((a, b) => {
    const ia = order.get(a.id);
    const ib = order.get(b.id);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const curIds = new Set(ops.map((o) => o.id));
  const report: AnchorReport = {
    renamed,
    added: ops.filter((o) => !baseIds.has(o.id)).map((o) => o.id),
    removed: base.operations.filter((o) => !curIds.has(o.id)).map((o) => o.id),
  };
  logger.info(report, '基线锚定完成');
  return { artifact: { ...artifact, operations: ops }, report };
}
