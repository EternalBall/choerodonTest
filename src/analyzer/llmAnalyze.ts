import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FeatureArtifactSchema,
  type FeatureArtifact,
} from '../core/schema.js';
import { featureLlmRawFile } from '../core/featurePaths.js';
import { logger } from '../core/logger.js';
import {
  formatPlaybooksForPrompt,
  loadPlaybooksForSources,
  type PlaybookDoc,
} from '../knowledge/loadPlaybooks.js';
import { deepSeekChat } from './deepseekClient.js';
import { formatSnippetsForPrompt, type CodeSnippet } from './retrieve.js';

const ALLOWED_TYPES = new Set([
  'query',
  'create',
  'detail',
  'table_picker',
  'update',
  'copy',
  'related_page',
  'delete',
  'row_action',
  'other',
]);

const TYPE_ALIASES: Record<string, string> = {
  edit: 'update',
  save: 'update',
  modify: 'update',
  view: 'detail',
  link: 'detail',
  openDetail: 'detail',
  siteassignment: 'related_page',
  site_assignment: 'related_page',
  setSites: 'related_page',
  setsites: 'related_page',
  addline: 'other',
  add_line: 'other',
  switch: 'row_action',
  setdefault: 'row_action',
  set_default: 'row_action',
  set_default_secondary_uom: 'row_action',
  rowaction: 'row_action',
  row_action: 'row_action',
  inline: 'row_action',
  cancel: 'other',
  lov: 'table_picker',
  picker: 'table_picker',
  search: 'query',
  list: 'query',
  add: 'create',
  new: 'create',
};

const JSON_SCHEMA_HINT = `{
  "feature": "物料维护",
  "entry": { "route": "/hbase/product/material-manager/list", "menu": "物料维护" },
  "pages": [
    { "id": "list", "name": "列表", "route": "/hbase/product/material-manager/list", "scope": "in_feature", "source_hint": "Material/MaterialList" },
    { "id": "detail", "name": "详情", "route": "/hbase/product/material-manager/dist/:id", "scope": "in_feature", "source_hint": "Material/MaterialDetail" },
    { "id": "site_assignment", "name": "站点分配", "route": "/hbase/product/material-manager/site-assignment/:materialId", "scope": "in_feature", "source_hint": "Material/MaterialSiteAssignment" },
    { "id": "site_properties", "name": "物料站点属性维护", "route": "/hbase/product/material-site-properties/detail/:materialId/:materialSiteId", "scope": "external", "note": "独立功能目录 MaterialSiteProperties，只记入口" }
  ],
  "page_edges": [
    { "id": "list_to_detail", "from_page": "list", "to_page": "detail", "via": "row_link" },
    {
      "id": "detail_to_site_assignment",
      "from_page": "detail",
      "to_page": "site_assignment",
      "via": "header_button",
      "control": { "kind": "button", "name": "站点分配", "element": "siteAssignmentBtn" },
      "preconditions": ["enter_detail"]
    },
    {
      "id": "site_assignment_to_site_properties",
      "from_page": "site_assignment",
      "to_page": "site_properties",
      "via": "row_link",
      "control": { "kind": "link", "name": "物料站点属性维护", "element": "siteAttrLink" },
      "preconditions": ["enter_detail", "open_site_assignment"],
      "note": "to 为 external，不再分析对方页内编辑/新建"
    }
  ],
  "operations": [
    { "id": "query", "name": "查询", "type": "query", "page_id": "list", "scope": "in_feature", "fields": ["物料编码", "物料描述"], "route": "/hbase/product/material-manager/list", "execution_chain": ["list", "query"] },
    { "id": "create", "name": "新建", "type": "create", "page_id": "detail", "scope": "in_feature", "opens": "page", "initial_mode": "create", "route": "/hbase/product/material-manager/dist/create", "execution_chain": ["list", "create", "fill", "save"] },
    { "id": "detail", "name": "详情", "type": "detail", "page_id": "detail", "scope": "in_feature", "entry": "row_link", "initial_mode": "view", "from_state": "detail_view", "execution_chain": ["list", "detail"] },
    {
      "id": "update",
      "name": "编辑保存",
      "type": "update",
      "page_id": "detail",
      "scope": "in_feature",
      "initial_mode": "view",
      "unlock": "click:editBtn",
      "preconditions": ["enter_detail", "click:editBtn"],
      "steps": [
        { "kind": "goto", "name": "进入列表", "page_id": "list", "evidence": "routes 配置" },
        { "kind": "filter_query", "name": "查询", "page_id": "list" },
        { "kind": "open_detail", "name": "打开详情", "page_id": "list", "evidence": "MaterialList#columns 物料编码链接" },
        { "kind": "click", "name": "点击编辑", "page_id": "detail", "element": "editBtn", "evidence": "MaterialDetail#Header 编辑按钮" },
        { "kind": "fill_form", "name": "改表单", "page_id": "detail", "args": { "fields": ["materialName"] } },
        { "kind": "click_expect_api", "name": "保存", "page_id": "detail", "element": "saveBtn", "api": "/v1/{tenantId}/mt-material/save/ui", "evidence": "MaterialDetail#handleSave" }
      ],
      "from_state": "detail_view",
      "to_state": "detail_edit"
    },
    {
      "id": "set_default_secondary_uom",
      "name": "设置默认辅单位",
      "type": "row_action",
      "page_id": "detail",
      "scope": "in_feature",
      "entry": "row_action",
      "initial_mode": "view",
      "preconditions": ["enter_detail", "secondary_uom_table_has_rows"],
      "execution_chain": ["list", "detail", "assert_secondary_uom_rows", "click_radio"],
      "api": "/v1/{tenantId}/pdl-material-uom-convert/secondary-uom/default",
      "row_target": { "area": "secondaryUomTable", "control": "radio", "column": "defaultFlag", "element": "defaultSecondaryUomRadio" }
    },
    {
      "id": "site_assignment",
      "name": "打开站点分配",
      "type": "related_page",
      "page_id": "site_assignment",
      "scope": "in_feature",
      "entry": "header_button",
      "entry_control": { "kind": "button", "name": "站点分配", "element": "siteAssignmentBtn" },
      "opens": "page",
      "preconditions": ["enter_detail"],
      "execution_chain": ["list", "detail", "site_assignment"],
      "from_state": "detail_view",
      "route": "/hbase/product/material-manager/site-assignment/:materialId",
      "description": "本功能内关联页入口边；页内编辑另见 site_assignment_update"
    },
    {
      "id": "site_assignment_update",
      "name": "站点分配编辑保存",
      "type": "update",
      "page_id": "site_assignment",
      "scope": "in_feature",
      "route": "/hbase/product/material-manager/site-assignment/:materialId",
      "initial_mode": "view",
      "unlock": "click:editBtn",
      "preconditions": ["enter_detail", "open_site_assignment", "click:editBtn"],
      "fields": ["revisionFlag", "productionVersionFlag", "enableFlag"],
      "execution_chain": ["list", "detail", "site_assignment", "edit", "toggle_switch", "save"],
      "from_state": "site_assignment_view",
      "to_state": "site_assignment_edit",
      "api": "/v1/{tenantId}/mt-material/save/site/ui",
      "api_source": "services/index.ts#SaveMaterialSiteAssignment",
      "api_kind": "custom_request",
      "description": "已落库行仅可改 Switch；不可改站点、不可删"
    },
    {
      "id": "site_assignment_create",
      "name": "站点分配增行保存",
      "type": "create",
      "page_id": "site_assignment",
      "scope": "in_feature",
      "route": "/hbase/product/material-manager/site-assignment/:materialId",
      "initial_mode": "view",
      "unlock": "click:editBtn",
      "preconditions": ["enter_detail", "open_site_assignment", "click:editBtn"],
      "execution_chain": ["list", "detail", "site_assignment", "edit", "add_line", "activate_lov_cell", "pick_lov", "save"],
      "api": "/v1/{tenantId}/mt-material/save/site/ui",
      "api_kind": "custom_request",
      "description": "未落库新行：加号→点格→pickLov→保存"
    },
    {
      "id": "site_assignment_delete_line",
      "name": "站点分配删行",
      "type": "delete",
      "page_id": "site_assignment",
      "scope": "in_feature",
      "route": "/hbase/product/material-manager/site-assignment/:materialId",
      "unlock": "click:editBtn",
      "preconditions": ["enter_detail", "open_site_assignment", "click:editBtn"],
      "execution_chain": ["list", "detail", "site_assignment", "edit", "add_line", "remove_line", "popconfirm", "save"],
      "api": "/v1/{tenantId}/mt-material/save/site/ui",
      "api_kind": "custom_request",
      "description": "仅未落库行有 icon-remove；须先增行再删"
    },
    {
      "id": "site_properties",
      "name": "物料站点属性维护",
      "type": "related_page",
      "page_id": "site_properties",
      "scope": "external",
      "entry": "row_action",
      "entry_control": { "kind": "link", "name": "物料站点属性维护", "element": "siteAttrLink" },
      "preconditions": ["enter_detail", "open_site_assignment"],
      "execution_chain": ["list", "detail", "site_assignment", "site_properties"],
      "route": "/hbase/product/material-site-properties/detail/:materialId/:materialSiteId",
      "description": "跨功能出边：只分析到入口，禁止再拆对方编辑/新建/校验"
    }
  ],
  "page_states": [
    {
      "id": "detail_view",
      "name": "详情只读",
      "route_when": "dist/:id",
      "mode": "view",
      "form_disabled": true,
      "header_buttons": ["编辑", "站点分配", "复制"],
      "ready_hint": "editBtn"
    },
    {
      "id": "detail_edit",
      "name": "详情编辑中",
      "route_when": "dist/:id",
      "mode": "edit",
      "form_disabled": false,
      "header_buttons": ["保存", "取消"],
      "enter_via": ["click:editBtn"],
      "exit_via": ["click:saveBtn", "click:cancelBtn"],
      "ready_hint": "saveBtn"
    },
    {
      "id": "site_assignment_view",
      "name": "站点分配只读",
      "route_when": "site-assignment/:materialId",
      "mode": "view",
      "form_disabled": true,
      "header_buttons": ["编辑"],
      "ready_hint": "editBtn"
    },
    {
      "id": "site_assignment_edit",
      "name": "站点分配编辑中",
      "route_when": "site-assignment/:materialId",
      "mode": "edit",
      "form_disabled": false,
      "header_buttons": ["保存", "取消"],
      "enter_via": ["click:editBtn"],
      "exit_via": ["click:saveBtn", "click:cancelBtn"],
      "ready_hint": "saveBtn"
    },
    {
      "id": "create",
      "name": "新建",
      "route_when": "dist/create",
      "mode": "create",
      "form_disabled": false,
      "header_buttons": ["保存", "取消"],
      "ready_hint": "saveBtn"
    }
  ],
  "field_rules": [
    { "name": "materialCode", "label": "物料编码", "required": true, "control": "input", "editable_when": ["create", "detail_edit"] },
    { "name": "siteLov", "label": "站点编码", "required": true, "control": "lov", "editable_when": ["site_assignment_edit"], "row_gate": "!materialSiteId", "note": "仅未落库行可编辑" },
    { "name": "enableFlag", "label": "启用状态", "control": "switch", "editable_when": ["site_assignment_edit"], "note": "已落库行亦可改" }
  ],
  "validations": [
    { "id": "form_required", "name": "表单必填", "when": "save", "type": "required", "fields": ["materialCode", "materialName", "primaryUomLov"] },
    { "id": "site_required", "name": "站点分配行站点必填", "when": "site_save", "type": "required", "fields": ["siteLov"], "message_hint": "必填" }
  ],
  "apis": ["/v1/{tenantId}/mt-material/save/ui", "/v1/{tenantId}/mt-material/save/site/ui"],
  "elements_hints": [
    { "ref": "material.editBtn", "role": "button", "name": "编辑" },
    { "ref": "material.siteAssignBtn", "role": "button", "name": "站点分配" },
    { "ref": "material.siteAssign.addLineBtn", "role": "button", "name": "新增行" }
  ],
  "notes": [
    "本功能内页（同 Material/ 目录、同 material-manager 路由族）须分析全部能力与执行链路",
    "跳到其他功能（如 MaterialSiteProperties）只记 related_page + page_edges，停止深挖"
  ],
  "review_suggestions": {
    "status": "pending_human_review",
    "confidence": 0.8,
    "risks": ["站点分配：已落库行无删钮、不可改站点；删行须先增行；空表增行后需选站点"],
    "extend_paths": [
      { "kind": "data_fixture", "item": "准备可进站点分配的样例物料", "why": "in_feature 页链路前置", "priority": "high" }
    ],
    "assert_checklist": [
      "pages 区分 in_feature / external",
      "本功能内关联页有 update/create/validations，而非仅 related_page",
      "表格行编辑已读 editor/renderer 行门禁（row_gate），未误把已落库行当可删/可改 Lov",
      "会 clickExpectApi 的 op.api 为源码字面量且可在 apis[] 核对",
      "external 出边无对方页内编辑用例"
    ]
  },
  "confidence": 0.85
}`;

const SYSTEM_PROMPT = `你是前端功能分析助手，服务于 UI 自动化测试配置生成。
根据源码（多为 React + Choerodon UI / HZero）识别业务功能、多页面能力与可执行链路。

【分析边界 — 最重要】
A. 先识别本功能 pages[]：入口列表/详情，以及同功能目录、同路由族下的关联页（例：Material/MaterialSiteAssignment 属物料维护 → scope=in_feature）。
B. 对本功能内每一个 in_feature 页面，逐一枚举页面上所有可交互控件（页头与表格按钮、页签与视图/维度切换标签、下拉与菜单项、行内动作、开关与单选、查询栏、弹窗与抽屉内按钮、确认框），每个控件至少对应一个 operation 或其 steps 中的一步；不得因控件不属于某个固定类别而省略。type 只是标签，不决定能否写出步骤。写清 page_id、preconditions、unlock、api，步骤只用 kind 白名单内的词。
C. 若某跳转进入其他功能（不同菜单模块、独立功能包，如 MaterialSiteProperties、其他 *Manager）：
   - 只输出一条 related_page（scope=external）+ page_edges 出边；
   - 禁止再分析对方页的编辑/新建/删除/校验/page_states。
D. related_page 只表示「入口边」。本功能内关联页若还有编辑/增行/保存，必须另出 update/create/row_action（page_id 指向该页），不可只用一条 related_page 敷衍。
E. **表格行编辑模式**（页头编辑后表头 icon-add 增行、行内 Lov/Switch、icon-remove+Popconfirm、再页头保存）：
   与页头「新建」、只读 row_action 区分；须输出 create（增行）/ delete（删行）/ update，并写 execution_chain。
   **必须读列 editor/renderer 条件**（如 !record.get('materialSiteId')），禁止套「编辑后每行都能删/改 Lov」：
   - 已落库行仅可改无行门禁的控件（常为 Switch）→ update.fields + execution_chain 含 toggle_switch；
   - Lov/删行仅未落库行 → create 用 add_line；delete 必须先 add_line 再 remove_line（禁止 table_has_rows 当删已落库行前置）；
   - field_rules 对有条件的字段写 row_gate（如 "!materialSiteId"）。
   用户消息中的 PLAYBOOK choerodon-table-row-edit 正文优先于本摘要。
F. **接口识别（api-binding）**：
   - 从触发链抽 url 字面量：services 工厂 / useRequest / 事件内 request·fetch / DS transport；禁止按资源名猜 REST。
   - 每条会改数据的 op 写 api（字面量）+ 尽量 api_source、api_kind（custom_request|ds_transport|inline|unknown）。
   - 未见字面量 → api 留空，禁止编造（如勿把站点分配写成 mt-material-site/save/ui；正确常为 mt-material/save/site/ui）；不确定处写入 notes / risks。
   - operation.api 必须能在源码或 apis[] 中找到；query 与 save 分开绑。
   用户消息中的 PLAYBOOK api-binding 正文优先于本摘要。

【硬性要求】
1. 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释文字
2. 必须输出 pages、page_edges、operations、page_states、field_rules、validations、review_suggestions
3. operations[].id 必须有（英文蛇形）；type 只能是：
   query | create | detail | table_picker | update | copy | related_page | delete | row_action | other
   - 页头「编辑→改表单→保存」→ update（必须写 unlock / preconditions）
   - 子表/列表行内 Radio、Switch、行按钮，调专用 API、不点页头保存 → row_action（api + row_target）
   - Lov/弹表 → table_picker
   - 跳转其他页 → related_page（entry、entry_control、preconditions、scope）
     行内 a[onClick] 无 href：entry_control.kind 可为 link，但 elements_hints 须用 text/css（.action-link a），禁止 role=link
   - 禁止把设默认、行启用等标成 update
4. 每个 operation 尽量填 page_id、scope、preconditions、unlock、api
11. **每个 operation 必须写 steps（有序执行步骤，这是测试流程的主依据）**：
   - 每步 {kind, name, page_id?, element?, api?, args?, note?, evidence}
   - kind 只能是：goto | filter_query | assert_table_rows | open_detail | click | fill | fill_form | pick_lov | click_expect_api | assert | set_var
   - 第一步必须是 goto（page_id 取 pages[].id；详情页等带 :id 的路由，先 goto 列表再 open_detail 或点链接）
   - click / click_expect_api 必须写 element：优先用平台 kit 已有键（见 PLAYBOOK 与 kit），否则在 elements_hints 里给出同名定义；禁止凭空编名字
   - 页签、维度/视图切换标签等非按钮控件，同样用 click 步骤逐个写出，切换后的视图单独成步骤链（如切到拼卷视图后再查询、勾选）
   - 会发请求的最后一步用 click_expect_api，api 必须是源码字面量且出现在 apis[]；若点击后还有确认弹窗（Modal.confirm→confirmModalOk；Popconfirm→confirmBtn），接口断言放在确认那一步
   - 严格按手册还原交互：下拉菜单=先点触发按钮再点 dropdownMenuItem；抽屉内容区按钮（okButton:false）定位在 drawerBody 内；行内编辑=先点单元格再操作编辑器；头行联动表=先点头行再勾行
   - evidence 写依据（源码 文件#函数 或 手册名），拿不准的步骤在 note 里说明，不要编造
   - 依赖其它操作产生的数据（如先创建再删除）：在 preconditions 写明，steps 里不重复创建
   - 步骤依赖的内容若可能被用户个性化隐藏（表格列可被用户在列设置里隐藏），在该步写 requires=对应列头元素（elements_hints 里用 th[data-index="字段名"] 定义），缺失时测试会跳过而不是报失败
   - execution_chain 可不写
5. apis / elements_hints 为数组；api 来自源码字面量，禁止猜测
6. **entry.route / pages[].route 必须是前端 SPA 路由**（如 /hwms/.../list），禁止写成 /v1/... 或 services 里的 API 路径；API 只进 operation.api 与 apis[]
7. notes 写清自动化陷阱与跨功能停止点
8. review_suggestions.status 固定 pending_human_review
9. assert_checklist 含：会 clickExpectApi 的 op.api 可在源码/apis 中核对；entry.route 非 API
10. **不要输出 meta_ops / flows**（由引擎根据 steps 编译并校验；输出也会被丢弃）

【输出示例】
${JSON_SCHEMA_HINT}`;

/** DeepSeek Chat：`response_format: json_object` + 本地归一化；注入 playbooks */
export async function llmAnalyzeFeature(opts: {
  feature: string;
  snippets: CodeSnippet[];
  /** prompt 中代码总字符上限；缺省沿用 formatSnippetsForPrompt 默认值 */
  maxTotalChars?: number;
  playbooks?: PlaybookDoc[];
  /** 基线骨架（提示词块）：要求未变化处沿用基线 id 与结构 */
  baselineBlock?: string;
}): Promise<FeatureArtifact> {
  const codeBlock = formatSnippetsForPrompt(opts.snippets, opts.maxTotalChars);

  if (!codeBlock.trim()) {
    throw new Error('没有检索到可分析的源码，请检查 -p 路径');
  }

  const playbooks =
    opts.playbooks ?? (await loadPlaybooksForSources(opts.snippets.map((s) => s.content)));
  if (!playbooks.length) {
    throw new Error(
      'knowledge/playbooks/ 下没有可用手册（*.md）。请先补全操作手册再分析（ADR 0007/0008）。',
    );
  }
  const playbookBlock = formatPlaybooksForPrompt(playbooks);

  logger.info(
    { files: opts.snippets.length, playbooks: playbooks.map((p) => p.id), feature: opts.feature },
    'DeepSeek 分析开始',
  );

  const { content: text, model } = await deepSeekChat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `功能关键词: ${opts.feature}\n\n${playbookBlock}\n\n请结合上述 Playbooks 与下列源码，严格按示例 JSON 结构输出路径描述：\n\n${codeBlock}${opts.baselineBlock ? `\n\n${opts.baselineBlock}` : ''}`,
      },
    ],
    responseFormatJson: true,
    temperature: 0.1,
  });

  await saveRawLlmResponse(opts.feature, text);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('无法解析 DeepSeek JSON');
    json = JSON.parse(m[0]);
  }

  const normalized = normalizeLlmJson(json, opts.feature);
  const artifact = FeatureArtifactSchema.parse({
    ...normalized,
    sources: opts.snippets.map((s) => s.relativePath),
    analyzer: 'deepseek',
    model,
  });

  logger.info(
    {
      feature: artifact.feature,
      ops: artifact.operations.map((o) => `${o.id}:${o.type}`),
      confidence: artifact.confidence,
    },
    'DeepSeek 分析完成',
  );

  const stepStats = artifact.operations.map((o) => {
    const steps = o.steps ?? [];
    return { id: o.id, total: steps.length, missing_evidence: steps.filter((s) => !s.evidence).length };
  });
  const lacking = stepStats.filter((s) => s.missing_evidence > 0);
  if (lacking.length) {
    logger.warn(
      { operations: lacking, total_steps: stepStats.reduce((n, s) => n + s.total, 0) },
      'DeepSeek 步骤缺少 evidence，请核对源码依据是否齐全',
    );
  }

  return artifact;
}

async function saveRawLlmResponse(feature: string, text: string): Promise<void> {
  try {
    const file = featureLlmRawFile(feature);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, 'utf8');
  } catch {
    // ignore
  }
}

export function normalizeLlmJson(input: unknown, featureHint: string): Record<string, unknown> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  const entryRaw = (raw.entry && typeof raw.entry === 'object' ? raw.entry : {}) as Record<
    string,
    unknown
  >;
  let entryRoute = String(
    entryRaw.route || entryRaw.path || `/${featureHint.toLowerCase()}/list`,
  );
  // 模型常把 services API 误写成 entry.route；前端 SPA 路由不含 /v1/
  if (/\/v1\//i.test(entryRoute) || /qis-[\w-]+(?:\/[\w-]+)*$/i.test(entryRoute)) {
    entryRoute = `/${featureHint.toLowerCase()}/list`;
  }
  const entry = {
    route: entryRoute,
    menu: entryRaw.menu != null ? String(entryRaw.menu) : featureHint,
  };

  const opsIn = Array.isArray(raw.operations)
    ? raw.operations
    : Array.isArray(raw.ops)
      ? raw.ops
      : [];

  const operations = opsIn
    .map((item, index) => normalizeOperation(item, index))
    .filter((op): op is Record<string, unknown> => Boolean(op));

  // 去掉纯取消类 other（name 含取消）；行内动作勿当取消过滤
  const filtered = operations.filter((op) => {
    const name = String(op.name || '');
    const id = String(op.id || '');
    const type = String(op.type || '');
    if (type === 'row_action') return true;
    if (/取消|cancel/i.test(name) || /cancel/i.test(id)) return false;
    return true;
  });

  if (filtered.length === 0) {
    filtered.push({
      id: 'query',
      name: '查询',
      type: 'query',
      page: 'list',
      page_id: 'list',
      scope: 'in_feature',
    });
  }

  const pages = normalizePages(raw.pages, filtered, entry.route) ?? [];
  const page_edges = normalizePageEdges(raw.page_edges ?? raw.pageEdges) ?? [];
  const field_rules = normalizeFieldRules(raw.field_rules ?? raw.fieldRules) ?? [];
  const apis = [...(normalizeApis(raw.apis) ?? [])];
  enrichInFeatureSiteAssignment(filtered, pages, page_edges, field_rules, apis);
  bindApisAgainstCatalog(filtered, apis);

  return {
    feature: String(raw.feature || featureHint),
    entry,
    pages: pages.length ? pages : undefined,
    page_edges: page_edges.length ? page_edges : undefined,
    operations: filtered,
    page_states: normalizePageStates(raw.page_states ?? raw.pageStates),
    field_rules: field_rules.length ? field_rules : undefined,
    validations: normalizeValidations(raw.validations),
    apis: apis.length ? [...new Set(apis)] : undefined,
    elements_hints: normalizeElementHints(raw.elements_hints ?? raw.elementsHints),
    notes: normalizeStringArray(raw.notes),
    review_suggestions: normalizeReviewSuggestions(
      raw.review_suggestions ?? raw.reviewSuggestions,
      clampConfidence(raw.confidence),
    ),
    confidence: clampConfidence(raw.confidence),
  };
}

function normalizeOperation(item: unknown, index: number): Record<string, unknown> | null {
  if (!item || typeof item !== 'object') return null;
  const op = item as Record<string, unknown>;

  const name = String(op.name || op.title || op.label || `操作${index + 1}`);
  let type = String(op.type || 'other');
  const aliasKey = type.replace(/[-_\s]/g, '').toLowerCase();
  if (TYPE_ALIASES[type]) type = TYPE_ALIASES[type];
  else if (TYPE_ALIASES[aliasKey]) type = TYPE_ALIASES[aliasKey];
  else if (!ALLOWED_TYPES.has(type)) type = 'other';

  let id = op.id != null ? String(op.id) : '';
  if (!id) {
    id = slugId(String(op.key || name || type || `op_${index + 1}`));
  }

  const fields = normalizeStringArray(op.fields);
  const used_by = normalizeStringArray(op.used_by ?? op.usedBy);
  const preconditions = normalizeStringArray(op.preconditions ?? op.preConditions);
  const opensRaw = op.opens != null ? String(op.opens) : undefined;
  const opens =
    opensRaw === 'modal' || opensRaw === 'page' || opensRaw === 'drawer' ? opensRaw : undefined;

  const modeRaw = String(op.initial_mode ?? op.initialMode ?? '');
  const initial_mode = ['view', 'edit', 'create', 'copy', 'other'].includes(modeRaw)
    ? modeRaw
    : undefined;

  // entry=row_action 且非 related_page → 纠成 row_action（避免误标 update）
  if (
    type === 'update' &&
    (String(op.entry || '') === 'row_action' ||
      /set_default|row_action|defaultFlag|secondary.?uom.?default/i.test(id + name))
  ) {
    type = 'row_action';
  }

  // related_page：详情页头跳转（站点分配等）补齐前置
  let entry = op.entry != null ? String(op.entry) : undefined;
  let from_state =
    op.from_state != null
      ? String(op.from_state)
      : op.fromState != null
        ? String(op.fromState)
        : undefined;
  let enrichedPre = preconditions ? [...preconditions] : [];
  if (type === 'related_page') {
    const isHeaderJump =
      entry === 'header_button' ||
      /站点分配|site.?assign|扩展属性|setSites/i.test(id + name) ||
      (from_state === 'detail_view' && entry !== 'row_action' && entry !== 'direct_route');
    if (isHeaderJump) {
      entry = entry || 'header_button';
      from_state = from_state || 'detail_view';
      if (!enrichedPre.some((p) => /enter_detail/i.test(p))) {
        enrichedPre = ['enter_detail', ...enrichedPre];
      }
    }
  }

  const rowTargetRaw = (op.row_target ?? op.rowTarget) as Record<string, unknown> | undefined;
  let row_target: Record<string, unknown> | undefined;
  if (rowTargetRaw && typeof rowTargetRaw === 'object') {
    const controlRaw = String(rowTargetRaw.control || 'other');
    const controls = new Set(['radio', 'switch', 'button', 'link', 'lov', 'other']);
    row_target = {
      area: rowTargetRaw.area != null ? String(rowTargetRaw.area) : undefined,
      control: controls.has(controlRaw) ? controlRaw : 'other',
      column: rowTargetRaw.column != null ? String(rowTargetRaw.column) : undefined,
      element: rowTargetRaw.element != null ? String(rowTargetRaw.element) : undefined,
      cell_element: rowTargetRaw.cell_element != null ? String(rowTargetRaw.cell_element) : undefined,
    };
  }

  // 站点分配常见路由纠偏（若模型误写成 site-properties）
  let route = op.route != null ? String(op.route) : undefined;
  if (
    type === 'related_page' &&
    /site.?assign|站点分配/i.test(id + name) &&
    (!route || /site-properties/i.test(route))
  ) {
    route = '/hbase/product/material-manager/site-assignment/:materialId';
  }

  let entry_control = normalizeEntryControl(op.entry_control ?? op.entryControl);
  if (type === 'related_page' && !entry_control?.element && !entry_control?.name) {
    entry_control = defaultEntryControl(id, name, entry);
  }

  return {
    id,
    name,
    type,
    page: op.page != null ? String(op.page) : undefined,
    page_id:
      op.page_id != null
        ? String(op.page_id)
        : op.pageId != null
          ? String(op.pageId)
          : guessPageId(type, id, name, route),
    scope: normalizeScope(op.scope, type, id, name, route),
    route,
    fields: fields?.length ? fields : undefined,
    opens,
    entry,
    entry_control,
    used_by: used_by?.length ? used_by : undefined,
    description: op.description != null ? String(op.description) : undefined,
    initial_mode,
    preconditions: enrichedPre.length ? enrichedPre : undefined,
    execution_chain: normalizeStringArray(op.execution_chain ?? op.executionChain),
    unlock: op.unlock != null ? String(op.unlock) : undefined,
    from_state,
    to_state: op.to_state != null ? String(op.to_state) : op.toState != null ? String(op.toState) : undefined,
    api: op.api != null ? String(op.api) : undefined,
    api_source:
      op.api_source != null
        ? String(op.api_source)
        : op.apiSource != null
          ? String(op.apiSource)
          : undefined,
    api_kind: normalizeApiKind(op.api_kind ?? op.apiKind),
    row_target,
    steps: normalizeSteps(op.steps),
  };
}

function normalizeSteps(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((x) => x && typeof x === 'object')
    .map((x) => {
      const o = x as Record<string, unknown>;
      const str = (v: unknown) => (v != null && String(v) !== '' ? String(v) : undefined);
      return {
        kind: String(o.kind ?? ''),
        name: String(o.name ?? o.kind ?? ''),
        page_id: str(o.page_id ?? o.pageId),
        element: str(o.element),
        api: str(o.api),
        args: o.args && typeof o.args === 'object' && !Array.isArray(o.args) ? o.args : undefined,
        note: str(o.note),
        evidence: str(o.evidence),
        requires: str(o.requires),
      };
    });
  return out.length ? out : undefined;
}

function normalizeApiKind(raw: unknown): string | undefined {
  const v = String(raw || '').toLowerCase();
  if (['custom_request', 'ds_transport', 'inline', 'unknown'].includes(v)) return v;
  return undefined;
}

function normalizeEntryControl(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const kindRaw = String(o.kind || o.control || '').toLowerCase();
  const kind =
    kindRaw === 'button' || kindRaw === 'link' || kindRaw === 'other' ? kindRaw : undefined;
  const name = o.name != null ? String(o.name) : o.text != null ? String(o.text) : undefined;
  const element = o.element != null ? String(o.element) : undefined;
  if (!name && !element) return undefined;
  return { kind: kind || (element ? undefined : 'button'), name, element };
}

/** 已知关联页缺省入口（仅补全，不替代已有 entry_control） */
function defaultEntryControl(
  id: string,
  name: string,
  entry?: string,
): Record<string, unknown> | undefined {
  if (/site.?assign|站点分配|setSites/i.test(id + name)) {
    return { kind: 'button', name: '站点分配', element: 'siteAssignmentBtn' };
  }
  if (/site.?prop|站点属性|materialSiteAttr/i.test(id + name)) {
    return { kind: 'link', name: '物料站点属性维护', element: 'siteAttrLink' };
  }
  if (/扩展属性|extend/i.test(id + name)) {
    return { kind: 'button', name: '扩展属性', element: 'extendAttrBtn' };
  }
  if (entry === 'header_button' && name) {
    return { kind: 'button', name };
  }
  return undefined;
}

function normalizePageStates(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const modeRaw = String(o.mode || 'other');
      const mode = ['view', 'edit', 'create', 'copy', 'other'].includes(modeRaw) ? modeRaw : 'other';
      return {
        id: String(o.id || `state_${i + 1}`),
        name: String(o.name || o.id || `状态${i + 1}`),
        route_when: o.route_when != null ? String(o.route_when) : o.routeWhen != null ? String(o.routeWhen) : undefined,
        mode,
        form_disabled:
          typeof o.form_disabled === 'boolean'
            ? o.form_disabled
            : typeof o.formDisabled === 'boolean'
              ? o.formDisabled
              : undefined,
        header_buttons: normalizeStringArray(o.header_buttons ?? o.headerButtons),
        enter_via: normalizeStringArray(o.enter_via ?? o.enterVia),
        exit_via: normalizeStringArray(o.exit_via ?? o.exitVia),
        ready_hint: o.ready_hint != null ? String(o.ready_hint) : o.readyHint != null ? String(o.readyHint) : undefined,
        note: o.note != null ? String(o.note) : undefined,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
  return out.length ? out : undefined;
}

function normalizeFieldRules(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const controls = new Set(['input', 'lov', 'switch', 'number', 'intl', 'select', 'other']);
  const out = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const name = String(o.name || o.field || o.key || '');
      if (!name) return null;
      const controlRaw = String(o.control || 'other');
      return {
        name,
        label: o.label != null ? String(o.label) : undefined,
        required: typeof o.required === 'boolean' ? o.required : undefined,
        readonly_when: normalizeStringArray(o.readonly_when ?? o.readonlyWhen),
        editable_when: normalizeStringArray(o.editable_when ?? o.editableWhen),
        row_gate: o.row_gate != null ? String(o.row_gate) : o.rowGate != null ? String(o.rowGate) : undefined,
        control: controls.has(controlRaw) ? controlRaw : 'other',
        note: o.note != null ? String(o.note) : undefined,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
  return out.length ? out : undefined;
}

function normalizeValidations(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const types = new Set(['required', 'unique', 'format', 'biz', 'api', 'other']);
  const out = raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const typeRaw = String(o.type || 'other');
      return {
        id: String(o.id || `val_${i + 1}`),
        name: String(o.name || o.id || `校验${i + 1}`),
        when: o.when != null ? String(o.when) : undefined,
        type: types.has(typeRaw) ? typeRaw : 'other',
        api: o.api != null ? String(o.api) : undefined,
        message_hint:
          o.message_hint != null
            ? String(o.message_hint)
            : o.messageHint != null
              ? String(o.messageHint)
              : undefined,
        fields: normalizeStringArray(o.fields),
        note: o.note != null ? String(o.note) : undefined,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
  return out.length ? out : undefined;
}

function normalizeApis(apis: unknown): string[] | undefined {
  if (!apis) return undefined;
  if (Array.isArray(apis)) {
    const out = apis
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a && typeof a === 'object') {
          const o = a as Record<string, unknown>;
          return String(o.url || o.path || o.uri || o.api || '');
        }
        return '';
      })
      .filter(Boolean);
    return out.length ? out : undefined;
  }
  if (typeof apis === 'object') {
    return normalizeApis(Object.values(apis as Record<string, unknown>));
  }
  return undefined;
}

function normalizeElementHints(hints: unknown): Array<Record<string, unknown>> | undefined {
  if (!hints) return undefined;
  let list: unknown[] = [];
  if (Array.isArray(hints)) list = hints;
  else if (typeof hints === 'object') {
    list = Object.entries(hints as Record<string, unknown>).map(([key, val]) => {
      if (val && typeof val === 'object') return { ref: key, ...(val as object) };
      return { ref: key, name: String(val) };
    });
  } else return undefined;

  const out = list
    .map((h, i) => {
      if (!h || typeof h !== 'object') return null;
      const o = h as Record<string, unknown>;
      const ref = String(o.ref || o.id || o.key || `element_${i + 1}`);
      return {
        ref,
        role: o.role != null ? String(o.role) : undefined,
        name: o.name != null ? String(o.name) : undefined,
        testId: o.testId != null ? String(o.testId) : undefined,
        label: o.label != null ? String(o.label) : undefined,
        placeholder: o.placeholder != null ? String(o.placeholder) : undefined,
        text: o.text != null ? String(o.text) : undefined,
        css: o.css != null ? String(o.css) : undefined,
        within: o.within != null ? String(o.within) : undefined,
        note: o.note != null ? String(o.note) : undefined,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  return out.length ? out : undefined;
}

function normalizeStringArray(v: unknown): string[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) {
    const out = v.map((x) => (typeof x === 'string' ? x : String((x as { name?: string })?.name || x))).filter(Boolean);
    return out.length ? out : undefined;
  }
  if (typeof v === 'string') return [v];
  return undefined;
}

const EXTEND_KINDS = new Set([
  'platform_kit',
  'keyword',
  'case',
  'analyze_retry',
  'data_fixture',
  'other',
]);

function normalizeReviewSuggestions(
  raw: unknown,
  fallbackConfidence: number,
): Record<string, unknown> | undefined {
  const empty = {
    status: 'pending_human_review',
    confidence: fallbackConfidence,
    risks: [] as string[],
    extend_paths: [] as Array<Record<string, unknown>>,
    assert_checklist: [] as string[],
  };

  if (!raw || typeof raw !== 'object') {
    return {
      ...empty,
      risks: ['模型未输出 review_suggestions，请人工补全 risks/extend_paths'],
    };
  }

  const o = raw as Record<string, unknown>;
  const pathsIn = Array.isArray(o.extend_paths)
    ? o.extend_paths
    : Array.isArray(o.extendPaths)
      ? o.extendPaths
      : [];

  const extend_paths = pathsIn
    .map((item) => {
      if (!item || typeof item !== 'object') {
        if (typeof item === 'string') {
          return { kind: 'other', item: String(item), priority: 'medium' };
        }
        return null;
      }
      const p = item as Record<string, unknown>;
      const kindRaw = String(p.kind || p.type || 'other').toLowerCase();
      const kind = EXTEND_KINDS.has(kindRaw) ? kindRaw : 'other';
      const text = String(p.item || p.name || p.action || p.what || '').trim();
      if (!text) return null;
      const priorityRaw = String(p.priority || 'medium').toLowerCase();
      const priority =
        priorityRaw === 'high' || priorityRaw === 'low' ? priorityRaw : 'medium';
      return {
        kind,
        item: text,
        why: p.why != null ? String(p.why) : undefined,
        priority,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  return {
    status: 'pending_human_review',
    confidence:
      typeof o.confidence === 'number'
        ? clampConfidence(o.confidence)
        : fallbackConfidence,
    risks: normalizeStringArray(o.risks) ?? [],
    extend_paths,
    assert_checklist:
      normalizeStringArray(o.assert_checklist ?? o.assertChecklist) ?? [],
  };
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
  return 0.7;
}

function normalizeScope(
  raw: unknown,
  type: string,
  id: string,
  name: string,
  route?: string,
): 'in_feature' | 'external' {
  const s = String(raw || '').toLowerCase();
  if (s === 'external' || s === 'out' || s === 'cross') return 'external';
  if (s === 'in_feature' || s === 'in' || s === 'internal') return 'in_feature';
  // 物料站点属性等独立功能：跨功能出边
  if (
    type === 'related_page' &&
    (/site.?propert|站点属性|material-site-properties|MaterialSiteProperties/i.test(
      id + name + (route || ''),
    ) ||
      (/site-properties/i.test(route || '') && !/site-assignment/i.test(route || '')))
  ) {
    return 'external';
  }
  return 'in_feature';
}

function guessPageId(
  type: string,
  id: string,
  name: string,
  route?: string,
): string | undefined {
  const key = id + name + (route || '');
  if (/site.?assign|站点分配|site-assignment/i.test(key)) return 'site_assignment';
  if (/site.?propert|站点属性|site-properties/i.test(key)) return 'site_properties';
  if (type === 'query') return 'list';
  if (type === 'create' || type === 'detail' || type === 'update' || type === 'copy') return 'detail';
  if (type === 'row_action') return 'detail';
  return undefined;
}

function normalizePages(
  raw: unknown,
  operations: Array<Record<string, unknown>>,
  entryRoute: string,
): Array<Record<string, unknown>> | undefined {
  const fromRaw: Array<Record<string, unknown>> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const id = String(o.id || o.key || '').trim();
      if (!id) continue;
      const name = String(o.name || id);
      const route = o.route != null ? String(o.route) : undefined;
      fromRaw.push({
        id,
        name,
        route,
        scope: normalizeScope(o.scope, 'related_page', id, name, route),
        source_hint:
          o.source_hint != null
            ? String(o.source_hint)
            : o.sourceHint != null
              ? String(o.sourceHint)
              : undefined,
        note: o.note != null ? String(o.note) : undefined,
      });
    }
  }

  const byId = new Map(fromRaw.map((p) => [String(p.id), p]));
  if (!byId.has('list')) {
    byId.set('list', {
      id: 'list',
      name: '列表',
      route: entryRoute,
      scope: 'in_feature',
    });
  }

  for (const op of operations) {
    const pageId = op.page_id != null ? String(op.page_id) : undefined;
    if (!pageId || byId.has(pageId)) continue;
    byId.set(pageId, {
      id: pageId,
      name: String(op.name || pageId),
      route: op.route != null ? String(op.route) : undefined,
      scope: (op.scope as string) || 'in_feature',
    });
  }

  // 有站点分配入口但缺 page 节点时补上
  const hasSiteOp = operations.some((o) =>
    /site.?assign|站点分配/i.test(String(o.id) + String(o.name)),
  );
  if (hasSiteOp && !byId.has('site_assignment')) {
    byId.set('site_assignment', {
      id: 'site_assignment',
      name: '站点分配',
      route: '/hbase/product/material-manager/site-assignment/:materialId',
      scope: 'in_feature',
      source_hint: 'Material/MaterialSiteAssignment',
    });
  }

  return [...byId.values()];
}

function normalizePageEdges(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: Array<Record<string, unknown>> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const from_page = String(o.from_page ?? o.fromPage ?? '').trim();
    const to_page = String(o.to_page ?? o.toPage ?? '').trim();
    if (!from_page || !to_page) continue;
    out.push({
      id: o.id != null ? String(o.id) : `${from_page}_to_${to_page}`,
      from_page,
      to_page,
      via: o.via != null ? String(o.via) : undefined,
      control: normalizeEntryControl(o.control ?? o.entry_control),
      preconditions: normalizeStringArray(o.preconditions),
      note: o.note != null ? String(o.note) : undefined,
    });
  }
  return out.length ? out : undefined;
}

/**
 * 本功能内「站点分配」：补齐/纠偏页内 create·update·delete，并写入行级 field_rules。
 * 已落库行（有 materialSiteId）：仅 Switch 可改；Lov/删行仅未落库新行。
 * api 优先从 apis[] 字面量绑定（save/site），禁止猜 mt-material-site/save/ui。
 */
function enrichInFeatureSiteAssignment(
  operations: Array<Record<string, unknown>>,
  pages: Array<Record<string, unknown>>,
  page_edges: Array<Record<string, unknown>>,
  field_rules: Array<Record<string, unknown>>,
  apis: string[],
): void {
  const siteEntry = operations.find(
    (o) =>
      String(o.type) === 'related_page' &&
      /site.?assign|站点分配/i.test(String(o.id) + String(o.name)),
  );
  if (!siteEntry) return;
  if (String(siteEntry.scope || 'in_feature') === 'external') return;

  const defaultRoute =
    String(siteEntry.route || '') ||
    '/hbase/product/material-manager/site-assignment/:materialId';

  const siteSaveApi = resolveSiteAssignmentSaveApi(apis);

  siteEntry.scope = 'in_feature';
  siteEntry.page_id = siteEntry.page_id || 'site_assignment';
  if (!siteEntry.execution_chain) {
    siteEntry.execution_chain = ['list', 'detail', 'site_assignment'];
  }

  const isSitePageOp = (o: Record<string, unknown>) =>
    String(o.page_id) === 'site_assignment' ||
    /site.?assign|站点分配|site-assignment/i.test(
      String(o.id) + String(o.name) + String(o.page_id || '') + String(o.route || ''),
    );

  const switchFields = ['revisionFlag', 'productionVersionFlag', 'enableFlag'];

  let updateOp = operations.find((o) => String(o.type) === 'update' && isSitePageOp(o));
  if (!updateOp) {
    updateOp = {
      id: 'site_assignment_update',
      name: '站点分配编辑保存',
      type: 'update',
      page_id: 'site_assignment',
      scope: 'in_feature',
      route: defaultRoute,
      initial_mode: 'view',
      unlock: 'click:editBtn',
      preconditions: ['enter_detail', 'open_site_assignment', 'click:editBtn'],
      from_state: 'site_assignment_view',
      to_state: 'site_assignment_edit',
    };
    operations.push(updateOp);
  }
  updateOp.page_id = 'site_assignment';
  updateOp.scope = 'in_feature';
  updateOp.fields = switchFields;
  updateOp.execution_chain = [
    'list',
    'detail',
    'site_assignment',
    'edit',
    'toggle_switch',
    'save',
  ];
  updateOp.description =
    '已落库行仅可改 Switch（revisionFlag/productionVersionFlag/enableFlag）；不可改站点、不可删';
  bindSiteSaveApi(updateOp, siteSaveApi, apis);

  let createOp = operations.find((o) => String(o.type) === 'create' && isSitePageOp(o));
  if (!createOp) {
    createOp = {
      id: 'site_assignment_create',
      name: '站点分配增行保存',
      type: 'create',
      page_id: 'site_assignment',
      scope: 'in_feature',
      route: defaultRoute,
      initial_mode: 'view',
      unlock: 'click:editBtn',
      preconditions: ['enter_detail', 'open_site_assignment', 'click:editBtn'],
      from_state: 'site_assignment_view',
      to_state: 'site_assignment_edit',
    };
    operations.push(createOp);
  }
  createOp.page_id = 'site_assignment';
  createOp.scope = 'in_feature';
  createOp.execution_chain = [
    'list',
    'detail',
    'site_assignment',
    'edit',
    'add_line',
    'activate_lov_cell',
    'pick_lov',
    'save',
  ];
  createOp.description = '未落库新行：表头加号→点格激活 Lov→pickLov→保存';
  bindSiteSaveApi(createOp, siteSaveApi, apis);

  let deleteOp = operations.find((o) => String(o.type) === 'delete' && isSitePageOp(o));
  if (!deleteOp) {
    deleteOp = {
      id: 'site_assignment_delete_line',
      name: '站点分配删行',
      type: 'delete',
      page_id: 'site_assignment',
      scope: 'in_feature',
      route: defaultRoute,
      initial_mode: 'view',
      unlock: 'click:editBtn',
    };
    operations.push(deleteOp);
  }
  deleteOp.page_id = 'site_assignment';
  deleteOp.scope = 'in_feature';
  deleteOp.preconditions = ['enter_detail', 'open_site_assignment', 'click:editBtn'];
  deleteOp.execution_chain = [
    'list',
    'detail',
    'site_assignment',
    'edit',
    'add_line',
    'remove_line',
    'popconfirm',
    'save',
  ];
  deleteOp.description =
    '仅未落库行有 icon-remove（!materialSiteId）；须先增行再删，禁止对已落库行点删除';
  bindSiteSaveApi(deleteOp, siteSaveApi, apis);

  upsertSiteFieldRules(field_rules);

  // 站点属性：标记 external，勿补对方内部 update
  for (const o of operations) {
    if (
      String(o.type) === 'related_page' &&
      /site.?propert|站点属性/i.test(String(o.id) + String(o.name) + String(o.route || ''))
    ) {
      o.scope = 'external';
      o.page_id = o.page_id || 'site_properties';
      if (!o.execution_chain) {
        o.execution_chain = ['list', 'detail', 'site_assignment', 'site_properties'];
      }
      const pre = Array.isArray(o.preconditions) ? [...(o.preconditions as string[])] : [];
      if (!pre.some((p) => /open_site_assignment/i.test(p))) {
        o.preconditions = [
          'enter_detail',
          'open_site_assignment',
          ...pre.filter((p) => !/enter_detail/i.test(p)),
        ];
      }
    }
  }

  if (!pages.some((p) => p.id === 'site_assignment')) {
    pages.push({
      id: 'site_assignment',
      name: '站点分配',
      route: '/hbase/product/material-manager/site-assignment/:materialId',
      scope: 'in_feature',
      source_hint: 'Material/MaterialSiteAssignment',
    });
  }
  if (!page_edges.some((e) => e.to_page === 'site_assignment')) {
    page_edges.push({
      id: 'detail_to_site_assignment',
      from_page: 'detail',
      to_page: 'site_assignment',
      via: 'header_button',
      control: { kind: 'button', name: '站点分配', element: 'siteAssignmentBtn' },
      preconditions: ['enter_detail'],
    });
  }
}

/** 从 apis 目录解析站点分配保存 URL；纠正常见猜错路径 */
function resolveSiteAssignmentSaveApi(apis: string[]): string {
  const fromCatalog = pickApiFromCatalog(apis, [
    /mt-material\/save\/site(?:\/ui)?/i,
    /\/save\/site(?:\/ui)?$/i,
  ]);
  if (fromCatalog) return fromCatalog;
  // services/index.ts#SaveMaterialSiteAssignment 已知字面量（非资源名猜测）
  const known = '/v1/{tenantId}/mt-material/save/site/ui';
  if (!apis.includes(known)) apis.push(known);
  return known;
}

function bindSiteSaveApi(
  op: Record<string, unknown>,
  siteSaveApi: string,
  apis: string[],
): void {
  const cur = String(op.api || '');
  // 纠正历史猜错：mt-material-site/save/ui
  if (!cur || /mt-material-site\/save/i.test(cur) || !apiInCatalog(cur, apis)) {
    op.api = siteSaveApi;
  } else if (/save\/site/i.test(cur)) {
    op.api = normalizeApiPath(cur);
  } else {
    op.api = siteSaveApi;
  }
  if (!op.api_kind) op.api_kind = 'custom_request';
  if (!op.api_source) {
    op.api_source = 'services/index.ts#SaveMaterialSiteAssignment';
  }
  const api = String(op.api);
  if (api && !apis.some((a) => apiLooseEqual(a, api))) apis.push(api);
}

/** 纠正已知猜错路径，并把 op.api 并入 apis 目录 */
function bindApisAgainstCatalog(
  operations: Array<Record<string, unknown>>,
  apis: string[],
): void {
  for (const op of operations) {
    const api = op.api != null ? String(op.api) : '';
    if (!api) continue;

    // 历史/模型猜错：mt-material-site/save/ui ≠ SaveMaterialSiteAssignment
    if (/mt-material-site\/save/i.test(api)) {
      const siteish = /site.?assign|站点分配|site-assignment/i.test(
        String(op.id) + String(op.name) + String(op.page_id || '') + String(op.route || ''),
      );
      if (siteish) {
        op.api = resolveSiteAssignmentSaveApi(apis);
        if (!op.api_kind) op.api_kind = 'custom_request';
        if (!op.api_source) op.api_source = 'services/index.ts#SaveMaterialSiteAssignment';
      } else {
        delete op.api;
        op.api_kind = 'unknown';
      }
      continue;
    }

    const norm = normalizeApiPath(api);
    op.api = norm;
    if (!apis.some((a) => apiLooseEqual(a, norm))) apis.push(norm);
  }
}

function pickApiFromCatalog(apis: string[], patterns: RegExp[]): string | undefined {
  for (const api of apis) {
    if (patterns.some((p) => p.test(api))) return normalizeApiPath(api);
  }
  return undefined;
}

function apiInCatalog(api: string, apis: string[]): boolean {
  return apis.some((a) => apiLooseEqual(a, api));
}

function apiLooseEqual(a: string, b: string): boolean {
  return normalizeApiPath(a) === normalizeApiPath(b) || a.includes(b) || b.includes(a);
}

function normalizeApiPath(api: string): string {
  let s = api.trim();
  // 去掉 host / 服务前缀，保留 /v1/...
  const v1 = s.match(/\/v1\/.+$/);
  if (v1) s = v1[0];
  s = s.replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  // 统一 tenant 占位
  s = s.replace(/\/v1\/\d+\//, '/v1/{tenantId}/');
  return s;
}

function upsertSiteFieldRules(field_rules: Array<Record<string, unknown>>): void {
  const ensure = (rule: Record<string, unknown>) => {
    const name = String(rule.name);
    const existing = field_rules.find((f) => String(f.name) === name);
    if (existing) {
      if (rule.row_gate != null) existing.row_gate = rule.row_gate;
      if (rule.note != null && !existing.note) existing.note = rule.note;
      if (rule.control != null && !existing.control) existing.control = rule.control;
      const ew = normalizeStringArray(existing.editable_when);
      if (!ew?.includes('site_assignment_edit')) {
        existing.editable_when = [...(ew || []), 'site_assignment_edit'];
      }
      return;
    }
    field_rules.push(rule);
  };

  ensure({
    name: 'siteLov',
    label: '站点编码',
    required: true,
    control: 'lov',
    editable_when: ['site_assignment_edit'],
    row_gate: '!materialSiteId',
    note: '仅未落库行可编辑；已落库行只读展示 siteCode',
  });
  for (const [name, label] of [
    ['revisionFlag', '启用版本'],
    ['productionVersionFlag', '启用生产版本'],
    ['enableFlag', '启用状态'],
  ] as const) {
    ensure({
      name,
      label,
      control: 'switch',
      editable_when: ['site_assignment_edit'],
      note: '编辑态已落库行亦可改（无 materialSiteId 门禁）',
    });
  }
}

function slugId(s: string): string {
  const ascii = s
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_|_$/g, '');
  if (ascii && /[a-z0-9]/.test(ascii)) return ascii.slice(0, 48);
  return `op_${Buffer.from(s).toString('hex').slice(0, 8)}`;
}
