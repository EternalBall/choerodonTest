import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { deepSeekChat } from '../analyzer/deepseekClient.js';
import { featureGenLlmRawFile, featureOutputSlug } from '../core/featurePaths.js';
import { logger } from '../core/logger.js';
import {
  SuiteSchema,
  type FeatureArtifact,
  type Suite,
} from '../core/schema.js';
import { listActions } from '../keywords/index.js';
import {
  formatPlaybooksForPrompt,
  loadPlaybooks,
} from '../knowledge/loadPlaybooks.js';

const ALLOWED_ACTIONS = new Set(listActions());

const SUITE_JSON_HINT = `{
  "suite": "问题管理平台字段配置 自动生成",
  "cases": [
    {
      "id": "TC_FEAT_E997AEE9_QUERY",
      "title": "问题管理平台字段配置 - 查询",
      "tags": ["问题管理平台字段配置", "query", "flow:default"],
      "steps": [
        {
          "name": "打开配置页",
          "action": "goto",
          "args": { "path": "/hwms/problem-management/problem-field-config" },
          "ready": { "visible": "feat_e997aee9.pageReady" },
          "screenshot": true
        },
        {
          "name": "筛选并查询",
          "action": "tableFilterQuery",
          "args": {
            "mode": "filterBar",
            "resetFirst": true,
            "fields": [
              { "name": "fieldType", "label": "类型", "control": "select", "first": true }
            ]
          },
          "ready": { "hidden": "feat_e997aee9.tableSpin" },
          "screenshot": true
        }
      ]
    },
    {
      "id": "TC_FEAT_E997AEE9_UPDATE",
      "title": "问题管理平台字段配置 - 保存",
      "tags": ["问题管理平台字段配置", "update", "flow:default"],
      "steps": [
        {
          "name": "打开配置页",
          "action": "goto",
          "args": { "path": "/hwms/problem-management/problem-field-config" },
          "ready": { "visible": "feat_e997aee9.pageReady" },
          "screenshot": true
        },
        {
          "name": "点击保存并等待接口",
          "action": "clickExpectApi",
          "args": {
            "target": "feat_e997aee9.saveBtn",
            "urlIncludes": ["qis-problem-field-perm/update"],
            "successUrlIncludes": ["qis-problem-field-perm/update"],
            "timeout": 30000
          },
          "screenshot": true
        }
      ]
    }
  ]
}`;

function buildSystemPrompt(allowedActions: string[], ns: string): string {
  return `你是 UI 自动化测试用例生成助手。根据功能路径描述（artifacts 中的 feature.yaml：优先 meta_ops + flows；否则 operations）生成可执行的 Playwright 配置驱动 suite JSON。

【硬性要求】
1. 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释文字
2. 顶层必须含 suite（字符串）与 cases（非空数组）
3. 每个 case：id、title、steps（至少 1 步）；tags 可选
4. 每个 step：name、action、args；可选 ready / assert / screenshot
5. action 只能是下列关键字之一：
   ${allowedActions.join(' | ')}
6. 元素引用使用命名空间前缀（如 ${ns}.pageReady / ${ns}.saveBtn），与 elements 库 key 对齐；禁止编造未声明的 CSS 选择器作为 target
7. 改数据步骤优先用 clickExpectApi，urlIncludes / successUrlIncludes 必须来自输入中的 operation.api / apis[] 字面量片段，禁止猜测 REST 路径
8. 每个 operation（或每条 flow）至少对应一条 case；case.id 形如 TC_{NS}_{OP_ID}，OP_ID 用 operation.id / flow.id 大写蛇形
9. 查询类用 tableFilterQuery（filterBar）；进详情用 openDetailRow；Lov 用 pickLov；Select/快码用 pickSelect；填表用 fill / fillForm
10. screenshot 默认 true；ready 用 visible/hidden 元素引用
11. **样本数据（重要）**：
    - Select / Lookup：tableFilterQuery 字段写 \`control: "select", first: true\`（不要 value）；或步骤用 pickSelect（name + first:true）
    - Lov：\`control: "lov", first: true\` 或 pickLov（默认第一行）
    - 自由文本才写 value；可用 \${ENV.ATA_SAMPLE} / \${ENV.ATA_RUN_ID} / \${vars.xxx}
    - **禁止**对 Select 字段 fill 环境变量字符串
    - 查询可选文本条件无样本时可省略该字段，只保留必填 Select/Lov
12. 若输入含 meta_ops + flows：严格按 flows 节点顺序编排 steps，把 meta_op.kind 映射为上表 action
13. 若仅有 operations：按 execution_chain / preconditions / type 推导最短可执行链路

【输出示例】
${SUITE_JSON_HINT}`;
}

/** 从 artifact 抽出喂给 LLM 的路径描述（优先 meta_ops/flows，否则 operations） */
export function formatArtifactForGenPrompt(artifact: FeatureArtifact): string {
  const ns = featureOutputSlug(artifact.feature);
  const payload: Record<string, unknown> = {
    feature: artifact.feature,
    element_namespace: ns,
    entry: artifact.entry,
    pages: artifact.pages,
    page_edges: artifact.page_edges,
    operations: artifact.operations,
    page_states: artifact.page_states,
    field_rules: artifact.field_rules,
    validations: artifact.validations,
    apis: artifact.apis,
    elements_hints: artifact.elements_hints,
    notes: artifact.notes,
  };
  if (artifact.meta_ops?.length) payload.meta_ops = artifact.meta_ops;
  if (artifact.flows?.length) payload.flows = artifact.flows;

  return YAML.stringify(payload);
}

function normalizeSuiteJson(
  input: unknown,
  artifact: FeatureArtifact,
  baseURL?: string,
): Suite {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const ns = featureOutputSlug(artifact.feature).toUpperCase();
  const casesIn = Array.isArray(raw.cases) ? raw.cases : [];

  const cases = casesIn
    .map((item, index) => normalizeCase(item, artifact, ns, index))
    .filter((c): c is Suite['cases'][number] => Boolean(c));

  if (!cases.length) {
    throw new Error('LLM 未生成任何有效用例（cases 为空或 action 全部非法）');
  }

  return SuiteSchema.parse({
    suite:
      typeof raw.suite === 'string' && raw.suite.trim()
        ? raw.suite.trim()
        : `${artifact.feature} 自动生成`,
    baseURL: baseURL ?? (typeof raw.baseURL === 'string' ? raw.baseURL : undefined),
    cases,
  });
}

function normalizeCase(
  item: unknown,
  artifact: FeatureArtifact,
  nsUpper: string,
  index: number,
): Suite['cases'][number] | null {
  if (!item || typeof item !== 'object') return null;
  const c = item as Record<string, unknown>;
  const stepsIn = Array.isArray(c.steps) ? c.steps : [];
  const steps = stepsIn
    .map((s) => normalizeStep(s))
    .filter((s): s is Suite['cases'][number]['steps'][number] => Boolean(s));
  if (!steps.length) return null;

  let id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : '';
  if (!id) {
    const opHint =
      typeof c.operation_id === 'string'
        ? c.operation_id
        : artifact.operations[index]?.id || `case_${index + 1}`;
    id = `TC_${nsUpper}_${String(opHint).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  }

  const tags = Array.isArray(c.tags)
    ? c.tags.map((t) => String(t)).filter(Boolean)
    : [artifact.feature, 'flow:llm'];

  return {
    id,
    title:
      typeof c.title === 'string' && c.title.trim()
        ? c.title.trim()
        : `${artifact.feature} - case ${index + 1}`,
    tags,
    steps,
  };
}

function normalizeStep(
  item: unknown,
): Suite['cases'][number]['steps'][number] | null {
  if (!item || typeof item !== 'object') return null;
  const s = item as Record<string, unknown>;
  const action = String(s.action || '').trim();
  if (!action || !ALLOWED_ACTIONS.has(action)) {
    logger.warn({ action }, '丢弃非法 action 步骤');
    return null;
  }
  const name =
    typeof s.name === 'string' && s.name.trim() ? s.name.trim() : action;
  const args =
    s.args && typeof s.args === 'object' && !Array.isArray(s.args)
      ? (s.args as Record<string, unknown>)
      : {};

  const step: Suite['cases'][number]['steps'][number] = {
    name,
    action,
    args,
    screenshot: s.screenshot === undefined ? true : (s.screenshot as boolean | object),
  };

  if (s.ready && typeof s.ready === 'object') {
    step.ready = s.ready as Suite['cases'][number]['steps'][number]['ready'];
  }
  if (Array.isArray(s.assert)) {
    step.assert = s.assert as Suite['cases'][number]['steps'][number]['assert'];
  }

  return step;
}

async function saveGenRaw(feature: string, text: string): Promise<void> {
  try {
    const file = featureGenLlmRawFile(feature);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, 'utf8');
  } catch {
    // ignore
  }
}

/**
 * artifacts feature.yaml（路径描述 / 元操作）→ LLM → 可执行 Suite。
 * 失败直接抛错，不回退规则编译。
 */
export async function llmGenSuite(opts: {
  artifact: FeatureArtifact;
  baseURL?: string;
}): Promise<Suite> {
  const { artifact, baseURL } = opts;
  const ns = featureOutputSlug(artifact.feature);
  const allowed = listActions();
  const playbooks = await loadPlaybooks();
  const playbookBlock = playbooks.length
    ? formatPlaybooksForPrompt(playbooks, 24_000)
    : '';

  const artifactBlock = formatArtifactForGenPrompt(artifact);
  if (!artifactBlock.trim()) {
    throw new Error('artifacts 路径描述为空，无法生成用例');
  }

  logger.info(
    {
      feature: artifact.feature,
      ns,
      operations: artifact.operations.length,
      meta_ops: artifact.meta_ops?.length ?? 0,
      flows: artifact.flows?.length ?? 0,
      playbooks: playbooks.map((p) => p.id),
    },
    'LLM 生成 suite 开始',
  );

  const { content: text, model } = await deepSeekChat({
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(allowed, ns),
      },
      {
        role: 'user',
        content: [
          `功能: ${artifact.feature}`,
          `元素命名空间 ns=${ns}（target 请用 ${ns}.xxx）`,
          playbookBlock,
          '【输入：artifacts 路径描述 / 元操作】',
          artifactBlock,
          '请严格按 system 要求输出 suite JSON。',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
    responseFormatJson: true,
    temperature: 0.1,
  });

  await saveGenRaw(artifact.feature, text);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('无法解析 LLM suite JSON');
    json = JSON.parse(m[0]);
  }

  const suite = normalizeSuiteJson(json, artifact, baseURL);
  logger.info(
    {
      feature: artifact.feature,
      model,
      cases: suite.cases.map((c) => c.id),
    },
    'LLM 生成 suite 完成',
  );
  return suite;
}
