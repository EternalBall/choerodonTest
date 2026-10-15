# 接口识别与绑定（API binding）

自动化里 `clickExpectApi` 的 `urlIncludes` **只能**来自源码字面量，禁止按页面名 / 资源名猜 REST（如把站点分配猜成 `mt-material-site/save/ui`）。

真实例：`SaveMaterialSiteAssignment` → `…/mt-material/save/site/ui`（custom `useRequest`），不是 DS 资源名拼出来的路径。

## 多源识别（按触发链，不按「有没有 DS」）

从 **UI 触发** 往下追，覆盖下列形态：

| 优先级 | 形态 | 线索 |
|--------|------|------|
| 1 | services 工厂 | `export function SaveXxx() { return { url, method } }` |
| 2 | useRequest / hooks | `useRequest(SaveXxx(), { manual })` → `runSave` / `run` |
| 3 | 事件内联 | `onClick` / `handleSave` 内 `request({ url })` / `fetch` / `axios` |
| 4 | DS transport | `transport.create` / `update` / `destroy` / `submit` |
| 5 | 再跳一层 | `xxxService.save()` → 继续跟到 1～3 |

DS 只是通道之一；页头保存、行内动作、抽屉确认经常是 1～3。

## 分析流程

```
触发（保存 / 确认 / Radio）
  → 处理函数（handleSave / onConfirm）
  → 调用（runSave / ds.submit / request / SaveXxx）
  → 解析 url 字面量 + method
  → 写入 operation.api（绑定本动作）
  → 同时进入 apis[]（全集）
```

硬规则：

1. **有字面量才写 `api`**；只有符号未见 url → 留空 + REVIEW gap，禁止编造。
2. **一个 op 只绑「点下去会发的那条」**；同页 query / check 另记，勿塞进保存监听。
3. 一次点击多请求：`urlIncludes` 可含相关针；`successUrlIncludes` 只写最终成功保存针。
4. `operation.api` 应能在检索源码或 `apis[]` 中找到；对不上则清空，勿 enrich 硬编码猜路径。

## 产物字段

```yaml
operations:
  - id: site_assignment_update
    api: /v1/{tenantId}/mt-material/save/site/ui
    api_source: services/index.ts#SaveMaterialSiteAssignment
    api_kind: custom_request   # custom_request | ds_transport | inline | unknown
apis:
  - /v1/{tenantId}/mt-material/save/site/ui
  - /v1/{tenantId}/mt-material-site/site/ui   # 查询，勿当保存
```

| api_kind | 含义 |
|----------|------|
| `custom_request` | services / useRequest / 业务封装 |
| `ds_transport` | DataSet transport |
| `inline` | 处理函数内直接写 url |
| `unknown` | 未解析到字面量（勿填假 api） |

## 常见误判

| 错误 | 正确 |
|------|------|
| `mt-material-site/save/ui`（资源名猜） | `mt-material/save/site/ui`（services 字面量） |
| 用 query 的 `…/site/ui` 当保存监听 | 保存用 `save/site`；query 另用 |
| 详情保存 url 套到站点分配 | 各 op 各自绑定 |

## gen 约定

- `clickExpectApi.urlIncludes` ← `apiPathNeedle(op.api)`，可回退 `artifact.apis` 中匹配本 op 语义的项。
- **缺 api**：不写死猜的 needle；可跳过 API 断言或标 REVIEW。
- 禁止在 gen 里硬编码 `mt-material-site/save/ui` 一类猜测路径。
