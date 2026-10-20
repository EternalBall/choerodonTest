# 端到端流程：生成 → 执行

## 主链（两步）

| 步骤 | 命令 | 输入 | 输出 |
|------|------|------|------|
| **1. 生成** | `ata gen -f … -p …` | 被测源码 + Playbooks + Platform Kit | **元操作** `artifacts/<featureSlug>/feature.yaml` + **测试脚本** `cases/generated/<featureSlug>/suite.yaml` + `elements/<featureSlug>/generated.yaml` |
| **2. 执行** | `ata test -c …` | suite + 元素库 | `reports/html` |

产物目录命名：`<featureSlug>`（如 `feat_e997aee9`）。同功能再次 gen 复用同目录。

```text
被测源码
    │  ata gen -f <功能> -p <源码根>
    │    ① LLM 分析 → operations（能力事实）
    │    ② compileFlows → meta_ops + flows（确定性编排）
    │    ③ LLM + playbooks → suite（按 flows）；kit → elements
    ▼
artifacts/<featureSlug>/feature.yaml   # operations + meta_ops + flows
cases/generated/<featureSlug>/suite.yaml
elements/<featureSlug>/generated.yaml
    │  ata test
    ▼
reports/html
```

若已有元操作文件，可只重做测试脚本：`pnpm ata gen -i artifacts/<featureSlug>/feature.yaml`。

`ata analyze` 已合并进 `gen`（等同 `gen -f -p --meta-only`，仅写元操作）。

## 概念分层

| 层 | 作用 | 谁产出 | 典型落盘 |
|----|------|--------|----------|
| `operations` | 能力摘要（审核） | LLM | `feature.yaml` |
| `meta_ops` | 最小执行单元 | `compileFlows`（按 type 模板） | `feature.yaml` |
| `flows` | 用例 = 元操作链 | `compileFlows`（一能力一流） | `feature.yaml` |
| suite `steps` | Playwright 关键字步骤 | LLM gen（跟 flows） | `suite.yaml` |

实现：`src/analyzer/compileFlows.ts`。LLM **不**输出 `meta_ops`/`flows`；`execution_chain` 由编译器反写为 meta_op_id 序列。

## Playbooks 与 Kit（生成阶段）

| 知识 | 形态 | 作用 |
|------|------|------|
| **Playbooks** | `knowledge/playbooks/*.md` | 分析识别元操作；生成时 meta_op → keyword / 元素语义 |
| **Platform Kit** | `knowledge/platform/choerodon/kit.yaml` | 合并为 `elements/.../generated.yaml` |
| **功能覆盖** | `knowledge/features/<slug>/elements.yaml` | 可选 curated 定位 |

## MetaOp kind → keyword

| kind | keyword |
|------|---------|
| goto | goto |
| filter_query | tableFilterQuery |
| assert_table_rows | assertTableHasRows |
| open_detail | openDetailRow |
| click | click |
| fill / fill_form | fill / fillForm（Select 项用 control+first） |
| pick_lov | pickLov（默认第一行） |
| （Select） | pickSelect（默认第一条） |
| click_expect_api | clickExpectApi |
| assert | assert |
| set_var | setVar |

## 产物分区与对比

```text
artifacts/<featureSlug>/        # 例：feat_e997aee9
  feature.yaml                 # current：当前路径描述（元操作 / operations / flows）
  v1/                          # 基线快照（与 feature.yaml 同目录）
    feature.yaml
    suite.yaml
    generated.yaml             # 可选
  baseline-manifest.yaml       # 基线列表与 latest 指针
  compare/
    latest-diff.yaml             # 结构化差异（baseline vs current）
    diff-<ts>.yaml
    latest-report.yaml           # LLM 根据 diff 生成的对比报告
    latest-report.md             # 报告可读版
    report-<ts>.yaml / .md

cases/generated/<featureSlug>/suite.yaml   # 当前可执行脚本（再次 gen 覆盖同目录）
```

**推荐节奏**：`gen` → `test` 全绿 → 改源码或手改 `feature.yaml` → 再 `gen`（若已有元操作且尚无 v1，CLI 会询问是否存档 v1）→ `compare`。

也可在首版跑通后手动 `snapshot -l v1`；`gen` 询问存档与 snapshot 等价。

对比流水线：**`v1/` 基线 vs 功能目录根部 current**（`feature.yaml` + `cases/generated/.../suite.yaml`）→ `diff.yaml` → LLM → `report.yaml`。默认对比标签为 **v1**。diff **以完整测试流程链为主轴**：有 `flows` 则展开节点比对；无则按 `operation.execution_chain` 合成。`suite` 仅提示编译漂移。报告为短总览 + 有变化流程的一句说明。

## CLI

**完整命令与选项见仓库根目录 [README.md](../README.md)。**

排障：`artifacts/<featureSlug>/llm.raw.json`（分析）、`gen.llm.raw.json`（生成 suite）。

## 实现

- `analyzer/analyzeFeature`：LLM → `compileMetaOpsAndFlows` → artifact
- `analyzer/compileFlows`：按 `operation.type` 生成 `meta_ops`/`flows`，反写 `execution_chain`
- `codegen/runGenPipeline`：无 flows 的旧产物自动 `ensureCompiledFlows` 并回写 → `llmGenSuite` → suite/elements
- `cli/index.ts`：`gen` 统一入口；`analyze` 为 `--meta-only` 兼容别名
