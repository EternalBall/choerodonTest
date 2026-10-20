# 端到端流程：生成 → 执行

## 主链（两步）

| 步骤 | 命令 | 输入 | 输出 |
|------|------|------|------|
| **1. 生成** | `ata gen -f … -p …` | 被测源码 + Playbooks + Platform Kit | **元操作** `artifacts/<base>_<ts>/feature.yaml` + **测试脚本** `cases/generated/<base>_<ts>/suite.yaml` + `elements/<base>_<ts>/generated.yaml` |
| **2. 执行** | `ata test -c …` | suite + 元素库 | `reports/html` |

产物目录命名：`<featureSlug>_<timestamp>`（如 `feat_e997aee9_2026-10-18T08-51-19-425Z`）。同功能再次 gen 复用最新目录。

```text
被测源码
    │  ata gen -f <功能> -p <源码根>
    │    ① LLM 分析源码 → 元操作产物
    │    ② LLM + playbooks → suite；kit 合并 → elements
    ▼
artifacts/<base>_<ts>/feature.yaml
cases/generated/<base>_<ts>/suite.yaml
elements/<base>_<ts>/generated.yaml
    │  ata test
    ▼
reports/html
```

若已有元操作文件，可只重做测试脚本：`pnpm ata gen -i artifacts/<base>_<ts>/feature.yaml`。

`ata analyze` 已合并进 `gen`（等同 `gen -f -p --meta-only`，仅写元操作）。

## 概念分层

| 层 | 作用 | 典型落盘 |
|----|------|----------|
| `operations` | 能力摘要（审核） | `feature.yaml` |
| `meta_ops` | 最小执行单元 | `feature.yaml` |
| `flows` | 用例 = 元操作链 | `feature.yaml` |
| suite `steps` | Playwright 关键字步骤 | `suite.yaml` |

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
| fill / fill_form | fill / fillForm |
| pick_lov | pickLov |
| click_expect_api | clickExpectApi |
| assert | assert |
| set_var | setVar |

## 产物分区与对比

```text
artifacts/<base>_<ts>/          # 例：feat_e997aee9_2026-10-18T08-51-19-425Z
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

cases/generated/<base>_<ts>/suite.yaml   # 当前可执行脚本（再次 gen 覆盖同目录）
```

**推荐节奏**：`gen` → `test` 全绿 → 改源码或手改 `feature.yaml` → 再 `gen`（若已有元操作且尚无 v1，CLI 会询问是否存档 v1）→ `compare`。

也可在首版跑通后手动 `snapshot -l v1`；`gen` 询问存档与 snapshot 等价。

对比流水线：**`v1/` 基线 vs 功能目录根部 current**（`feature.yaml` + `cases/generated/.../suite.yaml`）→ `diff.yaml` → LLM → `report.yaml`。默认对比标签为 **v1**。diff 以 **operations → flows → meta_ops（按 id 对齐）** 为主；`suite` 段按 `case.id` 辅助核对编译漂移。

## CLI

**完整命令与选项见仓库根目录 [README.md](../README.md)。**

排障：`artifacts/<base>_<ts>/llm.raw.json`（分析）、`gen.llm.raw.json`（生成 suite）。

## 实现

- `codegen/runGenPipeline`：`analyzeFeatureFromSource`（可选写 artifact）→ `llmGenSuite` → `writeGeneratedSuite` / `writeFeatureElementsStub`
- `cli/index.ts`：`gen` 统一入口；`analyze` 为 `--meta-only` 兼容别名

## 遗留

- `defaultFlows.ts` / `compileFlow.ts`：当前 `gen` 不使用。
