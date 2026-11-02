import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { deepSeekChat, isDelegateMode, isHandoffMode, loadDeepSeekConfig } from '../analyzer/deepseekClient.js';
import { logger } from '../core/logger.js';
import type { ControlDiff } from './controlCatalogDiff.js';

/**
 * 把源码脚本算出的控件差异（事实）与当前流程步骤（feature.yaml）交给 LLM，
 * 由 LLM 归纳「哪条流程因为哪些控件变化而变化」。
 * LLM 只能引用输入里出现过的控件 id；不在输入中的 id 会被剔除。
 * 兜底：所有控件变化都会在报告末尾的「源码变化明细」中逐条列出，不依赖 LLM 是否提到。
 */

const NarrativeSchema = z.object({
  summary: z.string(),
  flows: z.array(
    z.object({
      title: z.string(),
      change_type: z.enum(['added', 'removed', 'modified']),
      what_changed: z.string(),
      control_ids: z.array(z.string()).default([]),
    }),
  ),
  notes: z.array(z.string()).optional(),
});

export type FlowInput = { id: string; title: string; steps: string[] };

export type NarrativeResult = {
  markdown: string;
  flowsWithChange: number;
  droppedIds: string[];
};

/** 从 feature.yaml 取出流程列表（标题 + 有序步骤名） */
export function loadFlows(featureYaml: unknown): FlowInput[] {
  const doc = featureYaml as {
    flows?: { id: string; title?: string; nodes?: { meta_op_id: string }[] }[];
    meta_ops?: { id: string; name?: string }[];
    operations?: { id: string; name?: string; api?: string }[];
  };
  // 步骤名带上接口路径，便于与控件的 dataSet 接口对应
  const nameOf = new Map<string, string>();
  for (const o of [...(doc.operations ?? []), ...(doc.meta_ops ?? [])]) {
    if (o.name) nameOf.set(o.id, (o as { api?: string }).api ? `${o.name}（${(o as { api?: string }).api}）` : o.name);
  }
  return (doc.flows ?? []).map((f) => ({
    id: f.id,
    title: f.title ?? f.id,
    steps: (f.nodes ?? []).map((n) => nameOf.get(n.meta_op_id) ?? n.meta_op_id),
  }));
}

/** 语义 id 中的 tag|label|ctx|handler 片段，转为可读文字 */
const readable = (id: string): string => id.split('|').slice(1).filter(Boolean).join(' / ');

type Fact = { id: string; kind: string; desc: string; line?: number; side?: string; triggers?: string[] };
const loc = (f: Fact) => (f.line ? `（${f.side ?? ''}版 index.js:${f.line}）` : '');

function changeFacts(diff: ControlDiff): Fact[] {
  const out: Fact[] = [];
  for (const c of diff.added) {
    out.push({ id: c.id, kind: 'added', desc: `新增控件 ${readable(c.id)}，状态 ${c.state}${c.note ? `，${c.note}` : ''}`, line: c.line, side: '当前', triggers: c.triggers });
  }
  for (const c of diff.removed) {
    out.push({ id: c.id, kind: 'removed', desc: `移除控件 ${readable(c.id)}，原状态 ${c.state}${c.note ? `，${c.note}` : ''}`, line: c.line, side: 'V1', triggers: c.triggers });
  }
  for (const ch of diff.changed) {
    const parts = ch.fields.map((f) => {
      const b = (ch.before as unknown as Record<string, unknown>)[f];
      const a = (ch.after as unknown as Record<string, unknown>)[f];
      return `${f}：${String(b ?? '')} → ${String(a ?? '')}`;
    });
    out.push({ id: ch.id, kind: 'changed', desc: `属性变化 ${readable(ch.id)}（${parts.join('；')}）`, line: ch.after.line, side: '当前', triggers: ch.after.triggers });
  }
  for (const m of diff.possiblyMoved) {
    out.push({ id: m.after.id, kind: 'moved', desc: `疑似移动/改名 ${readable(m.before.id)} → ${readable(m.after.id)}`, line: m.after.line, side: '当前', triggers: m.after.triggers });
  }
  return out;
}

function buildSystemPrompt(): string {
  return `你是 MES 前端功能「流程变化」报告助手。输入分两部分：
1. facts：源码脚本确定性算出的控件变化（唯一可信的变化依据，每条有 id）。
2. flows：当前功能的测试流程（标题 + 有序步骤名）。步骤名来自历史分析，可能不完整，只用于定位流程，不作为变化依据。

【任务】
- 找出哪些流程的步骤与 facts 中的控件变化相关，写出该流程「怎么变了」。
- 一条 flow 输出一条记录；未受影响的流程不要输出。
- control_ids 只能填 facts 里出现过的 id，原样复制，不得编造或改写。
- what_changed 一句短句（≤50 字），只描述 facts 中的事实。
- 归属必须有依据：控件的 triggers（弹窗/点击入口）或其 dataSet 接口与某流程的步骤名/接口明显对应才可关联。仅凭控件名相近或同页面出现，不得关联。
- 同一控件只关联到一条最直接的流程（优先看 triggers 对应的流程）。若它的接口被多条流程共用，只关联一条，其余流程写进 notes，标注「接口共用，是否受影响待确认」，不得把同一变化写成多条流程都变了。
- 与任何流程都对不上的 facts，不要硬凑到某条流程里，忽略即可（脚本会在报告末尾单独列出）。
- summary：一两句话说明源码层面共几处变化、涉及几条流程。

【禁止】
- 不得新增 facts 之外的控件、接口或业务规则
- 不得描述「用户双击/点击了某处」这类 facts 中没有的操作
- 不得输出评审清单或冗长章节

输出单个 JSON，字段严格符合：{"summary": string, "flows": [{"title": string, "change_type": "added"|"removed"|"modified", "what_changed": string, "control_ids": string[]}], "notes": string[] 可选}，不要 Markdown 围栏。`;
}

export async function narrateControlDiff(opts: {
  feature: string;
  diff: ControlDiff;
  flows: FlowInput[];
}): Promise<NarrativeResult> {
  const facts = changeFacts(opts.diff);
  const knownIds = new Set(facts.map((f) => f.id));
  const config = isHandoffMode() || isDelegateMode() ? undefined : loadDeepSeekConfig();

  const user = `【功能】${opts.feature}

【facts（源码控件变化，唯一依据）】
${JSON.stringify(facts.map((f) => ({ id: f.id, kind: f.kind, desc: f.desc, version: f.side, triggers: (f.triggers ?? []).map((t) => readable(t)) })), null, 2)}

【flows（当前流程，步骤名仅供定位）】
${JSON.stringify(opts.flows.map((f) => ({ title: f.title, steps: f.steps })), null, 2)}`;

  const { content, model } = await deepSeekChat({
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
    responseFormatJson: true,
    config,
  });

  let parsed: z.infer<typeof NarrativeSchema>;
  try {
    parsed = NarrativeSchema.parse(JSON.parse(content));
  } catch (e) {
    throw new Error(`流程变化报告 JSON 解析/校验失败: ${(e as Error).message}；原始输出: ${content.slice(0, 300)}`);
  }

  // 剔除 LLM 编造的控件 id
  const droppedIds: string[] = [];
  const flows = parsed.flows.map((f) => {
    const kept = f.control_ids.filter((id) => {
      if (knownIds.has(id)) return true;
      droppedIds.push(id);
      return false;
    });
    return { ...f, control_ids: kept };
  });
  if (droppedIds.length) logger.warn({ droppedIds }, '流程报告：剔除不在源码变化中的控件引用');

  const referenced = new Set(flows.flatMap((f) => f.control_ids));
  const unlinked = facts.filter((f) => !referenced.has(f.id));

  const lines: string[] = [];
  lines.push(`# ${opts.feature}：流程变化报告（脚本事实 + LLM 归纳）`, '');
  lines.push(`> 变化依据来自源码控件目录对比（脚本确定性输出）；流程归纳由 LLM 完成（模型：${model}），每条引用的控件均已校验存在于源码变化中。`, '');
  lines.push('## 概述', '', parsed.summary, '');
  lines.push(`未关联到流程的源码变化 ${unlinked.length} 处（见末尾明细）。`, '');

  lines.push('## 有变化的流程', '');
  if (!flows.length) lines.push('（LLM 未关联到任何流程；以下为全部源码变化明细）', '');
  for (const f of flows) {
    const tag = f.change_type === 'added' ? '新增' : f.change_type === 'removed' ? '移除' : '修改';
    lines.push(`### ${f.title}（${tag}）`, '', f.what_changed, '');
    for (const id of f.control_ids) {
      const fact = facts.find((x) => x.id === id);
      if (fact) lines.push(`- ${fact.desc}${loc(fact)}`);
    }
    lines.push('');
  }

  lines.push('## 源码变化明细（全部，脚本输出）', '');
  for (const f of facts) {
    lines.push(`- [${f.kind}] ${f.desc}${loc(f)}`);
  }
  lines.push('');

  if (parsed.notes?.length) {
    lines.push('## 说明', '');
    for (const n of parsed.notes) lines.push(`- ${n}`);
    lines.push('');
  }
  lines.push('## 待确认', '', '- 流程步骤名来自历史分析（feature.yaml），可能不完整；流程归纳只作为定位参考，以上方源码变化明细为准。', '');

  return { markdown: lines.join('\n'), flowsWithChange: flows.length, droppedIds };
}

export async function writeNarrative(opts: {
  feature: string;
  diff: ControlDiff;
  featureYaml: unknown;
  outDir: string;
}): Promise<NarrativeResult> {
  const res = await narrateControlDiff({ feature: opts.feature, diff: opts.diff, flows: loadFlows(opts.featureYaml) });
  await fs.mkdir(opts.outDir, { recursive: true });
  await fs.writeFile(path.join(opts.outDir, 'control-flow-report.zh.md'), res.markdown, 'utf8');
  return res;
}

export async function readFeatureYaml(file: string): Promise<unknown> {
  return YAML.parse(await fs.readFile(file, 'utf8'));
}
