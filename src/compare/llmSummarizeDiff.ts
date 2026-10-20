import { z } from 'zod';
import { deepSeekChat, loadDeepSeekConfig } from '../analyzer/deepseekClient.js';
import { logger } from '../core/logger.js';
import type { CompareDiffDocument } from './buildDiffYaml.js';
import YAML from 'yaml';

const CompareReportSchema = z.object({
  report_version: z.literal('1'),
  feature: z.string(),
  logic_changed: z.boolean(),
  executive_summary: z.string().describe('2-4 句总览，业务语言'),
  capabilities: z.array(
    z.object({
      operation_id: z.string(),
      change_type: z.enum(['added', 'removed', 'modified', 'unchanged']),
      narrative: z.string(),
    }),
  ),
  meta_ops_summary: z.string().optional(),
  flows_summary: z.string().optional(),
  models_summary: z.string().optional().describe('入口/页面状态/字段规则/校验'),
  suite_summary: z.string().optional().describe('编译用例层辅助说明'),
  path_readable: z
    .array(
      z.object({
        category: z.string(),
        narrative: z.string(),
      }),
    )
    .describe('步骤构成、执行顺序、触发方式、前置、校验性等'),
  risks: z.array(z.string()),
  reviewer_checklist: z.array(z.string()),
});

export type CompareReportDocument = z.infer<typeof CompareReportSchema> & {
  meta: {
    generated_at: string;
    model: string;
    source_diff: string;
  };
};

function buildSystemPrompt(): string {
  return `你是 UI 自动化「路径描述」评审助手。输入是一份结构化的对比差异 YAML（baseline vs current），不是源码 diff。

【任务】
1. 用业务可读语言写对比报告，按能力（operations）组织
2. 优先说明：步骤构成、执行顺序、触发方式、前置依赖、接口去向、必填/校验变化
3. meta_ops / flows 有内容时说明节点级变化；无则明确写「产物未含 flows/meta_ops，仅能力层」
4. suite 段落仅作执行脚本是否跟上的辅助，不作为唯一逻辑依据
5. 输出单个 JSON 对象，字段严格符合用户 schema，不要 Markdown 围栏

【禁止】
- 不要编造 diff 中不存在的接口或步骤
- 不要用代码符号堆砌代替业务叙述`;
}

export async function llmSummarizeDiff(
  diff: CompareDiffDocument,
): Promise<{ report: CompareReportDocument; raw: string }> {
  const config = loadDeepSeekConfig();
  const diffYaml = YAML.stringify(diff);

  const user = `【对比差异 YAML】
${diffYaml}

【输出 JSON schema】
{
  "report_version": "1",
  "feature": string,
  "logic_changed": boolean,
  "executive_summary": string,
  "capabilities": [{ "operation_id": string, "change_type": "added"|"removed"|"modified"|"unchanged", "narrative": string }],
  "meta_ops_summary": string optional,
  "flows_summary": string optional,
  "models_summary": string optional,
  "suite_summary": string optional,
  "path_readable": [{ "category": string, "narrative": string }],
  "risks": string[],
  "reviewer_checklist": string[]
}`;

  const { content, model } = await deepSeekChat({
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    responseFormatJson: true,
    config,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`LLM 对比报告 JSON 解析失败: ${content.slice(0, 400)}`);
  }

  const body = CompareReportSchema.parse(parsed);
  const report: CompareReportDocument = {
    ...body,
    meta: {
      generated_at: new Date().toISOString(),
      model,
      source_diff: `compare/${diff.meta.baseline_label}`,
    },
  };

  logger.info({ model, feature: diff.meta.feature }, 'LLM 对比报告已生成');
  return { report, raw: content };
}

/** 无 LLM 时的结构化兜底报告 */
export function fallbackReportFromDiff(diff: CompareDiffDocument): CompareReportDocument {
  const caps: CompareReportDocument['capabilities'] = [];
  for (const op of diff.path.operations.added) {
    caps.push({ operation_id: op.id, change_type: 'added', narrative: `新增能力：${op.name}` });
  }
  for (const op of diff.path.operations.removed) {
    caps.push({ operation_id: op.id, change_type: 'removed', narrative: `移除能力：${op.name}` });
  }
  for (const c of diff.path.operations.changed) {
    caps.push({
      operation_id: c.id,
      change_type: 'modified',
      narrative: `变更字段：${c.fields.map((f) => f.field).join(', ')}`,
    });
  }
  for (const id of diff.path.operations.unchanged_ids) {
    caps.push({ operation_id: id, change_type: 'unchanged', narrative: '无变化' });
  }

  return {
    report_version: '1',
    feature: diff.meta.feature,
    logic_changed: diff.meta.logic_changed,
    executive_summary: diff.meta.logic_changed
      ? `相对基线 ${diff.meta.baseline_label}，路径描述存在逻辑层变更（详见 diff.yaml）。`
      : `相对基线 ${diff.meta.baseline_label}，路径描述无逻辑变更。`,
    capabilities: caps,
    suite_summary: diff.suite
      ? `用例新增 ${diff.suite.added.length}、移除 ${diff.suite.removed.length}、变更 ${diff.suite.changed.length}`
      : undefined,
    path_readable: [],
    risks: [],
    reviewer_checklist: ['请人工通读 diff.yaml 核对 execution_chain 与 api'],
    meta: {
      generated_at: new Date().toISOString(),
      model: 'fallback',
      source_diff: `compare/${diff.meta.baseline_label}`,
    },
  };
}
