# ATA Console（本机操作台）

可选本机 UI：选择功能、触发 CLI 步骤、审核 DOM 候选、编排 `meta_ops` → `flows`。

| 部分 | 作用 |
|------|------|
| `server/` | 本机 API（仅 127.0.0.1）：读写信 knowledge、SSE 日志 |
| `web/` | 前端：审核页、Flow 画布（保存 `source=user` 的 flows） |

启动方式在根 `README` 迁入 `package.json` 后补充，预期：`pnpm console`。

与引擎仓同仓维护；不部署为线上服务（一期）。
