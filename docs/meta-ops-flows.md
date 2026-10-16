# 端到端流程：生成 → 执行

## 主链（两步）

| 步骤 | 命令 | 输入 | 输出 |
|------|------|------|------|
| **1. 生成** | `ata gen -f … -p …` | 被测源码 + Playbooks + Platform Kit | **元操作** `artifacts/<slug>/feature.yaml` + **测试脚本** `cases/generated/<slug>/suite.yaml` + `elements/<slug>/generated.yaml` |
| **2. 执行** | `ata test -c …` | suite + 元素库 | `reports/html` |

```text
被测源码
    │  ata gen -f <功能> -p <源码根>
    │    ① LLM 分析源码 → 元操作产物
    │    ② LLM + playbooks → suite；kit 合并 → elements
    ▼
artifacts/<slug>/feature.yaml
cases/generated/<slug>/suite.yaml
elements/<slug>/generated.yaml
    │  ata test
    ▼
reports/html
```

若已有元操作文件，可只重做测试脚本：`pnpm ata gen -i artifacts/<slug>/feature.yaml`。

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

## CLI

```bash
# 一步：元操作 + 测试脚本 + 元素库（须 DEEPSEEK_API_KEY）
pnpm ata gen -f <功能名> -p <被测前端源码根>

# 仅根据已有元操作重新生成脚本
pnpm ata gen -i artifacts/<slug>/feature.yaml

# 执行
pnpm ata auth
pnpm ata test -c cases/generated/<slug>/suite.yaml
pnpm report
```

排障：`artifacts/<slug>/llm.raw.json`（分析）、`gen.llm.raw.json`（生成 suite）。

## 实现

- `codegen/runGenPipeline`：`analyzeFeatureFromSource`（可选写 artifact）→ `llmGenSuite` → `writeGeneratedSuite` / `writeFeatureElementsStub`
- `cli/index.ts`：`gen` 统一入口；`analyze` 为 `--meta-only` 兼容别名

## 遗留

- `defaultFlows.ts` / `compileFlow.ts`：当前 `gen` 不使用。
