# web-auto-test（test-03）

本仓库是 **web-auto-test 的唯一实现仓**：入库维护**组件知识**，并提供**分析 / 生成 / 执行 / 对比**引擎。领域术语见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [docs/adr/](./docs/adr/)。**本文档为完整使用说明**；概念细节可参阅 [docs/meta-ops-flows.md](./docs/meta-ops-flows.md)。

---

## 本仓库做什么

| 层级 | 职责 | 是否提交 Git |
|------|------|----------------|
| **组件知识** | 平台 DOM 定位（Kit）、组件操作手册（Playbook） | 是 |
| **引擎** | 源码分析、路径描述、LLM 生成 suite、Playwright 执行、v1 vs current 对比 | 是（`src/`、`tests/` 等） |
| **功能产物** | `artifacts/`、`cases/generated/`、`reports/` 等 | **否**（见 `.gitignore`） |

被测前端在业务仓；分析时 `gen -p` 指向该仓源码根目录。

---

## 目录结构（与产物落盘）

```text
test-03/
├── knowledge/platform/     # Kit：choerodon/kit.yaml
├── knowledge/playbooks/    # 分析 / 生成时注入的操作手册
├── knowledge/prompts/      # 独立阶段的系统提示词（page-dom-and-locator.md：页面 DOM 解析）
├── artifacts/<featureSlug>/   # 功能路径描述（本地；见下方命名规则）
│   ├── feature.yaml        # current（当前工作副本）
│   ├── page-locators.yaml  # 页面 DOM 解析 + 定位绑定结果（含 elements_draft、gaps、质量门禁违规）
│   ├── v1/                 # 基线快照（snapshot 写入，勿改）
│   ├── baseline-manifest.yaml
│   └── compare/            # diff.yaml、report.yaml
├── cases/generated/<featureSlug>/suite.yaml
├── elements/<featureSlug>/generated.yaml
├── configs/env.yaml
├── reports/                # Playwright HTML 报告
└── src/cli/                # `pnpm ata` 入口
```

### 概念分层（`feature.yaml` vs `suite.yaml`）

| 层 | 含义 | 谁产出 | 落盘 |
|----|------|--------|------|
| `operations` | 能力摘要（评审先看） | LLM 分析 | `feature.yaml` |
| `meta_ops` / `flows` | 可执行原子与测试流程链（权威编排） | **确定性编译**（`compileFlows`） | `feature.yaml` |
| suite `steps` | Playwright 关键字步骤 | LLM gen（按 flows） | `suite.yaml` |

分析流水线：源码 → **页面 DOM 解析与定位绑定**（见下文「页面 DOM 解析」）→ LLM（只认能力，可直出 `steps`，经 `validateOperationSteps` 校验，失败回退规则模板）→ `compileMetaOpsAndFlows`（按 `operation.type` 生成 `meta_ops`/`flows`，并反写 `execution_chain` 为 meta_op_id 序列）→ 落盘。

---

## 安装与环境

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

| 变量 | 用途 |
|------|------|
| `DEEPSEEK_API_KEY` | **gen**、**compare 报告** 必需 |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 可选 |
| `BASE_URL` | 被测环境（或 `configs/env.yaml`） |
| `TEST_USER` / `TEST_PASS` / `TEST_ROLE*` | `ata auth` 登录 |
| `TARGET_PROJECT` | `gen -p` 默认源码根 |

所有引擎命令：

```bash
pnpm ata <command> [options]
pnpm ata --help
```

其它 npm 脚本：

```bash
pnpm run build          # tsc 编译
pnpm test:e2e           # 直接跑 Playwright（一般用 ata test）
pnpm report             # 打开 reports/html
```

---

## 产物目录命名与 `-f` 参数

产物目录（`artifacts` / `cases/generated` / `elements`）统一为功能 slug：

```text
<featureSlug>
```

| 规则 | 示例 |
|------|------|
| 英文功能名 → 小写 | `Material` → `material` |
| 中文等 → `feat_` + 名哈希前 8 位 | → `feat_e997aee9` |

完整示例：`artifacts/feat_e997aee9/`。

- **首次** `gen -f … -p …`：新建以功能 slug 命名的目录。
- **同功能再次 gen**：覆盖同目录（保留 `v1/`、`compare/`）。
- 元素命名空间与目录名一致（如 `feat_e997aee9.pageReady`）。
- 历史带时间戳目录仍可用完整路径读取；新 gen 一律写入无时间戳的功能 slug 目录。

`-f` / 路径用于定位产物目录：

| 传入方式 | 示例 |
|----------|------|
| 功能名（中文） | `-f "问题管理平台字段配置"` → `feat_xxxx` |
| 英文功能名 | `-f Material` → `material` |
| 完整目录名 | `-f feat_e997aee9` |
| 目录路径 | `-f artifacts/feat_e997aee9` |
| **推荐** feature 路径 | `-f artifacts/.../feature.yaml` |

**snapshot / compare 请用与产物一致的目录名或 `feature.yaml` 路径**，避免基线与 current 不在同一目录。

---

## 命令一览

| 命令 | 作用 |
|------|------|
| `ata gen` | 源码或已有 `feature.yaml` → 路径描述 + suite + 元素库 |
| `ata analyze` | 等同 `gen -f -p --meta-only`（仅写元操作） |
| `ata test` | 执行 suite YAML |
| `ata auth` | 登录，写入 `playwright/.auth/user.json` |
| `ata snapshot` | 将 current 固化为 `artifacts/<slug>/v1/` |
| `ata compare` | **v1 基线 vs current** → `diff.yaml` → LLM → `report.yaml`；加 `--ata <功能目录> -p <项目根>` 则基线改取目标项目 `ata/` 最新版本（`-b V2` 指定版本，diff meta 记录 `baseline_source`） |
| `ata confirm` | `-f <功能名> -d <功能目录> [-p 项目根] [-n 备注] [-y]`：人工确认后把 current 备份为 `<功能目录>/ata/V<n>/`（V1、V2…不可变；打印与上一版本的字段差异条数，不动目标项目 git） |
| `ata versions` | `-d <功能目录> [-p 项目根]`：列出 `ata/` 已确认版本与确认时间 |
| `ata actions` | 列出 suite 可用 keyword |
| `ata scan-dom` | **页面 DOM 解析体检**：批量静态扫描 `packages/*/src/routes`，输出定位覆盖率与缺口聚类（不调 LLM、不连 UAT，详见「页面 DOM 解析」） |

---

## 1. 生成（gen）

### 从源码一步生成（分析 + 脚本 + 元素）

须配置 `DEEPSEEK_API_KEY`，且 `knowledge/playbooks/` 非空。

```bash
pnpm ata gen -f <功能名> -p <被测前端源码根>

# 示例
pnpm ata gen -f Material -p "D:/path/to/feature/src"
pnpm ata gen -f "问题管理平台字段配置" -p "%TARGET_PROJECT%"
```

**输出：**

- `artifacts/<slug>/feature.yaml`（含 `operations` + 编译后的 `meta_ops` / `flows`）
- `cases/generated/<slug>/suite.yaml`（优先按 `flows` 编排）
- `elements/<slug>/generated.yaml`
- 可选诊断：`artifacts/<slug>/llm.raw.json`、`gen.llm.raw.json`

对仅有 `operations` 的旧 `feature.yaml`，`gen -i` 会自动编译并回写 `meta_ops`/`flows`。

### 已有元操作，只重生成测试脚本

```bash
pnpm ata gen -i artifacts/<slug>/feature.yaml
```

### 只分析、不写 suite（元操作）

```bash
pnpm ata gen -f <功能名> -p <源码根> --meta-only
# 或兼容命令：
pnpm ata analyze -f <功能名> -p <源码根>
```

### gen 与 v1 存档（覆盖 current 之前）

若磁盘上已有 `feature.yaml` 且尚无 `v1/`，再次 `gen` 时会**交互询问**是否先存档 v1：

```bash
pnpm ata gen -f <功能名> -p <源码根> --archive-v1           # 非交互：直接存档 v1
pnpm ata gen -f <功能名> -p <源码根> --no-archive-prompt  # 不询问、不存档
```

（与手动 `snapshot -l v1` 等价。）

---

## 2. 执行（test）

```bash
# 业务环境：先登录
pnpm ata auth
pnpm ata test -c cases/generated/<slug>/suite.yaml

# 指定 suite（默认 example-smoke）
pnpm ata test -c cases/example-smoke.yaml --skip-auth

# 查看 HTML 报告
pnpm report
```

---

## 3. 基线快照（snapshot）

将 **current**（根目录 `feature.yaml` + 当前 suite/元素）复制到同功能目录下的 **`v1/`**：

```bash
pnpm ata snapshot -f artifacts/<slug>/feature.yaml -l v1 --note "首版跑通"
```

| 选项 | 说明 |
|------|------|
| `-f` | 功能名 / slug / `artifacts/<slug>` / **`feature.yaml` 路径**（必填） |
| `-l` | 基线标签，默认 `v1` |
| `--note` | 写入 `baseline-manifest.yaml` |

生成：

```text
artifacts/<slug>/v1/feature.yaml
artifacts/<slug>/v1/suite.yaml
artifacts/<slug>/v1/generated.yaml   # 若有
artifacts/<slug>/baseline-manifest.yaml
```

---

## 4. 版本对比（compare）

固定语义：**`v1/` 基线** vs **功能目录根部 current**：

| 侧 | 路径 |
|----|------|
| v1 | `artifacts/<slug>/v1/feature.yaml`、`v1/suite.yaml` |
| current | `artifacts/<slug>/feature.yaml`、`cases/generated/<slug>/suite.yaml` |

流水线：**diff.yaml →（LLM）→ report.yaml**

```bash
# 默认对比 v1（推荐带 feature.yaml 路径）
pnpm ata compare -f artifacts/<slug>/feature.yaml

pnpm ata compare -f artifacts/<slug>/feature.yaml -b v1
pnpm ata compare -f artifacts/<slug>/feature.yaml --list
```

| 选项 | 说明 |
|------|------|
| `-f` | 同 snapshot |
| `-b` | 基线标签，**默认 `v1`** |
| `--list` | 列出 `baseline-manifest.yaml` 中的基线 |

**对比产物**（`artifacts/<slug>/compare/`）：

| 文件 | 内容 |
|------|------|
| `latest-diff.yaml` | 结构化差异；`meta.logic_changed`、`compare_mode: v1_vs_current` |
| `latest-report.yaml` | LLM 报告；**`summary`** + 有变化的 **`flows`** |
| `latest-report.md` | 同上，简洁 Markdown |
| `diff-<时间>.yaml` / `report-<时间>.yaml` | 归档 |

diff **以完整测试流程链为主轴**（`compare_axis: full_flow`）：展开分析编译得到的 `flows` + `meta_ops`；仅旧产物无 `flows` 时才按 `execution_chain` 合成兜底。能力摘要与配套模型为辅；`suite` 仅作脚本漂移提示。报告只保留短总览 + 有变化流程的一句说明。

---

## 5. 端到端推荐流程

```text
① pnpm ata gen -f … -p …
② pnpm ata auth && pnpm ata test -c cases/generated/<slug>/suite.yaml
③ pnpm ata snapshot -f artifacts/<slug>/feature.yaml -l v1
④ 改源码或手改 feature.yaml → pnpm ata gen -i artifacts/<slug>/feature.yaml
⑤ pnpm ata test …
⑥ pnpm ata compare -f artifacts/<slug>/feature.yaml
⑦ 阅读 compare/latest-report.yaml（summary / flows）或 latest-report.md
```

---

## 页面 DOM 解析与体检

目标：精确识别页面里的 c7n 组件、自定义组件、原生节点，并绑定到可用的定位（元素库）。**只靠源码静态解析，不编造 CSS**；绑不上的记缺口。

### 流水线（`gen` / `analyze` 内自动执行）

| 步骤 | 模块 | 说明 |
|------|------|------|
| ① JSX 裁剪 | `src/analyzer/pruneJsx.ts` | TypeScript 编译器 API 把页面入口裁成「JSX 树 + 字面量 props」；识别 c7n / 原生 / 自定义；列配置里的 renderer 链接；`Modal.open` 内的 JSX 标为浮层；相对路径与本地别名（`@` → 包内 `src`）的自定义组件跟进，深度 ≤2、防环 |
| ② 确定性绑定 | `src/analyzer/kitBinding.ts` | 组件 + props → kit 键 / 字段定位：Table 以 `dataSet` 命名（同页多表：自身及之前的表都无条件渲染 → 正向 `nth`；自身及之后都无条件 → 负向 `nth`（从末尾数）；条件/循环渲染居中，或被跟进的子组件里也有表 → `needs_review` 待探测；回调属性、`Modal.open` 里的表不计入主树）；带文案按钮 → role+name；Lov → `<name>Open`；列内链接 → `td[data-index] a` 且 `within` 对应表 |
| ③ LLM 补全 | `src/analyzer/llmLocate.ts` | 系统提示词 `knowledge/prompts/page-dom-and-locator.md`，输入裁剪树 + kit 键 + 预绑定；输出 `page_dom_locator/v1` YAML（**不是 JSON**） |
| ④ 质量门禁 | `src/analyzer/validateLocate.ts` | 8 条：合法 slug、c7n 叶子须 bound 或 needs_kit、无 `element_N`、无逗号并集 CSS、多实例须消歧、未展开自定义组件不得 bound、`elements_draft` 与 locators 一致、bound 须有证据。失败降 `confidence` 并写 gaps，**不放行** |
| ⑤ 并入元素库 | `platformKit.ts` `buildFeatureElementLib` | 顺序 kit → 功能 overlay → 草案（只补缺失键）→ field_rules → hints；人工 overlay 最终覆盖 |

产物 `artifacts/<slug>/page-locators.yaml`；缺口与违规同时写入 `feature.yaml` 的 `review_suggestions.risks`。缺口类型：`needs_kit`、`unresolved_custom`、`ambiguous_multi_instance`、`dynamic_dom`、`large_file_truncated`。

**库组件与别名**：库别名读根 `tsconfig.json` 的 `paths`（`components/*`→hzero-front，`@components/*`→hcm-components-front，均在 node_modules，仓库内无源码）；包内 `@`→`./src` 读各包 `config/config.ts` 的 module-resolver。库组件在 `src/analyzer/libComponents.ts` 登记（已登记：Lov、EditTable、Upload、Checkbox，以及 `@components/tarzan-ui` 的 TarzanSpin / LocaleProvider / ExpandCardC7n / C7nFormItemSort（包裹型，透明，子节点照常解析）、TarzanDrawer（内容按浮层处理）、AttributeDrawer / LovSelect（自带 DOM，待探测），记为 `lib_known`；未登记记 `lib_unknown`）。本地 barrel（`export { default as X } from './X'`）会穿透到真实文件继续跟进——只登记已核实的用法，DOM 未核实，**不产出 CSS**。列 `editor` 里无 `name` 的控件，字段名取列 `name`，绑定到 `td[data-index=列名]` 单元格（`<列名>Cell`，within 对应表）；`getFieldDecorator('x')(<控件/>)` 旧写法记 `legacy_form_field`（DOM 未核实，待探测）。图标按钮（无文案、`icon` 为字面量）：绑定 `button:has(.icon-<name>)`（沿用 kit 的 tableAddLineBtn / tableRemoveLineBtn 约定；列头 `header` 内加 `.c7n-pro-table thead`，行内 `renderer`/`editor` 内加 `.c7n-pro-table-tbody tr.c7n-pro-table-row`）；add / remove 来自 kit 已核实条目，其它图标名按同一类名约定类推，标 `needs_review`；行内按钮每行重复、同作用域同图标多次出现记缺口。同文案按钮重复：三元的 T/F 分支、`a && X` 与 `!a && Y` 互斥，不算冲突；`Modal.open` 里的同名按钮限定到 kit `modal`（键名加 `InModal` 后缀，`needs_review`），主树按钮不受其影响；其余仍记 `dup_button_text`。`Modal.open` / `Drawer.open` 内容里的表格：限定到 kit `modal` / `drawer` 容器，键名加 `InModal` 后缀，容器内多表按该内容内的顺序给下标（规则同主树），均标 `needs_review`；`TarzanDrawer` 等库抽屉里的表仍记 `overlay_table`。带文案按钮的键名：优先取 `onClick` 处理函数名，其次 `src/analyzer/btnKeys.ts` 词表（纯字母文案直接用），词表外的留给 LLM 命名。 无 `name` 的字段控件按写法归因：`field_standalone_labeled/bare`（只有 value/onChange 的独立受控控件，不走 DataSet，不绑定；带 placeholder/label 的文案写进 `suggest`）、`field_dynamic_name`（`name={变量}`，运行时才定，不绑定）。`name={`前缀${expr}`}` 模板串：字面量前缀生成 `[name^="前缀"]` 选择器，键名 `<前缀>Any`，`needs_review` 并记 `field_name_template` 缺口（会匹配同前缀全部实例）。

> 步骤 7（只读探测 UAT 以核对 `needs_probe` 节点）尚未实现。

### 体检：`ata scan-dom`

```bash
pnpm ata scan-dom -p ../../repos/pdl-front                 # 全部包
pnpm ata scan-dom -p <仓库根> --packages key-hwms-front -o /tmp/dom-scan
```

纯静态，全仓库约十几秒。输出到 `-o`（默认 `/tmp/dom-scan/`，不进仓库）：

| 文件 | 内容 |
|------|------|
| `summary.md` / `summary.json` | 全局与分包覆盖率（严格 = 已绑定；含候选 = 另计带文案按钮的 role+name 候选）、缺口原因排行 |
| `pages.csv` | 每页一行：节点数、各状态数、覆盖率、`{...props}` 与 `.map` 计数 |
| `samples.md` | 每类缺口的代表页面，用来挑回归样本 |

页面入口 = `routes` 下含 `index.(tsx|jsx|js)` 的目录；被其它入口跟进的文件并入该页面，不单独计。缺口原因标签如 `button_needs_key_name`、`field_no_literal_name`、`multi_table_nth`、`overlay_table`、`custom_unresolved:<来源>`、`kit_missing:<组件>`、`props_spread`、`map_repeat`。

---

## 6. MetaOp kind → suite keyword

| kind | keyword |
|------|---------|
| goto | goto |
| filter_query | tableFilterQuery（Select/Lov 用 `control`+`first:true`） |
| assert_table_rows | assertTableHasRows |
| open_detail | openDetailRow |
| click | click |
| fill / fill_form | fill / fillForm |
| pick_lov | pickLov（默认第一行） |
| （Select） | pickSelect（默认第一条） |
| click_expect_api | clickExpectApi |
| assert | assert |
| set_var | setVar |

---

## 7. 排障

| 现象 | 处理 |
|------|------|
| `缺少 DEEPSEEK_API_KEY` | 在 `.env` 配置 key |
| `snapshot` 找不到 feature.yaml | `-f` 用实际产物路径，如 `artifacts/<featureSlug>/feature.yaml` |
| compare 报缺少 v1 | 先 `snapshot -l v1` |
| 分析 / 生成质量 | 查 `artifacts/<slug>/llm.raw.json`、`gen.llm.raw.json`；定位问题查 `page-locators.yaml`（`gaps`、`quality_violations`）与 `page-locators.raw.txt` |
| 依赖账号列个性化的用例被跳过 | 步骤带 `skipIfMissing`（来自 `operation.steps[].requires`）：元素 15 秒内不存在则跳过并说明原因，不改用户列设置 |
| 套件校验 | `pnpm exec tsx scripts/validate-suite.ts <suite.yaml>`（若项目已配置） |

---

## 8. 快速验证（demo，不调 LLM）

```bash
pnpm install
pnpm exec playwright install chromium
pnpm ata test -c cases/example-smoke.yaml --skip-auth
```

---

## 一期范围与参考

- 能力范围：[ADR 0009](docs/adr/0009-phase1-scope.md)
- 强制 LLM 分析：[ADR 0011](docs/adr/0011-analyze-llm-only.md)
- 引擎模块说明：[src/README.md](./src/README.md)
- 控制台（规划中）：[console/README.md](./console/README.md)

**确认（confirm）门禁、业务仓同步**等仍在规划中；当前用 **snapshot v1 + compare** 完成「首版保留 + 第二版差异说明」。

---

## LLM 文件交接模式（handoff）

不配 DeepSeek key，由外部 agent（如呆呆鸟）充当 LLM。`.env` 设 `LLM_MODE=handoff` 后：

1. 运行 `pnpm ata gen -f <功能名>`（`-p` 默认 `../../repos/pdl-front`）。一次分析会产生**两类**请求：先是页面 DOM 解析（应答为 YAML，`responseFormatJson=false`），再是功能分析（应答为 JSON）。
2. 引擎把每次 LLM 请求写到 `artifacts/_llm-handoff/<key>.request.json`（含 `messages`、`responseFormatJson`），随后以**退出码 3** 暂停。
3. agent 读取 request，按 `messages` 生成回复，**原样**写入同名 `<key>.response.txt`（`responseFormatJson=true` 时必须是合法 JSON）。
4. 重跑同一条命令；已应答的请求直接复用，直到下一个未应答请求再次暂停，如此直至流程结束。

key 由请求内容哈希得到，prompt 变动后旧应答自动失效。实现与细则见 `src/analyzer/deepseekClient.ts` 顶部注释。
