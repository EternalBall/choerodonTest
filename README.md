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
├── cases/                  # 手写用例；generated/ 为编译输出
├── elements/               # 编译期元素合并结果（可重建）
├── artifacts/              # 分析草稿、探针输出（本地）
├── playwright/             # 登录态、Playwright 工程资源
├── tests/                  # Playwright 驱动测试入口
├── demo/                   # 本地演示页（可选）
└── reports/                # HTML 报告输出（本地）
```

各子目录细节见对应 `README.md`（`knowledge/`、`console/`、`src/`）。

## 一期能力范围（引擎）

参见 [ADR 0009](docs/adr/0009-phase1-scope.md)：

- 组件知识入库与消费
- 从功能主源码目录 **分析** 生成路径描述（能力摘要 + 测试流程 + 配套模型）
- **Playwright** 按 flows 编译执行
- **current** 与 **最新已确认** 对比、变更说明（规划中/迁入中）
- **确认** 前整包 flows 跑通（规划中/迁入中）

明确不做（一期）：业务仓同步布局、CI 质量门、线上沙盒、多平台并行。

## 相关仓库

| 仓库 | 角色 |
|------|------|
| **choerodonTest（本仓）** | 规格 + 引擎 + 平台知识 |
| **被测前端业务仓** | 可选：存放已确认功能版本路径描述 |


### 快速验证（demo）

```bash
cd choerodonTest
pnpm install
pnpm exec playwright install chromium
pnpm ata test -c cases/example-smoke.yaml --skip-auth
```

从功能描述生成用例：

```bash
pnpm ata gen -i path/to/feature.yaml
pnpm ata test -c cases/generated/<slug>.yaml
```
