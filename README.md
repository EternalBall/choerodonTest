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
├── artifacts/<featureSlug>/   # 功能路径描述（本地；见下方命名规则）
│   ├── feature.yaml        # current（当前工作副本）
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

分析流水线：源码 → LLM（只认能力）→ `compileMetaOpsAndFlows`（按 `operation.type` 生成 `meta_ops`/`flows`，并反写 `execution_chain` 为 meta_op_id 序列）→ 落盘。

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
| `ata compare` | **v1 基线 vs current** → `diff.yaml` → LLM → `report.yaml` |
| `ata actions` | 列出 suite 可用 keyword |

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
| 分析 / 生成质量 | 查 `artifacts/<slug>/llm.raw.json`、`gen.llm.raw.json` |
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
