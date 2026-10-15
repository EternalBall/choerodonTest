# 元操作与流程编排（meta_ops / flows）

## 概念

| 层 | 作用 |
|----|------|
| `operations` | 能力摘要（审核用）：查询/复制/站点分配… |
| `meta_ops` | 可编排最小执行单元（goto / click / pick_lov…） |
| `flows` | 测试用例 = 元操作链；**gen 只编译 flows** |

```
analyze → operations +（可空）meta_ops
       → defaultFlows 补全 meta_ops + flows(source=default)
Console 画布 → 改 flows(source=user)
gen → 每个 flow → TC_{NS}_{FLOW_ID}
```

## MetaOp kind

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
| assert | assert（步骤级 assert） |
| set_var | setVar |

## 默认 flows

`src/codegen/defaultFlows.ts` 按 `operations` 类型生成；**flow.id = operation.id**，保证用例 ID 稳定（如 `TC_…_SITE_ASSIGNMENT_UPDATE`）。

- `source: default`：规则生成，可被 gen/solidify 刷新（同 id 且无 user 覆盖时）
- `source: user`：画布保存后不再被默认规则覆盖

## 画布约定

- 一期单主链：恰好一个入度 0 的起点
- 节点 `position` 落盘便于重开
- 保存 API：`PUT /api/features/:id/flows`

## gen

`featureToSuite` → `ensureMetaOpsAndFlows` → `compileFlowToSteps`。无 flows 的旧产物会自动补默认。
