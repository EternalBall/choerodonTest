# web-auto-test（test-03）

本仓库是 **web-auto-test 的唯一实现仓**：入库维护**组件知识**，并提供**分析 / 执行 / 对比 / 确认**引擎。产品目标与术语见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [docs/adr/](./docs/adr/)。


## 本目录作用

| 层级 | 职责 | 是否提交 Git |
|------|------|----------------|
| **组件知识** | 平台 DOM 定位（Kit）、组件操作手册（Playbook） | 是 |
| **引擎** | 检索源码、分析路径描述、编译用例、Playwright 执行、探针辅助、对比与确认 | 是（`src/`、`console/`、`tests/`） |
| **功能产物** | 某功能的 current / 已确认版本、分析草稿、编译用例、报告 | **否**（本地或业务仓；见 `.gitignore`） |

与 [ADR 0001](docs/adr/0001-repo-owns-knowledge-and-engine-only.md)：引擎仓只拥有知识层与引擎层；功能实例级路径描述不作为本仓长期真相源提交（可保留 `_example` 演示）。

## 目录结构

```text
choerodonTest/
├── CONTEXT.md              # 领域术语与产品语言（评审用）
├── README.md               # 本文件：仓职责与目录说明
├── docs/adr/               # 架构决策记录
├── knowledge/
│   ├── platform/           # 平台定位 Kit（如 choerodon/kit.yaml）
│   ├── playbooks/          # 操作手册（分析识别元操作时遵循）
│   └── features/           # 功能路径描述落盘区（默认 gitignore，除 _example）
├── src/                    # 引擎源码（CLI、分析、沉淀、codegen、关键字、探针）
├── console/                # 本机操作台（API + Web：审核、编排 flows）
├── configs/                # 环境配置（如 env.yaml 模板）
├── cases/                  # 手写用例；generated/<slug>/ 为编译输出
├── elements/               # 编译期元素：elements/<slug>/generated.yaml（可重建）
├── artifacts/              # 分析草稿：artifacts/<slug>/feature.yaml（本地）
├── playwright/             # 登录态、Playwright 工程资源
├── tests/                  # Playwright 驱动测试入口
├── demo/                   # 本地演示页（可选）
└── reports/                # HTML 报告输出（本地）
```

各子目录细节见对应 `README.md`（`knowledge/`、`console/`、`src/`）。

## 一期能力范围（引擎）

参见 [ADR 0009](docs/adr/0009-phase1-scope.md)：

- 组件知识入库与消费
- 从功能主源码目录 **分析** 生成路径描述（能力摘要 + 配套模型；强制 LLM，见 [ADR 0011](docs/adr/0011-analyze-llm-only.md)）
- **生成**：读 `artifacts` 路径描述，经 LLM 产出 `cases/generated` suite YAML
- **Playwright** 按 suite 关键字执行
- **current** 与 **最新已确认** 对比、变更说明（规划中/迁入中）
- **确认** 前整包跑通（规划中/迁入中）

明确不做（一期）：业务仓同步布局、CI 质量门、线上沙盒、多平台并行。

## 相关仓库

| 仓库 | 角色 |
|------|------|
| **本仓（web-auto-test）** | 规格 + 引擎 + 平台知识 |
| **被测前端业务仓** | 分析时 `-p` 指向的源码根；可选存放已确认功能版本 |

## 用法

### 1. 安装与环境

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env   # 填入账号、BASE_URL、DEEPSEEK_API_KEY 等
```

`.env` 关键项：

| 变量 | 用途 |
|------|------|
| `DEEPSEEK_API_KEY` | **analyze / gen 均强制 LLM**，缺 key 或调用失败直接报错 |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 可选，默认 `https://api.deepseek.com` / `deepseek-chat` |
| `BASE_URL` | 被测环境（也可用 `configs/env.yaml`） |
| `TEST_USER` / `TEST_PASS` / `TEST_ROLE*` | 登录态（`ata auth`） |
| `TARGET_PROJECT` | `ata analyze -p` 默认源码根 |

引擎命令入口：`pnpm ata <command>`（实现见 `src/cli/`，细节见 [src/README.md](./src/README.md)）。

### 2. 主流程：分析 → 生成 → 执行

主流程见 [docs/meta-ops-flows.md](./docs/meta-ops-flows.md)：

1. **生成**（一条命令）：`ata gen -f … -p …` → 元操作 `feature.yaml` + 测试脚本 `suite.yaml` + 元素库
2. **执行**：`ata test` → `reports/` 报告

```text
被测源码
        │  ata gen -f … -p …  （分析 + 编译脚本）
        ▼
artifacts/<slug>/feature.yaml
cases/generated/<slug>/suite.yaml + elements/<slug>/generated.yaml
        │  ata test
        ▼
Playwright 报告（reports/）
```

**生成**（须 `DEEPSEEK_API_KEY`；playbooks 非空）：

```bash
pnpm ata gen -f <功能名> -p <被测前端源码根目录>
# 例：
pnpm ata gen -f Material -p "D:/path/to/feature/src"
pnpm ata gen -f 问题管理平台字段配置 -p "%TARGET_PROJECT%"
```

- 输出：元操作 `artifacts/<slug>/feature.yaml`、测试脚本 `cases/generated/<slug>/suite.yaml`、`elements/<slug>/generated.yaml`
- 已有元操作、只重生成脚本：`pnpm ata gen -i artifacts/<slug>/feature.yaml`
- `ata analyze` 已合并为 `gen`（仅元操作时用 `gen -f … -p … --meta-only`）

**执行**：

```bash
# 业务环境（需先登录态）
pnpm ata auth
pnpm ata test -c cases/generated/<slug>/suite.yaml

# 本地 demo（跳过登录）
pnpm ata test -c cases/example-smoke.yaml --skip-auth
pnpm ata test -c cases/generated/<slug>/suite.yaml --skip-auth

# 查看报告
pnpm report
```

### 3. 其它命令

```bash
pnpm ata actions    # 列出 suite 可用的 Playwright 关键字 action
pnpm ata auth       # 登录并写入 playwright/.auth/user.json
pnpm ata --help
```

### 4. 快速验证（仅 demo，不调 LLM）

```bash
pnpm install
pnpm exec playwright install chromium
pnpm ata test -c cases/example-smoke.yaml --skip-auth
```

元操作 / flows 概念见 [docs/meta-ops-flows.md](./docs/meta-ops-flows.md)。
