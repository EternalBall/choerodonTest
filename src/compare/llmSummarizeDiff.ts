import { z } from 'zod';
import { deepSeekChat, loadDeepSeekConfig } from '../analyzer/deepseekClient.js';
import { logger } from '../core/logger.js';
import type { CompareDiffDocument } from './buildDiffYaml.js';
import YAML from 'yaml';

const CompareReportSchema = z.object({
  report_version: z.literal('2'),
  feature: z.string(),
  logic_changed: z.boolean(),
  /** 1～2 句总览 */
  summary: z.string(),
  /** 仅写有变化的流程；不变的可省略 */
  flows: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      change_type: z.enum(['added', 'removed', 'modified']),
      /** 一句说清这条完整流程怎么变了 */
      what_changed: z.string(),
    }),
  ),
  /** 可选补充，每条一行，尽量少 */
  notes: z.array(z.string()).optional(),
});

export type CompareReportDocument = z.infer<typeof CompareReportSchema> & {
  meta: {
    generated_at: string;
    model: string;
    source_diff: string;
  };
};

function buildSystemPrompt(): string {
  return `你是 UI 自动化「测试流程」对比报告助手。输入是基线 vs 当前的结构化 diff（主轴是完整流程链）。

【任务】
1. 以「完整测试流程」为单位写报告（一条 flow = 一条可执行链路），不要按零散字段堆砌
2. summary：一两句话说清有无逻辑变更、影响几条流程
3. flows：只列有变化的流程；what_changed 必须是一句短句（≤40 字），说清步骤增删/顺序/接口变化
4. notes：可选，最多 2 条，一句一条
5. 输出单个 JSON，字段严格符合 schema，不要 Markdown 围栏

【禁止】
- 不要复述 before/after 整链
- 不要编造 diff 中不存在的步骤或接口
- 不要写评审清单、能力分节、路径类别等冗长章节`;
}

export async function llmSummarizeDiff(
  diff: CompareDiffDocument,
): Promise<{ report: CompareReportDocument; raw: string }> {
  const config = loadDeepSeekConfig();
  // 给 LLM 的精简视图：流程主轴 + highlights，避免全量 before/after 噪音
  const forLlm = {
    meta: {
      feature: diff.meta.feature,
      baseline: diff.meta.baseline_label,
      logic_changed: diff.meta.logic_changed,
      suite_only_drift: diff.meta.suite_only_drift,
    },
    flows: diff.flows
      .filter((f) => f.change_type !== 'unchanged')
      .map((f) => ({
        id: f.id,
        title: f.title,
        change_type: f.change_type,
        highlights: f.highlights,
        before_chain: f.before.map((s) => `${s.meta_op_id}(${s.kind})`).join(' → '),
        after_chain: f.after.map((s) => `${s.meta_op_id}(${s.kind})`).join(' → '),
      })),
    operations: diff.operations,
    supporting: diff.supporting,
    suite: diff.suite,
  };
  const diffYaml = YAML.stringify(forLlm);

  const user = `【对比差异（完整流程主轴）】
${diffYaml}

【输出 JSON schema】
{
  "report_version": "2",
  "feature": string,
  "logic_changed": boolean,
  "summary": string,
  "flows": [{ "id": string, "title": string optional, "change_type": "added"|"removed"|"modified", "what_changed": string }],
  "notes": string[] optional
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
