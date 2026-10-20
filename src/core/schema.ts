import { z } from 'zod';

/** 元素定位：优先 role/testId/label，少用 css */
export const LocatorSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  testId: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  text: z.string().optional(),
  css: z.string().optional(),
  /** 限定在某个元素引用内，如 customer.pickerDialog */
  within: z.string().optional(),
});

export type LocatorDef = z.infer<typeof LocatorSchema>;

export const ReadySchema = z.object({
  visible: z.string().optional(),
  hidden: z.string().optional(),
  response: z.string().optional(),
}).optional();

export const AssertSchema = z.object({
  type: z.enum(['visible', 'hidden', 'textContains', 'valueEquals', 'urlContains']),
  target: z.string().optional(),
  value: z.string().optional(),
});

export const ScreenshotSchema = z.union([
  z.boolean(),
  z.object({
    /** 默认 false：只拍视口。true 易把 fixed 抽屉/flex 布局拼歪，慎用 */
    fullPage: z.boolean().optional(),
    /** 元素库引用，如 feat_xxx.copyDrawer；有则对该 locator 截图 */
    target: z.string().optional(),
  }),
]);

export const StepSchema = z.object({
  name: z.string(),
  action: z.string(),
  args: z.record(z.unknown()).default({}),
  assert: z.array(AssertSchema).optional(),
  ready: ReadySchema,
  /** true | false | { fullPage?, target? }；默认 true 且 fullPage=false */
  screenshot: ScreenshotSchema.default(true),
});

export const CaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()).optional(),
  steps: z.array(StepSchema).min(1),
});

export const SuiteSchema = z.object({
  suite: z.string(),
  baseURL: z.string().optional(),
  cases: z.array(CaseSchema).min(1),
});

export type Suite = z.infer<typeof SuiteSchema>;
export type CaseDef = z.infer<typeof CaseSchema>;
export type StepDef = z.infer<typeof StepSchema>;

export const OperationTypeSchema = z.enum([
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

/** 页面模式：只读 / 可编辑 / 新建可写等 */
export const PageModeSchema = z.enum(['view', 'edit', 'create', 'copy', 'other']);

/**
 * 页面状态机：何时只读、何时可改、页头按钮、如何切换
 * 例：列表点进详情 → view（编辑按钮）→ 点编辑 → edit（保存/取消）
 */
export const PageStateSchema = z.object({
  id: z.string().describe('状态 id，如 detail_view / detail_edit / create'),
  name: z.string().describe('中文名'),
  route_when: z
    .string()
    .optional()
    .describe('何种路由进入，如 dist/:id | dist/create | dist/copyStatus'),
  mode: PageModeSchema.default('other'),
  form_disabled: z.boolean().optional().describe('表单是否整体 disabled'),
  header_buttons: z
    .array(z.string())
    .optional()
    .describe('该状态下页头可见主按钮，如 编辑/保存/取消'),
  enter_via: z
    .array(z.string())
    .optional()
    .describe('如何进入该状态，如 click:editBtn / route:create'),
  exit_via: z
    .array(z.string())
    .optional()
    .describe('如何离开，如 click:saveBtn / click:cancelBtn'),
  ready_hint: z
    .string()
    .optional()
    .describe('自动化就绪信号，如 editBtn | saveBtn | materialCode'),
  note: z.string().optional(),
});

/** 字段规则：必输、只读时机、控件类型 */
export const FieldRuleSchema = z.object({
  name: z.string().describe('DS 字段名，如 materialCode'),
  label: z.string().optional().describe('中文标签'),
  required: z.boolean().optional(),
  readonly_when: z
    .array(z.string())
    .optional()
    .describe('哪些 page_state.id 下只读'),
  editable_when: z
    .array(z.string())
    .optional()
    .describe('哪些 page_state.id 下可改'),
  /**
   * 行级可编辑门禁（源码 editor/renderer 条件），如 "!materialSiteId"。
   * 有值时：仅满足该条件的行可编辑该字段；页状态 editable_when 仍须同时满足。
   */
  row_gate: z.string().optional(),
  control: z
    .enum(['input', 'lov', 'switch', 'number', 'intl', 'select', 'other'])
    .optional(),
  note: z.string().optional(),
});

/** 校验：前端 validate / 后端 check|save 业务校验 */
export const ValidationRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  when: z.string().optional().describe('触发时机，如 blur / save / unlock'),
  type: z.enum(['required', 'unique', 'format', 'biz', 'api', 'other']).optional(),
  api: z.string().optional().describe('相关 API path'),
  message_hint: z.string().optional().describe('失败提示关键词'),
  fields: z.array(z.string()).optional(),
  note: z.string().optional(),
});

export const RowTargetSchema = z.object({
  /** 所在区域，如 secondaryUomTable */
  area: z.string().optional(),
  /** 控件形态 */
  control: z.enum(['radio', 'switch', 'button', 'link', 'other']).optional(),
  /** 列/字段名，如 defaultFlag */
  column: z.string().optional(),
  /** 元素库 key，如 defaultSecondaryUomRadio */
  element: z.string().optional(),
});

/** related_page / 跳转入口：显式控件，禁止 gen 猜元素 key */
export const EntryControlSchema = z.object({
  kind: z.enum(['button', 'link', 'other']).optional(),
  /** 页面可见文案，如 站点分配 / 物料站点属性维护 */
  name: z.string().optional(),
  /** 元素库 key（优先于 name） */
  element: z.string().optional(),
});

/**
 * 功能范围内的页面节点。
 * in_feature：本功能内页，须继续分析该页全部能力；
 * external：跳到其他功能，只记入口边，不再深挖对方页内增删改/校验。
 */
export const PageNodeSchema = z.object({
  id: z.string().describe('如 list / detail / site_assignment'),
  name: z.string(),
  route: z.string().optional(),
  scope: z.enum(['in_feature', 'external']).default('in_feature'),
  source_hint: z.string().optional().describe('源码目录或文件线索'),
  note: z.string().optional(),
});

/** 页面跳转边：from → to，用于拼执行链路 */
export const PageEdgeSchema = z.object({
  id: z.string().optional(),
  from_page: z.string(),
  to_page: z.string(),
  via: z
    .string()
    .optional()
    .describe('header_button | row_link | menu | other'),
  control: EntryControlSchema.optional(),
  preconditions: z.array(z.string()).optional(),
  note: z.string().optional(),
});

export const OperationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: OperationTypeSchema,
  page: z.string().optional(),
  /** 归属页面 id（对应 pages[].id） */
  page_id: z.string().optional(),
  /**
   * in_feature：本功能内能力，须完整分析；
   * external：仅 related_page 出边，勿再拆对方内部功能。
   */
  scope: z.enum(['in_feature', 'external']).optional(),
  route: z.string().optional(),
  fields: z.array(z.string()).optional(),
  opens: z.enum(['modal', 'page', 'drawer']).optional(),
  entry: z.string().optional(),
  /** 点击入口控件（header_button / row_action 必填其一 element|name） */
  entry_control: EntryControlSchema.optional(),
  used_by: z.array(z.string()).optional(),
  description: z.string().optional(),
  /** 初始页面模式 */
  initial_mode: PageModeSchema.optional(),
  /** 执行前必须满足的步骤，如 ["enter_detail", "click:editBtn"] */
  preconditions: z.array(z.string()).optional(),
  /**
   * 可执行链路（有序）：分析后由 compileFlows 反写为 meta_op_id 序列。
   * 权威编排在 meta_ops + flows；本字段仅人读摘要。
   */
  execution_chain: z.array(z.string()).optional(),
  /** 从只读切到可写的动作，如 click:editBtn */
  unlock: z.string().optional(),
  /** 关联 page_states.id */
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  /** 行内动作 / 保存等触发的 API path（须为源码字面量） */
  api: z.string().optional(),
  /** api 出处，如 services/index.ts#SaveMaterialSiteAssignment */
  api_source: z.string().optional(),
  /** 调用形态 */
  api_kind: z
    .enum(['custom_request', 'ds_transport', 'inline', 'unknown'])
    .optional(),
  /** 行内动作目标 */
  row_target: RowTargetSchema.optional(),
});

/** 元操作 kind：与 keywords action 对齐，供流程编排 */
export const MetaOpKindSchema = z.enum([
  'goto',
  'filter_query',
  'assert_table_rows',
  'open_detail',
  'click',
  'fill',
  'fill_form',
  'pick_lov',
  'click_expect_api',
  'assert',
  'set_var',
]);

export const MetaOpSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: MetaOpKindSchema,
  page_id: z.string().optional(),
  /** 默认参数模板（节点可覆盖） */
  args: z.record(z.unknown()).optional(),
  element: z.string().optional(),
  api: z.string().optional(),
  ready: ReadySchema,
  constraints: z
    .object({
      requires_prior: z.array(z.string()).optional(),
    })
    .optional(),
  note: z.string().optional(),
});

export const FlowNodeSchema = z.object({
  id: z.string(),
  meta_op_id: z.string(),
  args: z.record(z.unknown()).optional(),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
});

export const FlowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
});

export const FlowSchema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()).optional(),
  source: z.enum(['default', 'user']).default('default'),
  nodes: z.array(FlowNodeSchema).min(1),
  edges: z.array(FlowEdgeSchema).default([]),
});

export const ElementHintSchema = z.object({
  ref: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  testId: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  text: z.string().optional(),
  css: z.string().optional(),
  within: z.string().optional(),
  note: z.string().optional(),
});

export const ReviewExtendKindSchema = z.enum([
  'platform_kit',
  'keyword',
  'case',
  'analyze_retry',
  'data_fixture',
  'other',
]);

/** LLM 分析后供人工审核的扩展建议 */
export const ReviewSuggestionItemSchema = z.object({
  kind: ReviewExtendKindSchema.default('other'),
  item: z.string().describe('建议做什么，如 drawer 选择器 / clickRowRadio'),
  why: z.string().optional().describe('原因'),
  priority: z.enum(['high', 'medium', 'low']).optional(),
});

/** DOM 探针产出的定位候选（须人工 approved 后才能写入 kit） */
export const DomCandidateSchema = z.object({
  id: z.string(),
  target: z.enum(['platform_kit', 'feature_elements']).default('platform_kit'),
  page_state: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  in_kit: z.boolean().optional().describe('当前 kit/overlay 是否已有同名 key'),
  proposed: z
    .object({
      css: z.string().optional(),
      role: z.string().optional(),
      name: z.string().optional(),
      text: z.string().optional(),
    })
    .optional(),
  evidence: z
    .object({
      route: z.string().optional(),
      count: z.number().optional(),
      aria_snippet: z.string().optional(),
      html_snippet: z.string().optional(),
      screenshot: z.string().optional(),
      probe_file: z.string().optional(),
    })
    .optional(),
  note: z.string().optional(),
});

export const ReviewSuggestionsSchema = z.object({
  status: z
    .enum(['pending_human_review', 'confirmed', 'rejected'])
    .default('pending_human_review'),
  confidence: z.number().min(0).max(1).optional(),
  risks: z.array(z.string()).optional().describe('自动化执行风险'),
  extend_paths: z.array(ReviewSuggestionItemSchema).optional().describe('建议扩展路径'),
  assert_checklist: z.array(z.string()).optional().describe('人工确认清单'),
  /** probe-dom 候选；confirm 仅合并 status=approved 的项 */
  dom_candidates: z.array(DomCandidateSchema).optional(),
});

export const FeatureArtifactSchema = z.object({
  feature: z.string(),
  entry: z.object({
    route: z.string(),
    menu: z.string().optional(),
  }),
  /** 本功能涉及的页面（含跨功能出边目标，external 仅记节点） */
  pages: z.array(PageNodeSchema).optional(),
  /** 页面间跳转关系 */
  page_edges: z.array(PageEdgeSchema).optional(),
  operations: z.array(OperationSchema).min(1),
  /** 可编排元操作（analyze 后由 compileFlows 确定性生成） */
  meta_ops: z.array(MetaOpSchema).optional(),
  /** 测试流程（analyze 后由 compileFlows 生成；gen/compare 主轴） */
  flows: z.array(FlowSchema).optional(),
  page_states: z.array(PageStateSchema).optional(),
  field_rules: z.array(FieldRuleSchema).optional(),
  validations: z.array(ValidationRuleSchema).optional(),
  review_suggestions: ReviewSuggestionsSchema.optional(),
  sources: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  apis: z.array(z.string()).optional(),
  elements_hints: z.array(ElementHintSchema).optional(),
  notes: z.array(z.string()).optional(),
  /** 新产物仅为 deepseek；heuristic 仅兼容读取历史 artifacts */
  analyzer: z.enum(['deepseek', 'heuristic']).optional(),
  model: z.string().optional(),
});

export type FeatureArtifact = z.infer<typeof FeatureArtifactSchema>;
export type ElementHint = z.infer<typeof ElementHintSchema>;
export type PageState = z.infer<typeof PageStateSchema>;
export type FieldRule = z.infer<typeof FieldRuleSchema>;
export type ValidationRule = z.infer<typeof ValidationRuleSchema>;
export type ReviewSuggestions = z.infer<typeof ReviewSuggestionsSchema>;
export type DomCandidate = z.infer<typeof DomCandidateSchema>;
export type PageNode = z.infer<typeof PageNodeSchema>;
export type PageEdge = z.infer<typeof PageEdgeSchema>;
export type MetaOp = z.infer<typeof MetaOpSchema>;
export type MetaOpKind = z.infer<typeof MetaOpKindSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

/** DeepSeek 结构化输出用（与 FeatureArtifact 对齐，字段更宽松便于模型填充） */
export const LlmFeatureOutputSchema = FeatureArtifactSchema.omit({
  sources: true,
  analyzer: true,
  model: true,
}).extend({
  confidence: z.number().min(0).max(1),
});

export const EnvConfigSchema = z.object({
  baseURL: z.string().url().or(z.string().startsWith('http')),
  auth: z.object({
    mode: z.enum(['storageState', 'eachCase', 'skip']).default('storageState'),
    statePath: z.string().default('playwright/.auth/user.json'),
    login: z.object({
      path: z.string().default('/login'),
      username: z.string(),
      password: z.string(),
      userSelector: LocatorSchema.optional(),
      passSelector: LocatorSchema.optional(),
      submitSelector: LocatorSchema.optional(),
      ready: z.string().optional(),
    }),
  }),
  defaults: z.object({
    gotoWaitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).default('domcontentloaded'),
    timeoutMs: z.number().default(30_000),
  }).default({}),
});

export type EnvConfig = z.infer<typeof EnvConfigSchema>;
