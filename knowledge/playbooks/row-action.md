# 行内动作 row_action

适用于：子表/列表里 Radio、Switch、行按钮，调专用 API，**不**走页头「编辑→保存」。

## 分析产物

```yaml
type: row_action
entry: row_action
initial_mode: view          # 多数只读页可点
api: /v1/.../xxx
row_target:
  area: secondaryUomTable
  control: radio            # radio | switch | button | link
  column: defaultFlag
  element: defaultSecondaryUomRadio
```

禁止标成 `update`。LLM 识别 Table `renderer` + 独立 `useRequest` 接口。

## 生成步骤

筛选 → 进详情（view ready）→ `clickExpectApi` 点 `row_target.element` 并校验 `api`。

`api` 须为源码字面量（services / useRequest / 内联 request / DS transport），见 [api-binding.md](./api-binding.md)。

多个同类操作 = 多条 `row_action`，共用模板，换 api / element。

若入口是「更多」下拉再点菜单项，见 [choerodon-row-dropdown.md](./choerodon-row-dropdown.md)（先展开 Menu，再点项）。
