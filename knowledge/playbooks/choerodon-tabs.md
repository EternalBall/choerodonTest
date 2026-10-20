# Choerodon Tabs

源码：[components/tabs](https://github.com/open-hand/choerodon-ui/tree/master/components/tabs)（`components-pro/tabs` 为再导出）。  
前缀是 **`c7n-tabs`**（`c7n-prefix`），不是 `c7n-pro-tabs`。

## DOM

```
.c7n-tabs.c7n-tabs-top|bottom|left|right
  ├── .c7n-tabs-bar
  │     └── .c7n-tabs-nav
  │           ├── .c7n-tabs-tab                 # 页签
  │           │     └── .c7n-tabs-tab-active     # 当前
  │           └── .c7n-tabs-ink-bar
  └── .c7n-tabs-content
        ├── .c7n-tabs-tabpane                   # 激活面板
        └── .c7n-tabs-tabpane-inactive          # 隐藏（display:none 或 height:0）
```

分组：`.c7n-tabs-group` / `-group-item-selected`。二级：`.c7n-tabs-second-tab`。  
过多页签：`.c7n-tabs-tab-prev` / `-tab-next` 滚动箭头。

业务详情也常见 **Collapse 折叠面板**（非 Tabs）；见 create-detail「基础属性」——勿把 Collapse 标成 Tabs。

## 源码识别

```tsx
<Tabs activeKey={key} onChange={setKey}>
  <Tabs.TabPane tab="基础属性" key="base">…</Tabs.TabPane>
  <Tabs.TabPane tab="附件" key="file">…</Tabs.TabPane>
</Tabs>
```

`onChange` 若拉数：追 `dataSet.query` / request → 可记入切 Tab 后的 ready。  
只读详情多 Tab：`page_states` / `execution_chain` 含 `tab:附件` 一类步骤。

## 分析产物

```yaml
pages:
  - id: detail
operations:
  - id: detail_edit_attachment_tab
    page_id: detail
    preconditions: [enter_detail, click:editBtn, tab:附件]
    fields: [files]
```

`field_rules` 可 note「仅某 Tab 可见」。

## 自动化步骤

1. 在目标 `.c7n-tabs` 内（within 详情区，避免点到布局壳 Tabs）  
2. `click` `.c7n-tabs-tab` 且文案匹配（或 `getByRole('tab', { name })` 若可访问）  
3. 等待对应 tabpane **非** `-inactive` / 关键内容可见  
4. 再 fill / upload / 断言  

```yaml
tabsBar:
  css: .c7n-tabs-bar
tabsTabActive:
  css: .c7n-tabs-tab-active
tabPaneActive:
  css: .c7n-tabs-tabpane:not(.c7n-tabs-tabpane-inactive)
```

## 常见误判

| 错误 | 正确 |
|------|------|
| `.c7n-pro-tabs` | **`.c7n-tabs`** |
| 点 tab 后立刻操作隐藏面板 | 等 inactive 去掉 / 内容 visible |
| 页面顶栏全局 Tabs 与内容 Tabs 混淆 | within 功能根 / page-content |
| Collapse 头当 Tab | Collapse 是另一组件 |
